// End-to-end over HTTP (no browser yet): approve a 4-item trip on NEAR, book a flight, a train, a hotel and a dinner
// on the demo sites, pay each x402 checkout through the Wayfare contract, then try a pricier hotel room and watch the
// contract refuse. Run with the chain (local mode) and sites up: pnpm -C agent pay:trip
import crypto from "node:crypto";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_RPC, CHAIN_LABEL, MERCHANTS, USDC_BASE_SEPOLIA, txLink } from "../src/merchants.js";
import { agent, call, nearAmount, traveler, view } from "../src/near.js";
import { PaymentRefused, payX402 } from "../src/x402-near.js";

const say = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const url = (id: string) => MERCHANTS.find((m) => m.id === id)!.url;
const usd = (base: string | bigint) => formatUnits(BigInt(base), 6);

const me = await traveler();
const bot = await agent();
const wallet = (await view<{ address: `0x${string}` }>("get_wallet", { traveler: me.accountId })).address;
const base = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });
const balance = async () => usd(await base.readContract({ address: USDC_BASE_SEPOLIA, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }));
say(`traveler wallet ${wallet}: ${await balance()} USDC on ${CHAIN_LABEL}`);

const guest = { full_name: "Aiko Tanaka", passport_no: "TZ1234567", email: "aiko@example.com" };
// what the agent books, and how (form on each site)
const ITEMS: { merchant: string; label: string; max: string; form: string; fields: Record<string, string> }[] = [
  { merchant: "kumo-air", label: "Flight Bangkok → Tokyo", max: "3200000", form: "/passenger", fields: { from: "bkk", to: "hnd", date: "2026-11-19", pax: "1", flight: "bkk-hnd-1055", cabin: "economy" } },
  { merchant: "kiseki-rail", label: "Train Tokyo → Kyoto", max: "1000000", form: "/passenger", fields: { from: "tokyo", to: "kyoto", date: "2026-11-20", pax: "1", train: "tokyo-kyoto-0830", cls: "ordinary" } },
  { merchant: "lantern-stays", label: "2 nights near Gion", max: "3000000", form: "/reserve", fields: { city: "kyoto", checkin: "2026-11-20", nights: "2", guests: "1", hotel: "gion-hanare", room: "tatami-twin" } },
  { merchant: "sumi-table", label: "Sushi dinner for 2", max: "1800000", form: "/reserve", fields: { city: "kyoto", date: "2026-11-21", party: "2", restaurant: "sushi-kaze", time: "18:00" } },
];

const plan = { title: "Bangkok → Kyoto, 3 days", items: ITEMS.map((i) => ({ merchant: i.merchant, what: i.label, max: i.max })) };
const budget = ITEMS.reduce((s, i) => s + BigInt(i.max), 0n) + 500_000n;
const { value: tripId } = await call<string>(
  me,
  "create_trip",
  {
    trip: {
      agent: bot.accountId,
      title: plan.title,
      plan_hash: crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
      budget: budget.toString(),
      items: ITEMS.map((i) => ({ merchant_id: i.merchant, label: i.label, max: i.max })),
      vault_fields: ["full_name", "passport_no", "email"],
      duration_sec: 3600,
    },
  },
  { deposit: nearAmount("0.25") },
);
say(`trip ${tripId} approved on NEAR: ${ITEMS.length} items, budget ${usd(budget)} USDC`);

async function book(merchant: string, form: string, fields: Record<string, string>) {
  const site = url(merchant);
  const r = await fetch(`${site}${form}`, { method: "POST", body: new URLSearchParams({ ...fields, ...guest }), redirect: "manual" });
  const id = new URL(r.headers.get("location")!, site).searchParams.get("id");
  if (!id) throw new Error(`${merchant}: booking failed (${r.status})`);
  const b = (await (await fetch(`${site}/api/bookings/${id}`)).json()) as { ref: string; total: string; title: string };
  say(`${merchant}: booked ${b.title} (${b.ref}), ${usd(b.total)} USDC`);
  return { site, id };
}

async function pay(item: number, site: string, id: string) {
  const t0 = Date.now();
  try {
    const paid = await payX402(bot, `${site}/api/bookings/${id}/pay`, { method: "POST" }, tripId, item, {
      onSigned: ({ nearTx }) => say(`  contract signed in ${((Date.now() - t0) / 1000).toFixed(1)}s (NEAR tx ${nearTx})`),
    });
    if (paid.settlement?.transaction) {
      say(`  paid, settled on ${CHAIN_LABEL}: ${txLink(paid.settlement.transaction)}`);
      await call(bot, "report_settled", { payment_id: paid.outcome!.payment_id, tx_hash: paid.settlement.transaction });
    } else say(`  merchant answered ${paid.response.status}: ${paid.error ?? JSON.stringify(paid.body).slice(0, 120)}`);
  } catch (e) {
    if (e instanceof PaymentRefused) say(`  REFUSED by the contract: ${e.outcome.reason}`);
    else say(`  payment failed: ${(e as Error).message}`);
  }
}

for (const [i, it] of ITEMS.entries()) {
  const { site, id } = await book(it.merchant, it.form, it.fields);
  await pay(i, site, id);
}
say("the agent tries to upgrade the hotel to the Garden Suite (5.80 USDC)…");
const up = await book("lantern-stays", "/reserve", { ...ITEMS[2].fields, room: "garden-suite" });
await pay(2, up.site, up.id);

const t = await view<{ spent: string; refusals: number; receipt_head: string; payments: string[] }>("get_trip", { trip_id: tripId });
say(`trip ${tripId}: ${t.payments.length} payments, spent ${usd(t.spent)} of ${usd(budget)} USDC, ${t.refusals} refused, receipt head ${t.receipt_head.slice(0, 16)}…`);
say(`traveler wallet now ${await balance()} USDC`);
