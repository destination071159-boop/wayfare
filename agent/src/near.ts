// NEAR access for the agent and scripts. Testnet only; keys come from ../.env (git-ignored).
import { Logger } from "@near-js/utils";
import { Account, KeyPair, connect, keyStores, utils } from "near-api-js";

// near-api-js prints every receipt and retry; the agent logs what matters itself.
if (!process.env.NEAR_LOGS) Logger.overrideLogger(undefined);

export const env = (k: string, fallback?: string): string => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`${k} is not set (see wayfare/.env)`);
  return v;
};

export const NETWORK = env("NEAR_NETWORK", "testnet");
if (NETWORK !== "testnet") throw new Error("Wayfare's scripts only run on testnet");
export const MPC = "v1.signer-prod.testnet";
export const CONTRACT = () => env("WAYFARE_CONTRACT");

// The free testnet RPC rate-limits busy clients (JSON-RPC error -429). Retry those calls with backoff instead of
// failing a booking halfway; every other response passes through untouched.
const RPC_URL = env("NEAR_RPC", "https://test.rpc.fastnear.com");
const plainFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(RPC_URL)) return plainFetch(input, init);
  for (let attempt = 0; ; attempt++) {
    const res = await plainFetch(input, init);
    if (attempt >= 7) return res;
    if (res.status !== 429) {
      if (!res.ok) return res;
      const body = await res.clone().text();
      if (!/"code"\s*:\s*-429/.test(body)) return res;
    }
    await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * 2 ** attempt))); // 2, 4, 8, 16, 30, 30, 30 s: ~2 min
  }
};

const keyStore = new keyStores.InMemoryKeyStore();
let nearP: ReturnType<typeof connect> | undefined;
const near = () => (nearP ??= connect({ networkId: NETWORK, nodeUrl: RPC_URL, keyStore }));

export async function account(id: string, secret?: string): Promise<Account> {
  if (secret) await keyStore.setKey(NETWORK, id, KeyPair.fromString(secret as `ed25519:${string}`));
  return (await near()).account(id);
}

export const traveler = () => account(env("TRAVELER_ACCOUNT"), env("TRAVELER_KEY"));
export const agent = () => account(env("AGENT_ACCOUNT"), env("AGENT_KEY"));

export const TGAS = 1_000_000_000_000n;
export const nearAmount = (n: string) => BigInt(utils.format.parseNearAmount(n)!);

/** Calls the Wayfare contract and returns its JSON result (failures throw with the contract's message). */
export async function call<T = unknown>(who: Account, method: string, args: object, opts: { deposit?: bigint; tgas?: bigint } = {}): Promise<{ value: T; tx: string }> {
  const r = await who.functionCall({ contractId: CONTRACT(), methodName: method, args, attachedDeposit: opts.deposit ?? 0n, gas: (opts.tgas ?? 100n) * TGAS });
  const raw = typeof r.status === "object" && "SuccessValue" in r.status ? r.status.SuccessValue : "";
  const text = raw ? Buffer.from(raw, "base64").toString() : "";
  return { value: (text ? JSON.parse(text) : undefined) as T, tx: r.transaction.hash };
}

export async function view<T = unknown>(method: string, args: object = {}, contractId = CONTRACT()): Promise<T> {
  const a = await account(env("TRAVELER_ACCOUNT"));
  return a.viewFunction({ contractId, methodName: method, args }) as Promise<T>;
}
