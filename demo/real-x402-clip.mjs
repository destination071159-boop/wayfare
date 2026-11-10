// The "not only our demo sites" part of the demo video: the agent pays a real, public x402 service (a weather API from
// the x402 Bazaar) on the real Base Sepolia, through the Wayfare contract. From the run of `pnpm -C agent pay:real`
// (trip #28) and a screenshot of its settlement on BaseScan (demo-video/real-x402/tx.png).
//   node demo/real-x402-clip.mjs   →  demo-video/real-x402/clip-voiced.mp4, then node demo/mcp-clip.mjs --splice
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'demo-video');
const DIR = path.join(OUT, 'real-x402');
const { video: V } = await import(pathToFileURL(path.join(ROOT, 'demo/scenario.mjs')).href);
const HF = `hyperframes@${V.hyperframesVersion || '0.8.78'}`;
const SECONDS = 12;
const TX = '0x7a40784be93f2f297b59dd3029bb22c26f02b4a65a64a56768b1cda38482fbb8';
const LINE = 'And not only our demo sites. Here the agent pays a real, public x402 weather API on Base Sepolia. NEAR checks it and signs, and the agent gets Kyoto\u2019s weather.';
if (!fs.existsSync(path.join(DIR, 'tx.png'))) throw new Error('missing demo-video/real-x402/tx.png (the settlement on sepolia.basescan.org)');

// lines from the real run (trip #28)
const L = [
  ['cmd', '$ pnpm pay:real   <i># CITY=Kyoto</i>'],
  ['res', 'GET weather API → <b>402</b>: 0.001 USDC'],
  ['ok', 'trip #28 approved · cap 0.01 USDC'],
  ['ok', 'NEAR checks the item · MPC signs'],
  ['res', 'paid via x402 → <b>200 OK</b>'],
  ['wx', 'Kyoto · 11.9 °C · mainly clear'],
  ['ok', 'settled · Base Sepolia · 0x7a40…fbb8'],
];
// highlight boxes, in % of the screenshot (1126×618)
const box = (x, y, w, h) => `left:${(x / 11.26).toFixed(2)}%;top:${(y / 6.18).toFixed(2)}%;width:${(w / 11.26).toFixed(2)}%;height:${(h / 6.18).toFixed(2)}%`;

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
  #head { position: absolute; left: 0; right: 0; top: 56px; text-align: center; }
  .eyebrow { display: inline-block; font: 700 22px 'JetBrains Mono'; color: #fff; background: #1769e0; border-radius: 10px; padding: 8px 16px; letter-spacing: .04em; }
  h2 { font: 700 62px/1.05 'Inter Tight'; letter-spacing: -.02em; margin-top: 20px; }
  .note { font: 500 26px 'Inter Tight'; color: #4b5563; margin-top: 14px; }
  #term { position: absolute; left: 48px; top: 340px; width: 640px; background: #0d1117; border-radius: 18px; overflow: hidden;
    box-shadow: 0 1px 2px rgba(15,23,42,.08), 0 40px 80px -30px rgba(15,23,42,.55); }
  .bar { height: 50px; display: flex; align-items: center; gap: 9px; padding: 0 20px; }
  #term .bar { background: #161b22; } #term .bar span { margin-left: 12px; font: 500 18px 'JetBrains Mono'; color: #8b949e; }
  .dot { width: 13px; height: 13px; border-radius: 50%; }
  .lines { padding: 28px 30px 34px; display: flex; flex-direction: column; gap: 17px; }
  .l { font: 500 20px/1.35 'JetBrains Mono'; color: #c9d1d9; white-space: nowrap; }
  .l i { color: #8b949e; font-style: normal; } .l b { color: #79c0ff; }
  .cmd { color: #f0f6fc; } .ok { color: #7ee787; } .res { color: #c9d1d9; } .wx { color: #e3b341; }
  #win { position: absolute; left: 720px; top: 310px; width: 1160px; background: #fff; border-radius: 18px; overflow: hidden;
    box-shadow: 0 1px 2px rgba(15,23,42,.08), 0 40px 80px -30px rgba(15,23,42,.45); }
  #win .bar { background: #eef0f3; border-bottom: 1px solid #e2e5ea; }
  .url { margin-left: 16px; flex: 1; height: 30px; border-radius: 8px; background: #fff; display: flex; align-items: center; padding: 0 12px;
    font: 500 15px 'JetBrains Mono'; color: #374151; white-space: nowrap; overflow: hidden; }
  .url b { color: #111; }
  .shot { position: relative; } .shot img { display: block; width: 100%; }
  .ring { position: absolute; border: 4px solid #1769e0; border-radius: 12px; }
</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${SECONDS}" data-width="1920" data-height="1080">
  <section id="rx" class="clip" data-start="0" data-duration="${SECONDS}" data-track-index="0">
    <div id="head">
      <div class="eyebrow">A REAL x402 SERVICE · NOT OURS</div>
      <h2>Not only our demo sites.</h2>
      <div class="note">A public weather API from the x402 Bazaar, paid on the real Base Sepolia</div>
    </div>
    <div id="term">
      <div class="bar"><i class="dot" style="background:#ff5f57"></i><i class="dot" style="background:#febc2e"></i><i class="dot" style="background:#28c840"></i><span>wayfare agent</span></div>
      <div class="lines">${L.map(([k, t], i) => `<div class="l ${k}" id="l${i}">${t}</div>`).join('')}</div>
    </div>
    <div id="win">
      <div class="bar"><i class="dot" style="background:#ff5f57"></i><i class="dot" style="background:#febc2e"></i><i class="dot" style="background:#28c840"></i>
        <div class="url"><b>sepolia.basescan.org</b>/tx/${TX.slice(0, 26)}…</div></div>
      <div class="shot"><img src="tx.png" alt="" />
        <div class="ring" id="r1" style="${box(10, 186, 1106, 60)}"></div>
        <div class="ring" id="r2" style="${box(294, 340, 72, 30)}"></div>
      </div>
    </div>
  </section>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.fromTo('#head > *', {opacity:0, y:22}, {opacity:1, y:0, duration:.5, stagger:.12, ease:'power3.out'}, .15);
  tl.fromTo('#term', {opacity:0, y:40}, {opacity:1, y:0, duration:.6, ease:'power3.out'}, .45);
  ${L.map((_, i) => `tl.fromTo('#l${i}', {opacity:0, x:-12}, {opacity:1, x:0, duration:.3, ease:'power2.out'}, ${(0.9 + i * 0.75).toFixed(2)});`).join('\n  ')}
  tl.fromTo('#win', {opacity:0, y:40}, {opacity:1, y:0, duration:.6, ease:'power3.out'}, ${(0.9 + (L.length - 1) * 0.75 + 0.2).toFixed(2)});
  tl.fromTo('#r1', {opacity:0, scale:1.04}, {opacity:1, scale:1, duration:.35, ease:'power2.out'}, ${(0.9 + (L.length - 1) * 0.75 + 1.0).toFixed(2)});
  tl.fromTo('#r2', {opacity:0, scale:1.2}, {opacity:1, scale:1, duration:.35, ease:'power2.out'}, ${(0.9 + (L.length - 1) * 0.75 + 1.8).toFixed(2)});
  tl.to('#rx', {opacity:0, duration:.4}, ${SECONDS - 0.45});
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
  tl.seek(0);
</script>
</body></html>`;

fs.writeFileSync(path.join(DIR, 'index.html'), html);
for (const f of ['hyperframes.json', 'package.json']) fs.copyFileSync(path.join(OUT, 'hyperframes', f), path.join(DIR, f));
const clip = path.join(DIR, 'clip.mp4');
execFileSync('npx', ['--yes', HF, 'render', '-o', clip, '--fps', '30', '--quality', 'high', '--video-frame-format', 'png', '-w', '1'], { cwd: DIR, stdio: 'inherit' });

// voice (same model and cache as narrate.mjs)
const env = { ...process.env, HYPERFRAMES_PYTHON: process.env.HYPERFRAMES_PYTHON ?? path.join(os.homedir(), '.cache/hf-tts-venv/bin/python') };
const vo = path.join(OUT, 'vo', `${crypto.createHash('sha1').update(`af_heart|1.05|${LINE}`).digest('hex').slice(0, 14)}.wav`);
if (!fs.existsSync(vo)) execFileSync('npx', ['--yes', HF, 'tts', LINE, '-v', 'af_heart', '-s', '1.05', '-o', vo], { env, stdio: 'ignore' });
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const vd = dur(vo);
const tempo = vd > SECONDS - 0.7 ? Math.min(vd / (SECONDS - 0.7), 1.22) : 1;
console.log(`voice ${vd.toFixed(1)}s${tempo > 1 ? ` sped ${tempo.toFixed(2)}x` : ''}`);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', clip, '-i', vo, '-filter_complex', `[1:a]aresample=48000,aformat=channel_layouts=stereo${tempo > 1 ? `,atempo=${tempo.toFixed(4)}` : ''},adelay=300|300,apad[a]`, '-map', '0:v', '-map', '[a]', '-t', String(SECONDS), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', path.join(DIR, 'clip-voiced.mp4')]);
console.log(`→ ${path.join(DIR, 'clip-voiced.mp4')}`);
