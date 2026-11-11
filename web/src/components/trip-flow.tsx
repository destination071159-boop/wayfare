"use client";
import "@xyflow/react/dist/style.css";
import { Background, type Edge, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import clsx from "clsx";
import { Ban, Bot, BookLock, CloudLightning, Coins, Fingerprint, Landmark, User, Wallet } from "lucide-react";
import { KindIcon } from "@/components/kind-icon";
import { get } from "@/lib/api";
import { short, usdc } from "@/lib/format";
import { merchantChain } from "@/lib/chain";
import { useStatus } from "@/lib/status";
import type { ChainTrip, Run } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";

type Tone = "neutral" | "sky" | "green" | "red" | "dark";
type Data = { icon: React.ReactNode; title: string; sub: string; foot?: string; tone: Tone };
type FlowNode = Node<Data, "card">;

const SKY = "#1769e0";
const RED = "#e16540";

/** One box in the diagram: icon, title, one line of detail, optional footer chip. */
function Card({ data }: NodeProps<FlowNode>) {
  const { tone } = data;
  return (
    <div
      className={clsx(
        "w-[250px] rounded-card px-3.5 py-3 shadow-button ring-1",
        tone === "dark" ? "bg-surface-charcoal text-canvas-white ring-canvas-white/10" : tone === "red" ? "bg-[#fff4f0] ring-lead-gen-red/30" : "bg-canvas-white ring-hairline",
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-midnight-ink/20" />
      <div className="flex items-center gap-2.5">
        <span
          className={clsx(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
            tone === "sky" && "bg-sky/10 text-sky",
            tone === "green" && "bg-deliver-green/15 text-midnight-ink",
            tone === "red" && "bg-lead-gen-red/15 text-lead-gen-red",
            tone === "neutral" && "bg-whisper-gray text-midnight-ink",
            tone === "dark" && "bg-canvas-white/10 text-canvas-white",
          )}
        >
          {data.icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-body-sm leading-tight font-medium">{data.title}</div>
          <div className={clsx("truncate text-[11px]", tone === "dark" ? "text-canvas-white/60" : "text-muted-ash")}>{data.sub}</div>
        </div>
      </div>
      {data.foot && <div className={clsx("mt-2 truncate rounded-button px-2 py-1 font-mono text-[10.5px]", tone === "dark" ? "bg-canvas-white/10 text-canvas-white/80" : "bg-whisper-gray text-midnight-ink/80")}>{data.foot}</div>}
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-midnight-ink/20" />
      {/* left-side ports: savings ⇄ wallet on the upper one, MPC signatures on the lower one */}
      <Handle id="s-out" type="source" position={Position.Left} className="!size-1.5 !border-0 !opacity-0" />
      <Handle id="w-fund" type="target" position={Position.Left} style={{ top: "30%" }} className="!size-1.5 !border-0 !opacity-0" />
      <Handle id="w-sig" type="target" position={Position.Left} style={{ top: "72%" }} className="!size-1.5 !border-0 !opacity-0" />
    </div>
  );
}

const nodeTypes = { card: Card };

function edge(id: string, source: string, target: string, label: string, kind: "money" | "control" | "refused" | "log" = "control"): Edge {
  const color = kind === "money" ? SKY : kind === "refused" ? RED : "rgba(17,17,17,.35)";
  return {
    id,
    source,
    target,
    label,
    animated: kind === "money",
    style: { stroke: color, strokeWidth: kind === "money" ? 1.8 : 1.3, strokeDasharray: kind === "refused" || kind === "log" ? "5 4" : undefined },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    labelStyle: { fontSize: 11, fontWeight: 500, fill: kind === "refused" ? RED : "#111" },
    labelBgStyle: { fill: "#fff", fillOpacity: 0.95 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 6,
  };
}

/** The finished trip as a graph: who approved, who asked, who signed, where the USDC went, and what NEAR refused. */
export function TripFlow({ run }: { run: Run }) {
  const { status } = useStatus();
  const { data: chain } = usePoll(() => get<ChainTrip>(`/api/trips/${run.trip_id}`), 5000, [run.trip_id]);
  const plan = run.plan;
  if (!plan || !chain?.trip) return null;
  const t = chain.trip;
  const name = (id: string) => status?.merchants.find((m) => m.id === id)?.name ?? id;
  const booked = plan.items.map((it, i) => ({ it, r: run.results.find((r) => r.item === i && r.status === "confirmed" && !r.label.endsWith("(upgrade)")) }));
  const refused = run.results.filter((r) => r.label.endsWith("(upgrade)") && r.status !== "confirmed");
  const signed = chain.payments.filter((p) => p.status === "signed").length;
  const asks = signed + t.refusals;

  const X = [0, 320, 640, 1010, 1340];
  const cancels = t.cancellations ?? [];
  const f = run.funded;
  const back = run.returned;

  // one wallet box per chain the trip pays on: the same address, the same MPC key
  const chainOfItem = (i: number) => merchantChain(status, plan.items[i].merchant);
  const used = [...new Map(plan.items.map((_, i) => [chainOfItem(i).id, chainOfItem(i)])).values()].sort((a, b) => (a.name === "Base" ? -1 : b.name === "Base" ? 1 : 0));
  const walletY = used.length > 2 ? [30, 210, 390] : used.length > 1 ? [110, 340] : [170];
  const wid = (network: string) => `w-${network}`;

  const nodes: FlowNode[] = [
    { id: "you", type: "card", position: { x: X[0], y: 60 }, data: { icon: <User size={15} />, title: "You", sub: run.request?.summary ?? "the traveler", foot: `budget ${usdc(t.budget)} USDC`, tone: "neutral" } },
    { id: "agent", type: "card", position: { x: X[0], y: 290 }, data: { icon: <Bot size={15} />, title: "Wayfare agent", sub: "browses, books, asks to pay", foot: "holds no key", tone: "neutral" } },
    { id: "contract", type: "card", position: { x: X[1], y: 170 }, data: { icon: <Landmark size={15} />, title: "Wayfare contract", sub: cancels.length ? `trip ${t.id} · ${cancels.length} refunds verified` : `trip ${t.id} · NEAR testnet`, foot: `${usdc(t.spent)} / ${usdc(t.budget)} signed`, tone: "dark" } },
    { id: "mpc", type: "card", position: { x: X[2], y: 60 }, data: { icon: <Fingerprint size={15} />, title: "NEAR MPC network", sub: used.length > 1 ? `Chain Signatures · signs all ${used.length} wallets` : "Chain Signatures · signs the wallet", foot: `${signed} USDC transfers signed`, tone: "sky" } },
    { id: "vault", type: "card", position: { x: X[2], y: 290 }, data: { icon: <BookLock size={15} />, title: "Traveler vault", sub: "passport, name, email", foot: `${chain.reads.length} reads logged on NEAR`, tone: "neutral" } },
  ];
  const edges: Edge[] = [
    edge("you-contract", "you", "contract", "approves the plan"),
    edge("agent-contract", "agent", "contract", `asks to pay ×${asks}`),
    edge("contract-mpc", "contract", "mpc", "within the caps"),
    edge("contract-vault", "contract", "vault", "logs every read", "log"),
  ];
  // what went in and came back on each chain, shown on the wallet itself so the lines stay unlabelled
  const fundLegs = f ? (f.legs ?? [{ network: used[0]?.id ?? "eip155:84532", usdc: f.usdc }]) : [];
  const backLegs = back ? (back.legs ?? [{ network: used[0]?.id ?? "eip155:84532", amount: back.amount }]) : [];
  used.forEach((c, k) => {
    const inn = fundLegs.find((l) => l.network === c.id);
    const out = backLegs.find((l) => l.network === c.id);
    const flow = [inn && `in ${usdc(inn.usdc)}`, out && (back?.payout_tx ? `back ${usdc(out.amount)}` : "returning")].filter(Boolean).join(" · ");
    const sub = flow ? `${flow} USDC` : c.near ? "ed25519 key held by NEAR MPC" : "key held by NEAR MPC";
    const addr = c.near ? (c.account ? short(c.account, 5) : undefined) : status?.wallet ? short(status.wallet.address, 5) : undefined;
    const foot = addr && (c.near ? `${addr} · MPC key` : used.filter((u) => !u.near).length > 1 ? `${addr} · same address` : addr);
    nodes.push({ id: wid(c.id), type: "card", position: { x: X[3], y: walletY[k] }, data: { icon: <Wallet size={15} />, title: `Trip wallet · ${c.name}`, sub, foot, tone: "sky" } });
    // signatures, not money: one thin trunk from MPC into each wallet's lower port
    edges.push({ ...edge(`mpc-${c.id}`, "mpc", wid(c.id), ""), type: "smoothstep", targetHandle: "w-sig", pathOptions: { borderRadius: 12 }, style: { stroke: SKY, strokeWidth: 1.3, opacity: 0.55 }, markerEnd: { type: MarkerType.ArrowClosed, color: SKY, width: 14, height: 14 } } as Edge);
  });

  // merchants grouped by chain, next to their wallet
  const order = plan.items.map((_, i) => i).sort((a, b) => used.findIndex((c) => c.id === chainOfItem(a).id) - used.findIndex((c) => c.id === chainOfItem(b).id));
  const mid = (walletY[0] + walletY[walletY.length - 1]) / 2;
  const rowAt = (k: number) => mid + (k - (order.length - 1) / 2) * 110;
  order.forEach((i, k) => {
    const { it, r } = booked[i];
    const id = `m${i}`;
    const c = chainOfItem(i);
    nodes.push({
      id,
      type: "card",
      position: { x: X[4], y: rowAt(k) },
      data: { icon: <KindIcon kind={it.kind} size={15} />, title: name(it.merchant), sub: it.label, foot: r ? `${c.name} · paid ${usdc(r.amount ?? it.total)} · ${r.ref}` : "not booked", tone: r ? "green" : "neutral" },
    });
    if (r) edges.push(edge(`w-${id}`, wid(c.id), id, k === 0 ? "USDC via x402" : "", "money"));
  });

  // each cancelled booking: its own box below the merchants, refunding into its chain's wallet
  cancels.forEach((c, k) => {
    const id = `cx${k}`;
    nodes.push({
      id,
      type: "card",
      position: { x: X[4], y: rowAt(order.length - 1) + 140 + k * 110 },
      data: { icon: <CloudLightning size={15} />, title: `${name(c.merchant_id)}: cancelled`, sub: `${c.booking_ref} · signature checked on NEAR`, foot: `refund ${usdc(c.refund)} → ${merchantChain(status, c.merchant_id).name} wallet`, tone: "red" },
    });
  });
  refused.forEach((r, k) => {
    const id = `ref${k}`;
    nodes.push({ id, type: "card", position: { x: X[2], y: 470 + k * 110 }, data: { icon: <Ban size={15} />, title: "Pricier room", sub: name(plan.items[r.item]?.merchant ?? ""), foot: `${r.amount ? usdc(r.amount) : "?"} USDC · over the cap`, tone: "red" } });
    edges.push(edge(`c-${id}`, "contract", id, "refused", "refused"));
  });

  // NEAR savings: funds each chain's wallet and gets back what's left, one two-way line per wallet down a shared trunk
  if (f || back) {
    const parts = [f && `−${Number(f.near).toFixed(2)}`, back?.near && `+${Number(back.near).toFixed(2)}`].filter(Boolean);
    nodes.push({
      id: "near-savings",
      type: "card",
      position: { x: X[3], y: -170 },
      data: { icon: <Coins size={15} />, title: "Your NEAR savings", sub: "swapped by NEAR Intents", foot: parts.length ? `${parts.join(" / ")} NEAR` : undefined, tone: "sky" },
    });
    for (const c of used) {
      if (!fundLegs.some((l) => l.network === c.id) && !backLegs.some((l) => l.network === c.id)) continue;
      const e = edge(`fund-${c.id}`, "near-savings", wid(c.id), "", "money");
      edges.push({ ...e, type: "smoothstep", sourceHandle: "s-out", targetHandle: "w-fund", pathOptions: { offset: 26, borderRadius: 12 }, markerStart: back ? { type: MarkerType.ArrowClosed, color: SKY, width: 14, height: 14 } : undefined } as Edge);
    }
  }

  return (
    <section className="mt-14">
      <h2 className="text-title font-medium">How the money moved</h2>
      <p className="mt-1 max-w-2xl text-body-sm text-muted-ash">
        Your NEAR savings fund the trip wallet on every chain it pays on. The agent only ever asks. The NEAR contract checks each request against the plan you approved, the MPC network signs for your wallet, and the USDC goes straight to the merchant. Anything over a cap stops at the contract, and what's left is swapped back to NEAR.
      </p>
      {/* sized to the diagram's own shape, so it fills the width with no empty band */}
      <div className="surface-card mt-5 overflow-hidden rounded-card" style={{ aspectRatio: `${X[4] + 250} / ${Math.max(...nodes.map((n) => n.position.y)) - Math.min(...nodes.map((n) => n.position.y)) + 100}`, minHeight: 360 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
        >
          <Background gap={22} size={1} color="rgba(17,17,17,.08)" />
        </ReactFlow>
      </div>
    </section>
  );
}
