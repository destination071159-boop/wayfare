// Local mode: runs an anvil fork of each chain Wayfare pays on (Base Sepolia :8545, Arbitrum Sepolia :8546), each
// with the real USDC contract. Keep it running while the demo runs. Run: pnpm -C agent chain
import { spawn } from "node:child_process";
import { formatUnits } from "viem";
import { CHAINS, chainLabel, client, usdcOn } from "../src/chains.js";
import { env, view } from "../src/near.js";

// The trip wallet starts empty: each trip is funded from NEAR savings when approved (the on-ramp, src/onramp.ts).
const AMOUNT = BigInt(process.env.LOCAL_USDC ?? "0") * 1_000_000n;

const kids = CHAINS.map((c) => {
  const port = new URL(c.rpc).port;
  const p = spawn("anvil", ["--fork-url", c.fork_url, "--chain-id", String(c.chain_id), "--port", port, "--silent"], { stdio: "inherit" });
  p.on("exit", (code) => {
    for (const k of kids) k.kill();
    process.exit(code ?? 0);
  });
  return p;
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => kids.forEach((k) => k.kill(sig)));

for (const c of CHAINS) {
  for (let i = 0; ; i++) {
    try {
      await client(c).getChainId();
      break;
    } catch {
      if (i > 90) throw new Error(`anvil (${c.name}) did not start`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const wallet = (await view<{ address: `0x${string}` } | null>("get_wallet", { traveler: env("TRAVELER_ACCOUNT") }))?.address;
if (!wallet) throw new Error("no traveler wallet: run pnpm -C agent setup:testnet first");
const lines: string[] = [];
for (const c of [...CHAINS].reverse()) {
  // LOCAL_USDC pre-funds every chain (the pay:trip / pay:hotel scripts skip the on-ramp)
  const amount = AMOUNT;
  await client(c).request({ method: "anvil_dealERC20" as never, params: [wallet, c.usdc, `0x${amount.toString(16)}`] as never });
  const bal = await usdcOn(c, wallet);
  // the Base line last: the demo launcher waits for "traveler wallet <addr>: <n> USDC"
  lines.push(c.key === "base" ? `${chainLabel(c)} ${c.rpc}\n  traveler wallet ${wallet}: ${formatUnits(bal, 6)} USDC` : `${chainLabel(c)} ${c.rpc}\n  trip wallet on ${c.name}: ${formatUnits(bal, 6)} USDC`);
}
console.log(lines.join("\n"));
