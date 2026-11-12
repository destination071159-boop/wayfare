// Kiseki Rail: a demo high-speed rail booking site (fictional operator). Checkout is paid with x402.
import express, { type Express } from "express";
import { checkout, clampInt, guestFields, hidden, isoDate } from "./checkout.js";
import { Store } from "./store.js";
import { esc, page, type Brand, FONTS } from "./ui.js";
import { usdc } from "./x402.js";

const brand: Brand = {
  name: "Kiseki Rail",
  tagline: "High-speed rail across Japan",
  accent: "#d7261e",
  accentInk: "#fff",
  bg: "#f3f3f1",
  logo: `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden><rect width="34" height="34" fill="#d7261e"/><circle cx="17" cy="17" r="9" fill="none" stroke="#fff" stroke-width="3"/><path d="M4 17h26" stroke="#fff" stroke-width="3"/></svg>`,
  theme: {
    font: FONTS.grotesk,
    headFont: FONTS.grotesk,
    radius: 3,
    headerBg: "#fff",
    headerInk: "#111",
    headerBorder: "5px solid #d7261e",
    hero: "linear-gradient(90deg, #161616 0%, #161616 72%, #d7261e 72%, #d7261e 74%, #161616 74%)",
    extra: ".logo { text-transform:uppercase; letter-spacing:.08em; font-size:17px; font-weight:800; } h1 { text-transform:uppercase; letter-spacing:.02em; font-weight:800; } .price { font-variant-numeric:tabular-nums; }",
  },
};

const STATIONS: Record<string, string> = { tokyo: "Tokyo", shinagawa: "Shinagawa", nagoya: "Nagoya", kyoto: "Kyoto", osaka: "Shin-Osaka" };
// minutes from Tokyo along the line
const KM: Record<string, number> = { tokyo: 0, shinagawa: 7, nagoya: 98, kyoto: 133, osaka: 148 };
// fares in USDC base units per minute of ride (1/100 scale: Tokyo → Kyoto ordinary ≈ 0.96 USDC ≈ $96)
const CLASSES = [
  { id: "ordinary", name: "Ordinary", perMin: 7_200, note: "2+3 seating" },
  { id: "green", name: "Green Car", perMin: 9_800, note: "2+2 wide seats, quieter car" },
];
const SERVICES = [
  { kind: "Kiseki Express", stops: "fast", minFactor: 1 },
  { kind: "Kiseki Limited", stops: "fewer stops", minFactor: 1.18 },
];
const DEPARTS = ["06:00", "07:30", "08:30", "09:30", "11:00", "12:30", "14:00", "15:30", "17:00", "18:30", "20:00"];

type Q = { from: string; to: string; date: string; pax: number };
const query = (q: Record<string, unknown>): Q => {
  const from = STATIONS[String(q.from)] ? String(q.from) : "tokyo";
  let to = STATIONS[String(q.to)] ? String(q.to) : "kyoto";
  if (to === from) to = from === "kyoto" ? "tokyo" : "kyoto";
  return { from, to, date: isoDate(q.date), pax: clampInt(q.pax, 1, 6, 1) };
};
const qs = (q: Q, extra: Record<string, string> = {}) => new URLSearchParams({ from: q.from, to: q.to, date: q.date, pax: String(q.pax), ...extra }).toString();
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

type Train = { id: string; no: string; kind: string; stops: string; dep: string; arr: string; mins: number };
function trains(q: Q): Train[] {
  const base = Math.abs(KM[q.to] - KM[q.from]);
  return DEPARTS.flatMap((dep, i) => {
    const s = SERVICES[i % 2];
    const mins = Math.round(base * s.minFactor) + 5;
    return [{ id: `${q.from}-${q.to}-${dep.replace(":", "")}`, no: `${s.kind.split(" ")[1].slice(0, 1)}${200 + i * 2}`, kind: s.kind, stops: s.stops, dep, arr: hhmm(toMin(dep) + mins), mins }];
  });
}
const fare = (t: Train, cls: (typeof CLASSES)[number], pax: number) => Math.round((cls.perMin * t.mins) / 10_000) * 10_000 * pax;

const select = (id: string, cur: string) =>
  Object.entries(STATIONS)
    .map(([k, v]) => `<option value="${k}"${k === cur ? " selected" : ""}>${v}</option>`)
    .join("");

export function railSite(payTo: string): Express {
  const store = new Store("kiseki-rail", "KR");
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (req, res) => {
    const q = query(req.query);
    res.send(
      page(brand, "Train tickets", `
<section class="hero"><h1>Book the bullet train</h1><p style="margin:0;opacity:.9">Tokyo, Nagoya, Kyoto and Osaka. E-tickets in seconds, pay with x402.</p>
<form class="search" action="/search" method="get">
  <div><label for="from">From</label><select id="from" name="from">${select("from", q.from)}</select></div>
  <div><label for="to">To</label><select id="to" name="to">${select("to", q.to)}</select></div>
  <div><label for="date">Date</label><input id="date" name="date" type="date" value="${esc(q.date)}"></div>
  <div><label for="pax">Passengers</label><input id="pax" name="pax" type="number" min="1" max="6" value="${q.pax}"></div>
  <div style="display:flex;align-items:end"><button type="submit">Find trains</button></div>
</form></section>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
  <div class="card"><b>Tokyo → Kyoto</b><div class="muted">from 2h 18m · from ${usdc(CLASSES[0].perMin * 138)} USDC</div></div>
  <div class="card"><b>Kyoto → Shin-Osaka</b><div class="muted">from 20m</div></div>
  <div class="card"><b>Tokyo → Nagoya</b><div class="muted">from 1h 43m</div></div>
</div>`),
    );
  });

  app.get("/search", (req, res) => {
    const q = query(req.query);
    res.send(
      page(brand, `${STATIONS[q.from]} → ${STATIONS[q.to]}`, `
<div class="steps"><b>1 Search</b> › 2 Choose seat › 3 Passenger › 4 Pay</div>
<h1>${STATIONS[q.from]} → ${STATIONS[q.to]}</h1>
<p class="muted">${esc(q.date)} · ${q.pax} passenger${q.pax > 1 ? "s" : ""}</p>
<div class="grid">
${trains(q)
  .map(
    (t) => `<article class="card train row between" data-train="${t.id}" data-depart="${t.dep}">
  <div style="min-width:220px"><div class="price">${t.dep} → ${t.arr}</div><div class="muted">${Math.floor(t.mins / 60)}h ${t.mins % 60}m · ${esc(t.kind)} ${t.no} · ${t.stops}</div></div>
  <div class="row" style="gap:10px">${CLASSES.map((c) => `<a class="btn${c.id === "green" ? " ghost" : ""}" href="/passenger?${qs(q, { train: t.id, cls: c.id })}">${c.name} · ${usdc(fare(t, c, q.pax))} USDC</a>`).join("")}</div>
</article>`,
  )
  .join("")}
</div>`),
    );
  });

  const pick = (q: Q, r: Record<string, unknown>) => {
    const t = trains(q).find((x) => x.id === r.train);
    const c = CLASSES.find((x) => x.id === r.cls);
    return t && c ? { t, c } : undefined;
  };

  app.get("/passenger", (req, res) => {
    const q = query(req.query);
    const p = pick(q, req.query);
    if (!p) return void res.status(404).send(page(brand, "Not found", "<h1>Train not found</h1>"));
    res.send(
      page(brand, "Passenger details", `
<div class="steps">1 Search › 2 Choose seat › <b>3 Passenger</b> › 4 Pay</div>
<h1>Passenger details</h1>
<div class="grid" style="grid-template-columns:1.4fr 1fr;align-items:start">
<form class="card grid" method="post" action="/passenger" id="passenger-form">
  ${hidden({ from: q.from, to: q.to, date: q.date, pax: q.pax, train: p.t.id, cls: p.c.id })}
  ${guestFields("Lead passenger (as on passport)")}
  <button type="submit" id="continue">Continue to payment</button>
</form>
<aside class="card"><b>${STATIONS[q.from]} → ${STATIONS[q.to]}</b><div class="muted">${esc(q.date)} · ${p.t.dep} → ${p.t.arr} · ${esc(p.t.kind)} ${p.t.no}</div><div class="muted">${p.c.name} · ${q.pax} passenger${q.pax > 1 ? "s" : ""}</div><div class="row between" style="margin-top:10px"><span>Total</span><span class="price">${usdc(fare(p.t, p.c, q.pax))} USDC</span></div></aside>
</div>`),
    );
  });

  app.post("/passenger", (req, res) => {
    const q = query(req.body);
    const p = pick(q, req.body);
    const g = req.body as Record<string, string>;
    if (!p || !g.full_name?.trim() || !g.passport_no?.trim() || !g.email?.trim()) return void res.status(400).send(page(brand, "Missing details", "<h1>Please fill in every required field</h1>"));
    const b = store.create({
      title: `${STATIONS[q.from]} → ${STATIONS[q.to]}, ${p.t.kind} ${p.t.no}`,
      detail: { route: `${STATIONS[q.from]} → ${STATIONS[q.to]}`, date: q.date, departs: p.t.dep, arrives: p.t.arr, train: `${p.t.kind} ${p.t.no}`, class: p.c.name, passengers: q.pax },
      guest: { full_name: g.full_name.trim(), passport_no: g.passport_no.trim(), email: g.email.trim() },
      total: String(fare(p.t, p.c, q.pax)),
    });
    res.redirect(303, `/booking?id=${b.id}`);
  });

  checkout(app, { brand, store, payTo, description: "Kiseki Rail train ticket", steps: ["Search", "Choose seat", "Passenger", "Pay"] });
  return app;
}
