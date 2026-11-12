// The checkout every demo site shares: a booking page that waits for payment, a JSON status endpoint, and the x402
// payment endpoint `POST /api/bookings/<id>/pay` (price = the booking's total, paid to the site's address).
import express, { type Express } from "express";
import { createWalletClient, erc20Abi, http, publicActions, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Store } from "./store.js";
import { esc, page, paymentBlock, type Brand } from "./ui.js";
import { isNearNet, MODE, NETS, type Net, usdc, x402Route } from "./x402.js";

/** The merchant's own key: the one behind its receiving address (from wayfare/.env). */
function merchantKey(payTo: string): Hex | undefined {
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("MERCHANT_KEY_") && v && privateKeyToAccount(v as Hex).address.toLowerCase() === payTo.toLowerCase()) return v as Hex;
  }
}

/** What the merchant signs when it cancels and refunds; the Wayfare contract rebuilds and checks the same text. */
export const cancellationMessage = (ref: string, paidTx: string, refund: string, refundTx: string) =>
  `Wayfare cancellation\nbooking: ${ref}\npaid tx: ${paidTx.toLowerCase()}\nrefund: ${refund}\nrefund tx: ${refundTx.toLowerCase()}`;

export function checkout(app: Express, opts: { brand: Brand; store: Store; payTo: string; description: string; steps: string[]; net?: Net }) {
  const { brand, store, payTo } = opts;
  const net = opts.net ?? NETS.base;
  const steps = opts.steps.map((s, i) => (i === opts.steps.length - 1 ? `<b>${i + 1} ${esc(s)}</b>` : `${i + 1} ${esc(s)}`)).join(" › ");

  app.get("/booking", (req, res) => {
    const b = store.get(String(req.query.id));
    if (!b) return void res.status(404).send(page(brand, "Not found", "<h1>Booking not found</h1>"));
    if (b.status === "cancelled" && b.cancellation) {
      const c = b.cancellation;
      return void res.send(
        page(brand, `Cancelled ${b.ref}`, `
<h1>Booking cancelled</h1>
<div class="card" id="cancelled" data-ref="${esc(b.ref)}"><p><b>${esc(b.title)}</b> (${esc(b.ref)}) was cancelled${c.by === "merchant" ? ` by ${esc(brand.name)}` : " at the customer's request"}: ${esc(c.reason)}</p>
<p>Refunded <b>${usdc(c.refund)} USDC</b> to the wallet that paid, on ${esc(net.label)} (tx <code>${esc(c.refund_tx)}</code>). The cancellation notice is signed with our payment key.</p></div>`),
      );
    }
    const pay = paymentBlock(b, usdc(b.total), payTo, { label: net.label, explorerTx: net.explorer_tx, id: net.id });
    const facts = Object.entries(b.detail)
      .map(([k, v]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(v)}</dd>`)
      .join("");
    res.send(
      page(brand, `Booking ${b.ref}`, `
<div class="steps">${steps}</div>
<h1>${esc(b.title)}</h1>
<div class="grid" style="grid-template-columns:1.5fr 1fr;align-items:start">
${pay.body}
<aside class="card"><dl class="kv" style="grid-template-columns:110px 1fr">${facts}<dt>guest</dt><dd>${esc(b.guest.full_name)}</dd><dt>total</dt><dd><b>${usdc(b.total)} USDC</b></dd></dl></aside>
</div>`, { script: pay.script }),
    );
  });

  app.get("/api/bookings/:id", (req, res) => {
    const b = store.get(req.params.id);
    if (!b) return void res.status(404).json({ error: "not found" });
    const { guest, ...rest } = b;
    res.json({ ...rest, guest: { full_name: guest.full_name } });
  });

  // Cancels a paid booking: refunds the USDC to the wallet that paid and signs a cancellation notice with the
  // merchant's payment key. by "merchant": the merchant cancelled (e.g. a cancelled flight); by "customer": a
  // change the customer (or their agent) asked for.
  app.post("/api/bookings/:id/cancel", express.json(), async (req, res) => {
    const b = store.get(req.params.id);
    if (!b) return void res.status(404).json({ error: "booking not found" });
    if (b.status === "cancelled") return void res.json({ ok: true, ref: b.ref, ...b.cancellation });
    if (b.status !== "confirmed" || !b.payment?.payer) return void res.status(409).json({ error: "only a paid booking can be cancelled" });
    const key = merchantKey(payTo);
    if (!key) return void res.status(500).json({ error: "this site has no payment key to refund with" });
    if (isNearNet(net)) return void res.status(409).json({ error: "this demo cancels only bookings paid on Base or Arbitrum" });
    const reason = String(req.body?.reason ?? "cancelled").slice(0, 120);
    const by = req.body?.by === "customer" ? "customer" : "merchant";
    try {
      const me = privateKeyToAccount(key);
      const wallet = createWalletClient({ account: me, chain: net.viem, transport: http(net.rpc) }).extend(publicActions);
      // local fork only: give the merchant gas for the refund
      if (MODE === "local") await wallet.request({ method: "anvil_setBalance" as never, params: [me.address, "0xde0b6b3a7640000"] as never });
      const hash = await wallet.writeContract({ address: net.usdc, abi: erc20Abi, functionName: "transfer", args: [b.payment.payer as Hex, BigInt(b.total)] });
      const receipt = await wallet.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`refund reverted: ${hash}`);
      const message = cancellationMessage(b.ref, b.payment.transaction, b.total, hash);
      const signature = await me.signMessage({ message });
      const cancellation = { reason, by, refund: b.total, refund_tx: hash, message, signature, at: Date.now() } as const;
      store.update(b.id, (x) => {
        x.status = "cancelled";
        x.cancellation = { ...cancellation };
      });
      res.json({ ok: true, ref: b.ref, paid_tx: b.payment.transaction, ...cancellation });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Before x402: only an open booking can be paid, and only once.
  app.post("/api/bookings/:id/pay", (req, res, next) => {
    const b = store.get(req.params.id);
    if (!b) return void res.status(404).json({ error: "booking not found" });
    if (b.status === "confirmed") return void res.status(409).json({ error: "already paid", ref: b.ref, payment: b.payment });
    if (b.status === "expired") return void res.status(410).json({ error: "the hold expired" });
    next();
  });
  app.use(
    x402Route({
      route: "POST /api/bookings/:id/pay",
      payTo,
      net,
      description: opts.description,
      amountFor: (p) => store.get(Store.idFromPath(p))?.total ?? "0",
      onSettled: (s) =>
        store.update(Store.idFromPath(s.path), (b) => {
          b.status = "confirmed";
          b.payment = { transaction: s.transaction, payer: s.payer, network: s.network, at: Date.now() };
          delete b.last_error;
        }),
      onFailed: (p, reason) => store.update(Store.idFromPath(p), (b) => (b.last_error = reason)),
    }),
  );
  app.post("/api/bookings/:id/pay", (req, res) => {
    const b = store.get(req.params.id)!;
    res.json({ ok: true, ref: b.ref, title: b.title, total: b.total });
  });
}

/** The guest-details form fields every site asks for (names match the traveler's vault fields). */
export const guestFields = (who = "Full name (as on passport)", passport = true) => `
  <div><label for="full_name">${esc(who)}</label><input id="full_name" name="full_name" required autocomplete="name"></div>
  ${passport ? '<div><label for="passport_no">Passport number</label><input id="passport_no" name="passport_no" required></div>' : ""}
  <div><label for="email">Email for the confirmation</label><input id="email" name="email" type="email" required></div>`;

export const hidden = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");

export const isoDate = (s: unknown, fallbackDays = 1) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? "")) ? String(s) : new Date(Date.now() + fallbackDays * 86_400_000).toISOString().slice(0, 10));
export const clampInt = (v: unknown, min: number, max: number, d: number) => Math.min(max, Math.max(min, Number(v) || d));
