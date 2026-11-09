// End-to-end over HTTP (no browser yet): approve a trip on NEAR, book a room on Lantern Stays, pay its x402 checkout
// through the Wayfare contract, then try a pricier room and watch the contract refuse.
// Run with the hotel site up (pnpm -C sites start): pnpm -C agent pay:hotel
import crypto from "node:crypto";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";
import { agent, call, nearAmount, traveler, view } from "../src/near.js";
import { BASE_RPC, CHAIN_LABEL, USDC_BASE_SEPOLIA, txLink } from "../src/merchants.js";
import { PaymentRefused, payX402 } from "../src/x402-near.js";

const HOTEL = process.env.HOTEL_URL ?? "http://localhost:4102";
const say = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

const me = await traveler();
const bot = await agent();
const wallet = (await view<{ address: `0x${string}` }>("get_wallet", { traveler: me.accountId })).address;
const base = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });
const balance = async () => formatUnits(await base.readContract({ address: USDC_BASE_SEPOLIA, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }), 6);
say(`traveler wallet ${wallet}: ${await balance()} USDC on ${CHAIN_LABEL}`);

// 1. the traveler approves a trip: one hotel item, at most 3.00 USDC
const plan = { title: "Kyoto weekend", items: [{ merchant: "lantern-stays", what: "2 nights near Gion", max: "3.00 USDC" }] };
const { value: tripId } = await call<string>(
  me,
  "create_trip",
  {
    trip: {
      agent: bot.accountId,
      title: plan.title,
      plan_hash: crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
      budget: "3500000",
      items: [{ merchant_id: "lantern-stays", label: "2 nights near Gion", max: "3000000" }],
      vault_fields: ["full_name", "passport_no", "email"],
      duration_sec: 3600,
    },
  },
  { deposit: nearAmount("0.25") },
);
say(`trip ${tripId} approved on NEAR (hotel ≤ 3.00 USDC)`);

async function book(room: string) {
  const form = new URLSearchParams({ city: "kyoto", checkin: "2026-11-20", nights: "2", guests: "1", hotel: "gion-hanare", room, full_name: "Aiko Tanaka", passport_no: "TZ1234567", email: "aiko@example.com" });
  const r = await fetch(`${HOTEL}/reserve`, { method: "POST", body: form, redirect: "manual" });
  const id = new URL(r.headers.get("location")!, HOTEL).searchParams.get("id")!;
  const b = (await (await fetch(`${HOTEL}/api/bookings/${id}`)).json()) as { ref: string; total: string; title: string };
  say(`booked ${b.title} (${b.ref}), total ${formatUnits(BigInt(b.total), 6)} USDC → ${HOTEL}/booking?id=${id}`);
  return id;
}

async function pay(id: string) {
  const t0 = Date.now();
  try {
    const paid = await payX402(bot, `${HOTEL}/api/bookings/${id}/pay`, { method: "POST" }, tripId, 0, {
      onAsk: ({ amount }) => say(`hotel answered 402: pay ${formatUnits(BigInt(amount), 6)} USDC, asking the NEAR contract to sign…`),
      onSigned: ({ nearTx }) => say(`contract signed (NEAR tx ${nearTx}) in ${((Date.now() - t0) / 1000).toFixed(1)}s, sending the x402 payment`),
    });
    say(`hotel answered ${paid.response.status}: ${paid.error ?? JSON.stringify(paid.body).slice(0, 160)}`);
    if (paid.settlement?.transaction) {
      say(`settled on ${CHAIN_LABEL}: ${txLink(paid.settlement.transaction)}`);
      await call(bot, "report_settled", { payment_id: paid.outcome!.payment_id, tx_hash: paid.settlement.transaction });
      say("settlement recorded on the trip");
    }
  } catch (e) {
    if (e instanceof PaymentRefused) say(`REFUSED by the contract: ${e.outcome.reason}`);
    else say(`payment failed: ${(e as Error).message}`);
  }
}

await pay(await book("tatami-twin"));
say("now the agent tries the Garden Suite (5.80 USDC) on the same trip…");
await pay(await book("garden-suite"));
say(`traveler wallet now ${await balance()} USDC`);
const t = await view<{ spent: string; refusals: number; receipt_head: string }>("get_trip", { trip_id: tripId });
say(`trip ${tripId}: spent ${formatUnits(BigInt(t.spent), 6)} USDC, ${t.refusals} refused, receipt head ${t.receipt_head.slice(0, 16)}…`);

