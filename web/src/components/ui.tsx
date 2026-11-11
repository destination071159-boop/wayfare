"use client";
import clsx from "clsx";
import { motion } from "motion/react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/** Sprout's action button: Midnight Ink fill for CTAs, 8px radius, a small spring on hover. */
export function PillButton({ variant = "primary", className, ...props }: React.ComponentProps<typeof motion.button> & { variant?: Variant }) {
  return (
    <motion.button
      whileHover={{ scale: props.disabled ? 1 : 1.03 }}
      whileTap={{ scale: props.disabled ? 1 : 0.97 }}
      transition={{ type: "spring", visualDuration: 0.2, bounce: 0.3 }}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-button px-4 py-2 text-body-sm font-medium transition-colors disabled:pointer-events-none",
        variant === "primary" && "bg-sky text-canvas-white shadow-button hover:bg-sky-deep disabled:bg-light-taupe disabled:text-muted-ash",
        variant === "secondary" && "bg-whisper-gray text-midnight-ink ring-1 ring-hairline hover:bg-canvas-white disabled:opacity-50",
        variant === "ghost" && "text-muted-ash hover:text-midnight-ink disabled:opacity-50",
        variant === "danger" && "bg-lead-gen-red/12 text-midnight-ink ring-1 ring-lead-gen-red/25 hover:bg-lead-gen-red/20 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

type Tone = "neutral" | "green" | "gold" | "red" | "blue";

/** Small uppercase status chip. Tinted backgrounds, Midnight Ink text. */
export function Tag({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-card px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase tabular-nums",
        tone === "neutral" && "bg-midnight-ink/[0.06] text-muted-ash",
        tone === "green" && "bg-deliver-green/15 text-midnight-ink",
        tone === "gold" && "bg-engagement-gold/25 text-midnight-ink",
        tone === "red" && "bg-lead-gen-red/15 text-midnight-ink",
        tone === "blue" && "bg-intelligence-blue/12 text-midnight-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Circle that holds an icon in a status row. */
export function StatusDisk({ tone = "neutral", solid = false, className, children }: { tone?: Tone; solid?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
        !solid && tone === "neutral" && "bg-whisper-gray text-midnight-ink",
        !solid && tone === "green" && "bg-deliver-green/15 text-midnight-ink",
        !solid && tone === "gold" && "bg-engagement-gold/20 text-midnight-ink",
        !solid && tone === "red" && "bg-lead-gen-red/15 text-lead-gen-red",
        !solid && tone === "blue" && "bg-intelligence-blue/12 text-intelligence-blue",
        solid && tone === "neutral" && "bg-midnight-ink text-canvas-white",
        solid && tone === "green" && "bg-deliver-green text-midnight-ink",
        solid && tone === "gold" && "bg-engagement-gold text-midnight-ink",
        solid && tone === "red" && "bg-lead-gen-red text-canvas-white",
        solid && tone === "blue" && "bg-intelligence-blue text-canvas-white",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A section label in Sprout's voice: small, medium weight, muted. */
export function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx("text-caption font-medium text-muted-ash", className)}>{children}</div>;
}
