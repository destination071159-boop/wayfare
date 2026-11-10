// Adds the voice to the rendered demo video: one line per card, per chapter, and per zoomed callout, spoken by a local voice model
// (Kokoro via `hyperframes tts`, free, the same voice as the Trellis video) and placed where that part starts.
//   node demo/narrate.mjs   →  demo-video/wayfare-demo.mp4
// One-time voice setup: python3 -m venv ~/.cache/hf-tts-venv && ~/.cache/hf-tts-venv/bin/pip install kokoro-onnx soundfile
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'demo-video');
const { video: V } = await import(pathToFileURL(path.join(ROOT, 'demo/scenario.mjs')).href);
const HF = `hyperframes@${V.hyperframesVersion || '0.8.78'}`;
const VOICE = 'af_heart', SPEED = '1.05', MAX_TEMPO = 1.22;

const LINES = {
  intro: 'Wayfare. An AI agent books your trip, and never touches your money.',
  problem: 'Today, an agent that pays for you gets your card, or your keys. Wayfare gives it neither.',
  1: 'I just ask, in plain words. A flight from Bangkok to Kyoto, two nights near Gion, sushi for two, and a budget of a thousand dollars.',
  2: 'The agent searches four booking sites, in a real browser.',
  3: 'I approve the plan once. The price is a live NEAR Intents quote, and I choose how much more a rebooking may cost without asking me. Then I fund it, straight from my NEAR savings.',
  z0: 'One NEAR deposit funds the trip, on Base, Arbitrum, and NEAR itself.',
  4: 'Each checkout asks for x402. The agent only asks. NEAR checks the rules and signs, on Base, on Arbitrum, and with x402 on NEAR too.',
  5: 'Then a typhoon. Kumo Air cancels the flight, and refunds it.',
  z1: 'But a refund only counts once NEAR checks the airline\u2019s signature on it.',
  6: 'The agent sees the train no longer connects, so it changes that too.',
  z2: 'Both are rebooked inside my twenty percent rule, so it never has to ask me.',
  7: 'Now the agent tries a pricier room, one I never approved, and asks NEAR to pay for it.',
  z3: 'NEAR refuses to sign. No signature, no payment.',
  8: 'When I end the trip, the agent can\u2019t pay for anything else.',
  z4: 'What\u2019s left on all three chains comes home, swapped back to NEAR.',
  9: 'Every payment, refund and refusal: signed, or blocked, by one NEAR contract.',
  f0: 'The agent only asks. The contract decides.',
  f1: 'NEAR signs one wallet, on three chains.',
  f2: 'And the USDC goes straight to each merchant.',
  proof: 'Here are three of them on NEAR testnet: the dinner\u2019s signature, its x402 payment, and the airline\u2019s signed refund. Check them yourself.',
  outro: 'Wayfare. Your trip, booked and paid. Your money, never handed over.',
};

const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

// the same timeline compose.mjs builds
const chapters = JSON.parse(fs.readFileSync(path.join(OUT, fs.existsSync(path.join(OUT, 'take-final/chapters.json')) ? 'take-final' : 'take', 'chapters.json'), 'utf8'));
const find = (re) => chapters.find((c) => re.test(c.html ?? ''));
const INTRO = V.intro?.seconds ?? 6.5, PROBLEM = V.problem ? (V.problem.seconds ?? 7.5) : 0, OUTRO = V.outro?.seconds ?? 8;
const skip = Math.max(0, (find(V.footage.startAt)?.t ?? 1.4) - 1.4);
const F0 = INTRO + PROBLEM;
const film = path.join(OUT, 'demo-hyperframes.mp4');
const TOTAL = dur(film);
const at = (t) => F0 + (t - skip);

const cues = [{ key: 'intro', t: 0.4 }, { key: 'problem', t: INTRO + 0.3 }];
V.chapters.forEach((c, i) => {
  const ch = find(c.match);
  if (ch) cues.push({ key: String(i + 1), t: at(ch.t) + 0.25 });
});
// a line over each zoomed callout and over the proof cards (times from polish.mjs footage)
const mfile = path.join(OUT, 'take-final', 'moments.json');
if (fs.existsSync(mfile)) {
  const mo = JSON.parse(fs.readFileSync(mfile, 'utf8'));
  mo.zooms.forEach((t, i) => cues.push({ key: `z${i}`, t: at(t) }));
  cues.push({ key: 'proof', t: at(mo.proof) });
  (mo.flow ?? []).forEach((t, i) => cues.push({ key: `f${i}`, t: at(t) }));
}
cues.push({ key: 'outro', t: TOTAL - OUTRO + 0.4 });
cues.sort((a, b) => a.t - b.t);

// voice each line once (cached by voice + text)
const cache = path.join(OUT, 'vo');
fs.mkdirSync(cache, { recursive: true });
const env = { ...process.env, HYPERFRAMES_PYTHON: process.env.HYPERFRAMES_PYTHON ?? path.join(os.homedir(), '.cache/hf-tts-venv/bin/python') };
const tts = (text) => {
  const f = path.join(cache, `${crypto.createHash('sha1').update(`${VOICE}|${SPEED}|${text}`).digest('hex').slice(0, 14)}.wav`);
  if (!fs.existsSync(f)) execFileSync('npx', ['--yes', HF, 'tts', text, '-v', VOICE, '-s', SPEED, '-o', f], { env, stdio: 'ignore' });
  return f;
};

const inputs = [], filters = [];
let bad = 0;
cues.forEach((c, i) => {
  const f = tts(LINES[c.key]);
  const d = dur(f);
  const room = (cues[i + 1]?.t ?? TOTAL) - c.t - 0.25;
  const tempo = d > room ? d / room : 1;
  const flag = tempo === 1 ? '' : tempo <= MAX_TEMPO ? `  sped ${tempo.toFixed(2)}x` : `  TOO LONG (${d.toFixed(1)}s for ${room.toFixed(1)}s)`;
  if (tempo > MAX_TEMPO) bad++;
  console.log(`${c.t.toFixed(1).padStart(6)}s  ${c.key.padEnd(7)} ${d.toFixed(1)}s${flag}  ${LINES[c.key].slice(0, 60)}`);
  inputs.push('-i', f);
  const ms = Math.round(c.t * 1000);
  filters.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo${tempo > 1 ? `,atempo=${Math.min(tempo, MAX_TEMPO).toFixed(4)}` : ''},adelay=${ms}|${ms}[a${i}]`);
});
if (bad) console.log(`${bad} line(s) are longer than their part: shorten them or hold longer in the scenario`);

const fc = `${filters.join(';')};${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0:dropout_transition=0,apad[mix]`;
const final = path.join(OUT, 'wayfare-demo.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', film, ...inputs, '-filter_complex', fc, '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final]);
console.log(`→ ${final} (${dur(final).toFixed(1)}s)`);
