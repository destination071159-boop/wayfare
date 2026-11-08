// On-ramp: funds the trip wallet from the traveler's NEAR savings, on every chain the trip pays on (USDC on Base
// for the flight and train, on Arbitrum for the hotel, on NEAR itself for the dinner).
//
// The price is a live quote from NEAR Intents (the 1Click API, mainnet), one per chain: how much NEAR buys exactly
// what that chain's bookings need. The quotes are dry runs, so nothing touches mainnet. NEAR Intents has no testnet,
// so in the demo:
//   - real: the quotes, and the traveler's NEAR deposit on NEAR testnet (to the Wayfare contract account);
//   - simulated: the solver's delivery, i.e. USDC credited to the trip wallet on each local fork; on NEAR testnet it
//     is a real USDC transfer from the demo pool (the Wayfare contract account, holding Circle faucet USDC).
// On mainnet the deposit goes to the 1Click deposit address from a non-dry quote, and a solver delivers the USDC.
import { CHAIN_MODE, CHAINS, isNear, type Rail, RAILS, client, refreshForks, usdcOn } from "./chains.js";
import { merchantChain } from "./merchants.js";
import { account, CONTRACT, env, traveler, view } from "./near.js";
import { nearUsdc, nearWallet, poolId, sendUsdc } from "./near-rail.js";

const ONECLICK = process.env.ONECLICK_URL ?? "https://1click.chaindefuser.com/v0";
const NEAR_ASSET = "nep141:wrap.near";

/** One chain's share of the funding. */
export type Leg = { network: string; chain: string; usdc: string; near: string; near_in: string; usd_in: string; before?: string; after?: string; tx?: string };

export type Quote = {
  legs?: Leg[];
  usdc_out: string; // base units (6 decimals)
  near_in: string; // yoctoNEAR
  near: string; // e.g. "2.6690"
  usd_in: string;
  time_estimate_sec: number;
  source: string;
  at: string;
};

export type Funded = { legs?: Leg[]; usdc: string; near: string; near_in: string; near_tx: string; deposit_to: string; quote: Quote; before: string; after: string; at: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nearOf = (yocto: string) => (Number(BigInt(yocto) / 10n ** 20n) / 1e4).toFixed(4);

/** POST /quote, retrying when the public API rate-limits. ONECLICK_JWT (optional, from partners.near-intents.org) lifts the limits. */
async function oneClickQuote<Q>(body: object): Promise<Q> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.ONECLICK_JWT) headers.authorization = `Bearer ${process.env.ONECLICK_JWT}`;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${ONECLICK}/quote`, { method: "POST", headers, signal: AbortSignal.timeout(20_000), body: JSON.stringify(body) });
    const text = await r.text();
    const limited = r.status === 429 || text.includes("-429") || /rate limit/i.test(text);
    if (limited && attempt < 4) {
      await wait(4000 * 2 ** attempt); // 4, 8, 16, 32 s
      continue;
    }
    let parsed: { quote?: Q; message?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {}
    if (!r.ok || !parsed.quote) throw new Error(`NEAR Intents quote failed: ${limited ? "rate limited, try again in a minute" : (parsed.message ?? r.status)}`);
    return parsed.quote;
  }
}

const deadline = () => new Date(Date.now() + 30 * 60_000).toISOString();
// a dry quote takes no deposit, so nothing is ever sent or refunded; the API only needs valid mainnet accounts
const PLACEHOLDER_NEAR = process.env.ONECLICK_REFUND_TO ?? "0".repeat(64);

/** A live NEAR Intents quote: how much NEAR buys exactly `usdc` (base units) of USDC on Base. */
export async function quoteNearForUsdc(usdc: bigint, recipient: string, chain: Pick<Rail, "intents_asset"> = CHAINS[0]): Promise<Quote> {
  const q = await oneClickQuote<{ amountIn: string; amountInUsd: string; amountOut: string; timeEstimate: number }>({
    dry: true,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: NEAR_ASSET,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: chain.intents_asset,
    amount: usdc.toString(),
    refundTo: PLACEHOLDER_NEAR,
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: deadline(),
  });
  return {
    usdc_out: q.amountOut,
    near_in: q.amountIn,
    near: nearOf(q.amountIn),
    usd_in: Number(q.amountInUsd).toFixed(2),
    time_estimate_sec: q.timeEstimate,
    source: "NEAR Intents 1Click, live mainnet quote (dry run)",
    at: new Date().toISOString(),
  };
}

export type ReturnQuote = { usdc_in: string; near_out: string; near: string; usd: string; time_estimate_sec: number; source: string; at: string };

/** The reverse: a live NEAR Intents quote for how much NEAR exactly `usdc` (base units) of USDC on Base buys. */
export async function quoteUsdcForNear(usdc: bigint, refundTo: string, chain: Pick<Rail, "intents_asset"> = CHAINS[0]): Promise<ReturnQuote> {
  const q = await oneClickQuote<{ amountIn: string; amountOut: string; amountOutUsd: string; timeEstimate: number }>({
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: chain.intents_asset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR_ASSET,
    amount: usdc.toString(),
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: PLACEHOLDER_NEAR, // the traveler is a testnet account
    recipientType: "DESTINATION_CHAIN",
    deadline: deadline(),
  });
  return {
    usdc_in: q.amountIn,
    near_out: q.amountOut,
    near: nearOf(q.amountOut),
    usd: Number(q.amountOutUsd).toFixed(2),
    time_estimate_sec: q.timeEstimate,
    source: "NEAR Intents 1Click, live mainnet quote (dry run)",
    at: new Date().toISOString(),
  };
}

/** The traveler's NEAR savings on testnet: available balance in yoctoNEAR. */
export async function nearSavings(): Promise<{ account: string; near: string } | null> {
  try {
    const me = await traveler();
    return { account: me.accountId, near: (await me.getAccountBalance()).available };
  } catch {
    return null;
  }
}

export async function walletAddress(): Promise<`0x${string}`> {
  const w = await view<{ address: `0x${string}` } | null>("get_wallet", { traveler: (await traveler()).accountId });
  if (!w) throw new Error("the traveler has no wallet");
  return w.address;
}

export async function usdcBalance(address: `0x${string}`, chain = CHAINS[0]): Promise<bigint> {
  return usdcOn(chain, address);
}

/** The trip wallet on a chain: the EVM address, or the NEAR implicit account. */
export async function holderOn(rail: Rail): Promise<string> {
  return isNear(rail) ? (await nearWallet()).account_id : walletAddress();
}

/** USDC the trip wallet holds on a chain. */
export async function balanceOn(rail: Rail, holder?: string): Promise<bigint> {
  const h = holder ?? (await holderOn(rail));
  return isNear(rail) ? nearUsdc(h) : usdcOn(rail, h as `0x${string}`);
}

/**
 * What each chain needs: its bookings, plus its share of the spare budget (in proportion to its bookings, rounded
 * down to 0.01 USDC) for changes like a rebooking. Base takes whatever rounding leaves over.
 */
export function needsFor(plan: { items: { merchant: string; total: number }[]; budget: number }): { chain: Rail; usdc: bigint }[] {
  const items = RAILS.map((c) => ({ chain: c, usdc: 0n }));
  for (const it of plan.items) items.find((x) => x.chain.id === merchantChain(it.merchant).id)!.usdc += BigInt(it.total);
  const total = items.reduce((s, x) => s + x.usdc, 0n);
  const spare = BigInt(plan.budget) - total;
  const out = items.map((x) => ({ chain: x.chain, usdc: x.usdc + (total > 0n && spare > 0n ? ((spare * x.usdc) / total / 10_000n) * 10_000n : 0n) }));
  out[0].usdc += BigInt(plan.budget) - out.reduce((s, x) => s + x.usdc, 0n);
  return out.filter((x) => x.usdc > 0n);
}

/** One live NEAR Intents quote per chain, combined. */
export async function quoteNeeds(needs: { chain: Rail; usdc: bigint }[], recipient: string): Promise<Quote> {
  const legs: Leg[] = [];
  let timeMax = 0;
  for (const n of needs) {
    // NEAR's leg is delivered to the NEAR trip wallet (an implicit account: a valid mainnet account id too)
    const to = isNear(n.chain) ? await holderOn(n.chain).catch(() => "0".repeat(64)) : recipient;
    const q = await quoteNearForUsdc(n.usdc, to, n.chain);
    timeMax = Math.max(timeMax, q.time_estimate_sec);
    legs.push({ network: n.chain.id, chain: n.chain.name, usdc: q.usdc_out, near: q.near, near_in: q.near_in, usd_in: q.usd_in });
  }
  const nearIn = legs.reduce((s, l) => s + BigInt(l.near_in), 0n);
  return {
    legs,
    usdc_out: legs.reduce((s, l) => s + BigInt(l.usdc), 0n).toString(),
    near_in: nearIn.toString(),
    near: (Number(nearIn / 10n ** 20n) / 1e4).toFixed(4),
    usd_in: legs.reduce((s, l) => s + Number(l.usd_in), 0).toFixed(2),
    time_estimate_sec: timeMax,
    source: "NEAR Intents 1Click, live mainnet quotes (dry run)",
    at: new Date().toISOString(),
  };
}

/** Tops the trip wallet up on each chain to what that chain needs. Returns null when it already holds enough. */
export async function fundTrip(needs: { chain: Rail; usdc: bigint }[], log: (kind: string, text: string, data?: unknown) => void = () => {}): Promise<Funded | null> {
  const wallet = await walletAddress();
  await refreshForks(wallet);
  const gaps: { chain: Rail; usdc: bigint; before: bigint; holder: string }[] = [];
  for (const n of needs) {
    const holder = await holderOn(n.chain);
    const before = await balanceOn(n.chain, holder);
    if (before < n.usdc) gaps.push({ chain: n.chain, usdc: n.usdc - before, before, holder });
  }
  if (!gaps.length) {
    log("fund", "the trip wallet already holds enough on every chain: no funding needed");
    return null;
  }
  if (CHAIN_MODE !== "local") throw new Error("the on-ramp demo credits USDC on the local forks; fund the wallet yourself in live mode");
  const quote = await quoteNeeds(gaps, wallet);
  for (const l of quote.legs!) log("quote", `NEAR Intents: ${l.near} NEAR buys ${Number(l.usdc) / 1e6} USDC on ${l.chain} (≈ $${l.usd_in})`, l);

  const me = await traveler();
  const deposit = CONTRACT();
  const out = await me.sendMoney(deposit, BigInt(quote.near_in));
  const nearTx = out.transaction.hash as string;
  log("fund", `${quote.near} NEAR deposited from your NEAR savings (testnet tx ${nearTx})`, { tx: nearTx });

  // The solver's side, simulated: deliver the USDC to the trip wallet. On each local fork it is credited; on NEAR
  // testnet the demo pool sends real testnet USDC.
  for (const [k, g] of gaps.entries()) {
    const target = g.before + g.usdc;
    let tx: string | undefined;
    if (isNear(g.chain)) {
      const pool = await account(poolId(), env("TRAVELER_KEY"));
      const have = await nearUsdc(pool.accountId);
      if (have < g.usdc) throw new Error(`the demo pool ${pool.accountId} has ${Number(have) / 1e6} USDC on NEAR testnet; top it up at https://faucet.circle.com (NEAR Testnet)`);
      tx = await sendUsdc(pool, g.holder, g.usdc, "wayfare on-ramp (NEAR Intents solver stand-in)");
    } else {
      await client(g.chain).request({ method: "anvil_dealERC20" as never, params: [wallet, g.chain.usdc, `0x${target.toString(16)}`] as never });
    }
    const now = await balanceOn(g.chain, g.holder);
    Object.assign(quote.legs![k], { before: g.before.toString(), after: now.toString(), ...(tx ? { tx } : {}) });
    const where = isNear(g.chain) ? `NEAR (testnet tx ${tx})` : `${g.chain.name} (local fork, solver simulated)`;
    log("funded", `${Number(g.usdc) / 1e6} USDC arrived in the trip wallet on ${where}: ${Number(now) / 1e6} USDC`);
  }
  const before = gaps.reduce((s, g) => s + g.before, 0n);
  const after = quote.legs!.reduce((s, l) => s + BigInt(l.after ?? "0"), 0n);
  const usdc = gaps.reduce((s, g) => s + g.usdc, 0n);
  return { legs: quote.legs, usdc: usdc.toString(), near: quote.near, near_in: quote.near_in, near_tx: nearTx, deposit_to: deposit, quote, before: before.toString(), after: after.toString(), at: new Date().toISOString() };
}
