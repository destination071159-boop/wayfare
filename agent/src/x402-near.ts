// The standard x402 client, with the Wayfare contract as its signer.
//
// x402's ExactEvmScheme asks its signer to sign a USDC TransferWithAuthorization. Here, instead of a private key,
// the "signer" asks the NEAR contract to pay for one trip item. The contract rebuilds the same authorization from its
// own rules (merchant address, approved price, budget) and returns an MPC signature, or refuses. We check that what
// the contract signed is exactly what x402 asked for, so a mismatch fails here and not at the merchant.
//
// On NEAR itself the same idea uses x402's `exact` scheme for NEAR (@x402/near): the merchant asks for a signed
// NEP-366 delegate action holding one USDC `ft_transfer`. The contract builds that delegate action itself and the MPC
// network signs it with the trip wallet's ed25519 key; we check it pays exactly what the merchant asked for.
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { ExactNearScheme } from "@x402/near/exact/client";
import type { ClientNearSigner } from "@x402/near";
import type { Account } from "near-api-js";
import { CHAINS, NEAR_RAIL } from "./chains.js";
import { call, view } from "./near.js";
import { blockHeight, type NearAuthorization, nearWallet, nextNonce, signedDelegateB64 } from "./near-rail.js";

export type PayOutcome = {
  status: "signed" | "refused" | "failed";
  trip_id?: string;
  payment_id?: string;
  reason?: string;
  network?: string;
  authorization?: { from: string; to: string; value: string; valid_after: string; valid_before: string; nonce: string };
  signature?: string;
  near?: NearAuthorization;
};

export class PaymentRefused extends Error {
  constructor(public outcome: PayOutcome) {
    super(`Wayfare contract ${outcome.status} the payment: ${outcome.reason}`);
  }
}

export type PayEvents = {
  onAsk?: (x: { amount: string; to: string }) => void;
  onSigned?: (x: { outcome: PayOutcome; nearTx: string }) => void;
};

/** A ClientEvmSigner whose signatures come from the Wayfare contract, for one trip item. */
export async function contractSigner(agent: Account, tripId: string, item: number, ev: PayEvents = {}) {
  const wallet = await view<{ address: `0x${string}` } | null>("get_wallet", { traveler: (await view<{ traveler: string }>("get_trip", { trip_id: tripId })).traveler });
  if (!wallet) throw new Error("the traveler has no wallet");
  const last: { outcome?: PayOutcome; nearTx?: string } = {};
  const signer = {
    address: wallet.address,
    async signTypedData({ message }: { message: Record<string, unknown> }): Promise<`0x${string}`> {
      const m = message as { from: string; to: string; value: bigint; validAfter: bigint; validBefore: bigint; nonce: string };
      ev.onAsk?.({ amount: m.value.toString(), to: m.to });
      const { value: out, tx } = await call<PayOutcome>(
        agent,
        "pay",
        { args: { trip_id: tripId, item, amount: m.value.toString(), nonce: m.nonce, valid_before: m.validBefore.toString() } },
        { tgas: 300n },
      );
      last.outcome = out;
      last.nearTx = tx;
      if (out.status !== "signed" || !out.signature || !out.authorization) throw new PaymentRefused(out);
      const a = out.authorization;
      const same =
        a.from.toLowerCase() === m.from.toLowerCase() &&
        a.to.toLowerCase() === m.to.toLowerCase() &&
        a.value === m.value.toString() &&
        a.valid_after === m.validAfter.toString() &&
        a.valid_before === m.validBefore.toString() &&
        a.nonce.toLowerCase() === m.nonce.toLowerCase();
      if (!same) throw new Error(`the contract signed a different payment than the merchant asked for (merchant pay_to ${m.to}, contract paid ${a.to})`);
      ev.onSigned?.({ outcome: out, nearTx: tx });
      return out.signature as `0x${string}`;
    },
  };
  return { signer, last };
}

/** A ClientNearSigner (x402 on NEAR) whose signed delegate actions come from the Wayfare contract, for one trip item. */
function contractNearSigner(agent: Account, tripId: string, item: number, last: { outcome?: PayOutcome; nearTx?: string }, ev: PayEvents): ClientNearSigner {
  return {
    async createSignedDelegateAction({ paymentRequirements: r }) {
      if (r.asset !== NEAR_RAIL.token) throw new Error(`the merchant asks for ${r.asset}, not USDC on NEAR`);
      ev.onAsk?.({ amount: r.amount, to: r.payTo });
      const w = await nearWallet();
      // the delegate action expires within the merchant's timeout (in blocks, about a second each)
      const maxBlockHeight = (await blockHeight()) + Math.min(r.maxTimeoutSeconds, 600);
      const { value: out, tx } = await call<PayOutcome>(
        agent,
        "pay",
        { args: { trip_id: tripId, item, amount: r.amount, nonce: String(await nextNonce(w)), valid_before: String(maxBlockHeight) } },
        { tgas: 300n },
      );
      last.outcome = out;
      last.nearTx = tx;
      if (out.status !== "signed" || !out.signature || !out.near) throw new PaymentRefused(out);
      const a = out.near;
      if (a.receiver_id !== r.payTo || a.amount !== r.amount || a.token !== r.asset || a.sender_id !== w.account_id) {
        throw new Error(`the contract signed a different payment than the merchant asked for (merchant pay_to ${r.payTo}, contract paid ${a.receiver_id})`);
      }
      ev.onSigned?.({ outcome: out, nearTx: tx });
      return signedDelegateB64(a, out.signature);
    },
  };
}

export type Paid = { response: Response; body: unknown; error?: string; settlement?: { transaction?: string; network?: string; success?: boolean; payer?: string }; outcome?: PayOutcome; nearTx?: string };

/** Pays an x402 endpoint for one trip item. Throws PaymentRefused when the contract says no. */
export async function payX402(agent: Account, url: string, init: RequestInit, tripId: string, item: number, ev: PayEvents = {}): Promise<Paid> {
  const { signer, last } = await contractSigner(agent, tripId, item, ev);
  // The client's own per-payment cap is off: the Wayfare contract is the spending control (item price + budget).
  // every chain Wayfare pays on, with contract-backed signers: the contract picks the chain from the merchant
  const schemes = [
    ...CHAINS.map((c) => ({ network: c.id as `${string}:${string}`, client: new ExactEvmScheme(signer) })),
    { network: NEAR_RAIL.id as `${string}:${string}`, client: new ExactNearScheme(contractNearSigner(agent, tripId, item, last, ev)) },
  ];
  const fetchPaid = wrapFetchWithPaymentFromConfig(fetch, { schemes, spendControls: false });
  let response: Response;
  try {
    response = await fetchPaid(url, init);
  } catch (e) {
    // the x402 client wraps signer errors; surface the contract's refusal as is
    let c: unknown = e;
    while (c instanceof Error) {
      if (c instanceof PaymentRefused) throw c;
      c = (c as { cause?: unknown }).cause;
    }
    if (last.outcome && last.outcome.status !== "signed") throw new PaymentRefused(last.outcome);
    throw e;
  }
  const header = response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
  const settlement = header ? (decodePaymentResponseHeader(header) as Paid["settlement"]) : undefined;
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  // a 402 after paying: the merchant (its facilitator) rejected the payment; say why
  let error: string | undefined;
  const required = response.status === 402 ? response.headers.get("PAYMENT-REQUIRED") : null;
  if (required) {
    try {
      error = (JSON.parse(Buffer.from(required, "base64").toString()) as { error?: string }).error;
    } catch {}
  }
  return { response, body, error, settlement, outcome: last.outcome, nearTx: last.nearTx };
}
