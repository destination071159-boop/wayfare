// Wayfare as an MCP server: any AI agent (Claude, Cursor, …) can plan, book and manage a trip through Wayfare.
// The calling agent holds no keys and no money. It only asks; the Wayfare contract on NEAR signs each payment,
// and only inside the plan the traveler approved. Approving a budget stays with the human: the agent gets a link.
//   claude mcp add wayfare -- pnpm -C <repo>/agent mcp      (needs the demo running: pnpm demo)
// WAYFARE_URL: the web app (default http://localhost:3400); its /api goes to the agent hub.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const WEB = (process.env.WAYFARE_URL ?? "http://localhost:3400").replace(/\/$/, "");
const NEAR_TX = "https://testnet.nearblocks.io/txns/";

type Booked = { item: number; label: string; status: string; ref?: string; amount?: number; reason?: string; near_tx?: string; settle_tx?: string; network?: string };
type Item = { kind: string; merchant: string; label: string; choice: string; total: number; reason: string };
type Run = {
  id: string;
  text: string;
  status: string;
  busy?: string;
  error?: string;
  trip_id?: string;
  approve_tx?: string;
  plan?: { items: Item[]; total: number; budget: number; over_budget: boolean };
  quote?: { near: string };
  funded?: { near: string; near_tx: string };
  rebook_pct?: number;
  results: Booked[];
  disruption?: { cause: string; status: string; note?: string; pending?: { label: string; amount: number; max: string; reason: string } };
  ended_tx?: string;
  returned?: { amount: string; near?: string; payout_tx?: string; settle_tx?: string };
  steps?: { kind: string; text: string }[];
};
type Status = { contract: string; traveler: string; agent: string; balance: string | null; savings?: unknown; chains: { name: string; label: string; balance: string | null; explorer_tx: string }[]; merchants: { id?: string; name?: string; chain?: string }[]; busy: { run: string; what: string } | null };

async function api<T>(p: string, body?: object): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${WEB}/api${p}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  } catch {
    throw new Error(`Wayfare is not reachable at ${WEB}. Start it with \`pnpm demo\` (or set WAYFARE_URL).`);
  }
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Wayfare answered ${r.status}`);
  return j;
}

const CHAIN: Record<string, string> = { "eip155:84532": "Base Sepolia", "eip155:421614": "Arbitrum Sepolia", "near:testnet": "NEAR testnet" };
const chain = (id?: string) => (id ? (CHAIN[id] ?? id) : "");
const usdc = (base?: number | string) => (base == null ? "?" : `${(Number(base) / 1e6).toFixed(2)} USDC`);
const tx = (h?: string) => (!h ? "" : h.startsWith("0x") ? h : `${NEAR_TX}${h}`);
const runUrl = (id: string) => `${WEB}/run?id=${id}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What the calling agent can do next, in words. */
function next(r: Run): string {
  if (r.busy) return `Wayfare is working (${r.busy}). Call get_trip with wait_seconds to follow it.`;
  if (r.status === "error") return `The run stopped: ${r.error}.`;
  if (r.status === "awaiting_approval")
    return `Ask the traveler to review and approve the plan at ${runUrl(r.id)}. Approving funds the trip from their NEAR savings and puts the plan on NEAR; you cannot approve it for them. Then call get_trip with wait_seconds.`;
  if (r.disruption?.status === "needs_approval") return `A replacement costs more than the traveler's rebook rule allows. Ask them to approve it at ${runUrl(r.id)}.`;
  if (r.status === "booked" && !r.ended_tx) return "The trip is booked. You can: try_upgrade (the contract will refuse anything off-plan), simulate_cancellation (demo), verify_trip, or end_trip when it is over.";
  if (r.ended_tx && !r.returned?.payout_tx) return "Trip ended. The leftover USDC is on its way home as NEAR; call get_trip with wait_seconds.";
  if (r.returned?.payout_tx) return "Done: the trip is over and the leftover money is back in the traveler's NEAR savings.";
  return "";
}

function summary(r: Run) {
  const lines = [`Run ${r.id}: ${r.status}${r.busy ? ` (busy: ${r.busy})` : ""}`, `Request: ${r.text}`];
  if (r.trip_id) lines.push(`Trip on NEAR: #${r.trip_id}${r.approve_tx ? ` (approved: ${tx(r.approve_tx)})` : ""}`);
  if (r.plan) {
    lines.push(`Plan: ${usdc(r.plan.total)} of a ${usdc(r.plan.budget)} budget${r.plan.over_budget ? " (OVER BUDGET)" : ""}${r.quote ? `, funded with ≈ ${r.quote.near} NEAR` : ""}`);
    r.plan.items.forEach((it, i) => lines.push(`  ${i + 1}. ${it.kind} · ${it.merchant}: ${it.label}, ${usdc(it.total)}. Why: ${it.reason}`));
  }
  if (r.rebook_pct != null && r.trip_id) lines.push(`Rebook rule: a cancelled booking may be replaced for up to +${r.rebook_pct}% without asking.`);
  if (r.funded) lines.push(`Funded: ${r.funded.near} NEAR → USDC via NEAR Intents (${tx(r.funded.near_tx)})`);
  if (r.results.length) {
    lines.push("Bookings:");
    for (const b of r.results)
      lines.push(`  - ${b.label}: ${b.status}${b.amount ? `, ${usdc(b.amount)}` : ""}${b.network ? ` on ${chain(b.network)}` : ""}${b.ref ? `, ref ${b.ref}` : ""}${b.reason ? `. ${b.reason}` : ""}${b.near_tx ? `\n      signed on NEAR: ${tx(b.near_tx)}` : ""}${b.settle_tx ? `\n      settled: ${tx(b.settle_tx)}` : ""}`);
  }
  if (r.disruption) lines.push(`Disruption: ${r.disruption.cause}: ${r.disruption.status}${r.disruption.note ? `. ${r.disruption.note}` : ""}`);
  if (r.ended_tx) lines.push(`Ended: ${tx(r.ended_tx)}`);
  if (r.returned) lines.push(`Returned: ${usdc(r.returned.amount)}${r.returned.near ? ` → ${r.returned.near} NEAR` : ""}${r.returned.payout_tx ? ` (${tx(r.returned.payout_tx)})` : ""}`);
  const recent = (r.steps ?? []).slice(-6);
  if (recent.length) lines.push("Latest activity:", ...recent.map((s) => `  [${s.kind}] ${s.text}`));
  lines.push(`Watch it live: ${runUrl(r.id)}`, `Next: ${next(r)}`);
  return lines.join("\n");
}

/** Polls until the run is idle (or its status changes), at most `seconds`. */
async function follow(id: string, seconds: number): Promise<Run> {
  let r = await api<Run>(`/runs/${id}`);
  const start = r.status, end = Date.now() + Math.min(seconds, 240) * 1000;
  while (Date.now() < end && (r.busy || r.status === "parsing" || r.status === "planning" || r.status === "booking") && r.status === start) {
    await wait(4000);
    r = await api<Run>(`/runs/${id}`);
  }
  return r;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const runId = z.string().regex(/^[\w-]+$/).describe("The run id from plan_trip or list_trips");
const waitS = z.number().int().min(0).max(240).optional().describe("Wait up to this many seconds for Wayfare to finish the current step (default 0)");

const server = new McpServer(
  { name: "wayfare", version: "1.0.0" },
  {
    instructions:
      "Wayfare books and pays for trips. You never hold the traveler's money or keys: a NEAR contract signs each payment, only inside the plan the traveler approved, on Base, Arbitrum or NEAR via x402. Flow: plan_trip → the traveler approves at the link → Wayfare books → (optional) try_upgrade / simulate_cancellation → end_trip. Steps take minutes; use wait_seconds.",
  },
);

server.registerTool(
  "wayfare_status",
  { title: "Wayfare status", description: "The traveler's NEAR account and savings, the trip wallet's USDC on each chain, the merchants Wayfare can book, and whether the agent is busy.", inputSchema: {}, annotations: { readOnlyHint: true } },
  async () => {
    const s = await api<Status>("/status");
    return text(
      [
        `Contract on NEAR: ${s.contract}`,
        `Traveler: ${s.traveler} · booking agent: ${s.agent}`,
        `Trip wallet: ${s.chains.map((c) => `${usdc(c.balance ?? undefined)} on ${c.label}`).join(", ")}`,
        `Merchants: ${s.merchants.map((m) => `${m.name ?? m.id} (${m.chain})`).join(", ")}`,
        s.busy ? `Busy: run ${s.busy.run} (${s.busy.what})` : "Idle: ready for a new trip.",
      ].join("\n"),
    );
  },
);

server.registerTool(
  "plan_trip",
  {
    title: "Plan a trip",
    description:
      "Start a trip from one sentence (where, when, what, budget). Wayfare parses it and searches its booking sites in a real browser, then proposes a plan for the traveler to approve. Nothing is paid yet.",
    inputSchema: { request: z.string().min(8).max(600).describe("e.g. 'Fly me from Bangkok to Kyoto on 2026-11-19 for 2 nights, a ryokan near Gion, sushi for two on the 21st. Budget $1,000.'"), wait_seconds: waitS },
  },
  async ({ request, wait_seconds }) => {
    const { id } = await api<{ id: string }>("/runs", { text: request });
    return text(summary(await follow(id, wait_seconds ?? 0)));
  },
);

server.registerTool(
  "get_trip",
  { title: "Get a trip", description: "A run's status, plan, bookings (with NEAR signature and settlement links), disruptions and what to do next.", inputSchema: { run_id: runId, wait_seconds: waitS }, annotations: { readOnlyHint: true } },
  async ({ run_id, wait_seconds }) => text(summary(await follow(run_id, wait_seconds ?? 0))),
);

server.registerTool(
  "list_trips",
  { title: "List trips", description: "Recent trip runs, newest first.", inputSchema: {}, annotations: { readOnlyHint: true } },
  async () => {
    const runs = await api<{ id: string; status: string; summary?: string; text: string; booked: number; trip_id?: string }[]>("/runs");
    return text(runs.length ? runs.map((r) => `${r.id}  ${r.status}${r.trip_id ? `  trip #${r.trip_id}` : ""}  ${r.booked} booked  ${r.summary ?? r.text}`).join("\n") : "No trips yet.");
  },
);

server.registerTool(
  "try_upgrade",
  {
    title: "Try a pricier room",
    description: "Ask to switch the hotel to a pricier room than the approved plan. Shows the guardrail: the NEAR contract refuses to sign a payment outside the plan, and the refusal is recorded on-chain.",
    inputSchema: { run_id: runId, wait_seconds: waitS },
  },
  async ({ run_id, wait_seconds }) => {
    await api(`/runs/${run_id}/upgrade`, {});
    return text(summary(await follow(run_id, wait_seconds ?? 0)));
  },
);

server.registerTool(
  "simulate_cancellation",
  {
    title: "Simulate a cancellation (demo)",
    description: "Demo only: the airline cancels the flight. Wayfare gets the refund (NEAR checks the airline's signature), fixes anything that no longer connects, and rebooks inside the traveler's rebook rule.",
    inputSchema: { run_id: runId, wait_seconds: waitS },
  },
  async ({ run_id, wait_seconds }) => {
    await api(`/runs/${run_id}/disrupt`, {});
    return text(summary(await follow(run_id, wait_seconds ?? 0)));
  },
);

server.registerTool(
  "end_trip",
  {
    title: "End the trip",
    description: "End the trip on NEAR: from then on no agent can pay or read the traveler's details. What is left on every chain is sent home and swapped back to NEAR.",
    inputSchema: { run_id: runId, wait_seconds: waitS },
    annotations: { destructiveHint: true },
  },
  async ({ run_id, wait_seconds }) => {
    await api(`/runs/${run_id}/end`, {});
    return text(summary(await follow(run_id, wait_seconds ?? 0)));
  },
);

server.registerTool(
  "verify_trip",
  {
    title: "Verify on NEAR",
    description: "Read the trip straight from the NEAR contract: the approved budget and plan hash, every payment the contract signed, refusals, and the receipt chain head.",
    inputSchema: { run_id: runId },
    annotations: { readOnlyHint: true },
  },
  async ({ run_id }) => {
    const r = await api<Run>(`/runs/${run_id}`);
    if (!r.trip_id) return text("This run is not on NEAR yet: the traveler has not approved it.");
    const { trip, payments } = await api<{ trip: Record<string, any>; payments: Record<string, any>[] }>(`/trips/${r.trip_id}`);
    const s = await api<Status>("/status");
    return text(
      [
        `Trip #${trip.id} on ${s.contract} (${trip.phase}): "${trip.title}"`,
        `Traveler ${trip.traveler}, agent ${trip.agent}`,
        `Budget ${usdc(trip.budget)}, spent ${usdc(trip.spent)}, refused ${trip.refusals}`,
        `Approved plan hash: ${trip.plan_hash}`,
        `Receipt chain head: ${trip.receipt_head}`,
        "Payments signed by the contract:",
        ...payments.map((p) => `  #${p.id} ${p.merchant_id ?? "withdraw"}: ${usdc(p.amount)} on ${chain(p.network)}, ${p.status}${p.settled_tx ? `, settled ${tx(p.settled_tx)}` : ""}`),
        `Check it yourself: near view ${s.contract} get_trip '{"trip_id":"${trip.id}"}' --networkId testnet`,
      ].join("\n"),
    );
  },
);

await server.connect(new StdioServerTransport());
console.error(`Wayfare MCP server on stdio → ${WEB}`);
