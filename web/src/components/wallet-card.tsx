"use client";
import { ShieldCheck } from "lucide-react";
import { StatusDisk } from "@/components/ui";
import { short, usdc } from "@/lib/format";
import { useStatus } from "@/lib/status";

/** The traveler's trip wallet: one address on the EVM chains and an account on NEAR. NEAR's MPC network holds both keys,
 * and only the Wayfare contract can ask for a signature. */
export function WalletCard() {
  const { status: s } = useStatus();
  return (
    <aside className="surface-card self-start rounded-card p-5">
      <div className="flex items-center gap-3">
        <StatusDisk tone="blue">
          <ShieldCheck className="size-[18px]" strokeWidth={2} />
        </StatusDisk>
        <div>
          <div className="font-medium">Your travel wallet</div>
          <div className="text-caption text-muted-ash">on {(s?.chains ?? []).map((c) => c.name).join(", ").replace(/, ([^,]*)$/, " and $1") || "Base"}</div>
        </div>
      </div>
      <div className="mt-5 flex items-baseline gap-2">
        <span className="display-tight text-[44px] leading-none font-medium num">{s?.balance != null ? usdc(s.balance) : "—"}</span>
        <span className="text-body-sm text-muted-ash">USDC</span>
      </div>
      {s?.chains && s.chains.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {s.chains.map((c) => (
            <span key={c.id} className="rounded-full bg-whisper-gray px-2.5 py-1 text-caption">
              <span className="text-muted-ash">{c.name}</span> <span className="font-medium num">{c.balance != null ? usdc(c.balance) : "—"}</span>
            </span>
          ))}
        </div>
      )}
      <div className="surface-panel mt-5 grid gap-2 rounded-card p-4 text-caption">
        <Row k="Address" v={<span className="font-mono">{s?.wallet ? short(s.wallet.address, 8) : "—"}</span>} />
        {s?.chains?.find((c) => c.account) && <Row k="On NEAR" v={<span className="font-mono">{short(s.chains.find((c) => c.account)!.account!, 8)}</span>} />}
        <Row k="Keys" v={<>held by NEAR MPC, path <span className="font-mono">{s?.wallet?.path ?? "—"}</span></>} />
        <Row k="Signs when" v={<span className="font-mono">{s?.contract ?? "—"}</span>} />
        <Row k="Agent" v={<>{s?.agent ?? "—"}, holds no key</>} />
        {s?.savings && <Row k="Savings" v={<>{(Number(BigInt(s.savings.near) / 10n ** 20n) / 1e4).toFixed(2)} NEAR in <span className="font-mono">{s.savings.account}</span></>} />}
      </div>
    </aside>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_1fr] gap-3">
      <span className="text-muted-ash">{k}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{v}</span>
    </div>
  );
}
