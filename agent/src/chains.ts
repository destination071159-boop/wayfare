// The chains Wayfare pays on. The EVM chains: one trip wallet (the MPC key at wayfare/<traveler>) has the same address
// on all of them; the contract signs for whichever chain the merchant is registered on. NEAR itself (NEAR_RAIL): the
// trip wallet is the implicit account of the MPC's ed25519 key at the same path, paying with x402 on NEAR.
//
// local mode: each chain is an anvil fork of its testnet with the real USDC contract (agent/scripts/local-chain.ts).
// live mode: the public testnets.
import { type Chain as ViemChain, createPublicClient, erc20Abi, http } from "viem";
import { arbitrumSepolia, baseSepolia } from "viem/chains";

export const CHAIN_MODE = process.env.WAYFARE_CHAIN === "live" ? "live" : "local";

export type Chain = {
  key: "base" | "arb";
  /** CAIP-2, as x402 and the contract name it */
  id: string;
  name: string;
  chain_id: number;
  usdc: `0x${string}`;
  /** the USDC contract's EIP-712 domain */
  token_name: string;
  token_version: string;
  rpc: string;
  fork_url: string;
  viem: ViemChain;
  explorer_tx: string;
  /** NEAR Intents (1Click) asset id of mainnet USDC on this chain, for price quotes */
  intents_asset: string;
};

const local = (port: number, env?: string) => process.env[env ?? ""] ?? `http://127.0.0.1:${port}`;

export const CHAINS: Chain[] = [
  {
    key: "base",
    id: "eip155:84532",
    name: "Base",
    chain_id: 84532,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    token_name: "USDC",
    token_version: "2",
    rpc: CHAIN_MODE === "live" ? "https://sepolia.base.org" : local(8545, "BASE_RPC"),
    fork_url: process.env.FORK_URL ?? "https://sepolia.base.org",
    viem: baseSepolia,
    explorer_tx: CHAIN_MODE === "live" ? "https://sepolia.basescan.org/tx/" : "",
    intents_asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  },
  {
    key: "arb",
    id: "eip155:421614",
    name: "Arbitrum",
    chain_id: 421614,
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    token_name: "USD Coin",
    token_version: "2",
    rpc: CHAIN_MODE === "live" ? "https://sepolia-rollup.arbitrum.io/rpc" : local(8546, "ARB_RPC"),
    fork_url: process.env.ARB_FORK_URL ?? "https://sepolia-rollup.arbitrum.io/rpc",
    viem: arbitrumSepolia,
    explorer_tx: CHAIN_MODE === "live" ? "https://sepolia.arbiscan.io/tx/" : "",
    intents_asset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
  },
];

/** NEAR testnet as a place merchants are paid: USDC (Circle's NEP-141), x402 `exact` on near:testnet. Always live. */
export type NearRail = {
  key: "near";
  id: "near:testnet";
  name: "NEAR";
  token: string;
  rpc: string;
  explorer_tx: string;
  intents_asset: string;
};
export const NEAR_RAIL: NearRail = {
  key: "near",
  id: "near:testnet",
  name: "NEAR",
  token: process.env.NEAR_USDC ?? "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
  rpc: process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com",
  explorer_tx: "https://testnet.nearblocks.io/txns/",
  intents_asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
};

/** Every place a merchant can be paid: the EVM chains, then NEAR. */
export type Rail = Chain | NearRail;
export const RAILS: Rail[] = [...CHAINS, NEAR_RAIL];
export const isNear = (r: Rail): r is NearRail => r.key === "near";
export const railById = (id: string): Rail => {
  const r = RAILS.find((x) => x.id === id);
  if (!r) throw new Error(`unknown chain ${id}`);
  return r;
};
export const railLabel = (r: Rail) => (isNear(r) ? "NEAR testnet" : chainLabel(r));

export const chainById = (id: string): Chain => {
  const c = CHAINS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown chain ${id}`);
  return c;
};
export const chainLabel = (c: Chain) => `${c.name} Sepolia${CHAIN_MODE === "local" ? " (local fork)" : ""}`;

/** The network record the contract stores (add_network). */
export const contractNetwork = (c: Chain) => ({ id: c.id, label: `${c.name} Sepolia`, chain_id: c.chain_id, token: c.usdc, token_name: c.token_name, token_version: c.token_version });

export const client = (c: Chain) => createPublicClient({ chain: c.viem, transport: http(c.rpc) });

/**
 * Local mode: re-forks each chain at its latest block. A fork reads state it hasn't seen from the public RPC at the
 * block it forked from, and public nodes prune old state, so a fork left idle for hours starts failing
 * ("missing trie node"). Each trip starts fresh; dev accounts stay funded and the chain id is kept.
 */
export async function refreshForks(wallet?: `0x${string}`) {
  if (CHAIN_MODE !== "local") return;
  for (const c of CHAINS) {
    await client(c).request({ method: "anvil_reset" as never, params: [{ forking: { jsonRpcUrl: c.fork_url } }] as never });
    // the fork copies the public chain, where the same address may hold real test USDC: each local trip starts empty
    if (wallet) await client(c).request({ method: "anvil_dealERC20" as never, params: [wallet, c.usdc, "0x0"] as never });
  }
}

export async function usdcOn(c: Chain, address: `0x${string}`): Promise<bigint> {
  return client(c).readContract({ address: c.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}
