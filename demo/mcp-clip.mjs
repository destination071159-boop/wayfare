// The "any AI agent can use it" part of the demo video: an MCP session with Wayfare's tools, built from a real trip
// that was planned and booked through the MCP server (agent/src/mcp.ts), then spliced in just before the outro.
//   node demo/mcp-clip.mjs <run-id>    (the hub must be running: pnpm demo; run after narrate.mjs)
//   node demo/mcp-clip.mjs --splice    (only redo the splice, reusing the rendered clips)
// The NearBlocks and real-x402 clips (demo/nearblocks-clip.mjs, demo/real-x402-clip.mjs), if rendered, go in first, after chapter 9.
//   → demo-video/mcp/ (composition + clip) and demo-video/wayfare-demo.mp4 with the clip inserted
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'demo-video');
const DIR = path.join(OUT, 'mcp');
const { video: V } = await import(pathToFileURL(path.join(ROOT, 'demo/scenario.mjs')).href);
const HF = `hyperframes@${V.hyperframesVersion || '0.8.78'}`;
const HUB = process.env.HUB_URL ?? 'http://127.0.0.1:7373';
const SECONDS = 12;
const LINE = 'And not only for people. Any AI agent can book through Wayfare over MCP. It plans and books, but only you approve the budget, and NEAR still refuses anything off the plan.';

const SPLICE = process.argv.includes('--splice');
const id = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!id && !SPLICE) throw new Error('usage: node demo/mcp-clip.mjs <run-id> | --splice');
const voiced = path.join(DIR, 'clip-voiced.mp4');
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
if (!SPLICE) {
const run = await (await fetch(`${HUB}/api/runs/${id}`)).json();
const usdc = (b) => (Number(b) / 1e6).toFixed(2);
const booked = run.results.filter((r) => r.status === 'confirmed');
const refused = run.results.find((r) => r.status === 'refused');
const rebooked = run.disruption?.rebooked?.length ?? 0;
const chains = [['eip155:84532', 'Base'], ['eip155:421614', 'Arbitrum'], ['near:testnet', 'NEAR']].filter(([n]) => booked.some((b) => b.network === n)).map(([, l]) => l);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// what a Claude Code session with the Wayfare MCP server shows (tool calls ⏺, results ⎿), from this trip
const L = [
  ['you', `&gt; Book me ${esc(run.request?.summary?.split(',')[0] ?? 'this trip')}: ryokan near Gion, sushi for two, $1,000`],
  ['call', `⏺ wayfare · <b>plan_trip</b>(request)`],
  ['res', `⎿ Plan: ${usdc(run.plan.total)} of a ${usdc(run.plan.budget)} USDC budget · ${run.plan.items.length} bookings`],
  ['warn', `⎿ The traveler approves at /run?id=…  <i>(the agent can't)</i>`],
  ['call', `⏺ wayfare · <b>get_trip</b>(wait_seconds: 240)`],
  ['res', `⎿ ${booked.length} booked · signed on NEAR · x402 on ${chains.join(', ')}`],
  ...(rebooked ? [['res', `⎿ Flight cancelled → refund verified, ${rebooked} rebooked inside +${run.rebook_pct}%`]] : []),
  ['call', `⏺ wayfare · <b>try_upgrade</b>()`],
  ['bad', `⎿ Refused by NEAR: ${refused ? `${usdc(refused.amount)} asked, ${usdc(run.plan.items.find((i) => i.kind === 'hotel')?.total ?? 0)} approved` : 'over the approved price'}`],
  ['call', `⏺ wayfare · <b>verify_trip</b>()`],
  ['res', `⎿ Trip #${run.trip_id} on wf.ghcsmw3fimg2.testnet · refused: 1 · plan hash ✓`],
];

const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=1920, height=1080" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; background: #f6f5f3; }
  #root { position: relative; width: 1920px; height: 1080px; font-family: 'Inter Tight', system-ui, sans-serif; color: #111;
    background-color: #f6f5f3; background-image: linear-gradient(rgba(0,0,0,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.05) 1px, transparent 1px); background-size: 48px 48px; }
  .clip { position: absolute; inset: 0; }
  #left { position: absolute; left: 110px; top: 250px; width: 600px; }
  .eyebrow { display: inline-block; font: 700 22px 'JetBrains Mono'; color: #fff; background: #1769e0; border-radius: 10px; padding: 8px 16px; letter-spacing: .04em; }
  h2 { font: 700 76px/1.04 'Inter Tight'; letter-spacing: -.025em; margin-top: 28px; }
  .sub { font: 500 30px/1.35 'Inter Tight'; color: #4b5563; margin-top: 26px; }
  .chips { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 36px; }
  .chip { font: 600 22px 'Inter Tight'; padding: 10px 18px; border-radius: 999px; background: #fff; border: 1px solid rgba(15,23,42,.12); }
  .chip.k { background: #e8f0fe; color: #0b4fb3; border-color: #bcd3fb; }
  #term { position: absolute; left: 760px; top: 190px; width: 1040px; min-height: 640px; background: #0d1117; border-radius: 20px;
    box-shadow: 0 1px 2px rgba(15,23,42,.08), 0 40px 80px -30px rgba(15,23,42,.55); overflow: hidden; }
  .bar { height: 54px; background: #161b22; display: flex; align-items: center; gap: 10px; padding: 0 22px; }
  .dot { width: 14px; height: 14px; border-radius: 50%; } .bar span { margin-left: 14px; font: 500 19px 'JetBrains Mono'; color: #8b949e; }
  .lines { padding: 34px 36px 40px; display: flex; flex-direction: column; gap: 18px; }
  .l { font: 500 23px/1.35 'JetBrains Mono'; color: #c9d1d9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .l b { color: #79c0ff; font-weight: 700; } .l i { color: #8b949e; font-style: normal; }
  .you { color: #f0f6fc; } .call { color: #d2a8ff; margin-top: 8px; } .res { color: #7ee787; padding-left: 26px; }
  .warn { color: #e3b341; padding-left: 26px; } .bad { color: #ff7b72; padding-left: 26px; }
</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${SECONDS}" data-width="1920" data-height="1080">
  <section id="mcp" class="clip" data-start="0" data-duration="${SECONDS}" data-track-index="0">
    <div id="left">
      <div class="eyebrow">MCP · ANY AI AGENT</div>
      <h2>Your AI can book through Wayfare too</h2>
      <div class="sub">Claude, Cursor or any MCP client gets the same tools, and the same limits.</div>
      <div class="chips"><span class="chip">no keys</span><span class="chip">no money</span><span class="chip k">you approve</span><span class="chip k">NEAR enforces</span></div>
    </div>
    <div id="term">
      <div class="bar"><i class="dot" style="background:#ff5f57"></i><i class="dot" style="background:#febc2e"></i><i class="dot" style="background:#28c840"></i><span>claude · wayfare MCP server</span></div>
      <div class="lines">${L.map(([k, t], i) => `<div class="l ${k}" id="l${i}">${t}</div>`).join('')}</div>
    </div>
  </section>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.fromTo('#left > *', {opacity:0, y:26}, {opacity:1, y:0, duration:.55, stagger:.15, ease:'power3.out'}, .2);
  tl.fromTo('#term', {opacity:0, y:40}, {opacity:1, y:0, duration:.6, ease:'power3.out'}, .5);
  ${L.map((_, i) => `tl.fromTo('#l${i}', {opacity:0, x:-14}, {opacity:1, x:0, duration:.3, ease:'power2.out'}, ${(1.1 + i * ((SECONDS - 3.2) / L.length)).toFixed(2)});`).join('\n  ')}
  tl.to('#mcp', {opacity:0, duration:.4}, ${SECONDS - 0.45});
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
  tl.seek(0);
</script>
</body></html>`;

fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'index.html'), html);
for (const f of ['hyperframes.json', 'package.json']) fs.copyFileSync(path.join(OUT, 'hyperframes', f), path.join(DIR, f));
const clip = path.join(DIR, 'clip.mp4');
execFileSync('npx', ['--yes', HF, 'render', '-o', clip, '--fps', '30', '--quality', 'high', '--video-frame-format', 'png', '-w', '1'], { cwd: DIR, stdio: 'inherit' });

// voice (same model and cache as narrate.mjs)
const env = { ...process.env, HYPERFRAMES_PYTHON: process.env.HYPERFRAMES_PYTHON ?? path.join(os.homedir(), '.cache/hf-tts-venv/bin/python') };
const vo = path.join(OUT, 'vo', `${crypto.createHash('sha1').update(`af_heart|1.05|${LINE}`).digest('hex').slice(0, 14)}.wav`);
if (!fs.existsSync(vo)) execFileSync('npx', ['--yes', HF, 'tts', LINE, '-v', 'af_heart', '-s', '1.05', '-o', vo], { env, stdio: 'ignore' });
const vd = dur(vo);
const tempo = vd > SECONDS - 0.8 ? Math.min(vd / (SECONDS - 0.8), 1.22) : 1;
console.log(`voice ${vd.toFixed(1)}s${tempo > 1 ? ` sped ${tempo.toFixed(2)}x` : ''}`);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', clip, '-i', vo, '-filter_complex', `[1:a]aresample=48000,aformat=channel_layouts=stereo${tempo > 1 ? `,atempo=${tempo.toFixed(4)}` : ''},adelay=400|400,apad[a]`, '-map', '0:v', '-map', '[a]', '-t', String(SECONDS), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', voiced]);

}

// splice before the outro: [film … outro start] + (nearblocks clip) + MCP clip + [outro]
// optional clips that go first: one tx on NearBlocks, then a real third-party x402 payment
const extra = ['nearblocks', 'real-x402'].map((d) => path.join(OUT, d, 'clip-voiced.mp4')).filter((f) => fs.existsSync(f));
const clips = [...extra, voiced];
const base = path.join(OUT, 'wayfare-demo-base.mp4');
const final = path.join(OUT, 'wayfare-demo.mp4');
if (!fs.existsSync(base) || fs.statSync(final).mtimeMs > fs.statSync(base).mtimeMs) fs.copyFileSync(final, base); // keep narrate.mjs's output to splice from
const total = dur(base), cut = +(total - (V.outro?.seconds ?? 8)).toFixed(3);
const norm = (i) => `[${i}:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS[v${i}];[${i}:a]aresample=48000,asetpts=PTS-STARTPTS[a${i}];`;
const n = clips.length + 2;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', base, ...clips.flatMap((c) => ['-i', c]), '-filter_complex',
  `[0:v]trim=0:${cut},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v0];[0:a]atrim=0:${cut},asetpts=PTS-STARTPTS,aresample=48000[a0];` +
  clips.map((_, i) => norm(i + 1)).join('') +
  `[0:v]trim=${cut},setpts=PTS-STARTPTS,fps=30,format=yuv420p[vz];[0:a]atrim=${cut},asetpts=PTS-STARTPTS,aresample=48000[az];` +
  `[v0][a0]${clips.map((_, i) => `[v${i + 1}][a${i + 1}]`).join('')}[vz][az]concat=n=${n}:v=1:a=1[v][a]`,
  '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final]);
const later = new Date(Date.now() + 2000);
fs.utimesSync(base, later, later); // so a re-run splices from the narrated base again, not from this output
console.log(`→ ${final} (${dur(final).toFixed(1)}s, ${clips.length} clip(s) at ${cut}s)`);
