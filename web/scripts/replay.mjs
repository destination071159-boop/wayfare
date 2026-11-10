// Builds the replay: a static, read-only copy of the web app with real trips, ready to host anywhere (Netlify, Vercel, GitHub Pages).
//   node scripts/replay.mjs [run-id …]    (the hub must be running: pnpm demo)   →  web/out/
// Without run ids it takes the newest finished trips. NEXT_PUBLIC_BASE_PATH=/repo for a GitHub Pages project site.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HUB = process.env.HUB_URL ?? "http://127.0.0.1:7373";
const OUT = path.join(WEB, "out");
const get = async (p) => {
  const r = await fetch(`${HUB}${p}`);
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return p.endsWith(".png") ? Buffer.from(await r.arrayBuffer()) : r.json();
};

const all = await get("/api/runs");
const ids = process.argv.slice(2).length ? process.argv.slice(2) : all.filter((r) => r.status === "booked" && r.trip_id).slice(0, 3).map((r) => r.id);
if (!ids.length) throw new Error("no finished trips to replay");

// next build always writes .next (distDir only moves the export), so keep the live app's build aside and put it back after
const LIVE = path.join(WEB, ".next"), KEEP = path.join(WEB, ".next-live");
const kept = fs.existsSync(LIVE);
fs.rmSync(KEEP, { recursive: true, force: true });
if (kept) fs.renameSync(LIVE, KEEP);
try {
  execFileSync("npx", ["next", "build"], { cwd: WEB, stdio: "inherit", env: { ...process.env, NEXT_PUBLIC_REPLAY: "1" } });
} finally {
  fs.rmSync(LIVE, { recursive: true, force: true });
  if (kept) fs.renameSync(KEEP, LIVE);
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(WEB, ".next-replay"), OUT, { recursive: true });

const write = (p, v) => {
  const f = path.join(OUT, "replay", p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.isBuffer(v) ? v : JSON.stringify(v));
};
write("api/status.json", { ...(await get("/api/status")), busy: null });
write("api/runs.json", all.filter((r) => ids.includes(r.id)));
for (const id of ids) {
  const run = await get(`/api/runs/${id}`);
  write(`api/runs/${id}.json`, { ...run, busy: undefined });
  if (run.trip_id) write(`api/trips/${run.trip_id}.json`, await get(`/api/trips/${run.trip_id}`));
  for (const s of run.shots) write(`files/runs/${id}/${s}`, await get(`/runs/${id}/${s}`));
  console.log(`replay: ${id} (trip #${run.trip_id}, ${run.shots.length} screenshots)`);
}
console.log(`→ ${OUT}  (host this folder; open /run?id=${ids[0]})`);
