// Standard x402 server setup shared by the demo merchants. Nothing here knows about NEAR: any x402 client can pay.
//
// Two modes (WAYFARE_CHAIN in wayfare/.env):
// - local (default): a local fork of Base Sepolia (anvil, BASE_RPC) with the real USDC contract, settled by the
//   official x402 facilitator code (x402Facilitator + ExactEvmScheme) running in this process. No funding needed.
// - live: public Base Sepolia, settled by the public x402.org facilitator. The wallet needs faucet USDC.
// A site can also take USDC on NEAR testnet (x402 `exact` on near:testnet, @x402/near): always the real testnet,
// settled by the official NEAR facilitator code in this process, whose relayer account pays the gas.
import type { FacilitatorClient } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402Facilitator } from "@x402/core/facilitator";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme as ExactEvmFacilitator } from "@x402/evm/exact/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createFacilitatorNearSigner } from "@x402/near";
import { ExactNearScheme as ExactNearFacilitator } from "@x402/near/exact/facilitator";
import { ExactNearScheme } from "@x402/near/exact/server";
import type { RequestHandler } from "express";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, baseSepolia } from "viem/chains";

export const MODE = process.env.WAYFARE_CHAIN === "live" ? "live" : "local";

/** A chain a site can take USDC on. In local mode each is an anvil fork (agent/scripts/local-chain.ts). */
export type EvmNet = {
  kind?: "evm";
  id: `${string}:${string}`;
  name: string;
  usdc: `0x${string}`;
  /** the USDC contract's EIP-712 domain */
  token_name: string;
  token_version: string;
  rpc: string;
  viem: typeof baseSepolia | typeof arbitrumSepolia;
  label: string;
  /** where a transaction can be looked up; empty in local mode (it only exists on the fork) */
  explorer_tx: string;
};
/** USDC on NEAR testnet (Circle's NEP-141), paid with x402 `exact` on near:testnet. */
export type NearNet = { kind: "near"; id: "near:testnet"; name: "NEAR"; token: string; rpc: string; label: string; explorer_tx: string };
export type Net = EvmNet | NearNet;
export const isNearNet = (n: Net): n is NearNet => n.kind === "near";

const fork = (name: string) => (MODE === "live" ? `${name} Sepolia` : `${name} Sepolia (local fork)`);
export const NETS = {
  base: {
    id: "eip155:84532",
    name: "Base",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    token_name: "USDC",
    token_version: "2",
    rpc: MODE === "live" ? "https://sepolia.base.org" : (process.env.BASE_RPC ?? "http://127.0.0.1:8545"),
    viem: baseSepolia,
    label: fork("Base"),
    explorer_tx: MODE === "live" ? "https://sepolia.basescan.org/tx/" : "",
  },
  arb: {
    id: "eip155:421614",
    name: "Arbitrum",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    token_name: "USD Coin",
    token_version: "2",
    rpc: MODE === "live" ? "https://sepolia-rollup.arbitrum.io/rpc" : (process.env.ARB_RPC ?? "http://127.0.0.1:8546"),
    viem: arbitrumSepolia,
    label: fork("Arbitrum"),
    explorer_tx: MODE === "live" ? "https://sepolia.arbiscan.io/tx/" : "",
  },
} satisfies Record<string, EvmNet>;

export const NEAR_NET: NearNet = {
  kind: "near",
  id: "near:testnet",
  name: "NEAR",
  token: process.env.NEAR_USDC ?? "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
  rpc: process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com",
  label: "NEAR testnet",
  explorer_tx: "https://testnet.nearblocks.io/txns/",
};

// Base Sepolia, under the names the sites used before they could take other chains
export const NETWORK = NETS.base.id;
export const USDC = NETS.base.usdc;
export const CHAIN_LABEL = NETS.base.label;
export const EXPLORER_TX = NETS.base.explorer_tx;

// anvil's first default account: a well-known test key that pays gas on the local fork only.
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const facilitators = new Map<string, FacilitatorClient>();
function getFacilitator(net: Net): FacilitatorClient {
  const have = facilitators.get(net.id);
  if (have) return have;
  let f: FacilitatorClient;
  if (isNearNet(net)) {
    // the official x402 NEAR facilitator: verifies the signed delegate action and relays it, paying the gas
    const relayer = process.env.NEAR_RELAYER_ACCOUNT, key = process.env.NEAR_RELAYER_KEY;
    if (!relayer || !key) throw new Error("NEAR_RELAYER_ACCOUNT / NEAR_RELAYER_KEY are not set: run pnpm -C agent setup:testnet");
    const signer = createFacilitatorNearSigner({ relayers: [{ accountId: relayer, secretKey: key as `ed25519:${string}` }], rpcUrls: { [net.id]: net.rpc } });
    f = new x402Facilitator().register(net.id, new ExactNearFacilitator(signer)) as unknown as FacilitatorClient;
  } else if (MODE === "live") f = new HTTPFacilitatorClient({ url: process.env.X402_FACILITATOR ?? "https://x402.org/facilitator" });
  else {
    // the official facilitator code, settling on this chain's local fork
    const account = privateKeyToAccount((process.env.LOCAL_FACILITATOR_KEY ?? ANVIL_KEY) as `0x${string}`);
    const wallet = createWalletClient({ account, chain: net.viem, transport: http(net.rpc) }).extend(publicActions);
    const signer = toFacilitatorEvmSigner({ ...wallet, address: account.address } as unknown as Parameters<typeof toFacilitatorEvmSigner>[0]);
    f = new x402Facilitator().register(net.id, new ExactEvmFacilitator(signer)) as unknown as FacilitatorClient;
  }
  facilitators.set(net.id, f);
  return f;
}

export type Settled = { path: string; transaction: string; payer?: string; network: string };

/**
 * x402 middleware for one route pattern (e.g. "POST /api/bookings/:id/pay").
 * `amountFor(path)` returns the price in USDC base units for that request.
 */
export function x402Route(opts: {
  route: string;
  net?: Net;
  payTo: string;
  description: string;
  amountFor: (path: string) => string;
  onSettled: (s: Settled) => void;
  onFailed: (path: string, reason: string) => void;
}): RequestHandler {
  const net = opts.net ?? NETS.base;
  const server = new x402ResourceServer(getFacilitator(net)).register(net.id, isNearNet(net) ? new ExactNearScheme() : new ExactEvmScheme());
  const pathOf = (ctx: { transportContext?: unknown }) => (ctx.transportContext as { request?: { path?: string } } | undefined)?.request?.path ?? "";
  server.onAfterSettle(async (ctx) => {
    if (ctx.result.success) opts.onSettled({ path: pathOf(ctx), transaction: ctx.result.transaction, payer: ctx.result.payer, network: ctx.result.network });
    else opts.onFailed(pathOf(ctx), ctx.result.errorReason ?? "settlement failed");
  });
  server.onSettleFailure(async (ctx) => {
    opts.onFailed(pathOf(ctx), ctx.error.message);
  });
  return paymentMiddleware(
    {
      [opts.route]: {
        accepts: {
          scheme: "exact",
          network: net.id,
          payTo: opts.payTo,
          maxTimeoutSeconds: 600,
          price: (ctx) =>
            isNearNet(net) ? { amount: opts.amountFor(ctx.path), asset: net.token } : { amount: opts.amountFor(ctx.path), asset: net.usdc, extra: { name: net.token_name, version: net.token_version } },
        },
        description: opts.description,
        mimeType: "application/json",
      },
    },
    server,
  );
}

/** USDC base units → "1.20" */
export const usdc = (base: string | number | bigint) => {
  const n = BigInt(base);
  return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0").slice(0, 2)}`;
};
