// Makes the key moments of the demo video readable. Runs after the take is edited, around compose:
//   node demo/polish.mjs footage    take/edited.mp4 → take-final/ : camera pushes in on each key line, and holds there
//   node <skill>/scripts/compose.mjs --take demo-video/take-final ...
//   node demo/polish.mjs overlays   adds callout cards and inserts to the composition (agent's browser, x402, on-chain proof)
// The inserts use the trip's own files: the agent's screenshots (.data/trips/<run>) and three of its NEAR transactions.
//   node demo/polish.mjs show       prints the times and the trip's numbers, without changing anything
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'demo-video');
const TAKE = process.env.DEMO_TAKE ?? path.join(OUT, 'take'), FINAL = path.join(OUT, 'take-final'), PROJECT = path.join(OUT, 'hyperframes');
const HUB = process.env.HUB_URL ?? 'http://127.0.0.1:7373';
const getJSON = async (p) => (await fetch(`${HUB}${p}`)).json();
// the recorded trip: DEMO_RUN, or the newest trip that ended with its money back on NEAR
const RUN = process.env.DEMO_RUN ?? (await getJSON('/api/runs')).find((r) => r.trip_id && r.status === 'booked')?.id;
const SHOTS = path.join(ROOT, '.data/trips', RUN);

// All times are seconds of take/edited.mp4, placed from the chapter starts (the scenario's holds are fixed, so each
// moment sits at the same offset from its chapter in every take). Zoom centres are in the 2× working frame (2880×1800):
// footage pixel (x, y) is (2x, 2y), and a centre near an edge is clamped so the view stays inside the frame.
const chapters = JSON.parse(fs.readFileSync(path.join(TAKE, 'chapters.json'), 'utf8'));
const ch = (n) => {
  const c = chapters.find((x) => x.html.startsWith(`<b>${n} ·`));
  if (!c) throw new Error(`chapter ${n} is missing from take/chapters.json`);
  return c.t;
};
const r2 = (t) => +t.toFixed(2);
const ZOOMS = [
  { from: r2(ch(4) - 3.65), to: r2(ch(4) - 0.25), z: 1.5, x: 640, y: 320 }, // funded from NEAR, on Base, Arbitrum and NEAR
  { from: r2(ch(6) - 3.94), to: r2(ch(6) - 0.44), z: 1.2, x: 1440, y: 1170 }, // NEAR checked Kumo Air's signature on the refund (the card, full width)
  { from: r2(ch(7) - 6.64), to: r2(ch(7) - 0.24), z: 1.2, x: 1440, y: 750 }, // rebooked within the rule (full width: the % sits on the right)
  { from: r2(ch(8) - 3.84), to: r2(ch(8) - 0.19), z: 2.0, x: 840, y: 640 }, // refused by NEAR (the box sits at footage y ~340 after the scroll)
  { from: r2(ch(9) - 4.81), to: r2(ch(9) - 0.21), z: 1.3, x: 730, y: 380 }, // back as NEAR in savings
];
// freeze the (zoomed) frame here, so the callout can be read
const HOLDS = [
  { at: r2(ch(4) - 1.25), sec: 1.2 },
  { at: r2(ch(6) - 1.64), sec: 1.6 },
  { at: r2(ch(7) - 2.54), sec: 1.0 },
  { at: r2(ch(8) - 1.14), sec: 1.6 },
  { at: r2(ch(9) - 1.51), sec: 1.4 },
  { at: r2(ch(9) + 5.0), sec: 9.5 }, // the money-flow diagram: frozen while the camera visits its three parts
  { at: r2(ch(9) + 11.49), sec: 1.4 },
];
// the three parts of the diagram (demo-video/flow/flow.png, a 2× screenshot of the recorded trip's diagram):
// focus point as a fraction of the image, zoom, label, and when the camera gets there (s into the freeze)
const FLOW = { hold: HOLDS.find((h) => h.sec === 9.5), parts: [
  { fx: 0.296, fy: 0.537, s: 1.75, at: 0.6, label: '1 · The agent only asks; the contract decides' },
  { fx: 0.60, fy: 0.42, s: 1.6, at: 3.6, label: '2 · NEAR MPC signs one wallet on 3 chains' },
  { fx: 0.75, fy: 0.48, s: 2.0, at: 6.6, label: '3 · USDC goes straight to each merchant' },
] };
const shift = (t) => t + HOLDS.filter((h) => h.at < t).reduce((s, h) => s + h.sec, 0);
const RAMP = 0.5;

function footage() {
  // 1 · zoom (eased in and out, at 2× so the moving crop lands on half pixels)
  const ease = (u) => `(${u})*(${u})*(3-2*(${u}))`;
  const c01 = (e) => `clip(${e},0,1)`;
  const env = ({ from, to }) => `${ease(c01(`(it-${from})/${RAMP}`))}*${ease(c01(`(${to}-it)/${RAMP}`))}`;
  const z = `1+${ZOOMS.map((k) => `${(k.z - 1).toFixed(3)}*${env(k)}`).join('+')}`;
  const pick = (key, d) => ZOOMS.reduceRight((acc, k) => `if(between(it,${k.from - 0.2},${k.to + 0.2}),${k[key]},${acc})`, d);
  const zoom = `scale=2880:1800:flags=lanczos,zoompan=z='${z}':x='clip(${pick('x', 720)}-iw/zoom/2,0,iw-iw/zoom)':y='clip(${pick('y', 450)}-ih/zoom/2,0,ih-ih/zoom)':d=1:s=1440x900:fps=30`;

  // 2 · holds: cut at each hold, freeze its first frame for `sec`, concat
  const cuts = [0, ...HOLDS.map((h) => h.at), 1e9];
  const parts = [], labels = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const hold = HOLDS[i];
    const pad = hold ? `,tpad=stop_mode=clone:stop_duration=${hold.sec}` : '';
    parts.push(`[z${i}]trim=start=${cuts[i]}:end=${cuts[i + 1]},setpts=PTS-STARTPTS${pad}[p${i}]`);
    labels.push(`[p${i}]`);
  }
  // the recorder's yellow "sped up" pill → Wayfare light blue (only the yellow is keyed out; text and page stay)
  // …and the recorder flashes it for a split second on the first, near-instant wait (the home page loading): blank it there
  const flash = `between(t,${(ch(1) - 0.6).toFixed(2)},${(ch(1) + 0.8).toFixed(2)})`;
  // (patched with the same strip from a clean frame a second later; the page doesn't move there)
  const clean = (ch(1) + 1.2).toFixed(2);
  const pill = `[0:v]split=3[base][pc][pp];[pc]crop=400:60:520:4,colorkey=0xFFE401:0.32:0.08[pk];color=c=0xD3E3FF:s=400x60:r=30[pb];[pb][pk]overlay=shortest=1[pn];` +
    `[pp]trim=start=${clean}:duration=0.05,setpts=PTS-STARTPTS,crop=400:60:520:4,loop=loop=-1:size=1,setpts=N/30/TB[patch];` +
    `[base][pn]overlay=520:4[rp];[rp][patch]overlay=520:4:shortest=1:enable='${flash}'[rc]`;
  const fc = `${pill};[rc]${zoom},split=${parts.length}${parts.map((_, i) => `[z${i}]`).join('')};${parts.join(';')};${labels.join('')}concat=n=${parts.length}:v=1:a=0[v]`;
  fs.mkdirSync(FINAL, { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${TAKE}/edited.mp4`, '-filter_complex', fc, '-map', '[v]', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', `${FINAL}/edited.mp4`], { stdio: 'inherit' });

  // 3 · chapter and caption times move with the holds
  for (const f of ['chapters.json', 'captions.json', 'marks.json']) {
    if (!fs.existsSync(`${TAKE}/${f}`)) continue;
    const j = JSON.parse(fs.readFileSync(`${TAKE}/${f}`, 'utf8'));
    const moved = Array.isArray(j) ? j.map((c) => (typeof c?.t === 'number' ? { ...c, t: +shift(c.t).toFixed(3) } : c)) : j;
    fs.writeFileSync(`${FINAL}/${f}`, JSON.stringify(moved));
  }
  // when each callout and the proof cards appear (take-final time), so narrate.mjs can speak over them
  fs.writeFileSync(`${FINAL}/moments.json`, JSON.stringify({ zooms: ZOOMS.map((k) => +shift(k.from + 0.35).toFixed(2)), proof: +shift(INSERTS.proof.from + 0.3).toFixed(2), flow: FLOW.parts.map((p) => +(shift(FLOW.hold.at) + p.at).toFixed(2)) }));
  const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${FINAL}/edited.mp4`]).toString().trim();
  console.log(`→ ${FINAL}/edited.mp4 (${(+d).toFixed(1)}s, ${ZOOMS.length} zooms, +${HOLDS.reduce((s, h) => s + h.sec, 0).toFixed(1)}s of holds)`);
}

// ── overlays ────────────────────────────────────────────────────────────────
// callouts and the proof insert, from the recorded trip itself
const run = await getJSON(`/api/runs/${RUN}`);
const status = await getJSON('/api/status');
const usd = (b) => String(Number((Number(b) / 1e6).toFixed(2)));
const name = (id) => status.merchants.find((m) => m.id === id)?.name ?? id;
const f = run.funded, back = run.returned, d = run.disruption;
const kumo = d.cancelled.find((c) => c.by === 'merchant') ?? d.cancelled[0];
const pct = (x) => {
  const was = d.cancelled.find((c) => c.item === x.item);
  const p = was ? Math.round(((x.amount - Number(was.refund)) / Number(was.refund)) * 1000) / 10 : 0;
  return `${run.plan.items[x.item].kind.replace(/^./, (c) => c.toUpperCase())} ${p >= 0 ? '+' : ''}${p}%`;
};
const refused = run.results.find((x) => x.label.endsWith('(upgrade)') && x.status !== 'confirmed');
const dinner = run.results.find((x) => x.status === 'confirmed' && x.network === 'near:testnet');
const nearWallet = status.chains.find((c) => c.id === 'near:testnet')?.account ?? '';
const CALLOUTS = [
  { zoom: 0, tag: 'ON-RAMP · NEAR INTENTS', tone: 'blue', title: `${Number(f.near).toFixed(2)} NEAR → ${usd(f.usdc)} USDC on ${f.legs.length} chains`, sub: 'Base, Arbitrum and NEAR: one deposit from your NEAR savings, priced live' },
  { zoom: 1, tag: 'REFUND VERIFIED ON NEAR', tone: 'green', title: 'The airline signed the cancellation', sub: `NEAR checks ${name(kumo.merchant)}’s signature before ${usd(kumo.refund)} USDC counts` },
  { zoom: 2, tag: 'REBOOKED · NO PROMPT', tone: 'green', title: d.rebooked.map(pct).map((t, i) => (i ? t.toLowerCase() : t)).join(', '), sub: `${d.rebooked.length > 1 ? 'both' : 'all'} inside your +${run.rebook_pct}% rebooking rule, enforced by the contract` },
  { zoom: 3, tag: 'REFUSED BY NEAR', tone: 'red', title: 'No signature, no payment', sub: `${(refused.amount / 1e6).toFixed(2)} USDC asked · ${(run.plan.items[refused.item].total / 1e6).toFixed(2)} USDC approved for this room` },
  { zoom: 4, tag: 'OFF-RAMP · NEAR INTENTS', tone: 'blue', title: `${usd(back.amount)} USDC on ${back.legs.length} chains → ${Number(back.near).toFixed(4)} NEAR`, sub: 'what’s left comes home to your NEAR savings' },
];
const INSERTS = {
  browser: { from: r2(ch(2) + 0.27), to: r2(ch(3) - 0.22) },
  x402: { from: r2(ch(4) + 0.35), to: r2(ch(4) + 5.35) },
  proof: { from: r2(ch(9) + 6.89), to: r2(ch(9) + 13.64) },
};
// three real transactions of this trip, on NEAR testnet
const TXS = [
  { hash: dinner.near_tx, method: 'pay', what: `${name('sumi-table')} · ${usd(dinner.amount)} USDC on NEAR`,
    flow: ['agent asks', 'wf.ghcsmw3fimg2.testnet checks the plan', 'v1.signer-prod.testnet · ed25519 signs', 'event payment_signed'] },
  { hash: dinner.settle_tx, method: 'x402 settle', what: 'the dinner, paid on NEAR',
    flow: ['x402.ghcsmw3fimg2.testnet relays, pays gas', `Delegate from trip wallet ${nearWallet.slice(0, 4)}…${nearWallet.slice(-4)}`, 'USDC ft_transfer → sumi-table'] },
  { hash: kumo.near_tx, method: 'record_cancellation', what: `${name(kumo.merchant)} refund · ${usd(kumo.refund)} USDC on Base`,
    flow: ['merchant’s signature', 'wf.ghcsmw3fimg2.testnet recovers the signer', `matches ${name(kumo.merchant)}’s pay-to`, 'event booking_cancelled'] },
];
if (process.argv[2] === 'show') {
  console.log(JSON.stringify({ RUN, trip: run.trip_id, ZOOMS, HOLDS, INSERTS, CALLOUTS: CALLOUTS.map((c) => `${c.title} | ${c.sub}`), TXS: TXS.map((t) => `${t.method} ${t.hash}`) }, null, 1));
  process.exit(0);
}

function overlays() {
  const { video: V } = await_import(path.join(ROOT, 'demo/scenario.mjs'));
  const F0 = (V.intro?.seconds ?? 6.5) + (V.problem?.seconds ?? 0);
  const T = (t) => +(F0 + shift(t)).toFixed(2);
  const A = path.join(PROJECT, 'assets');
  fs.copyFileSync(`${FINAL}/edited.mp4`, `${A}/app.mp4`);

  // the agent's own screenshots: the four sites it searched, and two x402 checkouts (cropped to the payment box)
  const shot = (name, out, crop) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${SHOTS}/${name}.png`, ...(crop ? ['-vf', `crop=${crop}`] : []), `${A}/${out}`]);
  shot('plan-flight', 'site-flight.png'); shot('plan-hotel', 'site-hotel.png'); shot('plan-train', 'site-train.png'); shot('plan-dinner', 'site-dinner.png');
  shot('book-flight-pay', 'pay-base.png', '1100:400:100:130'); shot('book-dinner-pay', 'pay-near.png', '1100:400:100:130');

  const html = [], anim = [];
  const clip = (id, t0, t1, body, cls = '') => {
    html.push(`<section id="${id}" class="clip wf-layer ${cls}" data-start="${t0}" data-duration="${+(t1 - t0).toFixed(2)}" data-track-index="3" data-layout-allow-overlap>${body}</section>`);
  };

  CALLOUTS.forEach((c, i) => {
    const k = ZOOMS[c.zoom];
    const t0 = T(k.from + 0.35), t1 = T(k.to - 0.25);
    clip(`wfc${i}`, t0, t1, `<div class="wf-callout"><span class="wf-tag ${c.tone}">${c.tag}</span><div class="wf-ct">${c.title}</div><div class="wf-cs">${c.sub}</div></div>`);
    anim.push(`tl.fromTo('#wfc${i} .wf-callout', {opacity:0, y:24}, {opacity:1, y:0, duration:.4, ease:'power3.out'}, ${t0})`);
    anim.push(`tl.to('#wfc${i} .wf-callout', {opacity:0, duration:.25}, ${(t1 - 0.25).toFixed(2)})`);
  });

  // insert 1 · the agent's browser
  {
    const t0 = T(INSERTS.browser.from), t1 = T(INSERTS.browser.to);
    const cells = [['site-flight', 'Kumo Air · flights'], ['site-hotel', 'Lantern Stays · ryokan'], ['site-train', 'Kiseki Rail · trains'], ['site-dinner', 'Sumi Table · dinner']]
      .map(([f, l], j) => `<div class="wf-cell" id="wfb${j}"><img src="assets/${f}.png" alt=""/><span>${l}</span></div>`).join('');
    clip('wfbrowser', t0, t1, `<div class="wf-panel"><div class="wf-head"><span class="wf-tag blue">THE AGENT’S BROWSER</span> searching 4 booking sites, as a person would</div><div class="wf-grid">${cells}</div></div>`);
    anim.push(`tl.fromTo('#wfbrowser .wf-panel', {opacity:0}, {opacity:1, duration:.35}, ${t0})`);
    anim.push(`tl.fromTo('#wfbrowser .wf-cell', {opacity:0, scale:.94}, {opacity:1, scale:1, duration:.4, stagger:.18, ease:'power3.out'}, ${(t0 + 0.2).toFixed(2)})`);
    anim.push(`tl.to('#wfbrowser .wf-panel', {opacity:0, duration:.3}, ${(t1 - 0.3).toFixed(2)})`);
  }
  // insert 2 · x402: what each checkout asks for
  {
    const t0 = T(INSERTS.x402.from), t1 = T(INSERTS.x402.to);
    const pays = [['pay-base', 'Kumo Air · Base Sepolia'], ['pay-near', 'Sumi Table · NEAR testnet']]
      .map(([f, l], j) => `<div class="wf-pay" id="wfp${j}"><span class="wf-tag ${j ? 'green' : 'blue'}">${l}</span><img src="assets/${f}.png" alt=""/></div>`).join('');
    clip('wfx402', t0, t1, `<div class="wf-panel"><div class="wf-head"><span class="wf-tag dark">HTTP 402 · PAYMENT REQUIRED</span> each checkout asks for USDC; NEAR signs it</div><div class="wf-pays">${pays}</div></div>`);
    anim.push(`tl.fromTo('#wfx402 .wf-panel', {opacity:0}, {opacity:1, duration:.35}, ${t0})`);
    anim.push(`tl.fromTo('#wfx402 .wf-pay', {opacity:0, x:-30}, {opacity:1, x:0, duration:.45, stagger:.35, ease:'power3.out'}, ${(t0 + 0.2).toFixed(2)})`);
    anim.push(`tl.to('#wfx402 .wf-panel', {opacity:0, duration:.3}, ${(t1 - 0.3).toFixed(2)})`);
  }
  // insert 4 · the money-flow diagram, close up: three camera moves over a sharp screenshot of it
  {
    fs.copyFileSync(path.join(OUT, 'flow', 'flow.png'), `${A}/flow.png`);
    const t0 = T(FLOW.hold.at), t1 = +(t0 + FLOW.hold.sec).toFixed(2);
    const VW = 1316, VH = 741; // the view, the image's own aspect (2210×1244)
    const cam = ({ fx, fy, s }) => {
      const x = Math.min(0, Math.max(VW - s * VW, VW / 2 - s * fx * VW)), y = Math.min(0, Math.max(VH - s * VH, VH / 2 - s * fy * VH));
      return `{x:${x.toFixed(1)}, y:${y.toFixed(1)}, scale:${s}}`;
    };
    const labels = FLOW.parts.map((p, j) => `<span class="wf-flowlabel" id="wffl${j}">${p.label}</span>`).join('');
    clip('wfflow', t0, t1, `<div class="wf-panel"><div class="wf-head"><span class="wf-tag blue">HOW THE MONEY MOVED</span> one trip, three parts</div><div class="wf-flowview"><img id="wfflowimg" src="assets/flow.png" alt=""/>${labels}</div></div>`);
    anim.push(`tl.fromTo('#wfflow .wf-panel', {opacity:0}, {opacity:1, duration:.35}, ${t0})`);
    anim.push(`tl.set('#wfflowimg', {x:0, y:0, scale:1}, ${t0})`);
    FLOW.parts.forEach((p, j) => {
      anim.push(`tl.to('#wfflowimg', {...${cam(p)}, duration:.8, ease:'power2.inOut'}, ${(t0 + p.at - 0.4).toFixed(2)})`);
      anim.push(`tl.fromTo('#wffl${j}', {opacity:0, y:12}, {opacity:1, y:0, duration:.35}, ${(t0 + p.at + 0.2).toFixed(2)})`);
      const next = FLOW.parts[j + 1];
      anim.push(`tl.to('#wffl${j}', {opacity:0, duration:.25}, ${(t0 + (next ? next.at - 0.45 : FLOW.hold.sec - 0.6)).toFixed(2)})`);
    });
    anim.push(`tl.to('#wfflowimg', {x:0, y:0, scale:1, duration:.5, ease:'power2.inOut'}, ${(t1 - 0.85).toFixed(2)})`);
    anim.push(`tl.to('#wfflow .wf-panel', {opacity:0, duration:.3}, ${(t1 - 0.3).toFixed(2)})`);
  }
  // insert 3 · on-chain proof
  {
    const t0 = T(INSERTS.proof.from), t1 = T(INSERTS.proof.to);
    const rows = TXS.map((x, j) => `<div class="wf-tx" id="wft${j}"><div class="wf-txh"><span class="wf-m">${x.method}</span><span class="wf-what">${x.what}</span><span class="wf-ok">✓ SUCCESS</span></div>
      <div class="wf-flow">${x.flow.map((s) => `<span>${s}</span>`).join('<i>→</i>')}</div>
      <div class="wf-hash">testnet.nearblocks.io/txns/${x.hash}</div></div>`).join('');
    clip('wfproof', t0, t1, `<div class="wf-panel"><div class="wf-head"><span class="wf-tag green">ON NEAR TESTNET</span> three of this trip’s transactions · check them yourself</div><div class="wf-txs">${rows}</div></div>`);
    anim.push(`tl.fromTo('#wfproof .wf-panel', {opacity:0}, {opacity:1, duration:.35}, ${t0})`);
    anim.push(`tl.fromTo('#wfproof .wf-tx', {opacity:0, y:26}, {opacity:1, y:0, duration:.45, stagger:.5, ease:'power3.out'}, ${(t0 + 0.2).toFixed(2)})`);
    anim.push(`tl.to('#wfproof .wf-panel', {opacity:0, duration:.3}, ${(t1 - 0.3).toFixed(2)})`);
  }

  const css = `
      .wf-layer { z-index: 8; pointer-events: none; }
      .wf-tag { display: inline-block; font: 700 17px 'JetBrains Mono', monospace; letter-spacing: .08em; padding: 7px 14px; border-radius: 999px; color: #fff; }
      .wf-tag.blue { background: #1462d4; } .wf-tag.green { background: #17734c; } .wf-tag.red { background: #a8360a; }
      .wf-tag.dark { background: #0f172a; } .wf-tag.violet { background: #4f46e5; }
      .wf-callout { position: absolute; left: 84px; top: 790px; max-width: 1060px; padding: 22px 30px 24px; border-radius: 22px;
        background: #0b2f6b; color: #fff; box-shadow: 0 30px 60px -24px rgba(11,47,107,.7); }
      .wf-ct { font: 700 44px/1.1 'Inter Tight', sans-serif; margin-top: 12px; letter-spacing: -.01em; }
      .wf-cs { font: 500 24px/1.3 'Inter Tight', sans-serif; color: #d6e4ff; margin-top: 8px; }
      .wf-panel { position: absolute; left: 52px; top: 108px; width: 1384px; height: 862px; border-radius: 16px; background: #f6f5f3;
        padding: 26px 34px; display: flex; flex-direction: column; gap: 20px; }
      .wf-head { font: 600 28px 'Inter Tight', sans-serif; color: #0f172a; display: flex; align-items: center; gap: 16px; }
      .wf-grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 18px; flex: 1; min-height: 0; }
      .wf-cell { position: relative; min-height: 0; border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 18px 36px -20px rgba(15,23,42,.5); border: 1px solid rgba(15,23,42,.1); }
      .wf-cell img { width: 100%; height: 100%; object-fit: cover; object-position: top left; display: block; }
      .wf-cell span { position: absolute; left: 14px; bottom: 14px; font: 700 20px 'Inter Tight', sans-serif; background: #1769e0; color: #fff; padding: 8px 14px; border-radius: 10px; }
      .wf-pays { display: flex; flex-direction: column; gap: 22px; align-items: center; }
      .wf-pay { position: relative; width: 1100px; }
      .wf-pay img { width: 1100px; height: 330px; object-fit: cover; object-position: top left; display: block; border-radius: 14px; border: 1px solid rgba(15,23,42,.12); box-shadow: 0 18px 36px -20px rgba(15,23,42,.5); }
      .wf-pay .wf-tag { position: absolute; right: 16px; top: 16px; }
      .wf-txs { display: flex; flex-direction: column; gap: 16px; margin-top: 6px; }
      .wf-tx { background: #fff; border-radius: 18px; padding: 20px 28px; border: 1px solid rgba(15,23,42,.1); box-shadow: 0 18px 36px -20px rgba(15,23,42,.4); }
      .wf-txh { display: flex; align-items: center; gap: 18px; }
      .wf-m { font: 700 30px 'JetBrains Mono', monospace; color: #1769e0; }
      .wf-what { font: 600 28px 'Inter Tight', sans-serif; color: #0f172a; flex: 1; }
      .wf-ok { font: 700 20px 'JetBrains Mono', monospace; color: #1f8a5b; background: #e7f6ee; padding: 6px 12px; border-radius: 8px; }
      .wf-flow { margin-top: 14px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font: 600 21px 'JetBrains Mono', monospace; color: #0f172a; }
      .wf-flow span { background: #f1f5f9; padding: 8px 12px; border-radius: 8px; }
      .wf-flow i { font-style: normal; color: #64748b; }
      .wf-hash { margin-top: 16px; font: 500 19px 'JetBrains Mono', monospace; color: #475569; }
      .wf-flowview { position: relative; width: 1316px; height: 741px; overflow: hidden; border-radius: 16px; background: #fff; border: 1px solid rgba(15,23,42,.1); box-shadow: 0 18px 36px -20px rgba(15,23,42,.4); }
      .wf-flowview img { position: absolute; left: 0; top: 0; width: 1316px; height: 741px; transform-origin: 0 0; display: block; }
      .wf-flowlabel { position: absolute; left: 24px; bottom: 24px; opacity: 0; font: 700 26px 'Inter Tight', sans-serif; color: #fff; background: #0b2f6b; padding: 12px 20px; border-radius: 14px; box-shadow: 0 18px 36px -16px rgba(11,47,107,.7); }
`;
  const file = path.join(PROJECT, 'index.html');
  let page = fs.readFileSync(file, 'utf8');
  if (page.includes('wf-layer')) throw new Error('overlays already added: run compose again first');
  page = page.replace('</style>', `${css}    </style>`);
  page = page.replace(/(\n\s*<\/div>\n\s*<script>)/, `\n      ${html.join('\n      ')}$1`);
  page = page.replace('window.__timelines = window.__timelines', `${anim.join(';\n      ')};\n      window.__timelines = window.__timelines`);
  fs.writeFileSync(file, page);
  console.log(`overlays: ${CALLOUTS.length} callouts, 4 inserts (money flow ${T(FLOW.hold.at)}s), (browser ${T(INSERTS.browser.from)}s, x402 ${T(INSERTS.x402.from)}s, proof ${T(INSERTS.proof.from)}s)`);
}

let await_import;
const mode = process.argv[2];
if (mode === 'footage') footage();
else if (mode === 'overlays') {
  const mod = await import(pathToFileURL(path.join(ROOT, 'demo/scenario.mjs')).href);
  await_import = () => mod;
  overlays();
} else console.log('usage: node demo/polish.mjs footage|overlays');
