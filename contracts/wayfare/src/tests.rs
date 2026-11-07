use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

const T0: u64 = 1_700_000_000 * SEC;
const H: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const WALLET: &str = "0xac901defd711ca8ca01b3d35e6dda85ea300ef13";
// anvil's public test account #2: the hotel's payment key signs the cancellation test vector below
const HOTEL_PAY_TO: &str = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const USDC: u128 = 1_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx_gas(who: &str, deposit: u128, ts: u64, tgas: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("wayfare.near"))
        .predecessor_account_id(acc(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(tgas))
        .block_timestamp(ts)
        .build());
}

fn ctx(who: &str, deposit: u128, ts: u64) {
    ctx_gas(who, deposit, ts, 300);
}

fn base_sepolia() -> Network {
    Network {
        id: "eip155:84532".into(),
        label: "Base Sepolia".into(),
        chain_id: 84532,
        token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e".into(),
        token_name: "USDC".into(),
        token_version: "2".into(),
    }
}

fn mpc_ok() -> Value {
    json!({ "scheme": "Secp256k1", "big_r": { "affine_point": format!("02{}", "11".repeat(32)) }, "s": { "scalar": "22".repeat(32) }, "recovery_id": 0 })
}

/// Contract with a rail and a hotel merchant, alice's wallet and trip 1: rail ≤ 40 USDC, hotel ≤ 150 USDC,
/// budget 200 USDC, agent bot.alice.near, 1 hour, vault fields name + passport.
fn setup() -> Wayfare {
    ctx("owner.near", 0, T0);
    let mut c = Wayfare::new(acc("owner.near"), acc("signer.near"), vec![base_sepolia()]);
    c.add_merchant("kyoto-rail".into(), "Kyoto Rail".into(), "rail".into(), "eip155:84532".into(), "0x1111111111111111111111111111111111111111".into(), "http://rail.local".into());
    c.add_merchant("gion-house".into(), "Gion House".into(), "hotel".into(), "eip155:84532".into(), HOTEL_PAY_TO.into(), "http://hotel.local".into());
    ctx("alice.near", WALLET_FEE.as_yoctonear(), T0);
    c.set_wallet(WALLET.to_uppercase().replace("0X", "0x"));
    create(&mut c);
    c
}

fn create(c: &mut Wayfare) -> U64 {
    ctx("alice.near", TRIP_FEE.as_yoctonear(), T0);
    c.create_trip(TripArgs {
        agent: acc("bot.alice.near"),
        title: "Tokyo to Kyoto, 2 nights".into(),
        plan_hash: H.into(),
        budget: U128(200 * USDC),
        items: vec![
            ItemArgs { merchant_id: "kyoto-rail".into(), label: "Shinkansen Tokyo → Kyoto".into(), max: U128(40 * USDC) },
            ItemArgs { merchant_id: "gion-house".into(), label: "2 nights near Gion".into(), max: U128(150 * USDC) },
        ],
        vault_fields: vec!["full_name".into(), "passport_no".into()],
        duration_sec: 3600,
        rebook_pct: Some(20),
    })
}

fn pay_args(item: u32, amount: u128, nonce: u8) -> PayArgs {
    PayArgs { trip_id: U64(1), item, amount: U128(amount), nonce: format!("{:02x}", nonce).repeat(32), valid_before: U64(T0 / SEC + 600) }
}

fn value(p: PromiseOrValue<PayOutcome>) -> PayOutcome {
    match p {
        PromiseOrValue::Value(v) => v,
        PromiseOrValue::Promise(_) => panic!("expected a value, got a promise"),
    }
}

fn is_promise(p: &PromiseOrValue<PayOutcome>) -> bool {
    matches!(p, PromiseOrValue::Promise(_))
}

// ---------- EIP-712 and signatures ----------

#[test]
fn digest_matches_viem() {
    // hashTypedData from viem with the same USDC domain and message.
    let t = eip712::Token { chain_id: 84532, address: eip712::address("0x036CbD53842c5426634e7929541eC2318f3dCF7e", "t"), name: "USDC", version: "2" };
    let x = eip712::Transfer {
        from: eip712::address(WALLET, "f"),
        to: eip712::address("0x1111111111111111111111111111111111111111", "t"),
        value: 120 * USDC,
        valid_after: 0,
        valid_before: 1_700_000_900,
        nonce: [0xab; 32],
    };
    assert_eq!(eip712::hex(&eip712::digest(&t, &x)), "59f8b8893cbd2bf3e8f336a4c35c9babaadf39bb84401dbb804c975fb1a52acf");
}

#[test]
fn signature_low_s_kept() {
    let sig = to_eth_signature(&mpc_ok()).unwrap();
    assert_eq!(sig, format!("0x{}{}1b", "11".repeat(32), "22".repeat(32)));
}

#[test]
fn signature_high_s_normalized() {
    // s = n - 1 → 1, and v flips.
    let high = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140";
    let v = json!({ "big_r": { "affine_point": format!("03{}", "aa".repeat(32)) }, "s": { "scalar": high }, "recovery_id": 0 });
    let sig = to_eth_signature(&v).unwrap();
    assert_eq!(sig, format!("0x{}{}01{}", "aa".repeat(32), "00".repeat(31), "1c"));
}

#[test]
fn signature_malformed_rejected() {
    assert!(to_eth_signature(&json!({ "big_r": { "affine_point": "02" }, "s": { "scalar": "22" }, "recovery_id": 0 })).is_none());
    assert!(to_eth_signature(&json!({ "error": "x" })).is_none());
}

// ---------- setup rules ----------

#[test]
fn wallet_is_normalized_and_path_is_per_traveler() {
    let c = setup();
    let w = c.get_wallet(acc("alice.near")).unwrap();
    assert_eq!(w.address, WALLET);
    assert_eq!(w.path, "wayfare/alice.near");
}

#[test]
#[should_panic(expected = "set your wallet first")]
fn trip_needs_wallet() {
    let mut c = setup();
    ctx("bob.near", TRIP_FEE.as_yoctonear(), T0);
    c.create_trip(TripArgs { agent: acc("bot.near"), title: "x".into(), plan_hash: H.into(), budget: U128(1), items: vec![], vault_fields: vec![], duration_sec: 3600, rebook_pct: None });
}

#[test]
#[should_panic(expected = "items add up to more than the budget")]
fn items_must_fit_budget() {
    let mut c = setup();
    ctx("alice.near", TRIP_FEE.as_yoctonear(), T0);
    c.create_trip(TripArgs {
        agent: acc("bot.alice.near"),
        title: "x".into(),
        plan_hash: H.into(),
        budget: U128(100 * USDC),
        items: vec![ItemArgs { merchant_id: "gion-house".into(), label: "hotel".into(), max: U128(150 * USDC) }],
        vault_fields: vec![],
        duration_sec: 3600,
        rebook_pct: None,
    });
}

#[test]
#[should_panic(expected = "unknown merchant")]
fn items_need_known_merchant() {
    let mut c = setup();
    ctx("alice.near", TRIP_FEE.as_yoctonear(), T0);
    c.create_trip(TripArgs {
        agent: acc("bot.alice.near"),
        title: "x".into(),
        plan_hash: H.into(),
        budget: U128(100 * USDC),
        items: vec![ItemArgs { merchant_id: "nowhere".into(), label: "x".into(), max: U128(1) }],
        vault_fields: vec![],
        duration_sec: 3600,
        rebook_pct: None,
    });
}

#[test]
#[should_panic(expected = "only the owner")]
fn only_owner_adds_merchants() {
    let mut c = setup();
    ctx("alice.near", 0, T0);
    c.add_merchant("evil".into(), "Evil".into(), "hotel".into(), "eip155:84532".into(), WALLET.into(), "http://x".into());
}

// ---------- paying ----------

#[test]
fn pay_within_rules_signs_to_the_merchant() {
    let mut c = setup();
    ctx("bot.alice.near", 0, T0 + SEC);
    assert!(is_promise(&c.pay(pay_args(1, 120 * USDC, 1))));
    let t = c.get_trip(U64(1)).unwrap().trip;
    assert_eq!((t.spent.0, t.items[1].paid.0, t.payments.len()), (120 * USDC, 120 * USDC, 1));
    let p = c.get_payment(U64(0)).unwrap();
    assert_eq!(p.status, PaymentStatus::Pending);
    assert_eq!(p.authorization.to, HOTEL_PAY_TO);
    assert_eq!(p.authorization.from, WALLET);

    ctx("wayfare.near", 0, T0 + 2 * SEC);
    let out = c.on_signed(U64(0), Ok(mpc_ok()));
    assert_eq!(out.status, "signed");
    let a = out.authorization.unwrap();
    assert_eq!((a.value.as_str(), a.to.as_str(), a.valid_after.as_str()), ("120000000", HOTEL_PAY_TO, "0"));
    assert_eq!(a.nonce, format!("0x{}", "01".repeat(32)));
    assert_eq!(out.signature.unwrap().len(), 2 + 130);
    assert_eq!(c.get_payment(U64(0)).unwrap().status, PaymentStatus::Signed);
}

#[test]
fn over_item_price_is_refused_and_logged() {
    let mut c = setup();
    ctx("bot.alice.near", 0, T0 + SEC);
    assert!(is_promise(&c.pay(pay_args(1, 120 * USDC, 1))));
    ctx("bot.alice.near", 0, T0 + 2 * SEC);
    let out = value(c.pay(pay_args(1, 60 * USDC, 2)));
    assert_eq!(out.status, "refused");
    assert!(out.reason.unwrap().contains("over the approved price for \"2 nights near Gion\""));
    let t = c.get_trip(U64(1)).unwrap().trip;
    assert_eq!((t.spent.0, t.refusals, t.payments.len()), (120 * USDC, 1, 1));
    assert!(get_logs().iter().any(|l| l.contains("payment_refused")));
}

#[test]
fn signer_failure_releases_the_reservation() {
    let mut c = setup();
    ctx("bot.alice.near", 0, T0 + SEC);
    let _ = c.pay(pay_args(0, 30 * USDC, 1));
    ctx("wayfare.near", 0, T0 + 2 * SEC);
    let out = c.on_signed(U64(0), Err(PromiseError::Failed));
    assert_eq!(out.status, "failed");
    let t = c.get_trip(U64(1)).unwrap().trip;
    assert_eq!((t.spent.0, t.items[0].paid.0), (0, 0));
    assert_eq!(c.get_payment(U64(0)).unwrap().status, PaymentStatus::Failed);
}

#[test]
#[should_panic(expected = "only this trip's agent")]
fn only_the_agent_pays() {
    let mut c = setup();
    ctx("mallory.near", 0, T0 + SEC);
    let _ = c.pay(pay_args(0, USDC, 1));
}

#[test]
#[should_panic(expected = "nonce already used")]
fn nonce_cannot_repeat() {
    let mut c = setup();
    ctx("bot.alice.near", 0, T0 + SEC);
    let _ = c.pay(pay_args(0, USDC, 7));
    let _ = c.pay(pay_args(0, USDC, 7));
}

#[test]
#[should_panic(expected = "valid_before: within 900 s from now")]
fn authorization_must_be_short_lived() {
    let mut c = setup();
    ctx("bot.alice.near", 0, T0 + SEC);
    let mut a = pay_args(0, USDC, 1);
    a.valid_before = U64(T0 / SEC + 3000);
    let _ = c.pay(a);
}

#[test]
#[should_panic(expected = "attach at least 250 Tgas")]
fn pay_needs_gas_for_the_signer() {
    let mut c = setup();
    ctx_gas("bot.alice.near", 0, T0 + SEC, 100);
    let _ = c.pay(pay_args(0, USDC, 1));
}

#[test]
fn ended_trip_refuses_payment_and_vault() {
    let mut c = setup();
    ctx("alice.near", 0, T0 + SEC);
    c.end_trip(U64(1));
    assert_eq!(c.get_trip(U64(1)).unwrap().phase, "ended");
    assert!(!c.can_read(U64(1), acc("bot.alice.near"), "full_name".into()));
    ctx("bot.alice.near", 0, T0 + 2 * SEC);
    let out = value(c.pay(pay_args(0, USDC, 1)));
    assert_eq!(out.reason.unwrap(), "the traveler ended this trip");
}

#[test]
fn expired_trip_refuses_payment() {
    let mut c = setup();
    ctx("bot.alice.near", 0, T0 + 3601 * SEC);
    assert_eq!(c.get_trip(U64(1)).unwrap().phase, "expired");
    let out = value(c.pay(pay_args(0, USDC, 1)));
    assert_eq!(out.reason.unwrap(), "the trip has expired");
}

#[test]
fn suspended_merchant_is_refused() {
    let mut c = setup();
    ctx("owner.near", 0, T0);
    c.set_merchant_active("kyoto-rail".into(), false);
    ctx("bot.alice.near", 0, T0 + SEC);
    let out = value(c.pay(pay_args(0, USDC, 1)));
    assert_eq!(out.reason.unwrap(), "merchant kyoto-rail is suspended");
}

#[test]
#[should_panic(expected = "only the traveler")]
fn only_traveler_ends_trip() {
    let mut c = setup();
    ctx("bot.alice.near", 0, T0 + SEC);
    c.end_trip(U64(1));
}

// ---------- vault ----------

#[test]
fn vault_read_is_recorded() {
    let mut c = setup();
    assert!(c.can_read(U64(1), acc("bot.alice.near"), "passport_no".into()));
    assert!(!c.can_read(U64(1), acc("bot.alice.near"), "card_number".into()));
    ctx("bot.alice.near", 0, T0 + SEC);
    let id = c.record_read(U64(1), vec!["full_name".into(), "passport_no".into()], "hotel check-in form".into());
    let r = c.get_read(id).unwrap();
    assert_eq!(r.fields.len(), 2);
    assert_eq!(c.get_trip_reads(U64(1)).len(), 1);
}

#[test]
#[should_panic(expected = "field card_number is not granted for this trip")]
fn vault_read_needs_grant() {
    let mut c = setup();
    ctx("bot.alice.near", 0, T0 + SEC);
    c.record_read(U64(1), vec!["card_number".into()], "checkout".into());
}

#[test]
#[should_panic(expected = "vault access has ended for this trip")]
fn vault_closed_after_end() {
    let mut c = setup();
    ctx("alice.near", 0, T0 + SEC);
    c.end_trip(U64(1));
    ctx("bot.alice.near", 0, T0 + 2 * SEC);
    c.record_read(U64(1), vec!["full_name".into()], "x".into());
}

// ---------- receipts, withdraw, settlement ----------

#[test]
fn receipt_chain_replays_from_logs() {
    // Re-run the trip's events and fold the logs: the head must match the contract's.
    ctx("owner.near", 0, T0);
    let mut c = Wayfare::new(acc("owner.near"), acc("signer.near"), vec![base_sepolia()]);
    c.add_merchant("gion-house".into(), "Gion House".into(), "hotel".into(), "eip155:84532".into(), HOTEL_PAY_TO.into(), "http://hotel.local".into());
    ctx("alice.near", WALLET_FEE.as_yoctonear(), T0);
    c.set_wallet(WALLET.into());
    let mut lines = vec![];
    ctx("alice.near", TRIP_FEE.as_yoctonear(), T0);
    c.create_trip(TripArgs {
        agent: acc("bot.alice.near"),
        title: "t".into(),
        plan_hash: H.into(),
        budget: U128(10 * USDC),
        items: vec![ItemArgs { merchant_id: "gion-house".into(), label: "hotel".into(), max: U128(10 * USDC) }],
        vault_fields: vec!["full_name".into()],
        duration_sec: 3600,
        rebook_pct: None,
    });
    lines.extend(get_logs());
    ctx("bot.alice.near", 0, T0 + SEC);
    c.record_read(U64(1), vec!["full_name".into()], "booking form".into());
    lines.extend(get_logs());
    ctx("bot.alice.near", 0, T0 + 2 * SEC);
    let _ = c.pay(PayArgs { trip_id: U64(1), item: 0, amount: U128(11 * USDC), nonce: "01".repeat(32), valid_before: U64(T0 / SEC + 600) });
    lines.extend(get_logs());
    let mut head = "0".repeat(64);
    for l in lines.iter().filter(|l| l.starts_with("EVENT_JSON:")) {
        head = sha256_hex(format!("{head}\n{l}").as_bytes());
    }
    assert_eq!(c.get_trip(U64(1)).unwrap().trip.receipt_head, head);
}

#[test]
fn traveler_can_withdraw_without_trip_rules() {
    let mut c = setup();
    ctx("alice.near", 0, T0 + SEC);
    let _ = c.withdraw(WithdrawArgs { network: "eip155:84532".into(), to: "0x3333333333333333333333333333333333333333".into(), amount: U128(500 * USDC), nonce: "05".repeat(32), valid_before: U64(T0 / SEC + 600) });
    let p = c.get_payment(U64(0)).unwrap();
    assert_eq!((p.trip_id, p.amount.0, p.authorization.to.as_str()), (None, 500 * USDC, "0x3333333333333333333333333333333333333333"));
}

#[test]
#[should_panic(expected = "no wallet")]
fn withdraw_needs_own_wallet() {
    let mut c = setup();
    ctx("bot.alice.near", 0, T0 + SEC);
    let _ = c.withdraw(WithdrawArgs { network: "eip155:84532".into(), to: WALLET.into(), amount: U128(1), nonce: "05".repeat(32), valid_before: U64(T0 / SEC + 600) });
}

#[test]
fn settlement_is_recorded_once_signed() {
    let mut c = setup();
    ctx("bot.alice.near", 0, T0 + SEC);
    let _ = c.pay(pay_args(0, 30 * USDC, 1));
    ctx("wayfare.near", 0, T0 + 2 * SEC);
    c.on_signed(U64(0), Ok(mpc_ok()));
    ctx("bot.alice.near", 0, T0 + 3 * SEC);
    let tx = format!("0x{}", "ab".repeat(32));
    c.report_settled(U64(0), tx.clone());
    assert_eq!(c.get_payment(U64(0)).unwrap().settled_tx, Some(tx));
}

// ---------- cancellations and rebooking ----------

/// viem `signMessage` with anvil key #2 over cancellation_message("GH-ABC123", 0xaa…, 120 USDC, 0xbb…).
const CANCEL_SIG: &str = "0x1cfec762f0c5dc2faec7595ba0ba1b4b724da4f7713b96a46c837165e5dd83b4566fb80a5ba48de3793ab15e51a870922ecc0f11d9fdc5cdf68b667b7dc4d0481b";

fn tx(b: &str) -> String {
    format!("0x{}", b.repeat(32))
}

/// Trip 1 with the hotel paid (120 USDC, payment 0) and settled in tx 0xaa…
fn paid_hotel() -> Wayfare {
    let mut c = setup();
    ctx("bot.alice.near", 0, T0 + SEC);
    let _ = c.pay(pay_args(1, 120 * USDC, 1));
    ctx("wayfare.near", 0, T0 + 2 * SEC);
    c.on_signed(U64(0), Ok(mpc_ok()));
    ctx("bot.alice.near", 0, T0 + 3 * SEC);
    c.report_settled(U64(0), tx("aa"));
    c
}

fn cancel(c: &mut Wayfare, refund: u128) -> Cancellation {
    ctx("bot.alice.near", 0, T0 + 4 * SEC);
    c.record_cancellation(U64(1), U64(0), "GH-ABC123".into(), U128(refund), tx("bb"), CANCEL_SIG.into())
}

#[test]
fn merchant_signature_recovers() {
    ctx("x.near", 0, T0);
    let msg = cancellation_message("GH-ABC123", &tx("aa"), 120 * USDC, &tx("bb"));
    assert_eq!(addr_str(&personal_sign_signer(&msg, CANCEL_SIG).unwrap()), HOTEL_PAY_TO);
}

#[test]
fn cancellation_refunds_and_allows_rebook_within_margin() {
    let mut c = paid_hotel();
    let k = cancel(&mut c, 120 * USDC);
    // 150 approved + 20% margin
    assert_eq!((k.item, k.refund.0, k.rebook_max.0), (1, 120 * USDC, 180 * USDC));
    let v = c.get_trip(U64(1)).unwrap();
    assert_eq!((v.trip.spent.0, v.trip.items[1].paid.0, v.rebook_pct, v.cancellations.len()), (0, 0, 20, 1));
    assert!(get_logs().iter().any(|l| l.contains("booking_cancelled")));
    ctx("bot.alice.near", 0, T0 + 5 * SEC);
    assert!(is_promise(&c.pay(pay_args(1, 170 * USDC, 2))));
}

#[test]
fn rebook_over_margin_needs_the_traveler() {
    let mut c = paid_hotel();
    cancel(&mut c, 120 * USDC);
    ctx("bot.alice.near", 0, T0 + 5 * SEC);
    let out = value(c.pay(pay_args(1, 190 * USDC, 2)));
    assert_eq!(out.status, "refused");
    assert!(out.reason.unwrap().contains("over the auto-rebook limit"));
    ctx("alice.near", 0, T0 + 6 * SEC);
    c.approve_rebook(U64(1), 1, U128(195 * USDC));
    ctx("bot.alice.near", 0, T0 + 7 * SEC);
    assert!(is_promise(&c.pay(pay_args(1, 190 * USDC, 3))));
}

#[test]
#[should_panic(expected = "not signed by Gion House")]
fn forged_cancellation_is_rejected() {
    // the agent claims a bigger refund than the merchant signed for
    let mut c = paid_hotel();
    cancel(&mut c, 100 * USDC);
}

#[test]
#[should_panic(expected = "already cancelled")]
fn payment_cancels_once() {
    let mut c = paid_hotel();
    cancel(&mut c, 120 * USDC);
    cancel(&mut c, 120 * USDC);
}

#[test]
#[should_panic(expected = "only the traveler")]
fn only_traveler_approves_rebook() {
    let mut c = paid_hotel();
    cancel(&mut c, 120 * USDC);
    ctx("bot.alice.near", 0, T0 + 5 * SEC);
    c.approve_rebook(U64(1), 1, U128(195 * USDC));
}

#[test]
#[should_panic(expected = "only a cancelled booking")]
fn rebook_needs_a_cancellation() {
    let mut c = paid_hotel();
    ctx("alice.near", 0, T0 + 5 * SEC);
    c.approve_rebook(U64(1), 0, U128(50 * USDC));
}

// ---------- several chains ----------

fn arbitrum_sepolia() -> Network {
    Network {
        id: "eip155:421614".into(),
        label: "Arbitrum Sepolia".into(),
        chain_id: 421614,
        token: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d".into(),
        token_name: "USD Coin".into(),
        token_version: "2".into(),
    }
}

#[test]
fn one_trip_pays_on_two_chains() {
    let mut c = setup();
    ctx("owner.near", 0, T0);
    c.add_network(arbitrum_sepolia());
    c.set_merchant_network("gion-house".into(), "eip155:421614".into());
    ctx("bot.alice.near", 0, T0 + SEC);
    assert!(is_promise(&c.pay(pay_args(0, 30 * USDC, 1))));
    assert!(is_promise(&c.pay(pay_args(1, 120 * USDC, 2))));
    let (rail, hotel) = (c.get_payment(U64(0)).unwrap(), c.get_payment(U64(1)).unwrap());
    assert_eq!((rail.network.as_str(), hotel.network.as_str()), ("eip155:84532", "eip155:421614"));
    // same wallet, different chains: the EIP-712 domains differ, so the digests do too
    assert_eq!(rail.authorization.from, hotel.authorization.from);
    let arb = eip712::Token { chain_id: 421614, address: eip712::address("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", "t"), name: "USD Coin", version: "2" };
    let x = eip712::Transfer { from: eip712::address(WALLET, "f"), to: eip712::address(HOTEL_PAY_TO, "t"), value: 120 * USDC, valid_after: 0, valid_before: T0 / SEC + 600, nonce: [0x02; 32] };
    assert_eq!(hotel.digest, eip712::hex(&eip712::digest(&arb, &x)));
}

#[test]
#[should_panic(expected = "unknown network")]
fn merchant_moves_only_to_a_known_network() {
    let mut c = setup();
    ctx("owner.near", 0, T0);
    c.set_merchant_network("gion-house".into(), "eip155:421614".into());
}

// ---------- paying on NEAR (x402 `exact` on near:testnet) ----------

const NEAR_USDC: &str = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
// near-api-js test vector (@near-js/transactions 2.5.1 buildDelegateAction + encodeDelegateAction)
const VEC_PK: &str = "ed25519:6DSjZ8mvsRZDvFqFxo8tCKePG96omXW7eVYVSySmDk8e";
const VEC_SENDER: &str = "4d7a80636b24694ba9c928394118cd539bf863f5e5773a0de27c7677d3eb0a87";
const VEC_DA: &str = "4000000034643761383036333662323436393462613963393238333934313138636435333962663836336635653537373361306465323763373637376433656230613837400000003365323231306531313834623435623634633861343334633061376537623233636330346561376562376136633363333235323064303364346166636238616601000000020b00000066745f7472616e73666572560000007b2272656365697665725f6964223a2273756d692d7461626c652e746573746e6574222c22616d6f756e74223a2231373030303030222c226d656d6f223a227761796661726520747269702037206974656d2033227d00e057eb481b000001000000000000000000000000000000141a99be1c0000007bc2eb0b00000000004d7a80636b24694ba9c928394118cd539bf863f5e5773a0de27c7677d3eb0a87";
const VEC_HASH: &str = "afbeb4e9b3525637502642de357af4792ecfc01611e56df541995567ce0df75e";
const HEIGHT: u64 = 200_000_000;

fn ctx_near(who: &str, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("wayfare.near"))
        .predecessor_account_id(acc(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(T0)
        .block_height(HEIGHT)
        .build());
}

#[test]
fn delegate_action_matches_near_api_js() {
    let (pk, account) = near_pay::ed25519_key(VEC_PK);
    assert_eq!(account.as_str(), VEC_SENDER);
    let args = br#"{"receiver_id":"sumi-table.testnet","amount":"1700000","memo":"wayfare trip 7 item 3"}"#;
    let da = near_pay::delegate_action(VEC_SENDER, NEAR_USDC, args, 123_456_789_012, 200_000_123, &pk);
    assert_eq!(eip712::hex(&da), VEC_DA);
    ctx_near("alice.near", 0);
    assert_eq!(eip712::hex(&near_pay::delegate_hash(&da)), VEC_HASH);
}

#[test]
fn ed25519_answer_is_parsed() {
    let sig: Vec<u64> = (0..64).collect();
    let hex = near_pay::to_ed25519_signature(&json!({ "scheme": "Ed25519", "signature": sig })).unwrap();
    assert_eq!(hex.len(), 128);
    assert!(near_pay::to_ed25519_signature(&json!({ "scheme": "Ed25519", "signature": [1, 2, 3] })).is_none());
    assert!(near_pay::to_ed25519_signature(&mpc_ok()).is_none());
}

/// setup() + NEAR testnet, a dinner merchant paid on NEAR, alice's NEAR wallet and trip 2 with the dinner.
fn near_setup() -> Wayfare {
    let mut c = setup();
    ctx_near("owner.near", 0);
    c.add_near_network(near_pay::NearNetwork { id: "near:testnet".into(), label: "NEAR testnet".into(), token: acc(NEAR_USDC) });
    c.add_merchant("sumi-table".into(), "Sumi Table".into(), "dining".into(), "near:testnet".into(), "sumi-table.testnet".into(), "http://dinner.local".into());
    ctx_near("alice.near", WALLET_FEE.as_yoctonear());
    c.set_near_wallet(VEC_PK.into());
    ctx("alice.near", TRIP_FEE.as_yoctonear(), T0);
    c.create_trip(TripArgs {
        agent: acc("bot.alice.near"),
        title: "Dinner in Kyoto".into(),
        plan_hash: H.into(),
        budget: U128(10 * USDC),
        items: vec![ItemArgs { merchant_id: "sumi-table".into(), label: "Sushi for two".into(), max: U128(2 * USDC) }],
        vault_fields: vec![],
        duration_sec: 3600,
        rebook_pct: None,
    });
    c
}

fn near_pay_args(amount: u128, nonce: u64, max_block_height: u64) -> PayArgs {
    PayArgs { trip_id: U64(2), item: 0, amount: U128(amount), nonce: nonce.to_string(), valid_before: U64(max_block_height) }
}

#[test]
fn pay_on_near_builds_the_ft_transfer_to_the_merchant() {
    let mut c = near_setup();
    ctx_near("bot.alice.near", 0);
    assert!(is_promise(&c.pay(near_pay_args(1_700_000, 42, HEIGHT + 300))));
    let p = c.get_payment(U64(0)).unwrap();
    assert_eq!(p.network, "near:testnet");
    assert_eq!(p.authorization.from, VEC_SENDER);
    assert_eq!(p.authorization.to, "sumi-table.testnet");
    let a = c.get_near_authorization(U64(0)).unwrap();
    assert_eq!((a.token.as_str(), a.receiver_id.as_str(), a.amount.0, a.nonce), (NEAR_USDC, "sumi-table.testnet", 1_700_000, 42));
    // the signed hash is exactly the delegate action the agent will submit
    let da = eip712::unhex(&a.delegate_action, "da");
    assert_eq!(p.digest, eip712::hex(&near_pay::delegate_hash(&da)));
    assert_eq!(c.get_trip(U64(2)).unwrap().trip.spent.0, 1_700_000);

    // signed: the answer carries the delegate action
    ctx_near("wayfare.near", 0);
    let sig: Vec<u64> = vec![7; 64];
    let out = c.on_signed(U64(0), Ok(json!({ "scheme": "Ed25519", "signature": sig })));
    assert_eq!(out.status, "signed");
    assert_eq!(out.signature.unwrap(), "07".repeat(64));
    assert_eq!(out.near.unwrap().delegate_action, a.delegate_action);
}

#[test]
fn near_payment_follows_the_trip_rules() {
    let mut c = near_setup();
    ctx_near("bot.alice.near", 0);
    let out = value(c.pay(near_pay_args(5 * USDC, 1, HEIGHT + 300)));
    assert_eq!(out.status, "refused");
    assert!(out.reason.unwrap().contains("over the approved price"));
}

#[test]
#[should_panic(expected = "nonce already used")]
fn near_nonce_must_grow() {
    let mut c = near_setup();
    ctx_near("bot.alice.near", 0);
    let _ = c.pay(near_pay_args(USDC / 2, 10, HEIGHT + 300));
    let _ = c.pay(near_pay_args(USDC / 2, 10, HEIGHT + 300));
}

#[test]
#[should_panic(expected = "within 900 blocks")]
fn near_authorization_must_be_short_lived() {
    let mut c = near_setup();
    ctx_near("bot.alice.near", 0);
    let _ = c.pay(near_pay_args(USDC, 1, HEIGHT + 1_000));
}

#[test]
fn near_settlement_takes_a_near_tx_hash_and_withdraw_works() {
    let mut c = near_setup();
    ctx_near("bot.alice.near", 0);
    let _ = c.pay(near_pay_args(USDC, 1, HEIGHT + 300));
    ctx_near("wayfare.near", 0);
    c.on_signed(U64(0), Ok(json!({ "scheme": "Ed25519", "signature": vec![1u64; 64] })));
    ctx_near("bot.alice.near", 0);
    c.report_settled(U64(0), "Dmj7oiekyFmekPtiC5BU24ocxNYqqdzh9CtvGC8CB51E".into());
    assert_eq!(c.get_payment(U64(0)).unwrap().settled_tx.unwrap(), "Dmj7oiekyFmekPtiC5BU24ocxNYqqdzh9CtvGC8CB51E");
    // the traveler moves what's left out of the NEAR wallet, no trip rules
    ctx_near("alice.near", 0);
    let _ = c.withdraw(WithdrawArgs { network: "near:testnet".into(), to: "wf.near".into(), amount: U128(USDC), nonce: "2".into(), valid_before: U64(HEIGHT + 300) });
    let w = c.get_payment(U64(1)).unwrap();
    assert_eq!((w.trip_id, w.authorization.to.as_str()), (None, "wf.near"));
}

#[test]
#[should_panic(expected = "pay_to: a NEAR account")]
fn near_merchant_needs_a_near_account() {
    let mut c = near_setup();
    ctx_near("owner.near", 0);
    c.add_merchant("bad".into(), "Bad".into(), "dining".into(), "near:testnet".into(), "Not An Account".into(), "http://x".into());
}
