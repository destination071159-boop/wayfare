// Kumo Air: a demo airline booking site (fictional airline). Checkout is paid with x402.
import express, { type Express } from "express";
import { checkout, clampInt, guestFields, hidden, isoDate } from "./checkout.js";
import { Store } from "./store.js";
import { esc, page, type Brand, FONTS } from "./ui.js";
import { usdc } from "./x402.js";

const brand: Brand = {
  name: "Kumo Air",
  tagline: "Flights across Asia",
  accent: "#0a84ff",
  accentInk: "#fff",
  bg: "#eef3fa",
  logo: `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden><circle cx="17" cy="17" r="17" fill="#0a84ff"/><path d="M9 21.5a4 4 0 0 1 1.2-7.8 6 6 0 0 1 11.5 1.3 3.3 3.3 0 0 1 2.3 6.5Z" fill="#fff"/></svg>`,
  theme: {
    font: FONTS.sans,
    headFont: FONTS.sans,
    radius: 10,
    headerBg: "#0b2a5b",
    headerInk: "#fff",
    headerBorder: "0",
    hero: "linear-gradient(120deg, #0b2a5b 0%, #134b9c 55%, #3aa0ff 100%)",
    extra: ".logo { font-weight:800; letter-spacing:-.02em; } .hero h1 { font-weight:800; }",
  },
};

const AIRPORTS: Record<string, { city: string; code: string }> = {
  bkk: { city: "Bangkok", code: "BKK" },
  sin: { city: "Singapore", code: "SIN" },
  icn: { city: "Seoul", code: "ICN" },
  hnd: { city: "Tokyo Haneda", code: "HND" },
  kix: { city: "Osaka Kansai", code: "KIX" },
};
// block minutes between airports (either direction)
const BLOCK: Record<string, number> = { "bkk-hnd": 360, "bkk-kix": 345, "sin-hnd": 400, "sin-kix": 385, "icn-hnd": 145, "icn-kix": 110, "hnd-kix": 75, "bkk-sin": 140, "bkk-icn": 330, "icn-sin": 390 };
const block = (a: string, b: string) => BLOCK[`${a}-${b}`] ?? BLOCK[`${b}-${a}`] ?? 240;
// USDC base units per block minute (1/100 scale: Bangkok → Tokyo economy ≈ 3.10 USDC ≈ $310)
const CABINS = [
  { id: "economy", name: "Economy", perMin: 8_600, bag: "1 × 23 kg" },
  { id: "premium", name: "Premium Economy", perMin: 14_500, bag: "2 × 23 kg" },
];
const DEPARTS = ["00:15", "07:40", "10:55", "14:20", "22:30"];

type Q = { from: string; to: string; date: string; pax: number };
const query = (q: Record<string, unknown>): Q => {
  const from = AIRPORTS[String(q.from)] ? String(q.from) : "bkk";
  let to = AIRPORTS[String(q.to)] ? String(q.to) : "hnd";
  if (to === from) to = from === "hnd" ? "bkk" : "hnd";
  return { from, to, date: isoDate(q.date), pax: clampInt(q.pax, 1, 6, 1) };
};
const qs = (q: Q, extra: Record<string, string> = {}) => new URLSearchParams({ from: q.from, to: q.to, date: q.date, pax: String(q.pax), ...extra }).toString();
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}${m >= 1440 ? " +1" : ""}`;

type Flight = { id: string; no: string; dep: string; arr: string; mins: number };
const flights = (q: Q): Flight[] =>
  DEPARTS.map((dep, i) => {
    const mins = block(q.from, q.to) + (i % 2) * 10;
    return { id: `${q.from}-${q.to}-${dep.replace(":", "")}`, no: `KU ${100 + i * 7 + (AIRPORTS[q.to].code.charCodeAt(0) % 10)}`, dep, arr: hhmm(toMin(dep) + mins), mins };
  });
const fare = (f: Flight, c: (typeof CABINS)[number], pax: number) => Math.round((c.perMin * f.mins) / 10_000) * 10_000 * pax;
const opts = (cur: string) => Object.entries(AIRPORTS).map(([k, v]) => `<option value="${k}"${k === cur ? " selected" : ""}>${v.city} (${v.code})</option>`).join("");
const route = (q: Q) => `${AIRPORTS[q.from].city} (${AIRPORTS[q.from].code}) → ${AIRPORTS[q.to].city} (${AIRPORTS[q.to].code})`;

export function flightSite(payTo: string): Express {
  const store = new Store("kumo-air", "KU");
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (req, res) => {
    const q = query(req.query);
    res.send(
      page(brand, "Flights", `
<section class="hero"><h1>Fly above the clouds</h1><p style="margin:0;opacity:.9">Bangkok, Singapore, Seoul, Tokyo and Osaka. Pay with x402.</p>
<form class="search" action="/search" method="get">
  <div><label for="from">From</label><select id="from" name="from">${opts(q.from)}</select></div>
  <div><label for="to">To</label><select id="to" name="to">${opts(q.to)}</select></div>
  <div><label for="date">Depart</label><input id="date" name="date" type="date" value="${esc(q.date)}"></div>
  <div><label for="pax">Passengers</label><input id="pax" name="pax" type="number" min="1" max="6" value="${q.pax}"></div>
  <div style="display:flex;align-items:end"><button type="submit">Search flights</button></div>
</form></section>`),
    );
  });

  app.get("/search", (req, res) => {
    const q = query(req.query);
    res.send(
      page(brand, route(q), `
<div class="steps"><b>1 Search</b> › 2 Choose fare › 3 Passenger › 4 Pay</div>
<h1>${esc(route(q))}</h1>
<p class="muted">${esc(q.date)} · one way · ${q.pax} passenger${q.pax > 1 ? "s" : ""} · nonstop</p>
<div class="grid">
${flights(q)
  .map(
    (f) => `<article class="card flight row between" data-flight="${f.id}" data-depart="${f.dep}">
  <div style="min-width:240px"><div class="price">${f.dep} → ${f.arr}</div><div class="muted">${Math.floor(f.mins / 60)}h ${f.mins % 60}m nonstop · ${esc(f.no)}</div></div>
  <div class="row" style="gap:10px">${CABINS.map((c) => `<a class="btn${c.id === "premium" ? " ghost" : ""}" href="/passenger?${qs(q, { flight: f.id, cabin: c.id })}">${c.name} · ${usdc(fare(f, c, q.pax))} USDC</a>`).join("")}</div>
</article>`,
  )
  .join("")}
</div>`),
    );
  });

  const pick = (q: Q, r: Record<string, unknown>) => {
    const f = flights(q).find((x) => x.id === r.flight);
    const c = CABINS.find((x) => x.id === r.cabin);
    return f && c ? { f, c } : undefined;
  };

  app.get("/passenger", (req, res) => {
    const q = query(req.query);
    const p = pick(q, req.query);
    if (!p) return void res.status(404).send(page(brand, "Not found", "<h1>Flight not found</h1>"));
    res.send(
      page(brand, "Passenger details", `
<div class="steps">1 Search › 2 Choose fare › <b>3 Passenger</b> › 4 Pay</div>
<h1>Passenger details</h1>
<div class="grid" style="grid-template-columns:1.4fr 1fr;align-items:start">
<form class="card grid" method="post" action="/passenger" id="passenger-form">
  ${hidden({ from: q.from, to: q.to, date: q.date, pax: q.pax, flight: p.f.id, cabin: p.c.id })}
  ${guestFields("Passenger name (as on passport)")}
  <button type="submit" id="continue">Continue to payment</button>
</form>
<aside class="card"><b>${esc(route(q))}</b><div class="muted">${esc(q.date)} · ${p.f.dep} → ${p.f.arr} · ${esc(p.f.no)}</div><div class="muted">${p.c.name} · bags ${p.c.bag}</div><div class="row between" style="margin-top:10px"><span>Total</span><span class="price">${usdc(fare(p.f, p.c, q.pax))} USDC</span></div></aside>
</div>`),
    );
  });

  app.post("/passenger", (req, res) => {
    const q = query(req.body);
    const p = pick(q, req.body);
    const g = req.body as Record<string, string>;
    if (!p || !g.full_name?.trim() || !g.passport_no?.trim() || !g.email?.trim()) return void res.status(400).send(page(brand, "Missing details", "<h1>Please fill in every required field</h1>"));
    const b = store.create({
      title: `${AIRPORTS[q.from].code} → ${AIRPORTS[q.to].code}, ${p.f.no}`,
      detail: { route: route(q), date: q.date, departs: p.f.dep, arrives: p.f.arr, flight: p.f.no, cabin: p.c.name, bags: p.c.bag, passengers: q.pax },
      guest: { full_name: g.full_name.trim(), passport_no: g.passport_no.trim(), email: g.email.trim() },
      total: String(fare(p.f, p.c, q.pax)),
    });
    res.redirect(303, `/booking?id=${b.id}`);
  });

  checkout(app, { brand, store, payTo, description: "Kumo Air flight ticket", steps: ["Search", "Choose fare", "Passenger", "Pay"] });
  return app;
}
