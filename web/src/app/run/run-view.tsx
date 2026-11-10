"use client";
import clsx from "clsx";
import { ArrowDownToLine, ArrowRight, Ban, Check, CloudLightning, Lock, PiggyBank, RefreshCw, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChainRecord } from "@/components/chain-record";
import { KindIcon } from "@/components/kind-icon";
import { TripFlow } from "@/components/trip-flow";
import { PillButton, StatusDisk, Tag } from "@/components/ui";
import { get, post, fileUrl } from "@/lib/api";
import { chainChip, chainOf, merchantChain } from "@/lib/chain";
import { clock, KIND_LABEL, short, usd, usdc } from "@/lib/format";
import { useStatus } from "@/lib/status";
import type { Booked, Disruption, Funded, Run, Step } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";

const TRACK = [
  { key: "parsing", label: "Understand" },
  { key: "planning", label: "Plan" },
  { key: "awaiting_approval", label: "Approve" },
  { key: "booking", label: "Book & pay" },
  { key: "booked", label: "Done" },
];

type Tone = "neutral" | "green" | "gold" | "red" | "blue";
const TONE: Record<string, Tone> = {
  search: "gold",
  read: "gold",
  choose: "blue",
  plan: "blue",
  approve: "green",
  vault: "blue",
  "402": "gold",
  sign: "gold",
  signed: "green",
  paid: "green",
  done: "green",
  refused: "red",
  failed: "red",
  error: "red",
  upgrade: "red",
  end: "red",
  disruption: "red",
  cancelled: "red",
  verified: "blue",
  reason: "gold",
  ask: "gold",
};

function Track({ status }: { status: Run["status"] }) {
  const at = status === "error" || status === "cancelled" ? -1 : TRACK.findIndex((t) => t.key === status);
  const done = (i: number) => i < at || status === "booked";
  return (
    <div className="surface-card flex items-center gap-2 overflow-x-auto rounded-card p-2">
      {TRACK.map((t, i) => (
        <div key={t.key} className="flex shrink-0 items-center gap-2">
          {i > 0 && <span className={clsx("h-px w-4 sm:w-8", done(i) || i === at ? "bg-midnight-ink/30" : "bg-midnight-ink/10")} />}
          <span className={clsx("flex items-center gap-2 rounded-button px-2.5 py-1.5 text-body-sm", i === at && status !== "booked" ? "bg-whisper-gray font-medium" : "")}>
            <span className={clsx("inline-flex size-5 items-center justify-center rounded-full", done(i) ? "bg-deliver-green text-midnight-ink" : i === at ? "bg-sky text-canvas-white" : "bg-whisper-gray")}>
              {done(i) ? <Check className="size-3" strokeWidth={3} /> : i === at ? <span className="live-dot size-1.5 rounded-full bg-canvas-white" /> : null}
            </span>
            <span className={i === at || done(i) ? "text-midnight-ink" : "text-muted-ash"}>{t.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function AgentView({ run }: { run: Run }) {
  const [pick, setPick] = useState<string | null>(null);
  const latest = run.shots[run.shots.length - 1];
  const shown = pick ?? latest;
  useEffect(() => setPick(null), [latest]);
  return (
    <div className="surface-card overflow-hidden rounded-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="font-medium">Agent&apos;s browser</span>
        <span className="min-w-0 flex-1 truncate text-caption text-muted-ash">{shown ? shown.replace(".png", "").replace(/-/g, " ") : ""}</span>
        {run.busy && (
          <Tag tone="gold">
            <span className="live-dot size-1.5 rounded-full bg-midnight-ink" /> live
          </Tag>
        )}
      </div>
      <div className="px-3">
        <div className="aspect-[1280/900] w-full overflow-hidden rounded-card bg-whisper-gray ring-1 ring-hairline">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(`/files/runs/${run.id}/${shown}?v=${run.shots.length}`)} alt={shown} className="h-full w-full object-cover object-top" />
          ) : (
            <div className="grid h-full place-items-center text-body-sm text-muted-ash">
              <span className="shimmer-text">Opening a browser…</span>
            </div>
          )}
        </div>
      </div>
      {run.shots.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto p-3">
          {run.shots.map((s) => (
            <button key={s} onClick={() => setPick(s)} className={clsx("h-11 w-16 shrink-0 overflow-hidden rounded-button ring-1 transition-opacity", s === shown ? "ring-midnight-ink" : "opacity-60 ring-hairline hover:opacity-100")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(`/files/runs/${run.id}/${s}`)} alt="" className="h-full w-full object-cover object-top" />
            </button>
          ))}
        </div>
      ) : (
        <div className="h-3" />
      )}
    </div>
  );
}

function Feed({ steps, busy }: { steps: Step[]; busy: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  // keep the newest line in view by scrolling the feed itself, never the page
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [steps.length]);
  return (
    <div className="surface-card flex h-full max-h-[620px] flex-col rounded-card p-4">
      <div className="px-1 font-medium">What the agent is doing</div>
      <div ref={box} className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          return (
            <div key={i} className={clsx("grid grid-cols-[52px_1fr] gap-2 rounded-button px-1 py-1 text-caption", last && "bg-whisper-gray")}>
              <span className="pt-0.5 font-mono text-[10.5px] text-muted-ash num">{clock(s.at)}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <Tag tone={TONE[s.kind] ?? "neutral"} className="mr-1.5 align-[1px]">
                  {s.kind}
                </Tag>
                <span className={last && busy ? "shimmer-text" : "text-midnight-ink/80"}>{s.text}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A short proof link: "Signed on NEAR ↗". Plain text when there is no explorer (a local fork). */
function Proof({ label, hash, base }: { label: string; hash?: string; base: string }) {
  if (!hash) return null;
  return base ? (
    <a href={`${base}${hash}`} target="_blank" rel="noreferrer" title={hash} className="text-sky hover:underline">
      {label} ↗
    </a>
  ) : (
    <span title={hash}>{label}</span>
  );
}

/** One plan item: what and why, then the booking proof underneath. */
function Item({ run, i, results }: { run: Run; i: number; results: Booked[] }) {
  const { status } = useStatus();
  const it = run.plan!.items[i];
  const own = results.filter((r) => !r.label.endsWith("(upgrade)"));
  const main = own.find((r) => r.status === "confirmed") ?? own.find((r) => r.status !== "cancelled") ?? own[own.length - 1];
  const replaced = own.filter((r) => r.status === "cancelled");
  const attempts = results.filter((r) => r.label.endsWith("(upgrade)"));
  const working = run.busy === "booking" && !main;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", visualDuration: 0.5, bounce: 0.1, delay: i * 0.05 }} className="surface-card flex flex-col rounded-card p-4">
      <div className="flex items-start gap-3">
        <StatusDisk tone={main?.status === "confirmed" ? "green" : "neutral"}>
          <KindIcon kind={it.kind} size={17} />
        </StatusDisk>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-caption text-muted-ash">
            {KIND_LABEL[it.kind]} · {status?.merchants.find((m) => m.id === it.merchant)?.name ?? it.merchant}
            <span className={clsx("rounded-full px-1.5 py-px text-[10px] font-medium", chainChip(merchantChain(status, it.merchant).name))}>pays on {merchantChain(status, it.merchant).name}</span>
          </div>
          <div className="mt-0.5 text-body-lg leading-snug font-medium">{it.label}</div>
        </div>
        <div className="text-right">
          <div className="text-body-lg leading-none font-medium num">{usdc(it.total)}</div>
          <div className="mt-1 text-[11px] text-muted-ash">USDC · ≈ {usd(it.total)}</div>
        </div>
      </div>
      <p className="mt-3 line-clamp-1 text-body-sm text-muted-ash" title={it.reason}>{it.reason}</p>
      {replaced.map((r) => (
        <div key={r.ref} className="mt-2 flex items-center gap-2 text-caption text-muted-ash" title={`${r.label} · ${r.ref} cancelled by the merchant and refunded`}>
          <Tag tone="red">replaced</Tag>
          <span className="min-w-0 truncate line-through">{r.label}</span>
          <span className="shrink-0">· refunded</span>
        </div>
      ))}

      <div className="surface-panel mt-4 flex min-h-[56px] items-center gap-3 rounded-card px-3 py-2.5">
        {main?.status === "confirmed" ? (
          <>
            <Tag tone="green">
              <Check className="size-3" strokeWidth={3} /> Booked
            </Tag>
            <div className="min-w-0 flex-1 text-caption">
              <div className="font-mono font-medium">{main.ref}</div>
              <div className="truncate text-[11.5px] text-muted-ash">
                <Proof label="Signed on NEAR" hash={main.near_tx} base={status?.near_explorer_tx ?? ""} /> · <Proof label={`Paid on ${chainOf(status, main.network).name}`} hash={main.settle_tx} base={chainOf(status, main.network).explorer} />
              </div>
            </div>
          </>
        ) : main ? (
          <>
            <Tag tone="red">
              <Ban className="size-3" strokeWidth={2.5} /> {main.status}
            </Tag>
            <span className="min-w-0 flex-1 text-caption">{main.reason}</span>
          </>
        ) : (
          <span className={clsx("text-caption", working ? "shimmer-text" : "text-muted-ash")}>{working ? "In the queue…" : run.status === "awaiting_approval" ? `Cap on NEAR after approval: ${usdc(it.total)} USDC` : "Not booked"}</span>
        )}
      </div>

      {attempts.map((a, k) => (
        <div key={k} className="mt-2 flex items-start gap-3 rounded-card bg-lead-gen-red/8 px-3 py-3 ring-1 ring-lead-gen-red/20">
          <StatusDisk tone="red" className="size-7">
            <Ban className="size-3.5" strokeWidth={2.5} />
          </StatusDisk>
          <div className="min-w-0 flex-1 text-caption">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">The agent tried a pricier room</span>
              <Tag tone="red">refused by NEAR</Tag>
            </div>
            <div className="mt-1 text-muted-ash" title={a.reason}>
              Asked {a.amount ? `${usdc(a.amount)} USDC` : "more"}; you approved {usdc(it.total)}. <span className="text-midnight-ink">NEAR refused to sign.</span>
            </div>
          </div>
        </div>
      ))}
    </motion.div>
  );
}

/** On-ramp: NEAR savings → USDC in the trip wallet, priced by a live NEAR Intents quote. */
function FundCard({ f }: { f: Funded }) {
  const { status } = useStatus();
  return (
    <div className="surface-card mt-5 flex flex-wrap items-center gap-4 rounded-card p-4">
      <StatusDisk tone="blue">
        <ArrowDownToLine className="size-[18px]" strokeWidth={2} />
      </StatusDisk>
      <div className="min-w-[240px] flex-1">
        <div className="font-medium">
          Funded {usdc(f.usdc)} USDC from {Number(f.near).toFixed(4)} NEAR <Tag tone="blue">on-ramp</Tag>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(f.legs ?? [{ network: status?.chains?.[0]?.id ?? "", usdc: f.usdc }]).map((l) => (
            <span key={l.network} className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium num", chainChip(chainOf(status, l.network).name))}>
              {chainOf(status, l.network).name} {usdc(l.usdc)}
            </span>
          ))}
        </div>
        <div className="mt-1.5 text-caption text-muted-ash">
          <Proof label="1 NEAR deposit" hash={f.near_tx} base={status?.near_explorer_tx ?? ""} /> · priced live by NEAR Intents
          <span className="text-muted-ash/80" title="The NEAR deposit and the quote are real. NEAR Intents has no testnet, so the solver's USDC delivery is simulated: credited on the local forks, and sent from a demo pool on NEAR testnet.">
            {" "}· solver delivery simulated (no Intents testnet)
          </span>
        </div>
      </div>
    </div>
  );
}

/** A merchant cancelled a booking: the refund proven on NEAR, the agent's reasoning, and the replacements. */
function DisruptionCard({ run, d, acting, onApprove }: { run: Run; d: Disruption; acting: boolean; onApprove: () => void }) {
  const { status } = useStatus();
  const near = status?.near_explorer_tx ?? "";
  const on = (merchant: string) => merchantChain(status, merchant);
  const working = run.busy === "rebooking";
  const reasons = run.steps.filter((s) => s.kind === "reason" && s.at >= d.started_at);
  const name = (id: string) => status?.merchants.find((m) => m.id === id)?.name ?? id;
  const head =
    d.status === "rebooked" ? <Tag tone="green">back on track</Tag> : d.status === "needs_approval" ? <Tag tone="gold">needs your OK</Tag> : d.status === "failed" ? <Tag tone="red">failed</Tag> : <Tag tone="blue">handling</Tag>;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="surface-card mt-5 rounded-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusDisk tone="red">
          <CloudLightning className="size-[18px]" strokeWidth={2} />
        </StatusDisk>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-medium">
            Kumo Air cancelled your flight {head}
          </div>
          <div className="text-caption text-muted-ash">{d.cause.charAt(0).toUpperCase() + d.cause.slice(1)}. The agent handled it inside your rules.</div>
        </div>
      </div>

      <ol className="mt-4 grid gap-2">
        {d.cancelled.map((c) => (
          <li key={c.ref} className="surface-panel rounded-card px-3.5 py-2.5 text-caption">
            <div className="flex items-center gap-2">
              <Tag tone="red">{c.by === "merchant" ? "cancelled" : "changed by the agent"}</Tag>
              <span className="min-w-0 truncate line-through decoration-midnight-ink/40" title={`${c.label} · ${c.ref}`}>
                {c.label}
              </span>
              <span className="ml-auto shrink-0 font-medium num">{usdc(c.refund)} USDC refunded</span>
            </div>
            <div
              className="mt-1 flex items-center gap-1.5 truncate text-[11.5px] text-muted-ash"
              title={`NEAR checked ${name(c.merchant)}'s signature on the cancellation before counting the refund, so the agent can't fake one. A replacement may cost up to ${usdc(c.rebook_max)} USDC without asking you.`}
            >
              <ShieldCheck className="size-3.5 shrink-0 text-sky" />
              <Proof label={`${name(c.merchant)}'s signature checked on NEAR`} hash={c.near_tx} base={near} /> · <Proof label={`Refund on ${on(c.merchant).name}`} hash={c.refund_tx} base={on(c.merchant).explorer} /> · rebook up to {usdc(c.rebook_max)}
            </div>
          </li>
        ))}
        {reasons.map((r) => (
          <li key={r.at} className="flex items-start gap-2 px-1 text-caption text-midnight-ink/80" title={r.text}>
            <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-engagement-gold/30 text-[10px]">?</span>
            <span className="line-clamp-1">The agent: {r.text}</span>
          </li>
        ))}
        {d.rebooked.map((x) => {
          const was = d.cancelled.find((c) => c.item === x.item);
          const pct = was ? Math.round(((x.amount - Number(was.refund)) / Number(was.refund)) * 1000) / 10 : 0;
          return (
            <li key={x.item} className="rounded-card bg-deliver-green/10 px-3.5 py-2.5 text-caption ring-1 ring-deliver-green/30">
              <div className="flex items-center gap-2">
                <Tag tone="green">
                  <RefreshCw className="size-3" strokeWidth={2.5} /> rebooked
                </Tag>
                <span className="min-w-0 truncate font-medium" title={`${x.from} → ${x.to}`}>
                  {x.to}
                </span>
                <span className="ml-auto shrink-0 font-medium num">
                  {usdc(x.amount)} USDC <span className="font-normal text-muted-ash">({pct >= 0 ? "+" : ""}{pct}%, {pct <= (run.rebook_pct ?? 0) ? "within your rule" : "approved by you"})</span>
                </span>
              </div>
              <div className="mt-1 truncate text-[11.5px] text-muted-ash" title={x.ref}>
                <Proof label="Signed on NEAR" hash={x.near_tx} base={near} /> · <Proof label={`Paid on ${on(run.plan!.items[x.item].merchant).name}`} hash={x.settle_tx} base={on(run.plan!.items[x.item].merchant).explorer} />
              </div>
            </li>
          );
        })}
        {d.pending && (
          <li className="flex flex-wrap items-center gap-3 rounded-card bg-engagement-gold/15 px-3.5 py-3 text-caption ring-1 ring-engagement-gold/40">
            <span className="min-w-[220px] flex-1">
              <span className="font-medium">{d.pending.label}</span> costs <span className="font-medium">{usdc(d.pending.amount)} USDC</span>, over your auto-rebook limit of {usdc(d.pending.max)}. NEAR refused to sign it until you say so.
            </span>
            <PillButton disabled={acting || !!run.busy} onClick={onApprove}>
              Approve {usdc(d.pending.amount)} USDC
            </PillButton>
          </li>
        )}
        {working && <li className="shimmer-text px-1 text-caption font-medium">The agent is finding a replacement…</li>}
        {d.status === "failed" && d.note && <li className="px-1 text-caption text-lead-gen-red">{d.note}</li>}
      </ol>
    </motion.div>
  );
}

/** Off-ramp: the unspent budget going back from the trip wallet to the traveler's NEAR savings, swapped by NEAR Intents. */
function ReturnCard({ run, left, acting, onRetry }: { run: Run; left: number; acting: boolean; onRetry: () => void }) {
  const { status } = useStatus();
  const r = run.returned;
  const working = run.busy === "returning";
  const done = !!r?.payout_tx;
  const half = !!r?.settle_tx && !done; // USDC left the trip wallet, the swap to NEAR didn't finish
  return (
    <div className="surface-card mt-4 flex flex-wrap items-center gap-4 rounded-card p-4">
      <StatusDisk tone={done ? "green" : "blue"}>
        <PiggyBank className="size-[18px]" strokeWidth={2} />
      </StatusDisk>
      <div className="min-w-[240px] flex-1">
        {done && r ? (
          <>
            <div className="font-medium">
              {usdc(r.amount)} USDC back as {Number(r.near).toFixed(4)} NEAR in your savings <Tag tone="green">off-ramp</Tag>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(r.legs ?? [{ network: "eip155:84532", chain: "Base", amount: r.amount, near_tx: r.near_tx, settle_tx: r.settle_tx, quote: r.quote }]).map((l) => (
                <a
                  key={l.network}
                  href={l.near_tx && status?.near_explorer_tx ? `${status.near_explorer_tx}${l.near_tx}` : undefined}
                  target="_blank"
                  rel="noreferrer"
                  title={`${usdc(l.amount)} USDC from ${chainOf(status, l.network).tag} → ${l.quote ? Number(l.quote.near).toFixed(4) : "?"} NEAR · signed on NEAR ${l.near_tx ?? ""}`}
                  className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium num hover:underline", chainChip(chainOf(status, l.network).name))}
                >
                  {chainOf(status, l.network).name} {usdc(l.amount)} ↗
                </a>
              ))}
            </div>
            <div className="mt-1.5 text-caption text-muted-ash">
              <Proof label="1 NEAR payout" hash={r.payout_tx!} base={status?.near_explorer_tx ?? ""} /> · priced live by NEAR Intents
              <span
                className="text-muted-ash/80"
                title="The signatures, the quote and the NEAR payout are real. NEAR Intents has no testnet, so the USDC lands at a stand-in deposit address (the Base fork, or the demo pool on NEAR) and the solver's payout comes from the Wayfare contract account."
              >
                {" "}· solver side simulated (no Intents testnet)
              </span>
            </div>
          </>
        ) : working ? (
          <div className="shimmer-text font-medium">
            {half ? "Swapping the USDC to NEAR with NEAR Intents…" : `Returning ${usdc(left)} USDC to your NEAR savings: NEAR signs on each chain, it settles, then NEAR Intents swaps it…`}
          </div>
        ) : half ? (
          <div className="font-medium">{usdc(r!.amount)} USDC left the trip wallet; the swap to NEAR didn&apos;t finish</div>
        ) : left > 0 ? (
          <div className="font-medium">{usdc(left)} USDC of the budget wasn&apos;t spent</div>
        ) : (
          <div className="font-medium">The whole budget was spent: nothing to return</div>
        )}
        {!done && <div className="mt-0.5 text-caption text-muted-ash">The trip wallet can only send it back to you. The NEAR contract signs the transfer; the agent has no say.</div>}
      </div>
      {!done && !working && (half || left > 0) && (
        <PillButton disabled={acting || !!run.busy} onClick={onRetry}>
          {half ? "Finish the swap" : "Return to NEAR savings"}
        </PillButton>
      )}
    </div>
  );
}

export function RunView() {
  const id = useSearchParams().get("id") ?? "";
  const { status } = useStatus();
  const { data: run, error, reload, setData } = usePoll(() => get<Run>(`/api/runs/${id}`), 1200, [id]);
  const [acting, setActing] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);

  const [rebookPct, setRebookPct] = useState(20);
  const act = async (action: string, body?: unknown) => {
    setActing(action);
    setActErr(null);
    try {
      setData(await post<Run>(`/api/runs/${id}/${action}`, body));
    } catch (e) {
      setActErr((e as Error).message);
    } finally {
      setActing(null);
      void reload();
    }
  };

  // runs planned before the on-ramp existed (or whose quote failed) ask for one when shown
  const needQuote = run?.status === "awaiting_approval" && !run.quote && !run.busy;
  useEffect(() => {
    if (needQuote) void post(`/api/runs/${id}/quote`).catch(() => {});
  }, [needQuote, id]);

  if (!run) return <main className="mx-auto w-full max-w-6xl px-4 pt-10 text-body-sm text-muted-ash sm:px-6">{error ?? <span className="shimmer-text">Loading…</span>}</main>;
  const p = run.plan;
  const booked = run.results.filter((r) => r.status === "confirmed" && !r.label.endsWith("(upgrade)"));
  const spent = booked.reduce((s, r) => s + (r.amount ?? 0), 0);
  const left = p ? Math.max(0, p.budget - spent) : 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-10 pb-24 sm:px-6">
      <section>
        <div className="text-caption font-medium text-muted-ash">Your request{run.trip_id ? ` · trip ${run.trip_id} on NEAR` : ""}</div>
        <h1 className="mt-2 max-w-4xl text-[26px] leading-[1.2] font-medium tracking-[-0.02em] sm:text-[32px]">&ldquo;{run.text}&rdquo;</h1>
        {run.request && (
          <p className="mt-3 text-body-sm text-muted-ash">
            Understood as <span className="font-medium text-midnight-ink">{run.request.summary}</span> · {run.request.parsed_by}
            {run.request.not_possible.length > 0 && <span className="text-lead-gen-red"> · can&apos;t book: {run.request.not_possible.join(", ")}</span>}
          </p>
        )}
        <div className="mt-6">
          <Track status={run.status} />
        </div>
        {run.status === "error" && <div className="mt-4 rounded-card bg-lead-gen-red/10 p-4 text-body-sm ring-1 ring-lead-gen-red/20">Stopped: {run.error}</div>}
      </section>

      <section className="mt-6 grid gap-3 lg:grid-cols-[1.45fr_1fr] [&>*]:min-w-0">
        <AgentView run={run} />
        <Feed steps={run.steps} busy={!!run.busy || run.status === "parsing" || run.status === "planning"} />
      </section>

      {p && (
        <section className="mt-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-title font-medium">Your itinerary</h2>
              <p className="mt-1 text-body-sm text-muted-ash">
                {p.items.length} bookings · <span className="font-medium text-midnight-ink">{usdc(p.total)} USDC</span> (≈ {usd(p.total)}){run.request?.budget_usd ? ` of a $${run.request.budget_usd.toLocaleString("en-US")} budget` : ""}
                {p.over_budget && <span className="text-lead-gen-red"> · over budget</span>}
              </p>
            </div>
            {run.trip_id && (
              <div className="text-right text-body-sm text-muted-ash">
                paid <span className="text-[28px] font-medium text-midnight-ink num">{usdc(spent)}</span> of {usdc(p.budget)} USDC
              </div>
            )}
          </div>

          {run.status === "awaiting_approval" && (
            <div className="surface-card mt-5 flex flex-wrap items-center gap-4 rounded-card p-4">
              <StatusDisk tone="blue" solid>
                <Lock className="size-4" strokeWidth={2} />
              </StatusDisk>
              <div className="min-w-[260px] flex-1 text-body-sm text-muted-ash">
                Approving funds the trip and puts the plan on NEAR: a budget of <span className="font-medium text-midnight-ink">{usdc(p.budget)} USDC</span>, these {p.items.length} merchants, and a cap for each booking at its price. The agent can only spend inside it, and it never gets a key. If a merchant cancels a booking, the agent may rebook it for up to{" "}
                <select value={rebookPct} onChange={(e) => setRebookPct(Number(e.target.value))} className="rounded-button bg-whisper-gray px-1.5 py-0.5 font-medium text-midnight-ink">
                  {[0, 10, 20, 30].map((v) => (
                    <option key={v} value={v}>
                      {v}% more
                    </option>
                  ))}
                </select>{" "}
                without asking you.
              </div>
              <PillButton variant="ghost" disabled={!!acting} onClick={() => act("cancel")}>
                Decline
              </PillButton>
              <PillButton disabled={!!acting} onClick={() => act("approve", { rebook_pct: rebookPct })}>
                {acting === "approve" ? "Approving…" : run.quote ? `Fund with ${Number(run.quote.near).toFixed(2)} NEAR & book` : "Approve & book"}
              </PillButton>
              <div className="surface-panel flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-card px-3.5 py-2.5 text-caption">
                <Tag tone="blue">on-ramp</Tag>
                {run.quote ? (
                  <span>
                    <span className="font-medium">{Number(run.quote.near).toFixed(4)} NEAR</span> from your NEAR savings buys{" "}
                    {(run.quote.legs ?? [{ network: "eip155:84532", chain: "Base", usdc: run.quote.usdc_out }]).map((l, k) => (
                      <span key={l.network}>
                        {k > 0 && " + "}
                        <span className="font-medium">{usdc(l.usdc)} USDC</span> on {l.chain}
                      </span>
                    ))}{" "}
                    for the trip wallet · ≈ ${run.quote.usd_in} · ~{run.quote.time_estimate_sec}s
                  </span>
                ) : (
                  <span className="shimmer-text">Getting a live NEAR Intents quote…</span>
                )}
                <span className="ml-auto text-muted-ash">live NEAR Intents quote</span>
              </div>
            </div>
          )}

          {run.funded && <FundCard f={run.funded} />}

          <div className="mt-5 grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
            {p.items.map((_, i) => (
              <Item key={i} run={run} i={i} results={run.results.filter((r) => r.item === i)} />
            ))}
          </div>

          {run.trip_id && run.status === "booked" && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {p.items.some((i) => i.kind === "flight") && (
                <PillButton variant="secondary" disabled={!!acting || !!run.busy || !!run.ended_tx || (!!run.disruption && run.disruption.status !== "failed")} onClick={() => act("disrupt")}>
                  <CloudLightning className="size-4" /> {run.busy === "rebooking" ? "Rebooking…" : run.disruption ? "Flight cancelled" : "Kumo Air cancels the flight"}
                </PillButton>
              )}
              {p.items.some((i) => i.kind === "hotel") && (
                <PillButton variant="secondary" disabled={!!acting || !!run.busy || !!run.ended_tx} onClick={() => act("upgrade")}>
                  {run.busy === "upgrading" ? "The agent is trying…" : "Let the agent try a pricier room"}
                </PillButton>
              )}
              <PillButton variant="danger" disabled={!!acting || !!run.busy || !!run.ended_tx} onClick={() => act("end")}>
                {run.ended_tx ? "Trip ended" : acting === "end" ? "Ending…" : left > 0 ? `End trip & return ${usdc(left)} USDC` : "End trip"}
              </PillButton>
              <span className="text-caption text-muted-ash">Ending revokes the agent (no more payments or vault reads) and sends the unspent budget back to your NEAR savings.</span>
            </div>
          )}
          {run.disruption && <DisruptionCard run={run} d={run.disruption} acting={!!acting} onApprove={() => act("approve-rebook")} />}
          {run.ended_tx && <ReturnCard run={run} left={left} acting={!!acting} onRetry={() => act("return")} />}
          {actErr && <p className="mt-3 text-caption text-lead-gen-red">{actErr}</p>}
        </section>
      )}

      {run.trip_id && run.status === "booked" && <TripFlow run={run} />}

      {run.trip_id && <ChainRecord tripId={run.trip_id} approveTx={run.approve_tx} nearExplorer={status?.near_explorer_tx ?? ""} />}
    </main>
  );
}
