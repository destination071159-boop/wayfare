// The planner: for each part of the request, search the merchant in the browser, let the model choose the option
// that fits (or simple rules without a key), open it and read the exact total. The result is the plan the traveler
// approves; each item's total becomes that item's limit on NEAR.
import type { Activity } from "./activity.js";
import type { Browser } from "./browser.js";
import type { TripRequest } from "./intent.js";
import { askJSON, hasLLM, MODEL } from "./llm.js";
import { type Candidate, type Kind, SKILLS, readCandidates, readTotal, search } from "./sites.js";

export type PlannedItem = { kind: Kind; merchant: string; label: string; choice: string; form_url: string; total: number; reason: string; decided_by: string };
export type Plan = { request: TripRequest; items: PlannedItem[]; total: number; budget: number; over_budget: boolean };

/** USDC base units ↔ the sites' 1/100 scale: $1 real = 0.01 test USDC = 10_000 base units. */
export const USD_TO_BASE = 10_000;
export const fmt = (base: number) => `${(base / 1e6).toFixed(2)} USDC (≈ $${Math.round(base / USD_TO_BASE)})`;

const ORDER: Kind[] = ["flight", "train", "hotel", "dinner"];

function want(kind: Kind, r: TripRequest): string {
  switch (kind) {
    case "flight":
      return `a ${r.flight!.cabin} seat`;
    case "train":
      return `a ${r.train!.class} seat`;
    case "hotel":
      return `a stay that fits: ${r.hotel!.preferences || "good value, well rated"}`;
    case "dinner":
      return `dinner for ${r.dinner!.party} guest${r.dinner!.party > 1 ? "s" : ""}${r.dinner!.preferences ? ` (${r.dinner!.preferences})` : ""}${r.dinner!.time ? ` around ${r.dinner!.time}` : " at a usual dinner time"}`;
  }
}

async function choose(kind: Kind, r: TripRequest, cands: Candidate[], planned: PlannedItem[], remaining: number, level: string, why = ""): Promise<{ index: number; label: string; reason: string; by: string }> {
  if (hasLLM()) {
    const list = cands.map((c, i) => `${i}. [${c.action}] ${c.text}`).join("\n");
    const ctx = planned.map((p) => `- ${p.label}: ${p.choice.slice(0, 160)}`).join("\n") || "(nothing yet)";
    const out = await askJSON<{ index: number; label: string; reason: string }>(
      `You pick one option for a traveler's trip. Prices shown are test USDC at 1/100 of the real price (1.00 USDC ≈ $100).
Respect the traveler's wishes, the timing of what's already planned (e.g. a train after the flight lands, with an hour to spare), and the remaining budget. Prefer good value; don't upgrade unless asked.
Return the option's index, a short label for the receipt in plain ASCII (e.g. "Flight BKK to HND, KU 116 10:55", "Gion Hanare Ryokan, Tatami Twin", "Sushi Kaze 18:00, 2 guests") and one sentence why.`,
      `Trip: ${r.summary}. Travelers: ${r.travelers}.
Choosing the ${kind}${level}: ${want(kind, r)}.${why ? `\nWhy: ${why}` : ""}
Already planned:\n${ctx}
Remaining budget: ${remaining > 0 ? fmt(remaining) : "not set"}.
Options:\n${list}`,
      "choice",
      { type: "object", additionalProperties: false, required: ["index", "label", "reason"], properties: { index: { type: "integer" }, label: { type: "string" }, reason: { type: "string" } } },
    );
    if (out.index >= 0 && out.index < cands.length) return { ...out, by: `openai:${MODEL()}` };
  }
  // rules: the right cabin/class, the preference words, then the cheapest
  const prefs = [r.hotel?.preferences, r.dinner?.preferences, r.dinner?.time].filter(Boolean).join(" ").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const avoid = /premium|green car/i;
  const score = (c: Candidate) => (avoid.test(c.action) ? -10 : 0) + prefs.filter((w) => c.text.toLowerCase().includes(w) || c.action.includes(w)).length;
  const best = cands.map((c, i) => ({ i, s: score(c), p: c.price ?? Infinity })).sort((a, b) => b.s - a.s || a.p - b.p)[0];
  const c = cands[best.i];
  return { index: best.i, label: `${kind}: ${c.text.slice(0, 50)}`, reason: "best match on preferences, then the cheapest", by: "rules" };
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** "07:40 → 13:50" in a result card: [departure, arrival]; arrival may carry "+1". */
export const times = (text: string) => text.match(/(\d{2}:\d{2})\s*→\s*(\d{2}:\d{2})(\s*\+1)?/);

/** A train on the flight's day must leave at least an hour after landing (checked here, not left to the model). */
export function connects(kind: Kind, r: TripRequest, planned: PlannedItem[], c: Candidate): boolean {
  if (kind !== "train" || !r.flight || !r.train || r.flight.date !== r.train.date) return true;
  const f = planned.find((p) => p.kind === "flight");
  const ft = f && times(f.choice);
  const tt = times(c.text);
  if (!ft || !tt) return true;
  if (ft[3]) return false; // lands the next day: no same-day train
  return minutes(tt[1]) >= minutes(ft[2]) + 60;
}

/** Searches one merchant, filters what fits, lets the model (or rules) choose, and reads the exact total. */
export async function planOne(b: Browser, kind: Kind, r: TripRequest, planned: PlannedItem[], act: Activity, budget: number, opts: { why?: string; exclude?: (c: Candidate) => boolean; tag?: string } = {}): Promise<PlannedItem> {
  const skill = SKILLS[kind];
  const tag = opts.tag ?? kind;
  act.add("search", `${skill.merchant}: searching for the ${kind}`);
  const all = await search(b, kind, r);
  await b.screenshot(act.file(`plan-${tag}.png`));
  let cands = all.filter((c) => connects(kind, r, planned, c) && !opts.exclude?.(c));
  if (!cands.length) throw new Error(`${skill.merchant}: nothing fits (e.g. no train an hour after the flight lands)`);
  act.add("read", `${skill.merchant}: ${all.length} options${cands.length < all.length ? `, ${cands.length} fit` : ""}`);
  const remaining = budget ? budget - planned.reduce((s, i) => s + i.total, 0) : 0;
  let pick = await choose(kind, r, cands, planned, remaining, skill.twoLevel ? " (which hotel)" : "", opts.why);
  if (skill.twoLevel) {
    act.add("choose", `${pick.label}: ${pick.reason}`);
    await b.open(cands[pick.index].href);
    cands = await readCandidates(b);
    pick = await choose(kind, r, cands, planned, remaining, " (which room)", opts.why);
  }
  const c = cands[pick.index];
  await b.open(c.href);
  const total = (await readTotal(b)) ?? c.price;
  if (!total) throw new Error(`${skill.merchant}: could not read the price`);
  await b.screenshot(act.file(`plan-${tag}-choice.png`));
  const item: PlannedItem = { kind, merchant: skill.merchant, label: pick.label.slice(0, 110), choice: `${c.text} [${c.action}]`, form_url: c.href, total, reason: pick.reason, decided_by: pick.by };
  act.add("choose", `${item.label} · ${fmt(total)} · ${pick.reason}`);
  return item;
}

export async function plan(b: Browser, r: TripRequest, act: Activity): Promise<Plan> {
  const budget = r.budget_usd ? Math.round(r.budget_usd * USD_TO_BASE) : 0;
  const items: PlannedItem[] = [];
  for (const kind of ORDER) {
    if (!r[kind]) continue;
    items.push(await planOne(b, kind, r, items, act, budget));
  }
  const total = items.reduce((s, i) => s + i.total, 0);
  return { request: r, items, total, budget: Math.max(budget, total), over_budget: budget > 0 && total > budget };
}
