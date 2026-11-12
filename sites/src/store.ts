// Bookings for a demo merchant, kept in memory and saved to wayfare/.data/<site>.json.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.data");

export type Booking = {
  id: string;
  ref: string;
  site: string;
  /** what was booked, for people and agents reading it */
  title: string;
  detail: Record<string, string | number>;
  guest: Record<string, string>;
  /** USDC base units */
  total: string;
  status: "awaiting_payment" | "confirmed" | "expired" | "cancelled";
  created_at: number;
  hold_until: number;
  payment?: { transaction: string; payer?: string; network: string; at: number };
  last_error?: string;
  /** set when the merchant cancels a paid booking and refunds it */
  cancellation?: { reason: string; by: "merchant" | "customer"; refund: string; refund_tx: string; message: string; signature: string; at: number };
};

export class Store {
  private file: string;
  private all = new Map<string, Booking>();

  constructor(private site: string, private refPrefix: string) {
    fs.mkdirSync(DATA, { recursive: true });
    this.file = path.join(DATA, `${site}.json`);
    try {
      for (const b of JSON.parse(fs.readFileSync(this.file, "utf8")) as Booking[]) this.all.set(b.id, b);
    } catch {}
  }

  private save() {
    fs.writeFileSync(this.file, JSON.stringify([...this.all.values()], null, 1));
  }

  create(b: Pick<Booking, "title" | "detail" | "guest" | "total">, holdMin = 15): Booking {
    const id = crypto.randomBytes(5).toString("hex");
    const ref = `${this.refPrefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const now = Date.now();
    const booking: Booking = { ...b, id, ref, site: this.site, status: "awaiting_payment", created_at: now, hold_until: now + holdMin * 60_000 };
    this.all.set(id, booking);
    this.save();
    return booking;
  }

  get(id: string): Booking | undefined {
    const b = this.all.get(id);
    if (b && b.status === "awaiting_payment" && Date.now() > b.hold_until) {
      b.status = "expired";
      this.save();
    }
    return b;
  }

  update(id: string, f: (b: Booking) => void) {
    const b = this.all.get(id);
    if (!b) return;
    f(b);
    this.save();
  }

  /** "/api/bookings/<id>/pay" → id */
  static idFromPath(p: string) {
    return p.split("/")[3] ?? "";
  }
}
