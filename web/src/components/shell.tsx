"use client";
import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GradientField } from "@/components/gradient-field";
import { useStatus } from "@/lib/status";
import { REPLAY } from "@/lib/api";

/** Paper-plane mark in a sky-blue tile. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-button bg-sky text-canvas-white" style={{ width: size, height: size }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M2.6 10.9 20.4 3.2c.7-.3 1.4.4 1.1 1.1l-7.7 17.8c-.3.8-1.4.7-1.6-.1l-1.9-7.1-7.1-1.9c-.8-.2-.9-1.3-.1-1.6Z" fill="currentColor" />
        <path d="m10.3 13.7 4.6-4.6" stroke="#1769e0" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

const TABS = [
  { href: "/", label: "Plan a trip", on: (p: string) => p === "/" || p === "/run" },
  { href: "/trips", label: "Trips", on: (p: string) => p.startsWith("/trips") },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { status, error } = useStatus();
  const online = !!status && !error;
  return (
    <>
      <GradientField mode={path === "/" ? "bright" : "dim"} />
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark />
            <span className="text-[19px] font-semibold tracking-[-0.02em]">Wayfare</span>
          </Link>
          <nav className="flex items-center gap-1">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} className={clsx("relative px-3 py-5 text-body-sm transition-colors", t.on(path) ? "font-medium text-midnight-ink" : "text-muted-ash hover:text-midnight-ink")}>
                {t.label}
                {t.on(path) && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-sky" />}
              </Link>
            ))}
          </nav>
          <span className="ml-auto hidden items-center gap-2 text-caption text-muted-ash sm:flex">
            <span className={clsx("size-1.5 rounded-full", online ? "live-dot bg-deliver-green" : "bg-lead-gen-red")} />
            {REPLAY && status ? (
              <>
                replay · NEAR testnet · <span className="font-mono text-[11px] text-midnight-ink">{status.contract}</span>
              </>
            ) : online ? (
              <>
                NEAR testnet · <span className="font-mono text-[11px] text-midnight-ink">{status.contract}</span>
              </>
            ) : (
              "agent offline"
            )}
          </span>
        </div>
      </header>
      {REPLAY && (
        <div className="relative z-30 border-b border-hairline bg-sky px-4 py-2 text-center text-caption text-canvas-white">
          Replay of real trips on NEAR testnet: every payment, refund and refusal links to its transaction. Buttons are off here: run Wayfare locally (<span className="font-mono">pnpm demo</span>) to book your own.
        </div>
      )}
      <div className="relative z-20 flex w-full flex-1 flex-col">
        {!status && error && (
          <div className="mx-auto mt-8 w-full max-w-6xl px-4 sm:px-6">
            <div className="surface-card rounded-card p-5 text-body-sm text-muted-ash">
              The agent isn&apos;t running. Start it from the <span className="font-medium text-midnight-ink">wayfare</span> folder with <span className="font-mono text-midnight-ink">pnpm demo</span>; this page connects on its own.
            </div>
          </div>
        )}
        {children}
      </div>
    </>
  );
}
