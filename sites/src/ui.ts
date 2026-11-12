// Page shell for the demo merchant sites: plain server-rendered HTML that a person or a browser agent can use.
/** Each merchant has its own look so the four read as separate companies. */
export type Theme = {
  font: string; // body font stack
  headFont: string; // heading font stack
  radius: number; // corner radius in px
  headerBg: string;
  headerInk: string;
  headerBorder: string; // css border-bottom for the top bar
  hero: string; // css background for the hero band
  dark?: boolean; // dark page (cards, inputs and status boxes switch too)
  extra?: string; // a few brand-specific css rules
};
export type Brand = { name: string; tagline: string; accent: string; accentInk: string; bg: string; logo: string; theme: Theme; /** the chain it takes USDC on (default Base Sepolia) */ chain?: string };

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
export const FONTS = { sans: SANS, serif: SERIF, grotesk: '"Helvetica Neue", Helvetica, Arial, sans-serif' };

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function page(brand: Brand, title: string, body: string, opts: { head?: string; script?: string } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(brand.name)}</title>
${opts.head ?? ""}
<style>
${css(brand)}
</style>
</head>
<body>
<div class="testnet">Testnet demo · prices are 1/100 of real prices and are paid in test USDC on ${esc(brand.chain ?? (process.env.WAYFARE_CHAIN === "live" ? "Base Sepolia" : "Base Sepolia (local fork)"))} · this site takes <b>x402</b> payments</div>
<header class="top"><div class="wrap">
  <a class="logo" href="/">${brand.logo}<span>${esc(brand.name)}</span></a>
  <nav><span>${esc(brand.tagline)}</span><span>Help</span><span>Sign in</span></nav>
</div></header>
<main><div class="wrap">${body}</div></main>
${opts.script ? `<script>${opts.script}</script>` : ""}
</body>
</html>`;
}

function css(brand: Brand) {
  const t = brand.theme;
  const d = !!t.dark;
  const ink = d ? "#f2ede4" : "#1c1917";
  return `
:root { --accent:${brand.accent}; --accent-ink:${brand.accentInk}; --bg:${brand.bg}; --ink:${ink}; --soft:${d ? "#b8afa2" : "#57534e"}; --mute:${d ? "#7d756b" : "#a8a29e"}; --line:${d ? "#302b26" : "#e7e5e4"}; --card:${d ? "#1c1a17" : "#fff"}; --field:${d ? "#14120f" : "#fff"}; --chip:${d ? "#2a2622" : "#f5f5f4"}; --ok:${d ? "#4ade80" : "#15803d"}; --warn:${d ? "#e0b45a" : "#b45309"}; --r:${t.radius}px; }
* { box-sizing:border-box; }
body { margin:0; font:15px/1.5 ${t.font}; color:var(--ink); background:var(--bg); }
a { color:inherit; }
h1, h2, .logo, .price { font-family:${t.headFont}; }
header.top { background:${t.headerBg}; color:${t.headerInk}; border-bottom:${t.headerBorder}; }
.wrap { max-width:1040px; margin:0 auto; padding:0 20px; }
.top .wrap { display:flex; align-items:center; gap:14px; height:64px; }
.logo { display:flex; align-items:center; gap:10px; font-weight:700; font-size:20px; letter-spacing:-.01em; text-decoration:none; }
.logo svg { display:block; flex-shrink:0; }
.top nav { margin-left:auto; display:flex; gap:18px; opacity:.75; font-size:14px; }
.testnet { background:#fef3c7; color:#78350f; font:13px ${SANS}; text-align:center; padding:6px 12px; }
main { padding:28px 0 64px; }
h1 { font-size:30px; letter-spacing:-.02em; margin:0 0 6px; }
h2 { font-size:20px; margin:0 0 10px; }
.muted { color:var(--soft); }
.card { background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:18px; }
.grid { display:grid; gap:16px; }
.hero { background:${t.hero}; color:#fff; border-radius:var(--r); padding:42px 32px; margin-bottom:22px; }
.hero h1 { font-size:36px; }
form.search { display:grid; grid-template-columns:2fr 1.3fr 1fr 1fr auto; gap:10px; background:var(--card); padding:12px; border-radius:var(--r); color:var(--ink); margin-top:22px; }
label { display:block; font-size:12px; font-weight:600; color:var(--soft); margin-bottom:4px; }
input, select, textarea { width:100%; font:inherit; padding:10px 12px; border:1px solid var(--line); border-radius:calc(var(--r) * .7); background:var(--field); color:var(--ink); color-scheme:${d ? "dark" : "light"}; }
button, .btn { font:inherit; font-weight:700; border:0; border-radius:calc(var(--r) * .7); padding:11px 18px; background:var(--accent); color:var(--accent-ink); cursor:pointer; text-decoration:none; display:inline-block; text-align:center; }
.btn.ghost { background:var(--card); color:var(--ink); border:1px solid var(--line); }
.photo { border-radius:calc(var(--r) * .85); min-height:150px; display:flex; align-items:flex-end; padding:12px; color:#fff; font-weight:700; text-shadow:0 1px 6px #0008; }
.row { display:flex; gap:16px; align-items:center; }
.between { justify-content:space-between; }
.price { font-size:22px; font-weight:700; }
.tag { display:inline-block; font-size:12px; padding:2px 8px; border-radius:99px; background:var(--chip); color:var(--soft); margin-right:6px; }
.tag.good { background:${d ? "#14361f" : "#dcfce7"}; color:${d ? "#86efac" : "#166534"}; }
.stars { color:#f59e0b; letter-spacing:1px; }
.steps { display:flex; gap:8px; font-size:13px; color:var(--mute); margin-bottom:18px; }
.steps b { color:var(--ink); }
.status { border-radius:var(--r); padding:18px; border:2px dashed var(--warn); background:${d ? "#2a2112" : "#fffbeb"}; }
.status.ok { border:2px solid var(--ok); background:${d ? "#11291a" : "#f0fdf4"}; }
.status.bad { border-color:#b91c1c; background:${d ? "#2d1414" : "#fef2f2"}; }
code { font:13px ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--chip); padding:2px 6px; border-radius:6px; word-break:break-all; }
dl.kv { display:grid; grid-template-columns:140px 1fr; gap:6px 12px; margin:0; font-size:14px; }
dl.kv dt { color:var(--soft); }
${t.extra ?? ""}
@media (max-width:760px) { form.search { grid-template-columns:1fr 1fr; } .hero { padding:28px 18px; } dl.kv { grid-template-columns:1fr; } }
`;
}

/** The booking page's payment box and status, shared by every site. Polls /api/bookings/<id>. */
export function paymentBlock(b: { id: string; ref: string; total: string; status: string }, totalLabel: string, payTo: string, chain: { label: string; explorerTx: string; id?: string }) {
  const endpoint = `/api/bookings/${b.id}/pay`;
  const body = `
<section id="payment" class="status" data-booking="${esc(b.id)}" data-status="${esc(b.status)}" data-x402-endpoint="${esc(endpoint)}" data-amount="${esc(b.total)}">
  <div id="pay-waiting">
    <h2>Payment required: ${esc(totalLabel)} USDC</h2>
    <p class="muted" style="margin:0 0 10px">Your room is held for 15 minutes. Pay with any x402 client:</p>
    <dl class="kv">
      <dt>Endpoint</dt><dd><code>POST ${esc(endpoint)}</code></dd>
      <dt>Network</dt><dd>${esc(chain.label)} (${esc(chain.id ?? "eip155:84532")}), USDC</dd>
      <dt>Pay to</dt><dd><code>${esc(payTo)}</code></dd>
    </dl>
    <p class="muted" style="margin:10px 0 0" id="pay-note">Waiting for payment…</p>
  </div>
  <div id="pay-done" hidden>
    <h2 style="color:var(--ok)">✓ Booking confirmed</h2>
    <dl class="kv">
      <dt>Confirmation</dt><dd><b id="conf-ref">${esc(b.ref)}</b></dd>
      <dt>Paid</dt><dd>${esc(totalLabel)} USDC on ${esc(chain.label)}</dd>
      <dt>From</dt><dd><code id="conf-payer"></code></dd>
      <dt>Transaction</dt><dd><a id="conf-tx" target="_blank" rel="noreferrer"><code></code></a></dd>
    </dl>
  </div>
</section>`;
  const script = `
(function () {
  var box = document.getElementById('payment');
  function show(b) {
    box.dataset.status = b.status;
    if (b.status === 'confirmed') {
      box.className = 'status ok';
      document.getElementById('pay-waiting').hidden = true;
      document.getElementById('pay-done').hidden = false;
      document.getElementById('conf-payer').textContent = (b.payment && b.payment.payer) || '';
      var a = document.getElementById('conf-tx');
      var ex = ${JSON.stringify(chain.explorerTx)};
      if (ex) a.href = ex + b.payment.transaction; else a.removeAttribute('href');
      a.firstChild.textContent = b.payment.transaction;
      return true;
    }
    if (b.status === 'expired') { box.className = 'status bad'; document.getElementById('pay-note').textContent = 'The hold expired. Start a new booking.'; return true; }
    if (b.last_error) document.getElementById('pay-note').textContent = 'Last attempt failed: ' + b.last_error;
    return false;
  }
  function poll() {
    fetch('/api/bookings/${b.id}').then(function (r) { return r.json(); }).then(function (b) { if (!show(b)) setTimeout(poll, 2000); }).catch(function () { setTimeout(poll, 3000); });
  }
  poll();
})();`;
  return { body, script };
}
