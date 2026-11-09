// The whole flow from one sentence, in the terminal: parse → plan by browsing → approve → book and pay.
// Run (chain + sites up): pnpm -C agent trip "Bangkok to Kyoto on 2026-11-19, 2 nights near Gion, sushi dinner, under $1000"
//   --yes          approve without asking
//   --try-upgrade  after booking, the agent also tries a pricier hotel room (the contract should refuse it)
import readline from "node:readline/promises";
import { fmt } from "../src/planner.js";
import { Run } from "../src/runner.js";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const text = args.find((a) => !a.startsWith("--")) ?? "Fly me from Bangkok to Kyoto on 2026-11-19 for 2 nights, a ryokan near Gion if possible, and a sushi dinner for two on the 21st. Budget $1,000.";

const run = new Run(text);
await run.plan();
const p = run.state.plan;
if (run.state.status !== "awaiting_approval" || !p) process.exit(1);

console.log(`\nPlan: ${p.request.summary}`);
for (const [i, it] of p.items.entries()) console.log(`  ${i + 1}. ${it.label.padEnd(48)} ${fmt(it.total)}`);
console.log(`  Total ${fmt(p.total)}${p.request.budget_usd ? ` of a $${p.request.budget_usd} budget` : ""}${p.over_budget ? "  (over budget)" : ""}\n`);

if (!flag("--yes")) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ok = (await rl.question("Approve this trip on NEAR? [y/N] ")).trim().toLowerCase() === "y";
  rl.close();
  if (!ok) {
    run.cancel();
    process.exit(0);
  }
}
await run.approve();
if (flag("--try-upgrade") && (run.state.status as string) === "booked") await run.tryUpgrade();
console.log(`\nEvidence: ${run.act.dir}`);
if ((run.state.status as string) === "error") process.exitCode = 1;
