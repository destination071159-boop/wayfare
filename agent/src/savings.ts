// Off-ramp: when a trip ends, what's left in the trip wallet goes back to the traveler's NEAR savings, from every
// chain the trip paid on.
//
// 1. For each chain with USDC left, the traveler asks the Wayfare contract to `withdraw`; the contract builds a USDC
//    TransferWithAuthorization from the trip wallet to the swap's deposit address on that chain, and the NEAR MPC
//    network signs it. A relayer submits it (paying gas), and the tx hash is reported back on NEAR.
// 2. NEAR Intents swaps that USDC to NEAR for the traveler. The price is a live 1Click quote per chain (dry run).
//    NEAR Intents has no testnet, so in the demo the deposit address is anvil's test account #1 and the solver's
//    payout is one real testnet transfer from the Wayfare contract account, which holds the NEAR the on-ramp deposited.
// On NEAR itself the leg is the same idea with a NEAR transaction: the contract signs a delegate action (one USDC
// `ft_transfer` from the NEAR trip wallet), the traveler's account relays it, and the USDC lands in the demo pool.
import crypto from "node:crypto";
import { createWalletClient, http, parseSignature, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS, CHAIN_MODE, type Chain, isNear, NEAR_RAIL, type Rail, railById, client, usdcOn } from "./chains.js";
import { blockHeight, nearUsdc, nearWallet, nextNonce, poolId, relay, signedDelegateB64 } from "./near-rail.js";
import { account, call, CONTRACT, env, traveler, view } from "./near.js";
import { quoteUsdcForNear, type ReturnQuote, walletAddress } from "./onramp.js";
import type { PayOutcome } from "./x402-near.js";

// Anvil's well-known dev accounts: #1 stands in for the NEAR Intents deposit address, #0 pays gas on the local forks.
const ANVIL_SAVINGS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export const DEPOSIT_ADDRESS = (process.env.INTENTS_DEPOSIT_ADDRESS ?? (CHAIN_MODE === "local" ? ANVIL_SAVINGS : "")) as `0x${string}` | "";
const RELAYER_KEY = (process.env.RELAYER_KEY ?? (CHAIN_MODE === "local" ? (process.env.LOCAL_FACILITATOR_KEY ?? ANVIL_KEY) : "")) as Hex | "";

const USDC_ABI = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

/** One chain's part of the return. */
export type ReturnLeg = { network: string; chain: string; amount: string; payment_id?: string; near_tx: string; settle_tx?: string; quote?: ReturnQuote };

export type Returned = {
  amount: string; // total, all chains
  to: string; // the swap's deposit address
  legs?: ReturnLeg[];
  payment_id?: string;
  near_tx: string; // the first leg's withdraw (signature) on NEAR
  settle_tx?: string; // set once every leg has settled
  quote?: ReturnQuote; // USDC → NEAR, all legs combined
  near?: string; // NEAR back in savings, e.g. "0.6106"
  payout_tx?: string; // the NEAR arriving in the traveler's account (testnet)
  account?: string;
  at: string;
};

type Log = (kind: string, text: string, data?: unknown) => void;

/** How much of the trip's budget was never spent, read from the contract. */
export async function unspentOf(tripId: string): Promise<bigint> {
  const t = await view<{ budget: string; spent: string }>("get_trip", { trip_id: tripId });
  const left = BigInt(t.budget) - BigInt(t.spent);
  return left > 0n ? left : 0n;
}

/** What the trip wallet holds on each chain (chains with nothing left out). */
export async function walletLeft(): Promise<{ chain: Rail; amount: bigint }[]> {
  const w = await walletAddress();
  const out: { chain: Rail; amount: bigint }[] = [];
  for (const c of CHAINS) out.push({ chain: c, amount: await usdcOn(c, w) });
  try {
    out.push({ chain: NEAR_RAIL, amount: await nearUsdc((await nearWallet()).account_id) });
  } catch {} // no NEAR wallet yet
  return out.filter((x) => x.amount > 0n);
}

/** NEAR: the contract signs an ft_transfer from the NEAR trip wallet to the pool; the traveler relays it (pays gas). */
async function returnNearLeg(amount: bigint, log: Log): Promise<ReturnLeg> {
  const w = await nearWallet();
  const to = poolId();
  log("return", `asking the Wayfare contract on NEAR to sign ${Number(amount) / 1e6} USDC on NEAR to the NEAR Intents deposit account ${to}`);
  const { value: out, tx: nearTx } = await call<PayOutcome>(
    await traveler(),
    "withdraw",
    { args: { network: NEAR_RAIL.id, to, amount: amount.toString(), nonce: String(await nextNonce(w)), valid_before: String((await blockHeight()) + 300) } },
    { tgas: 300n },
  );
  if (out.status !== "signed" || !out.signature || !out.near) throw new Error(`the contract did not sign the return: ${out.reason ?? out.status}`);
  log("signed", `NEAR MPC signed the NEAR return (payment ${out.payment_id})`, { tx: nearTx });
  const leg: ReturnLeg = { network: NEAR_RAIL.id, chain: NEAR_RAIL.name, amount: amount.toString(), payment_id: out.payment_id, near_tx: nearTx };
  const hash = await relay(env("TRAVELER_ACCOUNT"), env("TRAVELER_KEY"), signedDelegateB64(out.near, out.signature));
  log("paid", `${Number(amount) / 1e6} USDC sent to the swap on NEAR: ${hash}`);
  leg.settle_tx = hash;
  if (out.payment_id) {
    try {
      await call(await traveler(), "report_settled", { payment_id: out.payment_id, tx_hash: hash });
    } catch (e) {
      log("note", `could not record the NEAR settlement yet: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  return leg;
}

/** Signs (on NEAR) and settles (on its chain) one transfer from the trip wallet to the deposit address. */
async function returnLeg(rail: Rail, amount: bigint, log: Log): Promise<ReturnLeg> {
  if (isNear(rail)) return returnNearLeg(amount, log);
  const chain: Chain = rail;
  const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
  const validBefore = Math.floor(Date.now() / 1000) + 600;
  log("return", `asking the Wayfare contract on NEAR to sign ${Number(amount) / 1e6} USDC on ${chain.name} to the NEAR Intents deposit address ${DEPOSIT_ADDRESS}`);
  const { value: out, tx: nearTx } = await call<PayOutcome>(
    await traveler(),
    "withdraw",
    { args: { network: chain.id, to: DEPOSIT_ADDRESS, amount: amount.toString(), nonce, valid_before: String(validBefore) } },
    { tgas: 300n },
  );
  if (out.status !== "signed" || !out.signature || !out.authorization) throw new Error(`the contract did not sign the return: ${out.reason ?? out.status}`);
  log("signed", `NEAR MPC signed the ${chain.name} return (payment ${out.payment_id})`, { tx: nearTx });
  const leg: ReturnLeg = { network: chain.id, chain: chain.name, amount: amount.toString(), payment_id: out.payment_id, near_tx: nearTx };
  if (!RELAYER_KEY) {
    log("note", "signed but not submitted: set RELAYER_KEY to pay gas");
    return leg;
  }
  const a = out.authorization;
  const sig = parseSignature(out.signature as Hex);
  const v = Number(sig.v ?? BigInt(27 + (sig.yParity ?? 0)));
  const relayer = createWalletClient({ account: privateKeyToAccount(RELAYER_KEY), chain: chain.viem, transport: http(chain.rpc) });
  const hash = await relayer.writeContract({
    address: chain.usdc,
    abi: USDC_ABI,
    functionName: "transferWithAuthorization",
    args: [a.from as Hex, a.to as Hex, BigInt(a.value), BigInt(a.valid_after), BigInt(a.valid_before), a.nonce as Hex, v, sig.r, sig.s],
  });
  const receipt = await client(chain).waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`the return transfer reverted on ${chain.name}: ${hash}`);
  log("paid", `${Number(amount) / 1e6} USDC sent to the swap on ${chain.name}: ${hash}`);
  leg.settle_tx = hash;
  // the money has moved: recording it on NEAR is bookkeeping, so a failure here must not lose the leg
  if (out.payment_id) {
    try {
      await call(await traveler(), "report_settled", { payment_id: out.payment_id, tx_hash: hash });
    } catch (e) {
      log("note", `could not record the ${chain.name} settlement on NEAR yet: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  return leg;
}

/**
 * Empties the trip wallet on every chain into the swap, then swaps it all to NEAR for the traveler.
 * `done`: legs that already settled on an earlier try (kept, not redone). `onLeg` saves progress after each leg.
 */
export async function returnToSavings(log: Log = () => {}, done: ReturnLeg[] = [], onLeg: (legs: ReturnLeg[]) => void = () => {}): Promise<Returned> {
  if (!DEPOSIT_ADDRESS) throw new Error("set INTENTS_DEPOSIT_ADDRESS (from a 1Click quote) to return unspent budget in live mode");
  const legs: ReturnLeg[] = done.filter((l) => l.settle_tx);
  const left = (await walletLeft()).filter((l) => !legs.some((d) => d.network === l.chain.id));
  if (!left.length && !legs.length) throw new Error("the trip wallet is empty");
  for (const l of left) {
    legs.push(await returnLeg(l.chain, l.amount, log));
    onLeg([...legs]);
  }
  const total = legs.reduce((s, l) => s + BigInt(l.amount), 0n);
  const result: Returned = { amount: total.toString(), to: DEPOSIT_ADDRESS, legs, payment_id: legs[0].payment_id, near_tx: legs[0].near_tx, at: new Date().toISOString() };
  if (legs.every((l) => l.settle_tx)) result.settle_tx = legs[legs.length - 1].settle_tx;
  try {
    await swapToNear(result, log);
  } catch (e) {
    // the USDC is already out of the trip wallet, so keep the result: a retry only redoes the swap
    log("note", `the swap to NEAR didn't finish (${(e as Error).message}); retry to finish it`);
  }
  return result;
}

/** Leg 2: USDC → NEAR at live NEAR Intents prices (one per chain), paid into the traveler's NEAR account. Safe to retry. */
export async function swapToNear(result: Returned, log: Log = () => {}): Promise<Returned> {
  if (result.payout_tx) return result;
  // runs from before multi-chain returns have no legs: they were all on Base
  const legs = result.legs ?? [{ network: CHAINS[0].id, chain: CHAINS[0].name, amount: result.amount, near_tx: result.near_tx, settle_tx: result.settle_tx }];
  let nearOut = 0n;
  let usd = 0;
  let time = 0;
  for (const l of legs) {
    const rail = railById(l.network);
    const q = l.quote ?? (await quoteUsdcForNear(BigInt(l.amount), isNear(rail) ? "0".repeat(64) : result.to, rail));
    l.quote = q;
    nearOut += BigInt(q.near_out);
    usd += Number(q.usd);
    time = Math.max(time, q.time_estimate_sec);
    log("quote", `NEAR Intents: ${Number(l.amount) / 1e6} USDC on ${l.chain} buys ${q.near} NEAR (≈ $${q.usd})`, q);
  }
  const near = (Number(nearOut / 10n ** 20n) / 1e4).toFixed(4);
  result.legs = legs;
  result.quote = { usdc_in: result.amount, near_out: nearOut.toString(), near, usd: usd.toFixed(2), time_estimate_sec: time, source: legs[0].quote!.source, at: new Date().toISOString() };
  result.near = near;
  if (CHAIN_MODE !== "local") {
    log("note", "on mainnet the 1Click solver pays the NEAR out; nothing more to do here");
    return result;
  }
  // the solver's payout, done on testnet by the contract account (it holds the NEAR the on-ramp deposited)
  const me = (await traveler()).accountId;
  const pool = await account(CONTRACT(), env("TRAVELER_KEY"));
  const out = await pool.sendMoney(me, nearOut);
  result.payout_tx = out.transaction.hash as string;
  result.account = me;
  log("funded", `${near} NEAR back in your NEAR savings (${me}, testnet tx ${result.payout_tx})`, { tx: result.payout_tx });
  return result;
}
