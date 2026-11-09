// A real, third-party x402 service paid the Wayfare way: not one of our demo sites, but a public weather API listed in
// the x402 Bazaar (Coinbase's directory of x402 services), on the real Base Sepolia.
//   1. the weather API is a merchant on the Wayfare contract (registered once, by the contract owner)
//   2. the traveler approves a tiny trip: one item, "Kyoto weather", capped at 0.01 USDC
//   3. the agent calls the API, gets 402, asks the NEAR contract to sign, and the service's own facilitator settles it
// Needs a little USDC on the real Base Sepolia in the trip wallet (faucet.circle.com). No ETH: the facilitator pays gas.
//   pnpm -C agent pay:real
import crypto from "node:crypto";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";
import { agent, call, nearAmount, traveler, view } from "../src/near.js";
import { NETWORK_BASE_SEPOLIA, USDC_BASE_SEPOLIA } from "../src/merchants.js";
import { PaymentRefused, payX402 } from "../src/x402-near.js";

const API = process.env.REAL_X402_URL ?? "https://wallets-demo-seller-server.calebgcarithers.workers.dev/weather";
const CITY = process.env.CITY ?? "Kyoto";
const MERCHANT = { id: "bazaar-weather", name: "Weather API (x402 Bazaar)", category: "data", url: API };
const CAP = 10_000n; // 0.01 USDC
const say = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

const me = await traveler();
const bot = await agent();
const wallet = (await view<{ address: `0x${string}` }>("get_wallet", { traveler: me.accountId })).address;

// what the service asks for, before paying anything
const url = `${API}?location=${encodeURIComponent(CITY)}`;
const first = await fetch(url);
const req = first.headers.get("PAYMENT-REQUIRED");
if (first.status !== 402 || !req) throw new Error(`${API} answered ${first.status}, not an x402 402`);
const ask = (JSON.parse(Buffer.from(req, "base64").toString()) as { accepts: { network: string; amount: string; asset: string; payTo: string }[] }).accepts.find((a) => a.network === NETWORK_BASE_SEPOLIA.id);
if (!ask) throw new Error(`${API} does not take USDC on Base Sepolia`);
if (ask.asset.toLowerCase() !== USDC_BASE_SEPOLIA.toLowerCase()) throw new Error(`${API} asks for ${ask.asset}, not Circle's USDC`);
say(`${API} answered 402: ${formatUnits(BigInt(ask.amount), 6)} USDC on Base Sepolia to ${ask.payTo}`);

// the trip wallet's USDC on the real Base Sepolia (not the local fork the demo uses)
const real = createPublicClient({ chain: baseSepolia, transport: http(process.env.REAL_BASE_RPC ?? "https://sepolia.base.org") });
const balance = async () => real.readContract({ address: USDC_BASE_SEPOLIA, abi: erc20Abi, functionName: "balanceOf", args: [wallet] });
const before = await balance();
say(`trip wallet ${wallet}: ${formatUnits(before, 6)} USDC on the real Base Sepolia`);
if (before < BigInt(ask.amount)) {
  say(`not enough: get test USDC at https://faucet.circle.com (Base Sepolia) for ${wallet}, then run this again`);
  process.exit(1);
}

// 1. the service as a Wayfare merchant: the contract will only ever pay this address for it
const merchants = await view<{ id: string; pay_to: string }[]>("get_merchants", {}).catch(() => [] as { id: string; pay_to: string }[]);
const known = merchants.find((m) => m.id === MERCHANT.id);
if (!known) {
  const { tx } = await call(me, "add_merchant", { ...MERCHANT, network: NETWORK_BASE_SEPOLIA.id, pay_to: ask.payTo });
  say(`registered ${MERCHANT.name} on the Wayfare contract (NEAR tx ${tx})`);
} else if (known.pay_to.toLowerCase() !== ask.payTo.toLowerCase()) {
  throw new Error(`the service now asks to be paid at ${ask.payTo}, but the contract has ${known.pay_to}: not paying`);
}

// 2. the traveler approves one item
const plan = { title: `${CITY} weather check`, items: [{ merchant: MERCHANT.id, what: `current weather in ${CITY}`, max: "0.01 USDC" }] };
const { value: tripId, tx: approveTx } = await call<string>(
  me,
  "create_trip",
  {
    trip: {
      agent: bot.accountId,
      title: plan.title,
      plan_hash: crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
      budget: CAP.toString(),
      items: [{ merchant_id: MERCHANT.id, label: `Current weather in ${CITY}`, max: CAP.toString() }],
      vault_fields: [],
      duration_sec: 1800,
    },
  },
  { deposit: nearAmount("0.25") },
);
say(`trip ${tripId} approved on NEAR: one item, at most 0.01 USDC (tx ${approveTx})`);

// 3. the agent pays, through the contract
const t0 = Date.now();
try {
  const paid = await payX402(bot, url, { method: "GET" }, tripId, 0, {
    onAsk: ({ amount, to }) => say(`asking the NEAR contract to sign ${formatUnits(BigInt(amount), 6)} USDC to ${to}…`),
    onSigned: ({ nearTx }) => say(`NEAR contract signed (tx ${nearTx}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`),
  });
  say(`${API} answered ${paid.response.status}${paid.error ? `: ${paid.error}` : ""}`);
  if (paid.response.ok) say(`weather: ${JSON.stringify(paid.body).slice(0, 400)}`);
  if (paid.settlement?.transaction) {
    say(`settled on the real Base Sepolia: https://sepolia.basescan.org/tx/${paid.settlement.transaction}`);
    const { tx } = await call(bot, "report_settled", { payment_id: paid.outcome!.payment_id, tx_hash: paid.settlement.transaction });
    say(`settlement recorded on the trip (NEAR tx ${tx})`);
  }
  if (paid.nearTx) say(`the signature on NEAR: https://testnet.nearblocks.io/txns/${paid.nearTx}`);
} catch (e) {
  if (e instanceof PaymentRefused) say(`REFUSED by the contract: ${e.outcome.reason}`);
  else say(`payment failed: ${(e as Error).message}`);
}
say(`trip wallet now ${formatUnits(await balance(), 6)} USDC on the real Base Sepolia`);
