//! Sandbox: the real wasm on a local NEAR node, with a mock MPC signer (same method and answer shape as
//! `v1.signer`). One test, one sandbox (light on memory):
//! merchants and a wallet → a trip → the agent's hot key pays within the rules (signed, via the real promise and
//! callback) → over the approved price is refused and logged → a vault read → the traveler ends the trip and
//! everything stops → a failed signature gives the budget back → the traveler withdraws.
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{AccessKey, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const WASM: &str = "../target/near/wayfare/wayfare.wasm";
const SIGNER: &str = "../target/near/mock_signer/mock_signer.wasm";
const H: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const USDC: u64 = 1_000_000;

fn ok(r: &ExecutionFinalResult) {
    assert!(r.receipt_failures().is_empty(), "unexpected failure: {:?}", r.receipt_failures());
}

fn failed_with(r: &ExecutionFinalResult, text: &str) -> bool {
    format!("{:?}", r.receipt_failures()).contains(text)
}

async fn trip(c: &Contract, id: u64) -> anyhow::Result<Value> {
    Ok(c.view("get_trip").args_json(json!({ "trip_id": id.to_string() })).await?.json()?)
}

async fn pay(agent: &Account, c: &Contract, trip_id: u64, item: u32, amount: u64, nonce: u8, now_sec: u64) -> anyhow::Result<ExecutionFinalResult> {
    Ok(agent
        .call(c.id(), "pay")
        .args_json(json!({ "args": { "trip_id": trip_id.to_string(), "item": item, "amount": (amount).to_string(),
            "nonce": format!("{:02x}", nonce).repeat(32), "valid_before": (now_sec + 600).to_string() } }))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?)
}

async fn new_trip(traveler: &Account, c: &Contract, agent: &str) -> anyhow::Result<u64> {
    let r = traveler
        .call(c.id(), "create_trip")
        .args_json(json!({ "trip": { "agent": agent, "title": "Tokyo to Kyoto, 2 nights", "plan_hash": H, "budget": (200 * USDC).to_string(),
            "items": [
                { "merchant_id": "kyoto-rail", "label": "Shinkansen Tokyo → Kyoto", "max": (40 * USDC).to_string() },
                { "merchant_id": "gion-house", "label": "2 nights near Gion", "max": (150 * USDC).to_string() }
            ],
            "vault_fields": ["full_name", "passport_no"], "duration_sec": 3600 } }))
        .deposit(NearToken::from_millinear(250))
        .transact()
        .await?;
    ok(&r);
    Ok(r.json::<String>()?.parse()?)
}

#[tokio::test]
async fn trip_payments() -> anyhow::Result<()> {
    let w = near_workspaces::sandbox().await?;
    let root = w.root_account()?;
    let signer = root.create_subaccount("signer").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let signer = signer.deploy(&std::fs::read(SIGNER)?).await?.into_result()?;
    let c = root.create_subaccount("wayfare").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let c = c.deploy(&std::fs::read(WASM)?).await?.into_result()?;
    ok(&c
        .call("new")
        .args_json(json!({ "owner": root.id(), "mpc": signer.id(), "networks": [{ "id": "eip155:84532", "label": "Base Sepolia", "chain_id": 84532,
            "token": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "token_name": "USDC", "token_version": "2" }] }))
        .transact()
        .await?);
    for (id, cat, to) in [("kyoto-rail", "rail", "0x1111111111111111111111111111111111111111"), ("gion-house", "hotel", "0x2222222222222222222222222222222222222222")] {
        ok(&root.call(c.id(), "add_merchant").args_json(json!({ "id": id, "name": id, "category": cat, "network": "eip155:84532", "pay_to": to, "url": "http://localhost" })).transact().await?);
    }
    let alice = root.create_subaccount("alice").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let bot = alice.create_subaccount("bot").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    ok(&alice.call(c.id(), "set_wallet").args_json(json!({ "address": "0xac901defd711ca8ca01b3d35e6dda85ea300ef13" })).deposit(NearToken::from_millinear(10)).transact().await?);
    let t1 = new_trip(&alice, &c, bot.id().as_str()).await?;

    // the agent's hot key: function calls on Wayfare only, three methods
    let sk = SecretKey::from_random(KeyType::ED25519);
    ok(&bot
        .batch(bot.id())
        .add_key(sk.public_key(), AccessKey::function_call_access(c.id(), &["pay", "record_read", "report_settled"], Some(NearToken::from_millinear(500))))
        .transact()
        .await?);
    let hot = Account::from_secret_key(bot.id().clone(), sk, &w);
    let now_sec = w.view_block().await?.timestamp() / 1_000_000_000;

    // ── within the rules: signed through the real promise + callback ──
    let r = pay(&hot, &c, t1, 1, 120 * USDC, 1, now_sec).await?;
    ok(&r);
    let out: Value = r.json()?;
    assert_eq!(out["status"], "signed", "{out}");
    assert_eq!(out["authorization"]["to"], "0x2222222222222222222222222222222222222222", "paid to the merchant's registered address");
    assert_eq!(out["authorization"]["from"], "0xac901defd711ca8ca01b3d35e6dda85ea300ef13");
    assert_eq!(out["authorization"]["value"], "120000000");
    assert_eq!(out["signature"].as_str().unwrap().len(), 132);
    assert_eq!(signer.view("signed").await?.json::<u64>()?, 1);

    // ── over the approved price: refused, logged, nothing signed ──────
    let r = pay(&hot, &c, t1, 1, 60 * USDC, 2, now_sec).await?;
    ok(&r);
    assert!(r.logs().iter().any(|l| l.contains("payment_refused")));
    let out: Value = r.json()?;
    assert_eq!(out["status"], "refused");
    assert!(out["reason"].as_str().unwrap().contains("over the approved price"), "{out}");
    assert_eq!(signer.view("signed").await?.json::<u64>()?, 1, "the signer was never asked");
    let t = trip(&c, t1).await?;
    assert_eq!((t["spent"].as_str(), t["refusals"].as_u64()), (Some("120000000"), Some(1)));

    // the hot key can't create trips or move the traveler's money
    let r = hot.call(c.id(), "withdraw").args_json(json!({ "args": { "network": "eip155:84532", "to": "0x3333333333333333333333333333333333333333", "amount": "1", "nonce": "09".repeat(32), "valid_before": (now_sec + 600).to_string() } })).gas(Gas::from_tgas(300)).transact().await;
    assert!(r.is_err() || !r.unwrap().receipt_failures().is_empty(), "the hot key must not withdraw");

    // ── vault ─────────────────────────────────────────────────────────
    ok(&hot.call(c.id(), "record_read").args_json(json!({ "trip_id": t1.to_string(), "fields": ["full_name", "passport_no"], "purpose": "hotel guest form" })).transact().await?);
    let r = hot.call(c.id(), "record_read").args_json(json!({ "trip_id": t1.to_string(), "fields": ["card_number"], "purpose": "checkout" })).transact().await?;
    assert!(failed_with(&r, "not granted"));
    let can: bool = c.view("can_read").args_json(json!({ "trip_id": t1.to_string(), "agent": bot.id(), "field": "passport_no" })).await?.json()?;
    assert!(can);

    // ── settlement report ─────────────────────────────────────────────
    ok(&hot.call(c.id(), "report_settled").args_json(json!({ "payment_id": "0", "tx_hash": format!("0x{}", "ab".repeat(32)) })).transact().await?);

    // ── the traveler ends the trip: everything stops ──────────────────
    ok(&alice.call(c.id(), "end_trip").args_json(json!({ "trip_id": t1.to_string() })).transact().await?);
    let out: Value = pay(&hot, &c, t1, 0, 10 * USDC, 3, now_sec).await?.json()?;
    assert_eq!(out["reason"], "the traveler ended this trip");
    let r = hot.call(c.id(), "record_read").args_json(json!({ "trip_id": t1.to_string(), "fields": ["full_name"], "purpose": "x" })).transact().await?;
    assert!(failed_with(&r, "vault access has ended"));
    let t = trip(&c, t1).await?;
    assert_eq!((t["phase"].as_str(), t["payments"].as_array().unwrap().len(), t["reads"].as_array().unwrap().len()), (Some("ended"), 1, 1));
    assert_ne!(t["receipt_head"], "0".repeat(64));

    // ── the signer fails: the reservation comes back ──────────────────
    let failer = root.create_subaccount("failer").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    ok(&failer.call(c.id(), "set_wallet").args_json(json!({ "address": "0x4444444444444444444444444444444444444444" })).deposit(NearToken::from_millinear(10)).transact().await?);
    let t2 = new_trip(&failer, &c, bot.id().as_str()).await?;
    let r = pay(&hot, &c, t2, 0, 30 * USDC, 4, now_sec).await?;
    let out: Value = r.json()?;
    assert_eq!(out["status"], "failed", "{out}");
    let t = trip(&c, t2).await?;
    assert_eq!((t["spent"].as_str(), t["items"][0]["paid"].as_str()), (Some("0"), Some("0")));

    // ── the traveler can always withdraw (full key) ───────────────────
    let r = alice
        .call(c.id(), "withdraw")
        .args_json(json!({ "args": { "network": "eip155:84532", "to": "0x3333333333333333333333333333333333333333", "amount": (500 * USDC).to_string(), "nonce": "0a".repeat(32), "valid_before": (now_sec + 600).to_string() } }))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?;
    ok(&r);
    let out: Value = r.json()?;
    assert_eq!((out["status"].as_str(), out["authorization"]["to"].as_str()), (Some("signed"), Some("0x3333333333333333333333333333333333333333")));
    Ok(())
}
