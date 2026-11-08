// The demo merchants. Their sites run in ../sites; each takes x402 payments in USDC on its own chain:
// Lantern Stays (the hotel) on Arbitrum Sepolia, Sumi Table (dinner) on NEAR testnet, the others on Base Sepolia.
import { CHAINS, CHAIN_MODE, NEAR_RAIL, type Rail, chainLabel, contractNetwork, railById, railLabel } from "./chains.js";

export { CHAIN_MODE };
const BASE = CHAINS[0];
const ARB = CHAINS[1];

// Base Sepolia, kept under these names for the older scripts
export const USDC_BASE_SEPOLIA = BASE.usdc;
export const NETWORK_BASE_SEPOLIA = contractNetwork(BASE);
export const NETWORK_ARB_SEPOLIA = contractNetwork(ARB);
export const BASE_RPC = BASE.rpc;
export const CHAIN_LABEL = chainLabel(BASE);

export type MerchantInfo = { id: string; name: string; category: "rail" | "flight" | "hotel" | "dining"; network: string; url: string };

export const MERCHANTS: MerchantInfo[] = [
  { id: "kiseki-rail", name: "Kiseki Rail", category: "rail", network: BASE.id, url: "http://localhost:4101" },
  { id: "lantern-stays", name: "Lantern Stays", category: "hotel", network: ARB.id, url: "http://localhost:4102" },
  { id: "kumo-air", name: "Kumo Air", category: "flight", network: BASE.id, url: "http://localhost:4103" },
  { id: "sumi-table", name: "Sumi Table", category: "dining", network: NEAR_RAIL.id, url: "http://localhost:4104" },
];

/** The chain a merchant (by id or display name) is paid on. */
export const merchantChain = (merchant: string): Rail => railById(MERCHANTS.find((m) => m.id === merchant || m.name === merchant)?.network ?? BASE.id);

/** The NEAR network record the contract stores (add_near_network). */
export const NEAR_NETWORK = { id: NEAR_RAIL.id, label: "NEAR testnet", token: NEAR_RAIL.token };

export const txLink = (tx: string, network: string = BASE.id) => {
  const c = railById(network);
  return c.explorer_tx ? `${c.explorer_tx}${tx}` : `${tx} (${railLabel(c)})`;
};
