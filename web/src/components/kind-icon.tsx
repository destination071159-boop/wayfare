import { BedDouble, Plane, TrainFront, UtensilsCrossed } from "lucide-react";

const ICONS = { flight: Plane, train: TrainFront, hotel: BedDouble, dinner: UtensilsCrossed } as const;

export function KindIcon({ kind, size = 18, className }: { kind: string; size?: number; className?: string }) {
  const I = ICONS[kind as keyof typeof ICONS] ?? Plane;
  return <I size={size} strokeWidth={1.7} className={className} />;
}
