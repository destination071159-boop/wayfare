"use client";
import { ArrowRight, ArrowUp, Check, ChevronRight, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, useState } from "react";
import { KindIcon } from "@/components/kind-icon";
import { StatusDisk, Tag } from "@/components/ui";
import { WalletCard } from "@/components/wallet-card";
import { get, post } from "@/lib/api";
import { KIND_LABEL, usd, usdc } from "@/lib/format";
import { useStatus } from "@/lib/status";
import type { Run, RunSummary } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";

const EXAMPLES = [
  { label: "Bangkok → Kyoto", text: "Fly me from Bangkok to Kyoto on 2026-11-19 for 2 nights, a ryokan near Gion if possible, and a sushi dinner for two on the 21st. Budget $1,000." },
  { label: "Singapore → Tokyo", text: "Singapore to Tokyo on 2026-12-04, 3 nights somewhere cheap, and yakitori around 7pm on the second night. Under $900." },
  { label: "Seoul → Kyoto", text: "Seoul to Osaka on 2026-11-27, 2 nights in Kyoto, take the train there, and a kaiseki dinner on the 28th." },
];

const STEPS = [
  { t: "You ask", d: "In plain words. The AI turns it into a trip request." },
  { t: "It plans", d: "The agent opens each booking site in a real browser and compares options and prices." },
  { t: "You approve once", d: "The plan goes on NEAR: a budget, the merchants, and a price cap for every item." },
  { t: "It books and pays", d: "Each checkout asks for an x402 payment. The NEAR contract checks the rules and signs the USDC, or refuses." },
];

const rise = (delay: number) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { type: "spring" as const, visualDuration: 0.7, bounce: 0.1, delay } });

/** The most recent booked trip, shown as the product itself: four bookings and what NEAR signed. */
function TripPreview({ runId }: { runId?: string }) {
  const { data: run } = usePoll(() => (runId ? get<Run>(`/api/runs/${runId}`) : Promise.resolve(null)), 15000, [runId]);
  const p = run?.plan;
  if (!run || !p) {
    return <div className="surface-card hidden h-[420px] rounded-card lg:block" />;
  }
  const done = (i: number) => run.results.find((r) => r.item === i && r.status === "confirmed" && !r.label.endsWith("(upgrade)"));
  const refused = run.results.filter((r) => r.label.endsWith("(upgrade)") && r.status !== "confirmed").length;
  const spent = p.items.reduce((s, _, i) => s + (done(i)?.amount ?? 0), 0);
  return (
    <div className="surface-card rounded-card p-5 shadow-header">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-caption text-muted-ash">Latest trip · trip {run.trip_id} on NEAR</div>
          <div className="mt-0.5 truncate text-body-lg font-medium tracking-[-0.01em]">{run.request?.summary ?? "Your trip"}</div>
        </div>
        <Tag tone="green">
          <Check className="size-3" strokeWidth={3} /> booked
        </Tag>
      </div>
      <div className="mt-4 divide-y divide-hairline">
        {p.items.map((it, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            <StatusDisk tone={done(i) ? "blue" : "neutral"} className="size-8">
              <KindIcon kind={it.kind} size={15} />
            </StatusDisk>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body-sm font-medium">{it.label}</div>
              <div className="truncate text-caption text-muted-ash">
                {KIND_LABEL[it.kind]} · {it.merchant} {done(i)?.ref ? `· ${done(i)!.ref}` : ""}
              </div>
            </div>
            <span className="text-body-sm num">{usdc(it.total)}</span>
          </div>
        ))}
      </div>
      <div className="surface-panel mt-3 rounded-card p-3.5">
        <div className="flex items-center justify-between text-caption">
          <span className="flex items-center gap-1.5 font-medium">
            <ShieldCheck className="size-3.5 text-sky" /> Signed by the NEAR contract
          </span>
          <span className="num">
            {usdc(spent)} <span className="text-muted-ash">/ {usdc(p.budget)} USDC</span>
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas-white">
          <div className="h-full rounded-full bg-sky" style={{ width: `${Math.min(100, (spent / Math.max(1, p.budget)) * 100)}%` }} />
        </div>
        {refused > 0 && <div className="mt-2 text-caption text-muted-ash">{refused} payment over the cap refused, on chain.</div>}
      </div>
      <Link href={`/run?id=${run.id}`} className="mt-4 flex items-center gap-1 text-body-sm font-medium text-sky hover:text-sky-deep">
        Open this trip <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const { status } = useStatus();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data: runs } = usePoll(() => get<RunSummary[]>("/api/runs"), 6000);
  const latest = runs?.find((r) => r.trip_id && r.booked > 0);
  const blocked = busy || !!status?.busy;

  const go = async () => {
    if (text.trim().length < 8 || blocked) return;
    setBusy(true);
    setErr(null);
    try {
      const { id } = await post<{ id: string }>("/api/runs", { text });
      router.push(`/run?id=${id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void go();
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
      <section className="grid grid-cols-1 items-center gap-10 pt-12 pb-16 lg:min-h-[calc(100vh-64px)] lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pt-0 [&>*]:min-w-0">
        <div>
          <motion.div {...rise(0.05)} className="flex items-center gap-2 text-caption font-medium text-sky">
            <span className="size-1.5 rounded-full bg-sky" /> AI travel agent · payments guarded by NEAR
          </motion.div>
          <motion.h1 {...rise(0.12)} className="display-tight mt-4 text-[clamp(36px,4.3vw,58px)] leading-[1.04] font-medium text-balance">
            Your trip, booked and paid.
            <span className="mt-2 block text-[0.62em] leading-[1.1] tracking-[-0.03em] text-muted-ash">The agent never touches your money.</span>
          </motion.h1>
          <motion.p {...rise(0.22)} className="mt-5 max-w-xl text-body text-muted-ash">
            Flights, trains, hotels and dinner, booked in a real browser and paid with x402 on any chain. A NEAR contract signs each payment, and only inside the plan you approved.
          </motion.p>

          <motion.div {...rise(0.32)} className="mt-7 max-w-xl">
            <div className="flex flex-col gap-1 rounded-card bg-canvas-white p-2 shadow-button ring-1 ring-hairline transition-[box-shadow] focus-within:ring-sky/40">
              <textarea
                value={text}
                rows={2}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                placeholder="Bangkok to Kyoto next month, 2 nights near Gion, sushi for two…"
                className="w-full resize-none border-0 bg-transparent px-3 py-2 text-body leading-[1.5] text-midnight-ink placeholder:text-muted-ash/70 focus:outline-none disabled:opacity-50"
              />
              <div className="flex items-center justify-between gap-2 pl-3">
                <span className="truncate text-caption text-muted-ash">{status ? `plans with ${status.brain}` : ""}</span>
                <motion.button
                  whileHover={{ scale: blocked ? 1 : 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={go}
                  disabled={blocked || text.trim().length < 8}
                  className="inline-flex items-center gap-1.5 rounded-button bg-sky px-3.5 py-2 text-body-sm font-medium text-canvas-white transition-colors hover:bg-sky-deep disabled:bg-light-taupe disabled:text-muted-ash"
                >
                  {busy ? "Starting…" : "Plan my trip"} <ArrowUp className="size-4 rotate-45" strokeWidth={2.2} />
                </motion.button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-caption text-muted-ash">Try</span>
              {EXAMPLES.map((e) => (
                <button key={e.label} onClick={() => setText(e.text)} className="rounded-full bg-canvas-white/80 px-3 py-1 text-caption text-midnight-ink ring-1 ring-hairline transition-colors hover:ring-sky/40">
                  {e.label}
                </button>
              ))}
            </div>
            {status?.busy && (
              <p className="mt-3 text-caption text-muted-ash">
                The agent is busy {status.busy.what} another trip.{" "}
                <Link className="font-medium text-sky underline" href={`/run?id=${status.busy.run}`}>
                  Watch it
                </Link>
              </p>
            )}
            {err && <p className="mt-3 text-caption text-lead-gen-red">{err}</p>}
          </motion.div>
        </div>

        <motion.div {...rise(0.4)}>
          <TripPreview runId={latest?.id} />
        </motion.div>
      </section>

      <section>
        <h2 className="text-title font-medium">How it works</h2>
        <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.t} className="border-t border-midnight-ink/10 pt-4">
              <div className="text-caption font-medium text-sky num">0{i + 1}</div>
              <div className="mt-2 text-body font-medium">{s.t}</div>
              <p className="mt-1 text-body-sm text-muted-ash">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr] [&>*]:min-w-0">
        <WalletCard />
        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="text-title font-medium">Recent trips</h2>
            <Link href="/trips" className="flex items-center text-body-sm font-medium text-sky hover:text-sky-deep">
              All trips <ChevronRight className="size-4" />
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-2 [&>*]:min-w-0">
            {(runs ?? []).slice(0, 5).map((r) => (
              <Link key={r.id} href={`/run?id=${r.id}`} className="surface-card flex items-center gap-3 rounded-card px-4 py-3 transition-shadow hover:shadow-button">
                <span className="min-w-0 flex-1 truncate text-body-sm">{r.summary ?? r.text}</span>
                {r.total ? <span className="text-caption text-muted-ash num">≈ {usd(r.total)}</span> : null}
                <Tag tone={r.trip_id ? "green" : r.status === "error" ? "red" : "neutral"}>{r.trip_id ? `${r.booked} booked` : r.status.replace("_", " ")}</Tag>
              </Link>
            ))}
            {runs?.length === 0 && <p className="text-body-sm text-muted-ash">No trips yet. Ask for one above.</p>}
          </div>
        </div>
      </section>
      <p className="mt-12 text-caption text-muted-ash">Booking sites are fictional demo merchants. Prices are 1/100 of real prices, paid in test USDC. The NEAR side is real testnet.</p>
    </main>
  );
}
