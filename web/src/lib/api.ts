/** Replay build (NEXT_PUBLIC_REPLAY=1): a read-only copy of real trips, served as static JSON (see scripts/replay.mjs). */
export const REPLAY = process.env.NEXT_PUBLIC_REPLAY === "1";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** An agent screenshot: /files/runs/<run>/<file>.png */
export const fileUrl = (p: string) => (REPLAY ? `${BASE}/replay${p.split("?")[0]}` : p);

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(REPLAY ? `${BASE}/replay${path.split("?")[0]}.json` : path, { cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `${r.status}`);
  return body as T;
}

export async function post<T>(path: string, body: unknown = {}): Promise<T> {
  if (REPLAY) throw new Error("This is a replay of real trips on NEAR testnet, so it can't book. Run Wayfare locally (pnpm demo) to plan your own.");
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((out as { error?: string }).error ?? `${r.status}`);
  return out as T;
}
