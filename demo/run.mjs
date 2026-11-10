// `pnpm demo`: Wayfare on this machine.
//   1. local mode: forks of Base Sepolia (:8545) and Arbitrum Sepolia (:8546) (anvil) with the real USDC contracts
//      (skipped when WAYFARE_CHAIN=live)
//   2. the four demo booking sites (:4101-4104)
//   3. the agent hub (:7373): parses, plans in a browser, books and pays through the NEAR testnet contract
//   4. the web app (:3400; the production build if there is one)
// Needs wayfare/.env from `pnpm -C agent setup:testnet`. Light on memory: one browser at a time. Ctrl-C stops everything.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const say = (s) => console.log(`\x1b[2m▸\x1b[0m ${s}`);
const kids = [];
let stopping = false;
const stop = () => {
  stopping = true;
  for (const k of kids) try { process.kill(-k.pid, "SIGTERM"); } catch {}
  spawnSync(join(ROOT, "agent/node_modules/.bin/agent-browser"), ["close", "--all"], { stdio: "ignore" });
};
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
const fail = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };

for (const d of ["agent", "sites", "web"]) if (!existsSync(join(ROOT, d, "node_modules"))) fail("run `pnpm setup` first");
if (!existsSync(join(ROOT, ".env")) || !/AGENT_ACCOUNT=/.test(readFileSync(join(ROOT, ".env"), "utf8"))) fail("no wayfare/.env yet: run `pnpm -C agent setup:testnet` first");
const live = /^WAYFARE_CHAIN=live/m.test(readFileSync(join(ROOT, ".env"), "utf8"));
if (!live && spawnSync("pgrep", ["-f", "anvil --fork-url"]).stdout?.toString().trim()) fail("an anvil fork from an earlier run is still running. Stop it with: pkill -f 'anvil --fork-url'");

function start(name, cmd, args, opts = {}, ready) {
  const c = spawn(cmd, args, { detached: true, stdio: ["ignore", "pipe", "pipe"], ...opts });
  kids.push(c);
  let buf = "";
  return new Promise((resolve) => {
    const on = (d) => {
      buf = (buf + d).slice(-8000);
      if (process.env.VERBOSE) process.stdout.write(String(d).replace(/^(?=.)/gm, "   "));
      const m = ready && buf.match(ready);
      if (m) { ready = null; resolve(m); }
    };
    c.stdout.on("data", on);
    c.stderr.on("data", on);
    c.on("exit", (code) => { if (!stopping) fail(`${name} stopped (exit ${code}):\n${buf.slice(-1500)}`); });
    if (!ready) resolve(null);
  });
}

if (!live) {
  say("forking Base Sepolia and Arbitrum Sepolia locally (anvil)");
  const m = await start("chain", "pnpm", ["chain"], { cwd: join(ROOT, "agent") }, /traveler wallet (\S+): ([\d.]+) USDC/);
  say(`wallet ${m[1]}: ${m[2]} USDC on the local fork`);
}
say("starting the booking sites");
await start("sites", "pnpm", ["start"], { cwd: join(ROOT, "sites") }, /Sumi Table.*4104/);
say("starting the agent hub");
await start("hub", "pnpm", ["hub"], { cwd: join(ROOT, "agent") }, /Wayfare hub/);
say("starting the web app");
const built = existsSync(join(ROOT, "web/.next/BUILD_ID"));
await start("web", "pnpm", [built ? "start" : "dev"], { cwd: join(ROOT, "web"), env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=2048" } }, /Ready|ready/i);
console.log(`
\x1b[1mWayfare is running\x1b[0m
  Web app   http://localhost:3400
  Sites     Kiseki Rail :4101 · Lantern Stays :4102 · Kumo Air :4103 · Sumi Table :4104
  Chains    ${live ? "Base Sepolia + Arbitrum Sepolia (live)" : "Base Sepolia :8545 + Arbitrum Sepolia :8546, local forks"} · NEAR testnet
  Ctrl-C to stop.
`);
await new Promise(() => {});
