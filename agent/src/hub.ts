// The hub: the agent behind a small HTTP API for the web app (proxied there as /api and /files).
// One run at a time (one browser). Run: pnpm -C agent hub   (port 7373)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DATA, type Step } from "./activity.js";
import { hasLLM, MODEL } from "./llm.js";
import { CHAINS, chainLabel, NEAR_RAIL, RAILS, usdcOn } from "./chains.js";
import { nearUsdc, type NearWallet } from "./near-rail.js";
import { CHAIN_LABEL, CHAIN_MODE, MERCHANTS } from "./merchants.js";
import { CONTRACT, env, view } from "./near.js";
import { Run, type RunState } from "./runner.js";
import { nearSavings } from "./onramp.js";

const PORT = Number(process.env.HUB_PORT ?? 7373);
const TRIPS = path.join(DATA, "trips");
const runs = new Map<string, Run>();
let active: Run | undefined;


// The web app polls status every few seconds; cache the NEAR reads so it doesn't hammer the testnet RPC.
let walletCache: { address: `0x${string}`; path: string } | null = null;
let nearWalletCache: NearWallet | null = null;
let savingsCache: { at: number; value: Awaited<ReturnType<typeof nearSavings>> } | null = null;

async function status() {
  const travelerId = env("TRAVELER_ACCOUNT");
  const wallet = (walletCache ??= await view<{ address: `0x${string}`; path: string } | null>("get_wallet", { traveler: travelerId }));
  if (!savingsCache || Date.now() - savingsCache.at > 15_000) savingsCache = { at: Date.now(), value: await nearSavings() };
  // the same trip wallet address on every chain
  const chains: { id: string; name: string; label: string; balance: string | null; explorer_tx: string; account?: string }[] = [];
  for (const c of CHAINS) {
    let b: string | null = null;
    if (wallet) {
      try {
        b = (await usdcOn(c, wallet.address)).toString();
      } catch {}
    }
    chains.push({ id: c.id, name: c.name, label: chainLabel(c), balance: b, explorer_tx: c.explorer_tx });
  }
  // the trip wallet on NEAR itself: its own (implicit) account
  nearWalletCache ??= await view<NearWallet | null>("get_near_wallet", { traveler: travelerId }).catch(() => null);
  if (nearWalletCache) {
    let b: string | null = null;
    try {
      b = (await nearUsdc(nearWalletCache.account_id)).toString();
    } catch {}
    chains.push({ id: NEAR_RAIL.id, name: NEAR_RAIL.name, label: "NEAR testnet", balance: b, explorer_tx: NEAR_RAIL.explorer_tx, account: nearWalletCache.account_id });
  }
  const balance = chains.every((c) => c.balance === null) ? null : chains.reduce((s, c) => s + BigInt(c.balance ?? "0"), 0n).toString();
  return {
    contract: CONTRACT(),
    traveler: travelerId,
    agent: env("AGENT_ACCOUNT"),
    wallet,
    balance,
    chains,
    savings: savingsCache.value,
    chain: { mode: CHAIN_MODE, label: CHAIN_LABEL, explorer_tx: CHAIN_MODE === "live" ? "https://sepolia.basescan.org/tx/" : "" },
    near_explorer_tx: "https://testnet.nearblocks.io/txns/",
    brain: hasLLM() ? `openai:${MODEL()}` : "rules",
    merchants: MERCHANTS.map((m) => ({ ...m, chain: RAILS.find((c) => c.id === m.network)?.name })),
    busy: active?.state.busy ? { run: active.state.id, what: active.state.busy } : null,
  };
}

function readSteps(id: string): Step[] {
  try {
    return fs
      .readFileSync(path.join(TRIPS, id, "activity.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Step);
  } catch {
    return [];
  }
}

function shots(id: string) {
  try {
    return fs
      .readdirSync(path.join(TRIPS, id))
      .filter((f) => f.endsWith(".png"))
      .map((f) => ({ f, t: fs.statSync(path.join(TRIPS, id, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t)
      .map((x) => x.f);
  } catch {
    return [];
  }
}

const stateOf = (id: string): RunState | undefined => runs.get(id)?.state ?? Run.load(id);

function runView(id: string) {
  const s = stateOf(id);
  return s && { ...s, steps: readSteps(id), shots: shots(id) };
}

function listRuns() {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(TRIPS).filter((d) => fs.existsSync(path.join(TRIPS, d, "run.json")));
  } catch {}
  return ids
    .sort()
    .reverse()
    .slice(0, 30)
    .map((id) => stateOf(id))
    .filter(Boolean)
    .map((s) => ({ id: s!.id, text: s!.text, status: s!.status, summary: s!.request?.summary, trip_id: s!.trip_id, total: s!.plan?.total, created_at: s!.created_at, booked: s!.results.filter((r) => r.status === "confirmed").length }));
}

// several panels poll the same trip: share one read per trip every few seconds (the free RPC rate-limits)
const tripCache = new Map<string, { at: number; v: Promise<unknown> }>();
function tripView(tripId: string) {
  const hit = tripCache.get(tripId);
  if (hit && Date.now() - hit.at < 4000) return hit.v;
  const v = readTrip(tripId);
  tripCache.set(tripId, { at: Date.now(), v });
  v.catch(() => tripCache.delete(tripId));
  return v;
}

async function readTrip(tripId: string) {
  const [trip, payments, reads] = await Promise.all([view("get_trip", { trip_id: tripId }), view("get_trip_payments", { trip_id: tripId }), view("get_trip_reads", { trip_id: tripId })]);
  return { trip, payments, reads };
}

function loaded(id: string): Run {
  let r = runs.get(id);
  if (!r) {
    r = Run.resume(id);
    if (!r) throw new Error("no such run");
    runs.set(id, r);
  }
  return r;
}

function startRun(id: string, f: (r: Run) => Promise<void>) {
  const r = loaded(id);
  if (active && active !== r && active.state.busy) throw new Error(`the agent is busy (${active.state.busy})`);
  active = r;
  void f(r);
}

const send = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      try {
        resolve(s ? (JSON.parse(s) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
  });

http
  .createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://hub");
    const parts = u.pathname.split("/").filter(Boolean);
    try {
      // static evidence: /runs/<run>/<file>.png
      if (parts[0] === "runs" && parts.length === 3 && /^[\w-]+$/.test(parts[1]) && /^[\w.-]+\.png$/.test(parts[2])) {
        const f = path.join(TRIPS, parts[1], parts[2]);
        if (!fs.existsSync(f)) return send(res, 404, { error: "not found" });
        res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        return void fs.createReadStream(f).pipe(res);
      }
      if (parts[0] !== "api") return send(res, 404, { error: "not found" });
      const [, a, id, action] = parts;
      if (req.method === "GET" && a === "status") return send(res, 200, await status());
      if (req.method === "GET" && a === "runs" && !id) return send(res, 200, listRuns());
      if (req.method === "POST" && a === "runs" && !id) {
        const text = String((await readBody(req)).text ?? "").trim();
        if (text.length < 8 || text.length > 600) return send(res, 400, { error: "describe the trip in 8-600 characters" });
        if (active?.state.busy) return send(res, 409, { error: `the agent is busy (${active.state.busy})` });
        const r = new Run(text);
        runs.set(r.state.id, r);
        active = r;
        void r.plan();
        return send(res, 200, { id: r.state.id });
      }
      if (req.method === "GET" && a === "runs" && id) {
        const v = runView(id);
        return v ? send(res, 200, v) : send(res, 404, { error: "no such run" });
      }
      if (req.method === "POST" && a === "runs" && id) {
        if (action === "approve") {
          const pct = Number((await readBody(req)).rebook_pct);
          startRun(id, (r) => r.approve(Number.isFinite(pct) ? pct : undefined));
        }
        else if (action === "upgrade") startRun(id, (r) => r.tryUpgrade());
        else if (action === "disrupt") startRun(id, (r) => r.disrupt());
        else if (action === "approve-rebook") startRun(id, (r) => r.approveRebook());
        else if (action === "cancel") loaded(id).cancel();
        else if (action === "end") {
          const r = loaded(id);
          await r.end();
          active = r;
        }
        else if (action === "return") startRun(id, (r) => r.returnUnspent());
        else if (action === "quote") await loaded(id).refreshQuote();
        else return send(res, 404, { error: "unknown action" });
        return send(res, 200, runView(id));
      }
      if (req.method === "GET" && a === "trips" && id) return send(res, 200, await tripView(id));
      return send(res, 404, { error: "not found" });
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Wayfare hub http://localhost:${PORT}`));
