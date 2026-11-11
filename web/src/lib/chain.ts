import type { Status } from "./types";

/** The chain a payment, booking or merchant is on (Base when unknown, as older runs were). */
export function chainOf(status: Status | null | undefined, network?: string) {
  const c = status?.chains?.find((x) => x.id === network) ?? status?.chains?.[0];
  const name = c?.name ?? "Base";
  const near = c?.id.startsWith("near:") ?? false;
  // NEAR is always the real testnet; the EVM chains are local forks in local mode
  const tag = near ? "NEAR testnet" : status?.chain.mode === "live" ? name : `${name} fork`;
  return { id: c?.id ?? "eip155:84532", name, near, tag, explorer: c?.explorer_tx ?? status?.chain.explorer_tx ?? "", account: c?.account };
}

/** Chip colours per chain. */
export const chainChip = (name: string) => (name === "Base" ? "bg-sky/10 text-sky" : name === "NEAR" ? "bg-deliver-green/15 text-[#1d6b4a]" : "bg-[#28a0f0]/12 text-[#1b6fb0]");

/** The chain a merchant is paid on. */
export const merchantChain = (status: Status | null | undefined, merchant: string) =>
  chainOf(status, status?.merchants.find((m) => m.id === merchant || m.name === merchant)?.network);
