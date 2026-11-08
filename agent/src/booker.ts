// The booker: for each approved item, the browser opens the chosen option, fills the guest form with vault fields
// (each read logged on NEAR first), submits it, then pays the merchant's x402 checkout through the Wayfare contract
// and waits for the site to confirm.
import type { Account } from "near-api-js";
import type { Activity } from "./activity.js";
import type { Browser } from "./browser.js";
import { railLabel } from "./chains.js";
import { merchantChain, txLink } from "./merchants.js";
import { call } from "./near.js";
import { fmt, type PlannedItem } from "./planner.js";
import { readFields } from "./vault.js";
import { PaymentRefused, payX402 } from "./x402-near.js";

export type Booked = { item: number; label: string; status: "confirmed" | "refused" | "failed" | "cancelled"; ref?: string; amount?: number; reason?: string; near_tx?: string; settle_tx?: string; booking_url?: string; network?: string };

const VAULT_FIELDS = ["full_name", "passport_no", "email"];

/** Fills and submits the guest form; returns the booking page's payment details. */
async function submitGuestForm(b: Browser, agent: Account, tripId: string, it: PlannedItem, act: Activity, tag: string) {
  await b.open(it.form_url);
  const needed = await b.json<string[]>(`return [...document.querySelectorAll("form[method=post] input[required]")].map(i => i.name);`);
  const fields = needed.filter((f) => VAULT_FIELDS.includes(f));
  const { values, tx } = await readFields(agent, tripId, fields, `${it.merchant} guest form`);
  act.add("vault", `read ${fields.join(", ")} for ${it.merchant} (logged on NEAR, tx ${tx.slice(0, 10)}…)`);
  for (const f of fields) await b.fill(`form[method=post] [name="${f}"]`, values[f]);
  await b.screenshot(act.file(`book-${tag}-form.png`));
  await b.click("#continue");
  await b.wait("#payment");
  await b.screenshot(act.file(`book-${tag}-pay.png`));
  const pay = await b.json<{ endpoint: string; amount: string; status: string }>(`const p = document.getElementById("payment"); return { endpoint: p.dataset.x402Endpoint, amount: p.dataset.amount, status: p.dataset.status };`);
  return { pay, bookingUrl: await b.url() };
}

export async function book(b: Browser, agent: Account, tripId: string, index: number, it: PlannedItem, act: Activity, opts: { formUrl?: string } = {}): Promise<Booked> {
  const target = { ...it, form_url: opts.formUrl ?? it.form_url };
  const tag = opts.formUrl ? `${it.kind}-upgrade` : it.kind;
  act.add("book", `${it.merchant}: ${it.label}`);
  const { pay, bookingUrl } = await submitGuestForm(b, agent, tripId, target, act, tag);
  const origin = new URL(bookingUrl).origin;
  act.add("402", `${it.merchant} asks ${fmt(Number(pay.amount))} via x402 at ${pay.endpoint}`);
  try {
    const paid = await payX402(agent, `${origin}${pay.endpoint}`, { method: "POST" }, tripId, index, {
      onAsk: () => act.add("sign", "asking the Wayfare contract on NEAR to sign the USDC payment…"),
      onSigned: ({ nearTx }) => act.add("signed", `contract checked the rules and signed (NEAR tx ${nearTx})`),
    });
    const tx = paid.settlement?.transaction;
    if (!tx) {
      act.add("failed", `${it.merchant} did not accept the payment: ${paid.error ?? paid.response.status}`);
      return { item: index, label: it.label, status: "failed", reason: paid.error, booking_url: bookingUrl };
    }
    await call(agent, "report_settled", { payment_id: paid.outcome!.payment_id, tx_hash: tx });
    await b.waitText("Booking confirmed");
    await b.screenshot(act.file(`book-${tag}-confirmed.png`));
    const ref = await b.json<string>(`return document.getElementById("conf-ref")?.innerText ?? "";`);
    const chain = merchantChain(it.merchant);
    act.add("paid", `${it.merchant}: confirmed ${ref}, settled on ${railLabel(chain)}: ${txLink(tx, chain.id)}`);
    return { item: index, label: it.label, status: "confirmed", ref, amount: Number(pay.amount), near_tx: paid.nearTx, settle_tx: tx, booking_url: bookingUrl, network: chain.id };
  } catch (e) {
    if (e instanceof PaymentRefused) {
      await b.screenshot(act.file(`book-${tag}-refused.png`));
      act.add("refused", `the contract refused: ${e.outcome.reason}`);
      return { item: index, label: it.label, status: "refused", amount: Number(pay.amount), reason: e.outcome.reason, booking_url: bookingUrl };
    }
    act.add("failed", (e as Error).message);
    return { item: index, label: it.label, status: "failed", reason: (e as Error).message, booking_url: bookingUrl };
  }
}
