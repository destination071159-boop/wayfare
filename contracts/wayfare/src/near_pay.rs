//! Paying merchants on NEAR itself, with the x402 `exact` scheme for NEAR (`@x402/near`).
//!
//! The payer signs a NEP-366 delegate action holding exactly one NEP-141 `ft_transfer` (1 yoctoNEAR attached), and
//! the merchant's x402 facilitator submits it inside its own transaction, paying the gas. Here the payer is the
//! traveler's trip wallet on NEAR: an implicit account whose ed25519 key is held by the MPC network (Chain
//! Signatures, domain 1) under this contract and the path `wayfare/<traveler>`, the same path as the EVM wallet.
//! The contract builds the delegate action itself (to the merchant's registered account, never one the agent
//! picks), so the agent can only ask for what the trip allows.
use near_sdk::json_types::U128;
use near_sdk::serde_json::Value;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PublicKey};

/// NEP-141 `ft_transfer` gas inside the delegate action (the x402 NEAR default).
pub const FT_TRANSFER_TGAS: u64 = 30;
/// A signed delegate action lives at most this many blocks (≈ 1 s each).
pub const MAX_AUTH_BLOCKS: u64 = 900;
/// NEP-461: signable messages for on-chain actions start at 2^30; a delegate action (NEP-366) is 2^30 + 366.
pub const DELEGATE_DISCRIMINANT: u32 = (1 << 30) + 366;

/// A NEAR network and the USDC (NEP-141) contract on it.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct NearNetwork {
    /// CAIP-2, as x402 names it: "near:testnet"
    pub id: String,
    pub label: String,
    pub token: AccountId,
}

/// The traveler's trip wallet on NEAR.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct NearWallet {
    /// The MPC derivation path (domain 1, ed25519): `wayfare/<traveler>`.
    pub path: String,
    /// "ed25519:…", the key the MPC network holds at `path`.
    pub public_key: String,
    /// The implicit account of that key (64 hex characters).
    pub account_id: AccountId,
}

/// What the agent needs to send an x402 NEAR payment: the delegate action, to be joined with the signature.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct NearAuthorization {
    pub sender_id: AccountId,
    pub token: AccountId,
    pub receiver_id: String,
    pub amount: U128,
    pub nonce: u64,
    pub max_block_height: u64,
    pub public_key: String,
    /// Borsh `DelegateAction`, hex. Append the ed25519 signature (Borsh: 0x00 ‖ 64 bytes) for a `SignedDelegate`.
    pub delegate_action: String,
}

// Side tables (see lib.rs): their own prefixes, so the existing state needs no migration.
pub fn near_networks() -> LookupMap<String, NearNetwork> {
    LookupMap::new(b"x:nearnet".to_vec())
}
pub fn near_network_ids() -> LookupMap<u8, Vec<String>> {
    LookupMap::new(b"x:nearids".to_vec())
}
pub fn near_wallets() -> LookupMap<AccountId, NearWallet> {
    LookupMap::new(b"x:nearwallet".to_vec())
}
/// The last delegate-action nonce signed for each NEAR wallet: never sign one at or below it.
pub fn near_nonces() -> LookupMap<AccountId, u64> {
    LookupMap::new(b"x:nearnonce".to_vec())
}
/// payment id → the delegate action (hex) that was signed for it.
pub fn near_auths() -> LookupMap<u64, NearAuthorization> {
    LookupMap::new(b"x:nearauth".to_vec())
}

pub fn is_near_network(id: &str) -> bool {
    id.starts_with("near:")
}

/// An ed25519 public key → (Borsh bytes: 0x00 ‖ 32 bytes, implicit account id).
pub fn ed25519_key(public_key: &str) -> (Vec<u8>, AccountId) {
    let pk: PublicKey = public_key.parse().unwrap_or_else(|_| env::panic_str("public_key: ed25519:<base58>"));
    let bytes = pk.as_bytes().to_vec();
    require!(bytes.len() == 33 && bytes[0] == 0, "public_key must be ed25519");
    let account: AccountId = crate::eip712::hex(&bytes[1..]).parse().unwrap();
    (bytes, account)
}

fn put_str(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(&(s.len() as u32).to_le_bytes());
    out.extend_from_slice(s.as_bytes());
}

/// The `ft_transfer` arguments, as JSON bytes.
pub fn ft_transfer_args(receiver_id: &str, amount: u128, memo: &str) -> Vec<u8> {
    near_sdk::serde_json::json!({ "receiver_id": receiver_id, "amount": amount.to_string(), "memo": memo }).to_string().into_bytes()
}

/// Borsh `DelegateAction` with one `FunctionCall(ft_transfer)` action.
pub fn delegate_action(sender_id: &str, token: &str, args: &[u8], nonce: u64, max_block_height: u64, public_key: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(256 + args.len());
    put_str(&mut out, sender_id);
    put_str(&mut out, token);
    out.extend_from_slice(&1u32.to_le_bytes()); // one action
    out.push(2); // Action::FunctionCall
    put_str(&mut out, "ft_transfer");
    out.extend_from_slice(&(args.len() as u32).to_le_bytes());
    out.extend_from_slice(args);
    out.extend_from_slice(&(FT_TRANSFER_TGAS * 1_000_000_000_000).to_le_bytes());
    out.extend_from_slice(&1u128.to_le_bytes()); // 1 yoctoNEAR, as NEP-141 requires
    out.extend_from_slice(&nonce.to_le_bytes());
    out.extend_from_slice(&max_block_height.to_le_bytes());
    out.extend_from_slice(public_key);
    out
}

/// What the key signs: sha256(discriminant ‖ DelegateAction).
pub fn delegate_hash(delegate_action: &[u8]) -> [u8; 32] {
    env::sha256_array([&DELEGATE_DISCRIMINANT.to_le_bytes()[..], delegate_action].concat())
}

/// The MPC signer's ed25519 answer (`{"scheme":"Ed25519","signature":[64 bytes]}`) → hex.
pub fn to_ed25519_signature(v: &Value) -> Option<String> {
    if v.get("scheme")?.as_str()? != "Ed25519" {
        return None;
    }
    let bytes: Vec<u8> = v.get("signature")?.as_array()?.iter().map(|b| b.as_u64().filter(|&x| x < 256).map(|x| x as u8)).collect::<Option<_>>()?;
    (bytes.len() == 64).then(|| crate::eip712::hex(&bytes))
}
