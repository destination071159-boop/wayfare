// Disruptions: a merchant cancels a booking (a cancelled flight), or the agent has to change one (a train the new
// flight no longer connects to). Either way the merchant refunds the USDC to the trip wallet and signs a
// cancellation notice with its payment key. The agent hands that notice to the Wayfare contract
// (`record_cancellation`), which checks the signature against the merchant's registered address before the refund
// counts: only then may the agent rebook, for up to the item's price plus the traveler's auto-rebook margin.
import type { Account } from "near-api-js";
import type { Booked } from "./booker.js";
import { call, view } from "./near.js";

export type Cancelled = {
  item: number;
  merchant: string;
  label: string;
  ref: string;
  by: "merchant" | "customer";
  reason: string;
  refund: string;
  refund_tx: string;
  /** NEAR tx of record_cancellation: the contract verified the merchant's signature */
  near_tx: string;
  /** the most the replacement may cost without asking the traveler */
  rebook_max: string;
  at: string;
};

export type Rebooked = { item: number; from: string; to: string; amount: number; ref?: string; near_tx?: string; settle_tx?: string };

export type Disruption = {
  cause: string;
  status: "handling" | "needs_approval" | "rebooked" | "failed";
  cancelled: Cancelled[];
  rebooked: Rebooked[];
  /** a replacement over the auto-rebook limit, waiting for the traveler */
  pending?: { item: number; label: string; amount: number; max: string; reason: string };
  note?: string;
  started_at: string;
};

type Notice = { ref: string; paid_tx: string; refund: string; refund_tx: string; signature: string; reason: string; by: "merchant" | "customer" };

/** Asks the merchant's site to cancel and refund a booking; returns its signed notice. */
export async function requestCancellation(booking: Booked, by: "merchant" | "customer", reason: string): Promise<Notice> {
  if (!booking.booking_url) throw new Error(`no booking page for ${booking.label}`);
  const u = new URL(booking.booking_url);
  const id = u.searchParams.get("id");
  const r = await fetch(`${u.origin}/api/bookings/${id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by, reason }) });
  const body = (await r.json()) as Notice & { error?: string };
  if (!r.ok) throw new Error(`the merchant could not cancel ${booking.ref}: ${body.error ?? r.status}`);
  return body;
}

/** Hands the merchant's signed notice to the contract; returns the new rebooking limit. */
export async function recordOnNear(bot: Account, tripId: string, booking: Booked, merchant: string, n: Notice): Promise<Cancelled> {
  const payments = await view<{ id: string; settled_tx?: string }[]>("get_trip_payments", { trip_id: tripId });
  const p = payments.find((x) => x.settled_tx?.toLowerCase() === n.paid_tx.toLowerCase());
  if (!p) throw new Error(`no payment on NEAR settled with ${n.paid_tx}`);
  const { value, tx } = await call<{ rebook_max: string }>(bot, "record_cancellation", {
    trip_id: tripId,
    payment_id: p.id,
    booking_ref: n.ref,
    refund: n.refund,
    refund_tx: n.refund_tx,
    signature: n.signature,
  });
  return { item: booking.item, merchant, label: booking.label, ref: n.ref, by: n.by, reason: n.reason, refund: n.refund, refund_tx: n.refund_tx, near_tx: tx, rebook_max: value.rebook_max, at: new Date().toISOString() };
}
