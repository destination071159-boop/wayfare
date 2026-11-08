// One trip run, from the sentence to the bookings: parse → plan (browser) → approve (NEAR) → book (browser + x402).
// Used by the CLI (scripts/trip.ts) and the hub (src/hub.ts). State is saved to .data/trips/<run>/run.json.
import crypto from "node:crypto";
import fs from "node:fs";
import { Activity } from "./activity.js";
import { book, type Booked } from "./booker.js";
import { Browser } from "./browser.js";
import { parseIntent, type TripRequest } from "./intent.js";
import { agent, call, nearAmount, traveler } from "./near.js";
import { connects, fmt, plan, planOne, type Plan, type PlannedItem, times } from "./planner.js";
import { type Cancelled, type Disruption, recordOnNear, requestCancellation } from "./disruption.js";
import { type Funded, fundTrip, needsFor, type Quote, quoteNeeds, walletAddress } from "./onramp.js";
import { type ReturnLeg, returnToSavings, type Returned, swapToNear, walletLeft } from "./savings.js";
import { readCandidates } from "./sites.js";

export type RunStatus = "parsing" | "planning" | "awaiting_approval" | "booking" | "booked" | "cancelled" | "error";

export type RunState = {
  id: string;
  text: string;
  status: RunStatus;
  created_at: string;
  request?: TripRequest;
  plan?: Plan;
  trip_id?: string;
  approve_tx?: string;
  plan_hash?: string;
  results: Booked[];
  busy?: string;
  ended_tx?: string;
  returned?: Returned;
  quote?: Quote;
  funded?: Funded;
  /** if a booking is cancelled, the agent may rebook it for up to this much more (percent) without asking */
  rebook_pct?: number;
  disruption?: Disruption;
  /** return legs already settled (saved as they happen, so a failed return can resume) */
  returning?: ReturnLeg[];
  /** replacements still to book after the traveler's OK */
  pendingRebook?: { i: number; it: PlannedItem; from: string }[];
  error?: string;
};

/** The auto-rebook margin the traveler approves with the plan. */
export const REBOOK_PCT = 20;

export class Run {
  readonly act: Activity;
  state: RunState;

  constructor(text: string, id = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19), saved?: RunState) {
    this.act = new Activity(id);
    this.state = saved ?? { id, text, status: "parsing", created_at: new Date().toISOString(), results: [] };
    this.save();
  }

  /** Picks up a saved run (e.g. after the hub restarted) to approve, upgrade or end it. */
  static resume(id: string): Run | undefined {
    const s = Run.load(id);
    return s && new Run(s.text, s.id, { ...s, busy: undefined });
  }

  static load(id: string): RunState | undefined {
    try {
      return JSON.parse(fs.readFileSync(new Activity(id).file("run.json"), "utf8")) as RunState;
    } catch {
      return undefined;
    }
  }

  save() {
    this.act.save("run.json", this.state);
  }

  private set(p: Partial<RunState>) {
    Object.assign(this.state, p);
    this.save();
  }

  // a fresh session name per step: reusing one right after closing it races the browser daemon
  private browser(step: string) {
    return new Browser(`wayfare-${this.state.id}-${step}-${Date.now() % 1e6}`);
  }

  /** Runs one step; a failure stops the run, unless `keepStatus` (a side action on a booked trip). */
  private async guard(what: string, f: () => Promise<void>, keepStatus = false) {
    this.set({ busy: what });
    try {
      await f();
    } catch (e) {
      this.act.add("error", (e as Error).message);
      if (keepStatus) this.set({ error: (e as Error).message });
      else this.set({ status: "error", error: (e as Error).message });
    } finally {
      this.set({ busy: undefined });
    }
  }

  /** Parse the sentence and plan the trip by browsing the merchants. Ends awaiting approval. */
  async plan() {
    await this.guard("planning", async () => {
      this.act.add("ask", this.state.text);
      const req = await parseIntent(this.state.text);
      this.act.save("request.json", req);
      this.act.add("intent", `${req.summary} (parsed by ${req.parsed_by})`, req);
      for (const n of req.not_possible) this.act.add("note", `can't book: ${n}`);
      this.set({ request: req, status: "planning" });
      const b = this.browser("plan");
      try {
        await b.viewport(1280, 900);
        const p = await plan(b, req, this.act);
        this.act.save("plan.json", p);
        this.act.add("plan", `${p.items.length} items, ${fmt(p.total)}${req.budget_usd ? ` of a $${req.budget_usd} budget` : ""}${p.over_budget ? " (over budget)" : ""}: waiting for approval`);
        this.set({ plan: p, status: "awaiting_approval" });
        void this.refreshQuote();
      } finally {
        await b.close();
      }
    });
  }

  cancel() {
    if (this.state.status !== "awaiting_approval") throw new Error("only a plan waiting for approval can be cancelled");
    this.act.add("cancel", "the traveler declined the plan");
    this.set({ status: "cancelled" });
  }

  /** The traveler approves: the trip goes on NEAR, then the agent books and pays every item. */
  /** A live NEAR Intents price for funding this trip's budget, shown before approval. Never fatal. */
  async refreshQuote() {
    const p = this.state.plan;
    if (!p) return;
    try {
      const q = await quoteNeeds(needsFor(p), await walletAddress());
      this.set({ quote: q });
    } catch (e) {
      this.act.add("note", `no NEAR Intents quote right now: ${(e as Error).message}`);
    }
  }

  async approve(rebookPct = REBOOK_PCT) {
    const pct = Math.max(0, Math.min(100, Math.round(rebookPct)));
    const p = this.state.plan;
    if (this.state.status !== "awaiting_approval" || !p) throw new Error("nothing to approve");
    this.set({ status: "booking" });
    await this.guard("booking", async () => {
      const funded = await fundTrip(needsFor(p), (k, t, d) => this.act.add(k, t, d));
      if (funded) this.set({ funded, quote: funded.quote });
      const me = await traveler();
      const bot = await agent();
      const planHash = crypto.createHash("sha256").update(JSON.stringify(p.items.map((i) => ({ merchant: i.merchant, label: i.label, total: i.total })))).digest("hex");
      const { value: tripId, tx } = await call<string>(
        me,
        "create_trip",
        {
          trip: {
            agent: bot.accountId,
            title: p.request.summary.slice(0, 110),
            plan_hash: planHash,
            budget: String(p.budget),
            items: p.items.map((i) => ({ merchant_id: i.merchant, label: i.label, max: String(i.total) })),
            vault_fields: ["full_name", "passport_no", "email"],
            duration_sec: 7200,
            rebook_pct: pct,
          },
        },
        { deposit: nearAmount("0.25") },
      );
      this.set({ trip_id: tripId, approve_tx: tx, plan_hash: planHash, rebook_pct: pct });
      this.act.add("approve", `trip ${tripId} on NEAR: ${p.items.length} items, budget ${fmt(p.budget)}, each item capped at its planned price`, { tx });
      const b = this.browser("book");
      try {
        await b.viewport(1280, 900);
        for (const [i, it] of p.items.entries()) {
          const r = await book(b, bot, tripId, i, it, this.act);
          this.set({ results: [...this.state.results, r] });
        }
      } finally {
        await b.close();
      }
      const ok = this.state.results.filter((r) => r.status === "confirmed").length;
      this.act.add("done", `${ok} of ${p.items.length} booked`);
      this.set({ status: "booked" });
    });
  }

  /** Demo: the agent tries a pricier hotel room on the same trip. The contract should refuse. */
  async tryUpgrade() {
    const p = this.state.plan;
    const tripId = this.state.trip_id;
    const h = p?.items.findIndex((i) => i.kind === "hotel") ?? -1;
    if (!p || !tripId || h < 0) throw new Error("no booked hotel to upgrade");
    await this.guard("upgrading", async () => {
      const bot = await agent();
      const b = this.browser("upgrade");
      try {
        await b.viewport(1280, 900);
        const u = new URL(p.items[h].form_url);
        await b.open(`${u.origin}/hotel?${new URLSearchParams({ ...Object.fromEntries(u.searchParams), id: u.searchParams.get("hotel") ?? "" })}`);
        const rooms = (await readCandidates(b)).sort((x, y) => (y.price ?? 0) - (x.price ?? 0));
        const up = rooms.find((r) => r.href !== p.items[h].form_url) ?? rooms[0];
        this.act.add("upgrade", `the agent tries a pricier room: ${up.text.slice(0, 70)}`);
        const r = await book(b, bot, tripId, h, { ...p.items[h], label: `${p.items[h].label} (upgrade)` }, this.act, { formUrl: up.href });
        this.set({ results: [...this.state.results, r] });
      } finally {
        await b.close();
      }
    }, true);
  }

  private booked(i: number): Booked | undefined {
    return this.state.results.find((r) => r.item === i && r.status === "confirmed" && !r.label.endsWith("(upgrade)"));
  }

  private log = (k: string, t: string, d?: unknown) => this.act.add(k, t, d);

  /** Cancels one booking at the merchant and proves it on NEAR; marks the old result cancelled. */
  private async cancelItem(bot: Awaited<ReturnType<typeof agent>>, i: number, by: "merchant" | "customer", reason: string): Promise<Cancelled> {
    const p = this.state.plan!;
    const old = this.booked(i);
    if (!old) throw new Error(`${p.items[i].label} is not booked`);
    const n = await requestCancellation(old, by, reason);
    this.log("cancelled", `${p.items[i].merchant} cancelled ${old.ref}${by === "customer" ? " at the agent's request" : ""} (${reason}) and refunded ${fmt(Number(n.refund))} on Base: ${n.refund_tx}`);
    const c = await recordOnNear(bot, this.state.trip_id!, old, p.items[i].merchant, n);
    this.log(
      "verified",
      `NEAR checked ${p.items[i].merchant}'s signature on the cancellation: ${fmt(Number(c.refund))} is back in the budget, and the replacement may cost up to ${fmt(Number(c.rebook_max))} without asking you (+${this.state.rebook_pct ?? 0}%)`,
      { tx: c.near_tx },
    );
    old.status = "cancelled";
    const d = this.state.disruption!;
    this.set({ results: [...this.state.results], disruption: { ...d, cancelled: [...d.cancelled, c] } });
    return c;
  }

  /** Books replacements in order; stops at the first one over the auto-rebook limit and asks the traveler. */
  private async bookReplacements(bot: Awaited<ReturnType<typeof agent>>, todo: { i: number; it: PlannedItem; from: string }[]) {
    const p = this.state.plan!;
    const b = this.browser("rebook");
    try {
      await b.viewport(1280, 900);
      for (const [k, { i, it, from }] of todo.entries()) {
        const r = await book(b, bot, this.state.trip_id!, i, it, this.act);
        if (r.status === "refused" && /auto-rebook limit/.test(r.reason ?? "")) {
          const d = this.state.disruption!;
          const max = d.cancelled.find((c) => c.item === i)?.rebook_max ?? "0";
          this.log("ask", `${it.label} costs ${fmt(r.amount ?? it.total)}, over your auto-rebook limit: waiting for your OK`);
          this.set({ disruption: { ...d, status: "needs_approval", pending: { item: i, label: it.label, amount: r.amount ?? it.total, max, reason: r.reason ?? "" } }, pendingRebook: todo.slice(k) });
          return;
        }
        this.set({ results: [...this.state.results, r] });
        if (r.status !== "confirmed") throw new Error(`could not rebook ${it.label}: ${r.reason ?? r.status}`);
        p.items[i] = it;
        p.total = p.items.reduce((s, x) => s + x.total, 0);
        const d = this.state.disruption!;
        this.set({ plan: p, disruption: { ...d, rebooked: [...d.rebooked, { item: i, from, to: it.label, amount: r.amount ?? it.total, ref: r.ref, near_tx: r.near_tx, settle_tx: r.settle_tx }] } });
      }
    } finally {
      await b.close();
    }
    const d = this.state.disruption!;
    this.log("done", `trip back on track: ${d.rebooked.map((x) => x.to).join(", ")}`);
    this.set({ disruption: { ...d, status: "rebooked", pending: undefined }, pendingRebook: undefined });
  }

  /**
   * Demo of a disruption: Kumo Air cancels the booked flight. The agent proves the refund on NEAR, finds the next
   * flight, notices when the train no longer connects and changes it too, then books the replacements within the
   * traveler's auto-rebook rule.
   */
  async disrupt(cause = "typhoon warning over Bangkok") {
    const p = this.state.plan;
    const tripId = this.state.trip_id;
    const f = p?.items.findIndex((i) => i.kind === "flight") ?? -1;
    if (!p || !tripId || f < 0 || !this.booked(f)) throw new Error("no booked flight to cancel");
    if (this.state.ended_tx) throw new Error("the trip has ended");
    if (this.state.disruption && this.state.disruption.status !== "failed") throw new Error("this trip was already disrupted");
    await this.guard("rebooking", async () => {
      const bot = await agent();
      this.set({ disruption: { cause, status: "handling", cancelled: [], rebooked: [], started_at: new Date().toISOString() } });
      const oldFlight = p.items[f];
      this.log("disruption", `Kumo Air cancelled your flight, ${oldFlight.label}: ${cause}`);
      await this.cancelItem(bot, f, "merchant", `${cause}: flight cancelled`);

      const b = this.browser("replan");
      const todo: { i: number; it: PlannedItem; from: string }[] = [];
      try {
        await b.viewport(1280, 900);
        const gone = times(oldFlight.choice)?.[1];
        const others = p.items.filter((_, k) => k !== f);
        const flight = await planOne(b, "flight", p.request, others, this.act, p.budget, {
          why: `the airline cancelled the booked flight (${oldFlight.label}); pick a replacement on the same day, the earliest that still works`,
          exclude: (c) => !!gone && times(c.text)?.[1] === gone,
          tag: "flight-rebook",
        });
        todo.push({ i: f, it: flight, from: oldFlight.label });

        // the train has to leave an hour after the new flight lands
        const t = p.items.findIndex((i) => i.kind === "train");
        if (t >= 0 && this.booked(t)) {
          const planned = p.items.map((it, k) => (k === f ? flight : it));
          const train = p.items[t];
          if (!connects("train", p.request, planned.filter((_, k) => k !== t), { text: train.choice, action: "", href: train.form_url })) {
            const lands = times(flight.choice)?.[2];
            this.log("reason", `the new flight lands at ${lands}: the booked train (${train.label}) no longer connects, so the train has to change too`);
            await this.cancelItem(bot, t, "customer", "missed connection after the flight was cancelled");
            const others2 = planned.filter((_, k) => k !== t);
            const nt = await planOne(b, "train", p.request, others2, this.act, p.budget, {
              why: `the flight changed and now lands at ${lands}; pick the first train that leaves at least an hour after landing`,
              tag: "train-rebook",
            });
            todo.push({ i: t, it: nt, from: train.label });
          } else {
            this.log("reason", `the booked train still connects with the new flight: no change needed`);
          }
        }
      } finally {
        await b.close();
      }
      await this.bookReplacements(bot, todo);
    }, true);
    if (this.state.error && this.state.disruption?.status === "handling") this.set({ disruption: { ...this.state.disruption, status: "failed", note: this.state.error } });
  }

  /** The traveler approves a replacement over the auto-rebook limit; the agent books the rest. */
  async approveRebook() {
    const d = this.state.disruption;
    const todo = this.state.pendingRebook;
    if (!d?.pending || !todo?.length) throw new Error("nothing waiting for approval");
    await this.guard("rebooking", async () => {
      const { tx } = await call(await traveler(), "approve_rebook", { trip_id: this.state.trip_id, item: d.pending!.item, max: String(d.pending!.amount) });
      this.log("approve", `you approved ${d.pending!.label} at ${fmt(d.pending!.amount)}`, { tx });
      this.set({ disruption: { ...d, status: "handling", pending: undefined } });
      await this.bookReplacements(await agent(), todo);
    }, true);
  }

  /** The traveler ends the trip: no more payments or vault reads. */
  async end() {
    if (!this.state.trip_id) throw new Error("no trip yet");
    const { tx } = await call(await traveler(), "end_trip", { trip_id: this.state.trip_id });
    this.act.add("end", `the traveler ended trip ${this.state.trip_id}: the agent can no longer pay or read the vault`, { tx });
    this.set({ ended_tx: tx });
    void this.returnUnspent();
  }

  /** Off-ramp: sends the trip's unspent budget from the trip wallet back to the traveler's NEAR savings. */
  async returnUnspent() {
    const tripId = this.state.trip_id;
    const done = this.state.returned;
    if (!tripId || !this.state.ended_tx || done?.payout_tx) return;
    await this.guard("returning", async () => {
      if (done?.settle_tx) {
        // the USDC already left the trip wallet: only the swap to NEAR is left
        this.set({ returned: await swapToNear({ ...done }, (k, t, d) => this.act.add(k, t, d)), error: undefined });
        return;
      }
      const partial = this.state.returning ?? [];
      if (!partial.length && !(await walletLeft()).length) {
        this.act.add("return", "nothing left to return: the whole budget was spent");
        return;
      }
      // legs that settled on an earlier try are kept, so a retry never loses one
      const r = await returnToSavings((k, t, d) => this.act.add(k, t, d), partial, (legs) => this.set({ returning: legs }));
      this.set({ returned: r, error: undefined });
    }, true);
  }
}
