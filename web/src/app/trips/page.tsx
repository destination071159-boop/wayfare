"use client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { KindIcon } from "@/components/kind-icon";
import { Tag } from "@/components/ui";
import { get } from "@/lib/api";
import { usd, usdc } from "@/lib/format";
import type { RunSummary } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";

const TONE = { booked: "green", awaiting_approval: "blue", error: "red", cancelled: "neutral" } as const;

export default function Trips() {
  const { data: runs } = usePoll(() => get<RunSummary[]>("/api/runs"), 5000);
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-10 pb-24 sm:px-6">
      <div className="text-caption font-medium text-muted-ash">Every trip the agent planned</div>
      <h1 className="display-tight mt-2 text-[48px] leading-[1.05] font-medium">Trips</h1>
      <div className="mt-8 grid gap-2">
        {(runs ?? []).map((r) => (
          <Link key={r.id} href={`/run?id=${r.id}`} className="surface-card grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-card px-4 py-3.5 transition-shadow hover:shadow-button sm:grid-cols-[auto_1fr_auto_auto_auto]">
            <span className="flex gap-1 text-muted-ash">
              {(["flight", "train", "hotel", "dinner"] as const).map((k) => (
                <KindIcon key={k} kind={k} size={14} />
              ))}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-body-sm font-medium">{r.summary ?? r.text}</span>
              <span className="block font-mono text-[11px] text-muted-ash">{r.id.replace("T", " ").slice(0, 16)}</span>
            </span>
            <span className="hidden text-caption text-muted-ash num sm:block">{r.total ? `${usdc(r.total)} USDC · ≈ ${usd(r.total)}` : ""}</span>
            <Tag tone={TONE[r.status as keyof typeof TONE] ?? "gold"}>{r.trip_id ? `trip ${r.trip_id} · ${r.booked} booked` : r.status.replace("_", " ")}</Tag>
            <ChevronRight className="hidden size-4 text-muted-ash sm:block" />
          </Link>
        ))}
        {runs?.length === 0 && <p className="text-body-sm text-muted-ash">No trips yet.</p>}
      </div>
    </main>
  );
}
