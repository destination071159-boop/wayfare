// Paying on NEAR itself: the trip wallet there, USDC balances, and relaying NEP-366 signed delegate actions.
//
// The trip wallet on NEAR is the implicit account of the ed25519 key the MPC network holds for the Wayfare contract
// at wayfare/<traveler> (domain 1). Only the contract can sign for it, and it signs only `ft_transfer`s it built
// itself: to a merchant inside the trip's rules (`pay`), or back to savings for the traveler (`withdraw`).
// x402 on NEAR (`@x402/near`): the merchant's facilitator wraps the signed delegate action in its own transaction.
import { createFacilitatorNearSigner } from "@x402/near";
import type { Account } from "near-api-js";
import { NEAR_RAIL } from "./chains.js";
import { env, TGAS, traveler, view } from "./near.js";

export type NearWallet = { path: string; public_key: string; account_id: string };
export type NearAuthorization = { sender_id: string; token: string; receiver_id: string; amount: string; nonce: number; max_block_height: number; public_key: string; delegate_action: string };

export async function nearWallet(): Promise<NearWallet> {
  const w = await view<NearWallet | null>("get_near_wallet", { traveler: (await traveler()).accountId });
  if (!w) throw new Error("the traveler has no NEAR wallet: run pnpm -C agent setup:testnet");
  return w;
}

async function rpc<T>(method: string, params: object): Promise<T> {
  const r = await fetch(NEAR_RAIL.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "wf", method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message?: string; data?: unknown } };
  if (!j.result) throw new Error(`NEAR RPC ${method}: ${JSON.stringify(j.error ?? j).slice(0, 200)}`);
  return j.result;
}

/** USDC (base units) held by a NEAR account. */
export async function nearUsdc(accountId: string): Promise<bigint> {
  return BigInt(await view<string>("ft_balance_of", { account_id: accountId }, NEAR_RAIL.token));
}

export async function blockHeight(): Promise<number> {
  return (await rpc<{ header: { height: number } }>("block", { finality: "final" })).header.height;
}

/** The next delegate-action nonce for this key: above what the chain and the contract have seen. */
export async function nextNonce(w: NearWallet): Promise<number> {
  const k = await rpc<{ nonce: number }>("query", { request_type: "view_access_key", finality: "final", account_id: w.account_id, public_key: w.public_key });
  // above both the chain's nonce and the last one the contract signed (a signed but unsent payment holds that one;
  // once a higher nonce executes, the unsent one can never be used). ~10^14: still exact as a JS number.
  const signed = await view<string | null>("get_near_nonce", { account_id: w.account_id });
  return Math.max(k.nonce, Number(signed ?? 0)) + 1;
}

/** The x402 payload: Borsh SignedDelegate = DelegateAction ‖ Signature (0x00 = ed25519, then 64 bytes), base64. */
export function signedDelegateB64(a: NearAuthorization, signatureHex: string): string {
  return Buffer.concat([Buffer.from(a.delegate_action, "hex"), Buffer.from([0]), Buffer.from(signatureHex, "hex")]).toString("base64");
}

/** Submits a signed delegate action with `relayer` paying the gas (what an x402 facilitator does). */
export async function relay(relayerId: string, relayerKey: string, signedDelegateAction: string): Promise<string> {
  const signer = createFacilitatorNearSigner({ relayers: [{ accountId: relayerId, secretKey: relayerKey as `ed25519:${string}` }], rpcUrls: { [NEAR_RAIL.id]: NEAR_RAIL.rpc } });
  const out = await signer.submitSignedDelegateAction({ network: NEAR_RAIL.id, relayerId, signedDelegateAction });
  if (out.innerReceipt.kind !== "success") throw new Error(`the ft_transfer failed on NEAR: ${out.innerReceipt.error}`);
  return out.transaction;
}

/** A plain USDC transfer on NEAR from an account we hold the key for (the demo's stand-in for a NEAR Intents solver). */
export async function sendUsdc(from: Account, to: string, amount: bigint, memo: string): Promise<string> {
  const r = await from.functionCall({ contractId: NEAR_RAIL.token, methodName: "ft_transfer", args: { receiver_id: to, amount: amount.toString(), memo }, attachedDeposit: 1n, gas: 30n * TGAS });
  return r.transaction.hash;
}

/** Registers `accountId` with the USDC contract (NEP-145 storage), paid by `payer`. No-op if already registered. */
export async function registerUsdc(payer: Account, accountId: string): Promise<boolean> {
  const have = await view<unknown>("storage_balance_of", { account_id: accountId }, NEAR_RAIL.token);
  if (have) return false;
  await payer.functionCall({ contractId: NEAR_RAIL.token, methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, attachedDeposit: 12_500_000_000_000_000_000_000n, gas: 30n * TGAS });
  return true;
}

/** The demo's NEAR Intents stand-in on NEAR: the Wayfare contract account holds the USDC pool (testnet, Circle faucet). */
export const poolId = () => env("WAYFARE_CONTRACT");
