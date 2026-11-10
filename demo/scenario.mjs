// The Wayfare demo video (~2:00): one real trip, every feature, with short story cards around it.
// Records the running demo (`pnpm demo`, :3400) with the hyperframes-app-demo skill:
//   .claude/skills/hyperframes-app-demo/scripts/make-video.sh --scenario demo/scenario.mjs --base-url http://localhost:3400
// Slow steps (browsing, NEAR signatures, settlements) are sped up and labelled. Then, with --no-render:
//   node demo/polish.mjs footage   (zoom + hold on key lines)  →  compose --take demo-video/take-final
//   node demo/polish.mjs overlays  (callouts, agent browser, x402, on-chain proof)  →  hyperframes render  →  node demo/narrate.mjs
//   node demo/mcp-clip.mjs <run-id>  (the MCP part, from a trip booked through the MCP server, spliced in before the outro)
//   node demo/nearblocks-clip.mjs  (one tx on the public explorer; needs demo-video/nearblocks/tx.png) → node demo/mcp-clip.mjs --splice
//   node demo/real-x402-clip.mjs  (a real third-party x402 payment, from pnpm -C agent pay:real; needs demo-video/real-x402/tx.png) → node demo/mcp-clip.mjs --splice

export const config = {};

export const video = {
  brand: { name: 'WAYFARE', mark: 'W', accent: '#1769e0', accent2: '#2f9e6e', alert: '#e16540', ink: '#111111', bg: '#f6f5f3', fontDisplay: 'Inter Tight', fontMono: 'JetBrains Mono' },
  theme: 'soft',
  intro: {
    title: 'Your trip, booked and paid.',
    highlight: 'The agent never touches your money.',
    chips: ['NEAR Chain Signatures', 'NEAR Intents', 'x402 on Base, Arbitrum + NEAR'],
    seconds: 5,
  },
  problem: {
    eyebrow: 'THE PROBLEM',
    stat: 'card or keys',
    note: 'what an AI agent needs today to pay for you',
    lines: ['To book and pay, an agent gets your card or your keys, and you hope it behaves.', 'With Wayfare it gets <b>neither</b>. A NEAR contract signs each payment, only inside the plan you approved.'],
    seconds: 6.5,
  },
  footage: { startAt: /^<b>1 ·/, pill: '● REAL APP · NEAR TESTNET' },
  chapters: [
    { match: /^<b>1 ·/, label: 'Ask in plain words' },
    { match: /^<b>2 ·/, label: 'Plans in a real browser' },
    { match: /^<b>3 ·/, label: 'NEAR funds 3 chains' },
    { match: /^<b>4 ·/, label: 'x402 on 3 chains' },
    { match: /^<b>5 ·/, label: 'Flight cancelled' },
    { match: /^<b>6 ·/, label: 'Rebooked in your rule' },
    { match: /^<b>7 ·/, label: 'Off-plan? NEAR refuses' },
    { match: /^<b>8 ·/, label: 'Money home to NEAR' },
    { match: /^<b>9 ·/, label: 'How the money moved' },
  ],
  railTitle: 'One real trip',
  // Wayfare blue instead of the soft theme's ink; the outro's third card is the first one reversed (ink, white text)
  css: `
      .logo .c, #t2 span, #hl, .pl b, .cap b, .stack.s1 { background: #1769e0; }
      #t2 span { box-shadow: 0 24px 48px -22px rgba(23,105,224,.65); }
      #hl { box-shadow: 0 14px 28px -14px rgba(23,105,224,.7); }
      #bar { background: #1769e0; }
      .row.on .n { color: #ffffff; } .stack.s1 .k { color: #cfe0ff; }
      .pill { background: #e8f0fe; color: #0b4fb3; border-color: #bcd3fb; }
      .stack.s2 { background: #111111; color: #ffffff; border-color: #111111; } .stack.s2 .k { color: #a3a3a3; }
      .stack { display: flex; flex-direction: column; justify-content: center; } /* a one-line value sits in the middle, like the two-line ones */`,
  outro: {
    items: [{ k: 'SIGNS', v: 'NEAR Chain Signatures' }, { k: 'SWAPS', v: 'NEAR Intents' }, { k: 'PAYS', v: 'x402 · Base, Arbitrum, NEAR' }],
    tagline: 'Wayfare · your trip, booked and paid',
    seconds: 6,
  },
};

const REQUEST = 'Fly me from Bangkok to Kyoto on 2026-11-19 for 2 nights, a ryokan near Gion, and a sushi dinner for two on the 21st. Budget $1,000.';

export default async function scenario({ page, goto, caption, click, type, point, scrollTo, scrollY, hold, waitFor }) {
  const long = { timeout: 900_000 };

  // ── 1 · ask ─────────────────────────────────────────────
  await goto('/');
  await waitFor('home', page.getByPlaceholder(/Bangkok to Kyoto next month/));
  await caption('<b>1 ·</b> Ask for the trip in plain words');
  await hold(600);
  await type(page.getByPlaceholder(/Bangkok to Kyoto next month/), REQUEST);
  await hold(500);
  await click(page.getByRole('button', { name: /Plan my trip/ }));

  // ── 2 · plan ────────────────────────────────────────────
  await waitFor('run page', /What the agent is doing/);
  await caption('<b>2 ·</b> The agent searches 4 booking sites in a real browser');
  await hold(2500);
  await waitFor('agent plans', page.getByRole('button', { name: /Fund with .* NEAR & book/ }), { ...long, pill: '⏳ agent browsing · sped up' });

  // ── 3 · approve + on-ramp ───────────────────────────────
  await caption('<b>3 ·</b> Approve once: your NEAR funds the trip on Base, Arbitrum and NEAR');
  await scrollTo(page.getByRole('heading', { name: 'Your itinerary' }), 90);
  await hold(1500);
  await scrollTo(page.getByText('live NEAR Intents quote').first(), 430);
  await point(page.getByText('live NEAR Intents quote').first());
  await hold(1800);
  await point(page.locator('select').first());
  await hold(1500);
  await click(page.getByRole('button', { name: /Fund with .* NEAR & book/ }));
  await waitFor('funded', /Funded \d/, { ...long, pill: '⏳ NEAR deposit · sped up' });
  await scrollTo(page.getByText(/Funded \d/).first(), 260);
  await hold(3200);

  // ── 4 · book on two chains ──────────────────────────────
  await caption('<b>4 ·</b> Each checkout asks for x402: NEAR signs it, on Base, Arbitrum or NEAR itself');
  await waitFor('booked', page.getByRole('button', { name: /Kumo Air cancels the flight/ }), { ...long, pill: '⏳ booking + NEAR signatures · sped up' });
  await scrollTo(page.getByText('pays on NEAR').first(), 360);
  await point(page.getByText('pays on Arbitrum').first());
  await hold(1600);
  await point(page.getByText('pays on NEAR').first());
  await hold(2000);

  // ── 5 · disruption ──────────────────────────────────────
  await caption('<b>5 ·</b> Then a typhoon: Kumo Air cancels the flight');
  await click(page.getByRole('button', { name: /Kumo Air cancels the flight/ }));
  await waitFor('cancelled', /Kumo Air.s signature checked on NEAR/, { ...long, pill: '⏳ refund + NEAR check · sped up' });
  await scrollTo(page.getByText('Kumo Air cancelled your flight').first(), 120);
  await hold(1200);
  await point(page.locator('li', { hasText: /Kumo Air.s signature checked on NEAR/ }).first());
  await hold(2800);

  // ── 6 · rebook ──────────────────────────────────────────
  await caption('<b>6 ·</b> The agent fixes the train too, and rebooks inside your +20% rule');
  await waitFor('rebooked', /back on track/i, { ...long, pill: '⏳ rebooking · sped up' });
  const reason = page.locator('li', { hasText: /no longer connects/ }).first();
  await scrollTo(reason, 260);
  await point(reason);
  await hold(2200);
  await point(page.locator('li', { hasText: /within your rule/ }).first());
  await hold(2600);

  // ── 7 · refused ─────────────────────────────────────────
  await caption('<b>7 ·</b> The agent tries a pricier room. NEAR refuses to sign');
  await scrollTo(page.getByRole('button', { name: /Let the agent try a pricier room/ }), 520);
  await click(page.getByRole('button', { name: /Let the agent try a pricier room/ }));
  await waitFor('refused', /The agent tried a pricier room/, { ...long, pill: '⏳ agent asks NEAR · sped up' });
  await scrollTo(page.getByText(/The agent tried a pricier room/).first(), 320);
  await hold(3200);

  // ── 8 · off-ramp ────────────────────────────────────────
  await caption('<b>8 ·</b> End the trip: what is left on all 3 chains comes home as NEAR');
  await scrollTo(page.getByRole('button', { name: /End trip/ }), 520);
  await click(page.getByRole('button', { name: /End trip/ }));
  await waitFor('returned', /back as [\d.]+ NEAR in your savings/, { ...long, pill: '⏳ NEAR signs · swap · sped up' });
  await scrollTo(page.getByText(/back as [\d.]+ NEAR in your savings/).first(), 300);
  await hold(3600);

  // ── 9 · the whole picture ───────────────────────────────
  await caption('<b>9 ·</b> Every step, signed or refused by one NEAR contract');
  await scrollTo(page.getByRole('heading', { name: 'How the money moved' }), 20);
  await hold(5200);
  await scrollTo(page.getByRole('heading', { name: 'On-chain record' }), 40);
  await hold(2600);
}
