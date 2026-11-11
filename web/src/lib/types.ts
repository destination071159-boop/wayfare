export type Kind = "flight" | "train" | "hotel" | "dinner";
export type Step = { at: string; kind: string; text: string; data?: unknown };
export type PlannedItem = { kind: Kind; merchant: string; label: string; choice: string; form_url: string; total: number; reason: string; decided_by: string };
export type TripRequest = { summary: string; travelers: number; budget_usd: number | null; not_possible: string[]; parsed_by: string };
export type Plan = { request: TripRequest; items: PlannedItem[]; total: number; budget: number; over_budget: boolean };
export type Booked = { item: number; label: string; status: "confirmed" | "refused" | "failed" | "cancelled"; ref?: string; amount?: number; reason?: string; near_tx?: string; settle_tx?: string; booking_url?: string; network?: string };
export type ReturnQuote = { usdc_in: string; near_out: string; near: string; usd: string; time_estimate_sec: number; source: string; at: string };
export type ReturnLeg = { network: string; chain: string; amount: string; payment_id?: string; near_tx: string; settle_tx?: string; quote?: ReturnQuote };
export type Returned = { legs?: ReturnLeg[]; amount: string; to: string; payment_id?: string; near_tx: string; settle_tx?: string; quote?: ReturnQuote; near?: string; payout_tx?: string; account?: string; at: string };
export type Leg = { network: string; chain: string; usdc: string; near: string; near_in: string; usd_in: string; before?: string; after?: string };
export type Quote = { legs?: Leg[]; usdc_out: string; near_in: string; near: string; usd_in: string; time_estimate_sec: number; source: string; at: string };
export type Funded = { legs?: Leg[]; usdc: string; near: string; near_in: string; near_tx: string; deposit_to: string; quote: Quote; before: string; after: string; at: string };
/** As the contract records it (get_trip). */
export type ChainCancellation = { item: number; payment_id: string; merchant_id: string; booking_ref: string; refund: string; refund_tx: string; rebook_max: string; at: string };
export type Cancelled = { item: number; merchant: string; label: string; ref: string; by: "merchant" | "customer"; reason: string; refund: string; refund_tx: string; near_tx: string; rebook_max: string; at: string };
export type Rebooked = { item: number; from: string; to: string; amount: number; ref?: string; near_tx?: string; settle_tx?: string };
export type Disruption = {
  cause: string;
  status: "handling" | "needs_approval" | "rebooked" | "failed";
  cancelled: Cancelled[];
  rebooked: Rebooked[];
  pending?: { item: number; label: string; amount: number; max: string; reason: string };
  note?: string;
  started_at: string;
};
export type RunStatus = "parsing" | "planning" | "awaiting_approval" | "booking" | "booked" | "cancelled" | "error";
export type Run = {
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
  rebook_pct?: number;
  disruption?: Disruption;
  error?: string;
  steps: Step[];
  shots: string[];
};
export type RunSummary = { id: string; text: string; status: RunStatus; summary?: string; trip_id?: string; total?: number; created_at: string; booked: number };
export type Status = {
  contract: string;
  traveler: string;
  agent: string;
  wallet: { address: string; path: string } | null;
  balance: string | null;
  /** the trip wallet on each chain; NEAR's has its own (implicit) account */
  chains?: { id: string; name: string; label: string; balance: string | null; explorer_tx: string; account?: string }[];
  savings: { account: string; near: string } | null;
  chain: { mode: "local" | "live"; label: string; explorer_tx: string };
  near_explorer_tx: string;
  brain: string;
  merchants: { id: string; name: string; category: string; url: string; network?: string; chain?: string }[];
  busy: { run: string; what: string } | null;
};
export type ChainTrip = {
  trip: { id: string; phase: "active" | "expired" | "ended"; budget: string; spent: string; refusals: number; receipt_head: string; plan_hash: string; rebook_pct?: number; cancellations?: ChainCancellation[]; items: { merchant_id: string; label: string; max: string; paid: string }[]; expires_at: string } | null;
  payments: { id: string; item: number | null; merchant_id: string | null; amount: string; status: "pending" | "signed" | "failed"; digest: string; signature: string | null; settled_tx: string | null; authorization: { from: string; to: string; nonce: string } }[];
  reads: { id: string; fields: string[]; purpose: string; at: string }[];
};
