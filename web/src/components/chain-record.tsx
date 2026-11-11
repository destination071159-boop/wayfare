"use client";
import clsx from "clsx";
import { BookLock, CircleCheck, CircleX, ExternalLink } from "lucide-react";
import { StatusDisk, Tag } from "@/components/ui";
import { get } from "@/lib/api";
import { short, usdc } from "@/lib/format";
import type { ChainTrip } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";

/** What NEAR says about the trip: limits, payments it signed, vault reads, refusals, receipt chain head. */
export function ChainRecord({ tripId, approveTx, nearExplorer }: { tripId: string; approveTx?: string; nearExplorer: string }) {
  const { data } = usePoll(() => get<ChainTrip>(`/api/trips/${tripId}`), 3000, [tripId]);
  const t = data?.trip;
  if (!t) return null;
  const pct = Math.min(100, (Number(t.spent) / Math.max(1, Number(t.budget))) * 100);
  return (
    <section className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-title font-medium">On-chain record</h2>
          <p className="mt-1 max-w-2xl text-body-sm text-muted-ash">Read live from the Wayfare contract on NEAR: every payment it signed or refused, every vault read, folded into one hash chain anyone can re-check.</p>
        </div>
        <div className="flex items-center gap-2">
          <Tag tone={t.phase === "active" ? "green" : "neutral"}>trip {t.phase}</Tag>
          {t.refusals > 0 && <Tag tone="red">{t.refusals} refused</Tag>}
          {approveTx && (
            <a className="flex items-center gap-1 text-caption font-medium text-sky hover:text-sky-deep" target="_blank" rel="noreferrer" href={`${nearExplorer}${approveTx}`}>
              approval tx <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <div className="surface-card rounded-card p-5">
          <div className="text-caption font-medium text-muted-ash">Signed so far</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="display-tight text-[40px] leading-none font-medium num">{usdc(t.spent)}</span>
            <span className="text-body-sm text-muted-ash">/ {usdc(t.budget)} USDC</span>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-whisper-gray">
            <div className="h-full rounded-full bg-sky" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-5 space-y-2">
            {t.items.map((it, i) => (
              <div key={i} className="flex justify-between gap-4 text-caption">
                <span className="truncate text-muted-ash">{it.label}</span>
                <span className="shrink-0 num">
                  {usdc(it.paid)} <span className="text-muted-ash">/ {usdc(it.max)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="surface-card rounded-card p-5">
          <div className="text-caption font-medium text-muted-ash">Payments the contract signed</div>
          <div className="mt-3 space-y-2">
            {data.payments.map((p) => (
              <div key={p.id} className="surface-panel flex items-center gap-3 rounded-card px-3 py-2.5">
                <StatusDisk tone={p.status === "signed" ? "green" : "red"} className="size-7">
                  {p.status === "signed" ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
                </StatusDisk>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2 text-body-sm">
                    <span className="truncate font-medium">
                      {p.merchant_id ?? "withdraw"}
                      {data.trip?.cancellations?.some((c) => String(c.payment_id) === String(p.id)) && <span className="ml-2 rounded-full bg-deliver-green/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">refunded</span>}
                    </span>
                    <span className={clsx("num", data.trip?.cancellations?.some((c) => String(c.payment_id) === String(p.id)) && "text-muted-ash line-through")}>{usdc(p.amount)}</span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-ash">
                    to {short(p.authorization.to, 4)}
                    {p.settled_tx && <> · settled {short(p.settled_tx, 4)}</>}
                  </div>
                </div>
              </div>
            ))}
            {data.payments.length === 0 && <div className="text-body-sm text-muted-ash">None yet.</div>}
          </div>
        </div>

        <div className="surface-card flex flex-col rounded-card p-5">
          <div className="text-caption font-medium text-muted-ash">Vault reads</div>
          <div className="mt-3 mb-4 flex-1 space-y-2">
            {data.reads.map((r) => (
              <div key={r.id} className="flex items-start gap-3 text-body-sm">
                <BookLock className="mt-0.5 size-4 shrink-0 text-muted-ash" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.fields.join(", ")}</span>
                  <span className="block text-caption text-muted-ash">{r.purpose}</span>
                </span>
              </div>
            ))}
            {data.reads.length === 0 && <div className="text-body-sm text-muted-ash">None yet.</div>}
          </div>
          <div className="surface-panel rounded-card p-3">
            <div className="text-caption text-muted-ash">Receipt chain head</div>
            <div className="mt-1 font-mono text-[11px] [overflow-wrap:anywhere]">{t.receipt_head}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
