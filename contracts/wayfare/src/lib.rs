//! Wayfare: an AI agent books your trip and pays the merchants, on other chains, but only this contract can sign.
//!
//! - Each traveler has a wallet on EVM chains (Base) whose key is held by NEAR's MPC network (Chain Signatures)
//!   under this contract's account and the path `wayfare/<traveler>`. Nobody else, the agent included, can sign
//!   for it. The traveler funds it with USDC.
//! - The traveler approves a trip: the plan's hash, a budget, the items (each a merchant and the most it may cost),
//!   which vault fields (name, passport number, …) the agent may read, and an end time. The trip names one agent.
//! - The agent books on the merchants' sites. When a checkout asks for payment (x402, HTTP 402) the agent calls
//!   `pay`. The contract checks the trip, the item's approved price and the budget, then builds the USDC
//!   `TransferWithAuthorization` itself (to the merchant's registered address, never one the agent picks) and asks
//!   the MPC signer to sign it. Anything outside the rules is refused and logged, not signed.
//! - Every vault read and payment is logged and folded into a per-trip hash chain (`receipt_head`), so anyone can
//!   re-hash the trip's events and check nothing was left out.
//! - `end_trip` stops the agent at once: no more payments, no more vault reads. A signed authorization lives at
//!   most `MAX_AUTH_SEC`, so nothing signed before the end can be used for long after it.
//! - The traveler can always move their USDC out with `withdraw`, which is signed without trip rules.
//! - Merchants can also be paid on NEAR itself (x402 `exact` on `near:testnet`): the trip wallet there is an implicit
//!   account whose ed25519 key the MPC network holds at the same path, and the contract signs a NEP-366 delegate
//!   action holding one USDC `ft_transfer` (see near_pay.rs). The same trip rules apply on every chain.
//! - When a merchant cancels a booking (a cancelled flight), it refunds the USDC and signs a cancellation notice
//!   with its own payment key. `record_cancellation` checks that signature against the merchant's registered
//!   address and the exact payment it settled, so the agent cannot invent a refund. The refund goes back into the
//!   trip's budget, and the item may be rebooked for up to its approved price plus the trip's auto-rebook margin
//!   (`rebook_pct`, set by the traveler). Anything above that needs the traveler's `approve_rebook`.
//!
//! Amounts are the token's smallest unit (USDC: 6 decimals). Times are nanoseconds unless a name says `_sec`.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::store::{IterableMap, LookupMap, LookupSet, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue,
};

pub mod eip712;
mod events;
pub mod near_pay;
use near_pay::{NearAuthorization, NearNetwork, NearWallet};
use eip712::{addr_str, Address};
use events::Event;

#[cfg(test)]
mod tests;

const SEC: u64 = 1_000_000_000;
const MAX_ITEMS: usize = 12;
const MAX_FIELDS: usize = 12;
const MAX_PAYMENTS: usize = 24;
const MAX_READS: usize = 40;
const MAX_TEXT: usize = 120;
const MIN_TRIP_SEC: u32 = 60;
const MAX_TRIP_SEC: u32 = 30 * 86_400;
/// A signed payment authorization is valid for at most this long.
pub const MAX_AUTH_SEC: u64 = 900;
/// Kept by the contract: pays the storage of a trip, its payments and its vault reads.
pub const TRIP_FEE: NearToken = NearToken::from_millinear(250);
/// Kept by the contract: pays the storage of a wallet record.
pub const WALLET_FEE: NearToken = NearToken::from_millinear(10);
/// `pay` and `withdraw` need this much gas: the MPC signer takes most of it.
pub const PAY_GAS: Gas = Gas::from_tgas(250);
/// The auto-rebook margin can't exceed this (percent of the item's approved price).
pub const MAX_REBOOK_PCT: u16 = 100;
const SIGN_GAS: Gas = Gas::from_tgas(100);
const CALLBACK_GAS: Gas = Gas::from_tgas(15);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Merchants,
    Wallets,
    Trips,
    TravelerTrips,
    Payments,
    Reads,
    Nonces,
}

/// A chain and the USDC contract on it.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Network {
    /// CAIP-2, as x402 names it: "eip155:84532"
    pub id: String,
    pub label: String,
    pub chain_id: u64,
    pub token: String,
    /// The token's EIP-712 domain name and version ("USDC", "2" on Base).
    pub token_name: String,
    pub token_version: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Merchant {
    pub id: String,
    pub name: String,
    /// "rail", "flight", "hotel", "dining", …
    pub category: String,
    pub network: String,
    pub pay_to: String,
    /// Where its site is, for people reading a trip.
    pub url: String,
    pub active: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Wallet {
    /// The MPC derivation path: `wayfare/<traveler>`.
    pub path: String,
    /// The EVM address the MPC key at `path` controls (the traveler registers it; see `set_wallet`).
    pub address: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub merchant_id: String,
    pub label: String,
    /// The most the agent may pay for this item, in total.
    pub max: U128,
    /// Signed so far.
    pub paid: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TripStatus {
    Active,
    Ended,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Trip {
    pub id: U64,
    pub traveler: AccountId,
    pub agent: AccountId,
    pub title: String,
    /// sha256 hex of the plan the traveler approved.
    pub plan_hash: String,
    pub budget: U128,
    pub spent: U128,
    pub items: Vec<Item>,
    pub vault_fields: Vec<String>,
    pub created_at: U64,
    pub expires_at: U64,
    pub status: TripStatus,
    pub payments: Vec<U64>,
    pub reads: Vec<U64>,
    pub refusals: u32,
    /// sha256 chain over this trip's event logs: head = sha256(head_hex + "\n" + log line).
    pub receipt_head: String,
}

#[near(serializers = [json])]
pub struct TripView {
    #[serde(flatten)]
    pub trip: Trip,
    /// "active", "expired" or "ended"
    pub phase: String,
    pub rebook_pct: u16,
    pub cancellations: Vec<Cancellation>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PaymentStatus {
    Pending,
    Signed,
    Failed,
}

/// The fields x402 sends as `authorization` (numbers as decimal strings).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Authorization {
    pub from: String,
    pub to: String,
    pub value: String,
    pub valid_after: String,
    pub valid_before: String,
    pub nonce: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payment {
    pub id: U64,
    /// None for a traveler's `withdraw`.
    pub trip_id: Option<U64>,
    pub item: Option<u32>,
    pub merchant_id: Option<String>,
    pub requested_by: AccountId,
    pub network: String,
    pub amount: U128,
    pub authorization: Authorization,
    pub digest: String,
    pub status: PaymentStatus,
    /// 65 bytes r‖s‖v, hex, once signed.
    pub signature: Option<String>,
    /// The settlement transaction on the merchant's chain, as reported by the agent.
    pub settled_tx: Option<String>,
    pub created_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct VaultRead {
    pub id: U64,
    pub trip_id: U64,
    pub agent: AccountId,
    pub fields: Vec<String>,
    pub purpose: String,
    pub at: U64,
}

/// A booking the merchant cancelled and refunded, proven by the merchant's own signature.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Cancellation {
    pub item: u32,
    /// The payment the merchant refunded.
    pub payment_id: U64,
    pub merchant_id: String,
    pub booking_ref: String,
    pub refund: U128,
    /// The refund transaction on the merchant's chain.
    pub refund_tx: String,
    /// The most a replacement booking may cost without asking the traveler.
    pub rebook_max: U128,
    pub at: U64,
}

#[near(serializers = [json])]
pub struct ItemArgs {
    pub merchant_id: String,
    pub label: String,
    pub max: U128,
}

#[near(serializers = [json])]
pub struct TripArgs {
    pub agent: AccountId,
    pub title: String,
    pub plan_hash: String,
    pub budget: U128,
    pub items: Vec<ItemArgs>,
    pub vault_fields: Vec<String>,
    pub duration_sec: u32,
    /// If a merchant cancels a booking, the agent may rebook it for up to this much more (percent) on its own.
    pub rebook_pct: Option<u16>,
}

#[near(serializers = [json])]
pub struct PayArgs {
    pub trip_id: U64,
    pub item: u32,
    pub amount: U128,
    /// 32 random bytes, hex. USDC refuses a nonce the wallet has used before.
    pub nonce: String,
    /// Unix seconds; at most `MAX_AUTH_SEC` from now and not after the trip ends.
    pub valid_before: U64,
}

#[near(serializers = [json])]
pub struct WithdrawArgs {
    pub network: String,
    pub to: String,
    pub amount: U128,
    pub nonce: String,
    pub valid_before: U64,
}

/// What `pay` and `withdraw` return. `signed` carries everything an x402 `X-PAYMENT` header needs.
#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct PayOutcome {
    /// "signed", "refused" or "failed"
    pub status: String,
    pub trip_id: Option<U64>,
    pub payment_id: Option<U64>,
    pub reason: Option<String>,
    pub network: Option<String>,
    pub authorization: Option<Authorization>,
    /// EVM: 65 bytes r‖s‖v, hex. NEAR: the 64-byte ed25519 signature, hex.
    pub signature: Option<String>,
    /// NEAR payments: the delegate action the signature is for.
    pub near: Option<NearAuthorization>,
}

impl PayOutcome {
    fn refused(trip_id: u64, reason: String) -> Self {
        Self { status: "refused".into(), trip_id: Some(U64(trip_id)), payment_id: None, reason: Some(reason), network: None, authorization: None, signature: None, near: None }
    }
}

fn check_text(s: &str, what: &str) {
    require!(!s.trim().is_empty() && s.len() <= MAX_TEXT, format!("{what}: 1-{MAX_TEXT} characters"));
}

fn sha256_hex(b: &[u8]) -> String {
    eip712::hex(&env::sha256_array(b))
}

/// Logs the event and folds the log line into the trip's receipt chain.
fn emit(trip: &mut Trip, ev: Event) {
    let line = { use near_sdk::AsNep297Event; ev.to_nep297_event().to_event_log() };
    env::log_str(&line);
    trip.receipt_head = sha256_hex(format!("{}\n{}", trip.receipt_head, line).as_bytes());
}

fn emit_plain(ev: Event) {
    env::log_str(&{ use near_sdk::AsNep297Event; ev.to_nep297_event().to_event_log() });
}

// Side tables added after the first deploy: their own key prefixes, so the existing state needs no migration.
fn rebook_rules() -> LookupMap<u64, u16> {
    LookupMap::new(b"x:rebook".to_vec())
}
fn cancellations() -> LookupMap<u64, Vec<Cancellation>> {
    LookupMap::new(b"x:cancel".to_vec())
}

/// What a merchant signs (EIP-191 personal_sign) when it cancels and refunds a booking.
pub fn cancellation_message(booking_ref: &str, paid_tx: &str, refund: u128, refund_tx: &str) -> String {
    format!("Wayfare cancellation\nbooking: {booking_ref}\npaid tx: {paid_tx}\nrefund: {refund}\nrefund tx: {refund_tx}")
}

/// The EVM address that signed `message` with personal_sign, or None.
pub fn personal_sign_signer(message: &str, signature: &str) -> Option<Address> {
    let sig = eip712::unhex(signature, "signature");
    if sig.len() != 65 {
        return None;
    }
    let v = match sig[64] {
        27 | 28 => sig[64] - 27,
        0 | 1 => sig[64],
        _ => return None,
    };
    let prefixed = [format!("\x19Ethereum Signed Message:\n{}", message.len()).as_bytes(), message.as_bytes()].concat();
    let hash = env::keccak256_array(&prefixed);
    let pk = env::ecrecover(&hash, &sig[..64], v, true)?;
    let h = env::keccak256_array(&pk);
    Some(h[12..].try_into().unwrap())
}

/// secp256k1 order n and n/2: Ethereum (and USDC) only accept the low-s form of a signature.
const N: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe, 0xba, 0xae, 0xdc,
    0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
];
const HALF_N: [u8; 32] = [
    0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x5d, 0x57, 0x6e,
    0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0,
];

fn sub(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let mut d = a[i] as i16 - b[i] as i16 - borrow;
        borrow = if d < 0 { d += 256; 1 } else { 0 };
        out[i] = d as u8;
    }
    out
}

/// The MPC signer's answer → 65-byte Ethereum signature r‖s‖v, normalized to low s.
pub fn to_eth_signature(v: &Value) -> Option<String> {
    let big_r = v.get("big_r")?.get("affine_point")?.as_str()?;
    let s = v.get("s")?.get("scalar")?.as_str()?;
    let rec = v.get("recovery_id")?.as_u64()?;
    if big_r.len() != 66 || s.len() != 64 || rec > 1 {
        return None;
    }
    let ok_hex = |x: &str| x.bytes().all(|c| c.is_ascii_hexdigit());
    if !ok_hex(big_r) || !ok_hex(s) {
        return None;
    }
    let r = &big_r[2..];
    let mut s_bytes: [u8; 32] = (0..32).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect::<Vec<_>>().try_into().ok()?;
    let mut rec = rec as u8;
    if s_bytes > HALF_N {
        s_bytes = sub(&N, &s_bytes);
        rec ^= 1;
    }
    Some(format!("0x{}{}{:02x}", r.to_lowercase(), eip712::hex(&s_bytes), 27 + rec))
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Wayfare {
    owner: AccountId,
    mpc: AccountId,
    networks: Vec<Network>,
    merchants: IterableMap<String, Merchant>,
    wallets: LookupMap<AccountId, Wallet>,
    trips: LookupMap<u64, Trip>,
    next_trip: u64,
    traveler_trips: LookupMap<AccountId, Vec<u64>>,
    payments: Vector<Payment>,
    reads: Vector<VaultRead>,
    /// from-address ‖ nonce: never sign the same nonce twice for a wallet.
    nonces: LookupSet<Vec<u8>>,
}

#[near]
impl Wayfare {
    /// `mpc`: `v1.signer-prod.testnet` on testnet, `v1.signer` on mainnet.
    #[init]
    pub fn new(owner: AccountId, mpc: AccountId, networks: Vec<Network>) -> Self {
        let mut c = Self {
            owner,
            mpc,
            networks: vec![],
            merchants: IterableMap::new(StorageKey::Merchants),
            wallets: LookupMap::new(StorageKey::Wallets),
            trips: LookupMap::new(StorageKey::Trips),
            next_trip: 1,
            traveler_trips: LookupMap::new(StorageKey::TravelerTrips),
            payments: Vector::new(StorageKey::Payments),
            reads: Vector::new(StorageKey::Reads),
            nonces: LookupSet::new(StorageKey::Nonces),
        };
        for n in networks {
            c.check_network(&n);
            c.networks.push(n);
        }
        c
    }

    // ---------- owner ----------

    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }

    fn check_network(&self, n: &Network) {
        check_text(&n.id, "network id");
        check_text(&n.label, "network label");
        check_text(&n.token_name, "token name");
        check_text(&n.token_version, "token version");
        eip712::address(&n.token, "token");
        require!(n.id.starts_with("eip155:") && n.id[7..] == n.chain_id.to_string(), "network id must be eip155:<chain_id>");
        require!(self.networks.iter().all(|x| x.id != n.id), "network already added");
    }

    pub fn add_network(&mut self, network: Network) {
        self.only_owner();
        self.check_network(&network);
        self.networks.push(Network { token: addr_str(&eip712::address(&network.token, "token")), ..network });
    }

    /// Adds a NEAR network (x402 `exact` on NEAR) and its USDC contract.
    pub fn add_near_network(&mut self, network: NearNetwork) {
        self.only_owner();
        check_text(&network.label, "network label");
        require!(near_pay::is_near_network(&network.id) && network.id.len() <= 32, "network id must be near:<name>");
        let mut nets = near_pay::near_networks();
        require!(!nets.contains_key(&network.id), "network already added");
        let mut ids = near_pay::near_network_ids();
        let mut list = ids.get(&0).cloned().unwrap_or_default();
        list.push(network.id.clone());
        ids.insert(0, list);
        nets.insert(network.id.clone(), network);
        nets.flush();
        ids.flush();
    }

    fn known_network(&self, id: &str) -> bool {
        self.networks.iter().any(|n| n.id == id) || near_pay::near_networks().contains_key(&id.to_string())
    }

    /// A merchant's receiving address: an EVM address on eip155 networks, an account on NEAR.
    fn pay_to_for(network: &str, pay_to: &str) -> String {
        if near_pay::is_near_network(network) {
            pay_to.parse::<AccountId>().unwrap_or_else(|_| env::panic_str("pay_to: a NEAR account")).to_string()
        } else {
            addr_str(&eip712::address(pay_to, "pay_to"))
        }
    }

    pub fn add_merchant(&mut self, id: String, name: String, category: String, network: String, pay_to: String, url: String) {
        self.only_owner();
        for (s, what) in [(&id, "merchant id"), (&name, "name"), (&category, "category"), (&url, "url")] {
            check_text(s, what);
        }
        require!(id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-'), "merchant id: a-z, 0-9, -");
        require!(self.known_network(&network), "unknown network");
        require!(!self.merchants.contains_key(&id), "merchant already added");
        let pay_to = Self::pay_to_for(&network, &pay_to);
        emit_plain(Event::MerchantAdded { merchant_id: id.clone(), category: category.clone(), network: network.clone(), pay_to: pay_to.clone() });
        self.merchants.insert(id.clone(), Merchant { id, name, category, network, pay_to, url, active: true });
    }

    /// Moves a merchant to another network (same receiving address: an EVM key works on every EVM chain).
    /// Only future payments change; anything already signed keeps the network it was signed for.
    pub fn set_merchant_network(&mut self, id: String, network: String) {
        self.only_owner();
        require!(self.networks.iter().any(|n| n.id == network), "unknown network");
        let m = self.merchants.get_mut(&id).unwrap_or_else(|| env::panic_str("unknown merchant"));
        require!(!near_pay::is_near_network(&m.network), "this merchant is paid on NEAR: use set_merchant_payee");
        m.network = network.clone();
        emit_plain(Event::MerchantNetworkSet { merchant_id: id, network });
    }

    /// Moves a merchant to any network with a new receiving address (an EVM address, or a NEAR account on NEAR).
    pub fn set_merchant_payee(&mut self, id: String, network: String, pay_to: String) {
        self.only_owner();
        require!(self.known_network(&network), "unknown network");
        let pay_to = Self::pay_to_for(&network, &pay_to);
        let m = self.merchants.get_mut(&id).unwrap_or_else(|| env::panic_str("unknown merchant"));
        m.network = network.clone();
        m.pay_to = pay_to.clone();
        emit_plain(Event::MerchantPayeeSet { merchant_id: id, network, pay_to });
    }

    pub fn set_merchant_active(&mut self, id: String, active: bool) {
        self.only_owner();
        let m = self.merchants.get_mut(&id).unwrap_or_else(|| env::panic_str("unknown merchant"));
        m.active = active;
        emit_plain(Event::MerchantUpdated { merchant_id: id, active });
    }

    // ---------- traveler ----------

    pub fn wallet_path(&self, traveler: AccountId) -> String {
        format!("wayfare/{traveler}")
    }

    /// Registers the EVM address of the MPC key at `wayfare/<you>` (read it with the signer's
    /// `derived_public_key(path, predecessor = this contract)`). A wrong address cannot leak funds: signatures
    /// always come from your own path's key, and USDC rejects them for any other `from`.
    #[payable]
    pub fn set_wallet(&mut self, address: String) {
        let traveler = env::predecessor_account_id();
        let address = addr_str(&eip712::address(&address, "address"));
        if !self.wallets.contains_key(&traveler) {
            require!(env::attached_deposit() >= WALLET_FEE, format!("attach {} yoctoNEAR for storage", WALLET_FEE.as_yoctonear()));
        }
        let path = self.wallet_path(traveler.clone());
        emit_plain(Event::WalletSet { traveler: traveler.clone(), address: address.clone(), path: path.clone() });
        self.wallets.insert(traveler, Wallet { path, address });
    }

    /// Registers your trip wallet on NEAR: the ed25519 key the MPC network holds at `wayfare/<you>` (domain 1; read
    /// it with the signer's `derived_public_key(path, predecessor = this contract, domain_id = 1)`). Its implicit
    /// account is the wallet. As with `set_wallet`, a wrong key cannot leak funds: it just can't pay.
    #[payable]
    pub fn set_near_wallet(&mut self, public_key: String) {
        let traveler = env::predecessor_account_id();
        let (_, account_id) = near_pay::ed25519_key(&public_key);
        let mut all = near_pay::near_wallets();
        if !all.contains_key(&traveler) {
            require!(env::attached_deposit() >= WALLET_FEE, format!("attach {} yoctoNEAR for storage", WALLET_FEE.as_yoctonear()));
        }
        let path = self.wallet_path(traveler.clone());
        emit_plain(Event::NearWalletSet { traveler: traveler.clone(), account_id: account_id.clone(), path: path.clone() });
        all.insert(traveler, NearWallet { path, public_key, account_id });
        all.flush();
    }

    #[payable]
    pub fn create_trip(&mut self, trip: TripArgs) -> U64 {
        let traveler = env::predecessor_account_id();
        require!(env::attached_deposit() >= TRIP_FEE, format!("attach {} yoctoNEAR for storage", TRIP_FEE.as_yoctonear()));
        require!(self.wallets.contains_key(&traveler), "set your wallet first");
        check_text(&trip.title, "title");
        require!(trip.plan_hash.len() == 64 && eip712::unhex(&trip.plan_hash, "plan_hash").len() == 32, "plan_hash: sha256 hex");
        require!(!trip.items.is_empty() && trip.items.len() <= MAX_ITEMS, format!("1-{MAX_ITEMS} items"));
        require!(trip.vault_fields.len() <= MAX_FIELDS, format!("at most {MAX_FIELDS} vault fields"));
        for f in &trip.vault_fields {
            check_text(f, "vault field");
        }
        require!((MIN_TRIP_SEC..=MAX_TRIP_SEC).contains(&trip.duration_sec), format!("duration: {MIN_TRIP_SEC}-{MAX_TRIP_SEC} s"));
        let rebook_pct = trip.rebook_pct.unwrap_or(0);
        require!(rebook_pct <= MAX_REBOOK_PCT, format!("rebook_pct: 0-{MAX_REBOOK_PCT}"));
        let mut total: u128 = 0;
        let mut items = Vec::with_capacity(trip.items.len());
        for it in trip.items {
            check_text(&it.label, "item label");
            let m = self.merchants.get(&it.merchant_id).unwrap_or_else(|| env::panic_str(&format!("unknown merchant {}", it.merchant_id)));
            require!(m.active, format!("merchant {} is not active", m.id));
            require!(it.max.0 > 0, "item max must be > 0");
            total = total.checked_add(it.max.0).unwrap_or_else(|| env::panic_str("overflow"));
            items.push(Item { merchant_id: it.merchant_id, label: it.label, max: it.max, paid: U128(0) });
        }
        require!(total <= trip.budget.0, "items add up to more than the budget");
        let now = env::block_timestamp();
        let id = self.next_trip;
        self.next_trip += 1;
        let mut t = Trip {
            id: U64(id),
            traveler: traveler.clone(),
            agent: trip.agent,
            title: trip.title,
            plan_hash: trip.plan_hash.to_lowercase(),
            budget: trip.budget,
            spent: U128(0),
            items,
            vault_fields: trip.vault_fields,
            created_at: U64(now),
            expires_at: U64(now + trip.duration_sec as u64 * SEC),
            status: TripStatus::Active,
            payments: vec![],
            reads: vec![],
            refusals: 0,
            receipt_head: "0".repeat(64),
        };
        let ev = Event::TripCreated {
            trip_id: U64(id),
            traveler: traveler.clone(),
            agent: t.agent.clone(),
            plan_hash: t.plan_hash.clone(),
            budget: t.budget,
            items: t.items.len() as u32,
            expires_at: t.expires_at,
        };
        emit(&mut t, ev);
        self.trips.insert(id, t);
        if rebook_pct > 0 {
            let mut rules = rebook_rules();
            rules.insert(id, rebook_pct);
            rules.flush();
        }
        self.traveler_trips.entry(traveler).or_default().push(id);
        U64(id)
    }

    /// Stops the agent at once: no more payments or vault reads on this trip.
    pub fn end_trip(&mut self, trip_id: U64) {
        let t = self.trips.get_mut(&trip_id.0).unwrap_or_else(|| env::panic_str("unknown trip"));
        require!(env::predecessor_account_id() == t.traveler, "only the traveler");
        require!(t.status == TripStatus::Active, "trip already ended");
        t.status = TripStatus::Ended;
        let ev = Event::TripEnded { trip_id, spent: t.spent, unspent: U128(t.budget.0 - t.spent.0) };
        emit(t, ev);
    }

    /// Moves the traveler's own USDC out of their wallet, with no trip rules.
    /// On NEAR: `to` is an account, `nonce` the delegate-action nonce (decimal) and `valid_before` its max block height.
    pub fn withdraw(&mut self, args: WithdrawArgs) -> Promise {
        let traveler = env::predecessor_account_id();
        if near_pay::is_near_network(&args.network) {
            require!(args.amount.0 > 0, "amount must be > 0");
            let to = Self::pay_to_for(&args.network, &args.to);
            let (wallet, auth, digest) = self.near_authorize(&traveler, &args.network, &to, args.amount.0, &args.nonce, args.valid_before.0, "wayfare: back to savings");
            let id = self.push_payment(None, None, None, traveler, args.network, args.amount, auth, digest.clone());
            return self.sign_near(wallet.path, digest, id);
        }
        let wallet = self.wallets.get(&traveler).cloned().unwrap_or_else(|| env::panic_str("no wallet"));
        let network = self.networks.iter().find(|n| n.id == args.network).cloned().unwrap_or_else(|| env::panic_str("unknown network"));
        require!(args.amount.0 > 0, "amount must be > 0");
        let to = eip712::address(&args.to, "to");
        let (auth, digest) = self.authorize(&wallet, &network, to, args.amount.0, &args.nonce, args.valid_before.0);
        let id = self.payments.len() as u64;
        self.payments.push(Payment {
            id: U64(id),
            trip_id: None,
            item: None,
            merchant_id: None,
            requested_by: traveler,
            network: network.id,
            amount: args.amount,
            authorization: auth,
            digest: digest.clone(),
            status: PaymentStatus::Pending,
            signature: None,
            settled_tx: None,
            created_at: U64(env::block_timestamp()),
        });
        self.sign(wallet.path, digest, id)
    }

    // ---------- agent ----------

    /// Asks the contract to pay for one item of the trip. Signed if it fits the rules; refused (and logged) if not.
    pub fn pay(&mut self, args: PayArgs) -> PromiseOrValue<PayOutcome> {
        let caller = env::predecessor_account_id();
        let tid = args.trip_id.0;
        let t = self.trips.get(&tid).cloned().unwrap_or_else(|| env::panic_str("unknown trip"));
        require!(caller == t.agent, "only this trip's agent");
        let idx = args.item as usize;
        require!(idx < t.items.len(), "unknown item");
        require!(args.amount.0 > 0, "amount must be > 0");
        let item = t.items[idx].clone();
        let merchant = self.merchants.get(&item.merchant_id).cloned().unwrap();
        let on_near = near_pay::is_near_network(&merchant.network);
        let now = env::block_timestamp();

        let refusal = if t.status == TripStatus::Ended {
            Some("the traveler ended this trip".to_string())
        } else if now >= t.expires_at.0 {
            Some("the trip has expired".to_string())
        } else if !merchant.active {
            Some(format!("merchant {} is suspended", merchant.id))
        } else if t.payments.len() >= MAX_PAYMENTS {
            Some(format!("this trip already has {MAX_PAYMENTS} payments"))
        } else if item.paid.0 + args.amount.0 > item.max.0 && Self::was_cancelled(tid, args.item) {
            Some(format!("the replacement for \"{}\" costs {}, over the auto-rebook limit of {}: the traveler must approve it", item.label, args.amount.0, item.max.0 - item.paid.0))
        } else if item.paid.0 + args.amount.0 > item.max.0 {
            Some(format!("over the approved price for \"{}\": {} already paid + {} asked > {} approved", item.label, item.paid.0, args.amount.0, item.max.0))
        } else if t.spent.0 + args.amount.0 > t.budget.0 {
            Some(format!("over the trip budget: {} spent + {} asked > {}", t.spent.0, args.amount.0, t.budget.0))
        } else {
            None
        };
        if let Some(reason) = refusal {
            let t = self.trips.get_mut(&tid).unwrap();
            t.refusals += 1;
            let ev = Event::PaymentRefused { trip_id: args.trip_id, item: args.item, amount: args.amount, reason: reason.clone() };
            emit(t, ev);
            return PromiseOrValue::Value(PayOutcome::refused(tid, reason));
        }

        if on_near {
            // the delegate action may not outlive the trip (a block is about a second)
            let blocks_left = args.valid_before.0.saturating_sub(env::block_height());
            require!(now + blocks_left * SEC <= t.expires_at.0, "valid_before is after the trip ends");
            let memo = format!("wayfare trip {} item {}", tid, args.item);
            let (wallet, auth, digest) = self.near_authorize(&t.traveler, &merchant.network, &merchant.pay_to, args.amount.0, &args.nonce, args.valid_before.0, &memo);
            let id = self.push_payment(Some(args.trip_id), Some(args.item), Some(merchant.id.clone()), caller, merchant.network.clone(), args.amount, auth, digest.clone());
            self.reserve(tid, idx, args.amount.0, id, &merchant.id, &digest);
            return PromiseOrValue::Promise(self.sign_near(wallet.path, digest, id));
        }
        let network = self.networks.iter().find(|n| n.id == merchant.network).cloned().unwrap();
        let wallet = self.wallets.get(&t.traveler).cloned().unwrap();
        let valid_before = args.valid_before.0;
        require!(valid_before * SEC <= t.expires_at.0, "valid_before is after the trip ends");
        let to = eip712::address(&merchant.pay_to, "pay_to");
        let (auth, digest) = self.authorize(&wallet, &network, to, args.amount.0, &args.nonce, valid_before);
        let id = self.push_payment(Some(args.trip_id), Some(args.item), Some(merchant.id.clone()), caller, network.id, args.amount, auth, digest.clone());
        self.reserve(tid, idx, args.amount.0, id, &merchant.id, &digest);
        PromiseOrValue::Promise(self.sign(wallet.path, digest, id))
    }

    #[allow(clippy::too_many_arguments)]
    fn push_payment(&mut self, trip_id: Option<U64>, item: Option<u32>, merchant_id: Option<String>, requested_by: AccountId, network: String, amount: U128, authorization: Authorization, digest: String) -> u64 {
        let id = self.payments.len() as u64;
        self.payments.push(Payment {
            id: U64(id),
            trip_id,
            item,
            merchant_id,
            requested_by,
            network,
            amount,
            authorization,
            digest,
            status: PaymentStatus::Pending,
            signature: None,
            settled_tx: None,
            created_at: U64(env::block_timestamp()),
        });
        id
    }

    /// Counts a payment against its item and the budget while it is being signed.
    fn reserve(&mut self, tid: u64, idx: usize, amount: u128, payment_id: u64, merchant_id: &str, digest: &str) {
        let t = self.trips.get_mut(&tid).unwrap();
        t.items[idx].paid = U128(t.items[idx].paid.0 + amount);
        t.spent = U128(t.spent.0 + amount);
        t.payments.push(U64(payment_id));
        let ev = Event::PaymentRequested { trip_id: U64(tid), payment_id: U64(payment_id), item: idx as u32, merchant_id: merchant_id.to_string(), amount: U128(amount), digest: digest.to_string() };
        emit(t, ev);
    }

    /// The agent reports the transaction that settled a payment on the merchant's chain (anyone can check it there).
    pub fn report_settled(&mut self, payment_id: U64, tx_hash: String) {
        let p = self.payments.get_mut(payment_id.0 as u32).unwrap_or_else(|| env::panic_str("unknown payment"));
        require!(env::predecessor_account_id() == p.requested_by, "only who asked for the payment");
        require!(p.status == PaymentStatus::Signed, "payment is not signed");
        require!(p.settled_tx.is_none(), "already reported");
        let tx_hash = if near_pay::is_near_network(&p.network) {
            // a NEAR transaction hash: base58 of 32 bytes
            let ok = (43..=44).contains(&tx_hash.len()) && tx_hash.bytes().all(|c| c.is_ascii_alphanumeric() && !b"0OIl".contains(&c));
            require!(ok, "tx_hash: a NEAR transaction hash (base58)");
            tx_hash
        } else {
            require!(tx_hash.len() == 66 && eip712::unhex(&tx_hash, "tx_hash").len() == 32, "tx_hash: 0x + 32 bytes hex");
            tx_hash.to_lowercase()
        };
        p.settled_tx = Some(tx_hash.clone());
        let (trip_id, tx) = (p.trip_id, tx_hash);
        if let Some(tid) = trip_id {
            let t = self.trips.get_mut(&tid.0).unwrap();
            emit(t, Event::PaymentSettled { trip_id: tid, payment_id, tx_hash: tx });
        }
    }

    /// Logs that the agent read vault fields for this trip. The vault server serves a field only after it sees
    /// this read on chain (`get_read`), and the read is in the trip's receipt chain.
    pub fn record_read(&mut self, trip_id: U64, fields: Vec<String>, purpose: String) -> U64 {
        let agent = env::predecessor_account_id();
        check_text(&purpose, "purpose");
        let id = self.reads.len() as u64;
        let t = self.trips.get_mut(&trip_id.0).unwrap_or_else(|| env::panic_str("unknown trip"));
        require!(agent == t.agent, "only this trip's agent");
        require!(t.status == TripStatus::Active && env::block_timestamp() < t.expires_at.0, "vault access has ended for this trip");
        require!(!fields.is_empty(), "no fields");
        for f in &fields {
            require!(t.vault_fields.contains(f), format!("field {f} is not granted for this trip"));
        }
        require!(t.reads.len() < MAX_READS, format!("this trip already has {MAX_READS} reads"));
        t.reads.push(U64(id));
        let ev = Event::VaultRead { trip_id, read_id: U64(id), agent: agent.clone(), fields: fields.clone(), purpose: purpose.clone() };
        emit(t, ev);
        self.reads.push(VaultRead { id: U64(id), trip_id, agent, fields, purpose, at: U64(env::block_timestamp()) });
        U64(id)
    }

    // ---------- cancellations and rebooking ----------

    fn was_cancelled(trip_id: u64, item: u32) -> bool {
        cancellations().get(&trip_id).is_some_and(|v| v.iter().any(|c| c.item == item))
    }

    /// Records a merchant's cancellation and refund. Anyone may submit it (usually the agent): it only counts if the
    /// merchant's registered payment key signed `cancellation_message` for a payment this trip settled with it.
    /// The refund goes back into the budget, and the item may be rebooked for up to its approved price plus the
    /// trip's auto-rebook margin.
    pub fn record_cancellation(&mut self, trip_id: U64, payment_id: U64, booking_ref: String, refund: U128, refund_tx: String, signature: String) -> Cancellation {
        check_text(&booking_ref, "booking_ref");
        require!(refund_tx.len() == 66 && eip712::unhex(&refund_tx, "refund_tx").len() == 32, "refund_tx: 0x + 32 bytes hex");
        let p = self.payments.get(payment_id.0 as u32).cloned().unwrap_or_else(|| env::panic_str("unknown payment"));
        require!(p.trip_id == Some(trip_id), "the payment is not part of this trip");
        require!(p.status == PaymentStatus::Signed, "the payment was never signed");
        let paid_tx = p.settled_tx.clone().unwrap_or_else(|| env::panic_str("the payment has no settlement to cancel"));
        require!(refund.0 > 0 && refund.0 <= p.amount.0, "refund: more than 0, at most what was paid");
        let item = p.item.unwrap();
        let merchant_id = p.merchant_id.clone().unwrap();
        let merchant = self.merchants.get(&merchant_id).cloned().unwrap();
        let mut all = cancellations();
        let mut list = all.get(&trip_id.0).cloned().unwrap_or_default();
        require!(list.iter().all(|c| c.payment_id != payment_id), "this payment was already cancelled");
        let refund_tx = refund_tx.to_lowercase();
        let msg = cancellation_message(&booking_ref, &paid_tx, refund.0, &refund_tx);
        let signer = personal_sign_signer(&msg, &signature).unwrap_or_else(|| env::panic_str("bad signature"));
        require!(addr_str(&signer) == merchant.pay_to, format!("not signed by {}'s payment key", merchant.name));

        let pct = rebook_rules().get(&trip_id.0).copied().unwrap_or(0) as u128;
        let t = self.trips.get_mut(&trip_id.0).unwrap_or_else(|| env::panic_str("unknown trip"));
        let it = &mut t.items[item as usize];
        it.paid = U128(it.paid.0 - refund.0);
        it.max = U128(it.max.0 + it.max.0 * pct / 100);
        let rebook_max = U128(it.max.0 - it.paid.0);
        t.spent = U128(t.spent.0 - refund.0);
        let c = Cancellation { item, payment_id, merchant_id: merchant_id.clone(), booking_ref, refund, refund_tx: refund_tx.clone(), rebook_max, at: U64(env::block_timestamp()) };
        let ev = Event::BookingCancelled { trip_id, item, payment_id, merchant_id, refund, refund_tx, rebook_max };
        emit(t, ev);
        list.push(c.clone());
        all.insert(trip_id.0, list);
        all.flush();
        c
    }

    /// The traveler lets the agent pay up to `max` in total for a cancelled item's replacement.
    pub fn approve_rebook(&mut self, trip_id: U64, item: u32, max: U128) {
        let t = self.trips.get_mut(&trip_id.0).unwrap_or_else(|| env::panic_str("unknown trip"));
        require!(env::predecessor_account_id() == t.traveler, "only the traveler");
        require!(t.status == TripStatus::Active, "the trip has ended");
        require!((item as usize) < t.items.len(), "unknown item");
        require!(Self::was_cancelled(trip_id.0, item), "only a cancelled booking can be rebooked");
        require!(max.0 >= t.items[item as usize].paid.0, "max is below what was already paid");
        t.items[item as usize].max = max;
        emit(t, Event::RebookApproved { trip_id, item, max });
    }

    // ---------- signing ----------

    /// Builds and checks one USDC authorization; reserves its nonce.
    fn authorize(&mut self, wallet: &Wallet, network: &Network, to: Address, amount: u128, nonce: &str, valid_before: u64) -> (Authorization, String) {
        require!(env::prepaid_gas() >= PAY_GAS, format!("attach at least {} Tgas", PAY_GAS.as_tgas()));
        let now_sec = env::block_timestamp() / SEC;
        require!(valid_before > now_sec && valid_before <= now_sec + MAX_AUTH_SEC, format!("valid_before: within {MAX_AUTH_SEC} s from now"));
        let nonce = eip712::bytes32(nonce, "nonce");
        let from = eip712::address(&wallet.address, "wallet");
        let key = [&from[..], &nonce[..]].concat();
        require!(!self.nonces.contains(&key), "nonce already used");
        self.nonces.insert(key);
        let token = eip712::Token { chain_id: network.chain_id, address: eip712::address(&network.token, "token"), name: &network.token_name, version: &network.token_version };
        let x = eip712::Transfer { from, to, value: amount, valid_after: 0, valid_before, nonce };
        let digest = eip712::hex(&eip712::digest(&token, &x));
        let auth = Authorization {
            from: addr_str(&from),
            to: addr_str(&to),
            value: amount.to_string(),
            valid_after: "0".into(),
            valid_before: valid_before.to_string(),
            nonce: format!("0x{}", eip712::hex(&nonce)),
        };
        (auth, digest)
    }

    /// Builds and checks one NEAR delegate action (a USDC `ft_transfer` from the traveler's NEAR wallet to `to`).
    /// Returns the wallet, the payment record's authorization (valid_before = max block height) and the hash to sign.
    #[allow(clippy::too_many_arguments)]
    fn near_authorize(&mut self, traveler: &AccountId, network: &str, to: &str, amount: u128, nonce: &str, max_block_height: u64, memo: &str) -> (NearWallet, Authorization, String) {
        require!(env::prepaid_gas() >= PAY_GAS, format!("attach at least {} Tgas", PAY_GAS.as_tgas()));
        let net = near_pay::near_networks().get(&network.to_string()).cloned().unwrap_or_else(|| env::panic_str("unknown network"));
        let wallet = near_pay::near_wallets().get(traveler).cloned().unwrap_or_else(|| env::panic_str("the traveler has no NEAR wallet: set_near_wallet first"));
        let h = env::block_height();
        require!(max_block_height > h && max_block_height <= h + near_pay::MAX_AUTH_BLOCKS, format!("valid_before (max block height): within {} blocks from now", near_pay::MAX_AUTH_BLOCKS));
        let nonce: u64 = nonce.parse().unwrap_or_else(|_| env::panic_str("nonce: the delegate-action nonce, decimal"));
        let mut nonces = near_pay::near_nonces();
        require!(nonces.get(&wallet.account_id).is_none_or(|&last| nonce > last), "nonce already used");
        nonces.insert(wallet.account_id.clone(), nonce);
        nonces.flush();
        let (pk, _) = near_pay::ed25519_key(&wallet.public_key);
        let args = near_pay::ft_transfer_args(to, amount, memo);
        let da = near_pay::delegate_action(wallet.account_id.as_str(), net.token.as_str(), &args, nonce, max_block_height, &pk);
        let digest = eip712::hex(&near_pay::delegate_hash(&da));
        let near = NearAuthorization {
            sender_id: wallet.account_id.clone(),
            token: net.token.clone(),
            receiver_id: to.to_string(),
            amount: U128(amount),
            nonce,
            max_block_height,
            public_key: wallet.public_key.clone(),
            delegate_action: eip712::hex(&da),
        };
        let id = self.payments.len() as u64;
        let mut auths = near_pay::near_auths();
        auths.insert(id, near);
        auths.flush();
        let auth = Authorization {
            from: wallet.account_id.to_string(),
            to: to.to_string(),
            value: amount.to_string(),
            valid_after: "0".into(),
            valid_before: max_block_height.to_string(),
            nonce: nonce.to_string(),
        };
        (wallet, auth, digest)
    }

    fn sign_near(&self, path: String, digest: String, payment_id: u64) -> Promise {
        self.sign_with(json!({ "Eddsa": digest }), 1, path, payment_id)
    }

    fn sign(&self, path: String, digest: String, payment_id: u64) -> Promise {
        self.sign_with(json!({ "Ecdsa": digest }), 0, path, payment_id)
    }

    fn sign_with(&self, payload: Value, domain_id: u32, path: String, payment_id: u64) -> Promise {
        let args = json!({ "request": { "payload_v2": payload, "path": path, "domain_id": domain_id } });
        Promise::new(self.mpc.clone())
            .function_call_weight("sign".to_string(), args.to_string().into_bytes(), NearToken::from_yoctonear(1), SIGN_GAS, GasWeight(1))
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_signed(U64(payment_id)))
    }

    #[private]
    pub fn on_signed(&mut self, payment_id: U64, #[callback_result] res: Result<Value, PromiseError>) -> PayOutcome {
        let p = self.payments.get_mut(payment_id.0 as u32).unwrap();
        let on_near = near_pay::is_near_network(&p.network);
        let sig = res.ok().and_then(|v| if on_near { near_pay::to_ed25519_signature(&v) } else { to_eth_signature(&v) });
        let near = if on_near { near_pay::near_auths().get(&payment_id.0).cloned() } else { None };
        let mut out = PayOutcome { status: String::new(), trip_id: p.trip_id, payment_id: Some(payment_id), reason: None, network: Some(p.network.clone()), authorization: None, signature: None, near };
        match sig {
            Some(s) => {
                p.status = PaymentStatus::Signed;
                p.signature = Some(s.clone());
                out.status = "signed".into();
                out.authorization = Some(p.authorization.clone());
                out.signature = Some(s);
                if let Some(tid) = p.trip_id {
                    let t = self.trips.get_mut(&tid.0).unwrap();
                    emit(t, Event::PaymentSigned { trip_id: tid, payment_id });
                }
            }
            None => {
                // Nothing was signed: give the reservation back (the nonce stays used).
                p.status = PaymentStatus::Failed;
                out.status = "failed".into();
                out.reason = Some("the MPC signer did not sign".into());
                let (trip_id, item, amount) = (p.trip_id, p.item, p.amount.0);
                if let (Some(tid), Some(i)) = (trip_id, item) {
                    let t = self.trips.get_mut(&tid.0).unwrap();
                    t.items[i as usize].paid = U128(t.items[i as usize].paid.0 - amount);
                    t.spent = U128(t.spent.0 - amount);
                    emit(t, Event::PaymentFailed { trip_id: tid, payment_id, reason: "the MPC signer did not sign".into() });
                }
            }
        }
        out
    }

    // ---------- views ----------

    pub fn get_config(&self) -> Value {
        let ids = near_pay::near_network_ids().get(&0).cloned().unwrap_or_default();
        let nets = near_pay::near_networks();
        let near_networks: Vec<NearNetwork> = ids.iter().filter_map(|i| nets.get(i).cloned()).collect();
        json!({ "owner": self.owner, "mpc": self.mpc, "networks": self.networks, "near_networks": near_networks, "trips": self.next_trip - 1,
            "payments": self.payments.len(), "trip_fee": TRIP_FEE.as_yoctonear().to_string(), "wallet_fee": WALLET_FEE.as_yoctonear().to_string(),
            "pay_tgas": PAY_GAS.as_tgas(), "max_auth_sec": MAX_AUTH_SEC })
    }

    pub fn get_merchants(&self) -> Vec<Merchant> {
        self.merchants.values().cloned().collect()
    }

    pub fn get_merchant(&self, id: String) -> Option<Merchant> {
        self.merchants.get(&id).cloned()
    }

    pub fn get_wallet(&self, traveler: AccountId) -> Option<Wallet> {
        self.wallets.get(&traveler).cloned()
    }

    pub fn get_near_wallet(&self, traveler: AccountId) -> Option<NearWallet> {
        near_pay::near_wallets().get(&traveler).cloned()
    }

    /// The last delegate-action nonce signed for a NEAR trip wallet: the next one must be higher (and above the
    /// key's nonce on chain). Using it voids any older signed delegate action that was never submitted.
    pub fn get_near_nonce(&self, account_id: AccountId) -> Option<U64> {
        near_pay::near_nonces().get(&account_id).map(|&n| U64(n))
    }

    /// For a NEAR payment: the delegate action that was signed (join it with `signature` for a `SignedDelegate`).
    pub fn get_near_authorization(&self, payment_id: U64) -> Option<NearAuthorization> {
        near_pay::near_auths().get(&payment_id.0).cloned()
    }

    pub fn get_trip_cancellations(&self, trip_id: U64) -> Vec<Cancellation> {
        cancellations().get(&trip_id.0).cloned().unwrap_or_default()
    }

    pub fn get_trip(&self, trip_id: U64) -> Option<TripView> {
        let t = self.trips.get(&trip_id.0)?.clone();
        let phase = if t.status == TripStatus::Ended {
            "ended"
        } else if env::block_timestamp() >= t.expires_at.0 {
            "expired"
        } else {
            "active"
        };
        let rebook_pct = rebook_rules().get(&trip_id.0).copied().unwrap_or(0);
        let cancellations = cancellations().get(&trip_id.0).cloned().unwrap_or_default();
        Some(TripView { trip: t, phase: phase.into(), rebook_pct, cancellations })
    }

    /// Newest first.
    pub fn get_trips(&self, from: Option<U64>, limit: Option<u32>) -> Vec<TripView> {
        let start = from.map(|f| f.0).unwrap_or(self.next_trip - 1).min(self.next_trip - 1);
        (1..=start).rev().take(limit.unwrap_or(20).min(50) as usize).filter_map(|i| self.get_trip(U64(i))).collect()
    }

    pub fn get_traveler_trips(&self, traveler: AccountId) -> Vec<U64> {
        self.traveler_trips.get(&traveler).map(|v| v.iter().map(|&i| U64(i)).collect()).unwrap_or_default()
    }

    pub fn get_payment(&self, payment_id: U64) -> Option<Payment> {
        self.payments.get(payment_id.0 as u32).cloned()
    }

    pub fn get_trip_payments(&self, trip_id: U64) -> Vec<Payment> {
        self.trips.get(&trip_id.0).map(|t| t.payments.iter().filter_map(|p| self.payments.get(p.0 as u32).cloned()).collect()).unwrap_or_default()
    }

    pub fn get_read(&self, read_id: U64) -> Option<VaultRead> {
        self.reads.get(read_id.0 as u32).cloned()
    }

    pub fn get_trip_reads(&self, trip_id: U64) -> Vec<VaultRead> {
        self.trips.get(&trip_id.0).map(|t| t.reads.iter().filter_map(|r| self.reads.get(r.0 as u32).cloned()).collect()).unwrap_or_default()
    }

    pub fn can_read(&self, trip_id: U64, agent: AccountId, field: String) -> bool {
        self.trips.get(&trip_id.0).is_some_and(|t| {
            t.agent == agent && t.status == TripStatus::Active && env::block_timestamp() < t.expires_at.0 && t.vault_fields.contains(&field)
        })
    }
}

