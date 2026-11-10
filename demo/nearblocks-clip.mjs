// The "check it yourself" part of the demo video: one of the trip's NEAR transactions on the public explorer.
//   1. screenshot the tx on testnet.nearblocks.io (light theme, Overview tab) → demo-video/nearblocks/tx.png (the tx this prints)
//   2. node demo/nearblocks-clip.mjs          → demo-video/nearblocks/clip-voiced.mp4
//   3. node demo/mcp-clip.mjs --splice        → inserts it after chapter 9, before the MCP part
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'demo-video');
const DIR = path.join(OUT, 'nearblocks');
const { video: V } = await import(pathToFileURL(path.join(ROOT, 'demo/scenario.mjs')).href);
const HF = `hyperframes@${V.hyperframesVersion || '0.8.78'}`;
const SECONDS = 7.5;
// the dinner's `pay` on NEAR (the first proof card in the video), from the recorded trip: NB_TX, or the newest trip
const HUB = process.env.HUB_URL ?? 'http://127.0.0.1:7373';
const TX = process.env.NB_TX ?? await (async () => {
  const id = process.env.DEMO_RUN ?? (await (await fetch(`${HUB}/api/runs`)).json()).find((r) => r.trip_id && r.status === 'booked')?.id;
  const run = await (await fetch(`${HUB}/api/runs/${id}`)).json();
  return run.results.find((x) => x.status === 'confirmed' && x.network === 'near:testnet').near_tx;
})();
console.log(`NearBlocks clip for ${TX}`);
const LINE = 'Here is that payment on NearBlocks. The agent called pay on the Wayfare contract, and it went through.';
if (!fs.existsSync(path.join(DIR, 'tx.png'))) throw new Error('missing demo-video/nearblocks/tx.png (screenshot of the tx on testnet.nearblocks.io)');

// highlight boxes, in % of the screenshot (1160×646)
const box = (x, y, w, h) => `left:${(x / 11.6).toFixed(2)}%;top:${(y / 6.46).toFixed(2)}%;width:${(w / 11.6).toFixed(2)}%;height:${(h / 6.46).toFixed(2)}%`;

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
  #head { position: absolute; left: 0; right: 0; top: 64px; text-align: center; }
  .eyebrow { display: inline-block; font: 700 22px 'JetBrains Mono'; color: #fff; background: #1f7a4f; border-radius: 10px; padding: 8px 16px; letter-spacing: .04em; }
  h2 { font: 700 60px/1.05 'Inter Tight'; letter-spacing: -.02em; margin-top: 20px; }
  #win { position: absolute; left: 310px; top: 240px; width: 1300px; background: #fff; border-radius: 18px; overflow: hidden;
    box-shadow: 0 1px 2px rgba(15,23,42,.08), 0 40px 80px -30px rgba(15,23,42,.45); transform-origin: 30% 30%; }
  .bar { height: 52px; background: #eef0f3; display: flex; align-items: center; gap: 9px; padding: 0 20px; border-bottom: 1px solid #e2e5ea; }
  .dot { width: 13px; height: 13px; border-radius: 50%; }
  .url { margin-left: 18px; flex: 1; height: 32px; border-radius: 8px; background: #fff; display: flex; align-items: center; padding: 0 14px;
    font: 500 17px 'JetBrains Mono'; color: #374151; white-space: nowrap; overflow: hidden; }
  .url b { color: #111; font-weight: 700; }
  .shot { position: relative; }
  .shot img { display: block; width: 100%; }
  .ring { position: absolute; border: 4px solid #1769e0; border-radius: 12px; box-shadow: 0 0 0 9999px rgba(15,23,42,0); }
</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${SECONDS}" data-width="1920" data-height="1080">
  <section id="nb" class="clip" data-start="0" data-duration="${SECONDS}" data-track-index="0">
    <div id="head">
      <div class="eyebrow">PUBLIC EXPLORER · NEAR TESTNET</div>
      <h2>Don't take our word for it.</h2>
    </div>
    <div id="win">
      <div class="bar"><i class="dot" style="background:#ff5f57"></i><i class="dot" style="background:#febc2e"></i><i class="dot" style="background:#28c840"></i>
        <div class="url"><b>testnet.nearblocks.io</b>/txns/${TX}</div></div>
      <div class="shot"><img src="tx.png" alt="" />
        <div class="ring" id="r1" style="${box(16, 180, 1128, 62)}"></div>
        <div class="ring" id="r2" style="${box(218, 334, 84, 34)}"></div>
        <div class="ring" id="r3" style="${box(218, 498, 180, 76)}"></div>
      </div>
    </div>
  </section>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.fromTo('#head > *', {opacity:0, y:22}, {opacity:1, y:0, duration:.5, stagger:.12, ease:'power3.out'}, .15);
  tl.fromTo('#win', {opacity:0, y:40}, {opacity:1, y:0, duration:.6, ease:'power3.out'}, .35);
  tl.to('#win', {scale:1.06, duration:${SECONDS - 1.6}, ease:'sine.inOut'}, 1.0);
  tl.fromTo('#r1', {opacity:0, scale:1.04}, {opacity:1, scale:1, duration:.35, ease:'power2.out'}, 1.6);
  tl.fromTo('#r2', {opacity:0, scale:1.2}, {opacity:1, scale:1, duration:.35, ease:'power2.out'}, 3.3);
  tl.fromTo('#r3', {opacity:0, scale:1.06}, {opacity:1, scale:1, duration:.35, ease:'power2.out'}, 4.6);
  tl.to('#nb', {opacity:0, duration:.4}, ${SECONDS - 0.45});
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
