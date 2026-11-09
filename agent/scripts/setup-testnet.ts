// One-time (idempotent) testnet setup. Run: pnpm -C agent setup:testnet
// With no traveler account in .env, it first creates one with free testnet NEAR from the faucet.
// Deploys or updates the contract (your own build if there is one, else the prebuilt contracts/wayfare/res/wayfare.wasm), creates the agent account and the merchants' receiving addresses, registers the
// merchants and the traveler's wallets (Base/Arbitrum, and NEAR itself), and prints the wallet to fund with Base Sepolia USDC.
// For the merchant paid on NEAR it also creates the x402 relayer account (pays the gas of NEAR settlements), the
// merchant's NEAR account, and registers everyone with the USDC contract on NEAR testnet.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";
import { KeyPair } from "near-api-js";
import { createPublicClient, erc20Abi, formatUnits, http, keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { CONTRACT, MPC, account, call, env, nearAmount, traveler, view } from "../src/near.js";
import { MERCHANTS, NEAR_NETWORK, NETWORK_ARB_SEPOLIA, NETWORK_BASE_SEPOLIA, USDC_BASE_SEPOLIA } from "../src/merchants.js";
import { NEAR_RAIL } from "../src/chains.js";
import { nearUsdc, registerUsdc } from "../src/near-rail.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(here, "../../.env");
const BUILT = path.resolve(here, "../../contracts/target/near/wayfare/wayfare.wasm");
const WASM = fs.existsSync(BUILT) ? BUILT : path.resolve(here, "../../contracts/wayfare/res/wayfare.wasm");

function setEnv(key: string, value: string) {
  const lines = (fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "").split("\n").filter((l) => !l.startsWith(`${key}=`));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.push(`${key}=${value}`, "");
  fs.writeFileSync(ENV_FILE, lines.join("\n"), { mode: 0o600 });
  process.env[key] = value;
}

const exists = async (id: string) => {
  try {
    await (await account(id)).state();
    return true;
  } catch {
    return false;
  }
};

// ── traveler: a fresh testnet account from the faucet, if .env has none ──
async function faucetAccount(id: string): Promise<string> {
  const kp = KeyPair.fromRandom("ed25519");
  const r = await fetch("https://helper.nearprotocol.com/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!r.ok) throw new Error(`testnet faucet: ${r.status} ${await r.text()}`);
  return kp.toString();
}
if (!process.env.TRAVELER_ACCOUNT) {
  const id = `wayfare-${Date.now().toString(36)}.testnet`;
  const key = await faucetAccount(id);
  setEnv("NEAR_NETWORK", "testnet");
  setEnv("NEAR_RPC", process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com");
  setEnv("TRAVELER_ACCOUNT", id);
  setEnv("TRAVELER_KEY", key);
  console.log("created traveler", id, "(free testnet NEAR from the faucet)");
  // a second faucet account, deleted into the traveler: enough NEAR for the contract, the agent and a few trips
  const extra = `wftop${Date.now().toString(36)}.testnet`;
  await (await account(extra, await faucetAccount(extra))).deleteAccount(id);
}
if (!process.env.WAYFARE_CONTRACT) setEnv("WAYFARE_CONTRACT", `wf.${env("TRAVELER_ACCOUNT")}`);
if (!process.env.WAYFARE_CHAIN) setEnv("WAYFARE_CHAIN", "local");

const me = await traveler();
const contractId = CONTRACT();
const key = KeyPair.fromString(env("TRAVELER_KEY") as `ed25519:${string}`);

// ── contract ──────────────────────────────────────────────
if (!(await exists(contractId))) {
  await me.createAccount(contractId, key.getPublicKey(), nearAmount("4"));
  console.log("created", contractId);
}
const c = await account(contractId, env("TRAVELER_KEY"));
await c.deployContract(fs.readFileSync(WASM));
console.log("deployed", contractId);
try {
  await c.functionCall({ contractId, methodName: "new", args: { owner: me.accountId, mpc: MPC, networks: [NETWORK_BASE_SEPOLIA] } });
  console.log("initialized");
} catch (e) {
  if (!String(e).includes("already been initialized")) throw e;
}

// ── networks: every chain Wayfare pays on ─────────────────
const { networks, near_networks = [] } = await view<{ networks: { id: string }[]; near_networks?: { id: string }[] }>("get_config");
for (const n of [NETWORK_BASE_SEPOLIA, NETWORK_ARB_SEPOLIA]) {
  if (!networks.some((x) => x.id === n.id)) {
    await call(me, "add_network", { network: n });
    console.log("added network", n.id, n.label);
  }
}
if (!near_networks.some((x) => x.id === NEAR_NETWORK.id)) {
  await call(me, "add_near_network", { network: NEAR_NETWORK });
  console.log("added network", NEAR_NETWORK.id, "(USDC", NEAR_NETWORK.token + ")");
}

// ── x402 on NEAR: a relayer account for the merchants' facilitator (it pays the gas of settlements) ──
if (!process.env.NEAR_RELAYER_ACCOUNT) {
  const id = `x402.${me.accountId}`;
  const kp = KeyPair.fromRandom("ed25519");
  if (!(await exists(id))) await me.createAccount(id, kp.getPublicKey(), nearAmount("1"));
  setEnv("NEAR_RELAYER_ACCOUNT", id);
  setEnv("NEAR_RELAYER_KEY", kp.toString());
  console.log("created x402 relayer", id);
}

// ── agent account (its own NEAR pays its gas) ─────────────
if (!process.env.AGENT_ACCOUNT) {
  const id = `agent.${me.accountId}`;
  const kp = KeyPair.fromRandom("ed25519");
  if (!(await exists(id))) await me.createAccount(id, kp.getPublicKey(), nearAmount("2"));
  setEnv("AGENT_ACCOUNT", id);
  setEnv("AGENT_KEY", kp.toString());
  console.log("created agent", id);
}

// ── merchants: a receiving address each, registered on the contract ──
const registered = await view<{ id: string; pay_to: string; network: string }[]>("get_merchants");
for (const m of MERCHANTS) {
  const keyVar = `MERCHANT_KEY_${m.id.toUpperCase().replace(/-/g, "_")}`;
  if (!process.env[keyVar]) setEnv(keyVar, generatePrivateKey());
  let payTo = privateKeyToAccount(process.env[keyVar] as `0x${string}`).address.toLowerCase();
  if (m.network === NEAR_RAIL.id) {
    // paid on NEAR: its own testnet account, registered with the USDC contract
    payTo = `${m.id}.${me.accountId}`;
    const nearKeyVar = `MERCHANT_NEAR_KEY_${m.id.toUpperCase().replace(/-/g, "_")}`;
    if (!(await exists(payTo))) {
      const kp = KeyPair.fromRandom("ed25519");
      await me.createAccount(payTo, kp.getPublicKey(), nearAmount("0.2"));
      setEnv(nearKeyVar, kp.toString());
      console.log("created merchant account", payTo);
    }
    if (await registerUsdc(me, payTo)) console.log("registered", payTo, "with USDC on NEAR");
  }
  const onChain = registered.find((r) => r.id === m.id);
  if (onChain && (onChain.network !== m.network || onChain.pay_to !== payTo) && (m.network === NEAR_RAIL.id || onChain.network === NEAR_RAIL.id)) {
    await call(me, "set_merchant_payee", { id: m.id, network: m.network, pay_to: payTo });
    console.log("moved merchant", m.id, "to", m.network, payTo);
    continue;
  }
  if (onChain && onChain.pay_to !== payTo) throw new Error(`${m.id} is registered with ${onChain.pay_to}, but ${keyVar} gives ${payTo}`);
  if (!onChain) {
    await call(me, "add_merchant", { id: m.id, name: m.name, category: m.category, network: m.network, pay_to: payTo, url: m.url });
    console.log("registered merchant", m.id, payTo);
  } else if (onChain.network !== m.network) {
    await call(me, "set_merchant_network", { id: m.id, network: m.network });
    console.log("moved merchant", m.id, "to", m.network);
  }
}

// ── the traveler's wallet: the MPC key at wayfare/<traveler> ──
const walletPath = `wayfare/${me.accountId}`;
const pk = await view<string>("derived_public_key", { path: walletPath, predecessor: contractId, domain_id: 0 }, MPC);
const address = `0x${keccak256(bs58.decode(pk.split(":")[1])).slice(-40)}`;
const current = await view<{ address: string } | null>("get_wallet", { traveler: me.accountId });
if (current?.address !== address) {
  await call(me, "set_wallet", { address }, { deposit: nearAmount("0.01") });
  console.log("wallet registered");
}
// ── the trip wallet on NEAR: the MPC's ed25519 key at the same path (domain 1); its implicit account ──
const nearPk = await view<string>("derived_public_key", { path: walletPath, predecessor: contractId, domain_id: 1 }, MPC);
const nearAccount = Buffer.from(bs58.decode(nearPk.split(":")[1])).toString("hex");
const nearCurrent = await view<{ public_key: string } | null>("get_near_wallet", { traveler: me.accountId });
if (nearCurrent?.public_key !== nearPk) {
  await call(me, "set_near_wallet", { public_key: nearPk }, { deposit: nearAmount("0.01") });
  console.log("NEAR wallet registered", nearAccount);
}
// an implicit account exists once it holds NEAR; it pays the 1 yoctoNEAR each ft_transfer needs
if (!(await exists(nearAccount))) {
  await me.sendMoney(nearAccount, nearAmount("0.05"));
  console.log("created the NEAR trip wallet", nearAccount);
}
for (const id of [nearAccount, contractId]) if (await registerUsdc(me, id)) console.log("registered", id, "with USDC on NEAR");
const pool = await nearUsdc(contractId);

const base = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") }); // live balance; local mode funds itself (pnpm chain)
const bal = await base.readContract({ address: USDC_BASE_SEPOLIA, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
console.log(`\nTraveler ${me.accountId}`);
console.log(`  Base wallet ${address} (only ${contractId} can sign for it)`);
console.log(`  USDC on Base Sepolia: ${formatUnits(bal, 6)}`);
console.log(`  NEAR wallet ${nearAccount} (only ${contractId} can sign for it)`);
console.log(`  demo pool on NEAR (${contractId}): ${formatUnits(pool, 6)} USDC${pool < 5_000_000n ? "  → add USDC at https://faucet.circle.com (NEAR Testnet) to " + contractId : ""}`);
if (bal === 0n && process.env.WAYFARE_CHAIN === "live") console.log("  → fund it at https://faucet.circle.com (Base Sepolia, USDC)");
if (process.env.WAYFARE_CHAIN !== "live") console.log("  local mode: the wallet starts empty; approving a trip funds it from your NEAR (on-ramp)");
console.log(`  NEAR: ${(Number(BigInt((await me.getAccountBalance()).available) / 10n ** 21n) / 1000).toFixed(2)} available (about 3 per trip; pnpm -C agent topup adds more)`);
