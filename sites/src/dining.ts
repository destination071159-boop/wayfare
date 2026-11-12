// Sumi Table: a demo restaurant reservation site (fictional restaurants). Prepaid courses are paid with x402, in USDC
// on NEAR testnet (x402 `exact` on near:testnet).
import express, { type Express } from "express";
import { checkout, clampInt, guestFields, hidden, isoDate } from "./checkout.js";
import { Store } from "./store.js";
import { esc, page, type Brand, FONTS } from "./ui.js";
import { NEAR_NET, usdc } from "./x402.js";

const brand: Brand = {
  name: "Sumi Table",
  chain: NEAR_NET.label,
  tagline: "Reservations at Japan's best counters",
  accent: "#c9a24a",
  accentInk: "#14110d",
  bg: "#121110",
  logo: `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden><circle cx="17" cy="17" r="15.5" fill="none" stroke="#c9a24a" stroke-width="1.5"/><path d="M10 21c3-6 9-9 15-9-2 6-7 10-15 9Z" fill="#c9a24a"/><path d="M9 24h16" stroke="#c9a24a" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  theme: {
    font: FONTS.sans,
    headFont: FONTS.serif,
    radius: 4,
    headerBg: "#0b0a09",
    headerInk: "#f2ede4",
    headerBorder: "1px solid #2a2622",
    hero: "radial-gradient(120% 140% at 85% 0%, #3a2c14 0%, #1a1611 45%, #0f0e0c 100%)",
    dark: true,
    extra: ".logo { font-weight:400; font-style:italic; font-size:22px; letter-spacing:.01em; } h1, h2 { font-weight:400; } .hero h1 { font-style:italic; color:#e9d9b0; }",
  },
};

type Restaurant = { id: string; city: string; name: string; cuisine: string; area: string; course: string; perGuest: number; rating: number; hue: number; slots: string[] };
// prepaid course per guest in USDC base units (1/100 scale: 0.85 USDC ≈ an $85 omakase)
const RESTAURANTS: Restaurant[] = [
  { id: "sushi-kaze", city: "kyoto", name: "Sushi Kaze", cuisine: "Edomae sushi", area: "Gion", course: "Omakase, 14 pieces", perGuest: 850_000, rating: 4.8, hue: 200, slots: ["17:30", "18:00", "20:00", "20:30"] },
  { id: "kaiseki-tsuki", city: "kyoto", name: "Kaiseki Tsuki", cuisine: "Kyoto kaiseki", area: "Higashiyama", course: "Seasonal kaiseki, 9 courses", perGuest: 1_400_000, rating: 4.9, hue: 30, slots: ["18:00", "19:30"] },
  { id: "pontocho-yakitori", city: "kyoto", name: "Pontocho Torii", cuisine: "Yakitori", area: "Pontocho, riverside", course: "Chef's skewer course", perGuest: 420_000, rating: 4.5, hue: 12, slots: ["17:00", "18:30", "19:00", "21:00"] },
  { id: "nishiki-tofu", city: "kyoto", name: "Nishiki Tofu House", cuisine: "Shojin & tofu", area: "Nishiki Market", course: "Tofu tasting, 7 courses", perGuest: 380_000, rating: 4.4, hue: 90, slots: ["12:00", "13:00", "18:00"] },
  { id: "ginza-hikari", city: "tokyo", name: "Ginza Hikari", cuisine: "Edomae sushi", area: "Ginza", course: "Omakase, 18 pieces", perGuest: 1_600_000, rating: 4.9, hue: 230, slots: ["18:00", "20:30"] },
  { id: "dotonbori-kushi", city: "osaka", name: "Dotonbori Kushi", cuisine: "Kushikatsu", area: "Namba", course: "20-skewer set", perGuest: 300_000, rating: 4.3, hue: 340, slots: ["17:30", "19:00", "20:30"] },
];
const CITIES: Record<string, string> = { kyoto: "Kyoto", tokyo: "Tokyo", osaka: "Osaka" };

type Q = { city: string; date: string; party: number };
const query = (q: Record<string, unknown>): Q => ({ city: CITIES[String(q.city)] ? String(q.city) : "kyoto", date: isoDate(q.date, 2), party: clampInt(q.party, 1, 8, 2) });
const qs = (q: Q, extra: Record<string, string> = {}) => new URLSearchParams({ city: q.city, date: q.date, party: String(q.party), ...extra }).toString();
const swatch = (r: Restaurant) => `<div class="photo" style="min-height:120px;background:linear-gradient(160deg,hsl(${r.hue} 40% 38%),hsl(${(r.hue + 30) % 360} 30% 14%))">${esc(r.cuisine)}</div>`;

export function diningSite(payTo: string): Express {
  const store = new Store("sumi-table", "ST");
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  const form = (q: Q) => `<form class="search" action="/search" method="get" style="grid-template-columns:2fr 1.3fr 1fr auto">
  <div><label for="city">City</label><select id="city" name="city">${Object.entries(CITIES).map(([k, v]) => `<option value="${k}"${k === q.city ? " selected" : ""}>${v}</option>`).join("")}</select></div>
  <div><label for="date">Date</label><input id="date" name="date" type="date" value="${esc(q.date)}"></div>
  <div><label for="party">Guests</label><input id="party" name="party" type="number" min="1" max="8" value="${q.party}"></div>
  <div style="display:flex;align-items:end"><button type="submit">Find a table</button></div>
</form>`;

  app.get("/", (req, res) => {
    const q = query(req.query);
    res.send(page(brand, "Restaurant reservations", `<section class="hero"><h1>Reserve the counter</h1><p style="margin:0;opacity:.9">Sushi, kaiseki and yakitori. Prepaid courses, pay with x402.</p>${form(q)}</section>`));
  });

  app.get("/search", (req, res) => {
    const q = query(req.query);
    const list = RESTAURANTS.filter((r) => r.city === q.city);
    res.send(
      page(brand, `Restaurants in ${CITIES[q.city]}`, `
<div class="steps"><b>1 Search</b> › 2 Choose time › 3 Contact › 4 Pay</div>
<h1>Tables in ${CITIES[q.city]}</h1>
<p class="muted">${esc(q.date)} · ${q.party} guest${q.party > 1 ? "s" : ""}</p>
<div class="grid">
${list
  .map(
    (r) => `<article class="card restaurant" data-restaurant="${r.id}" style="display:grid;grid-template-columns:200px 1fr;gap:18px">
  ${swatch(r)}
  <div><div class="row between"><h2 style="margin:0">${esc(r.name)}</h2><span><b>${r.rating}</b> ★</span></div>
  <div class="muted">${esc(r.cuisine)} · ${esc(r.area)}</div>
  <p style="margin:6px 0">${esc(r.course)} · <b>${usdc(r.perGuest)} USDC</b> per guest, prepaid</p>
  <div class="row" style="gap:8px;flex-wrap:wrap">${r.slots.map((s) => `<a class="btn ghost slot" data-time="${s}" href="/reserve?${qs(q, { restaurant: r.id, time: s })}">${s}</a>`).join("")}</div></div>
</article>`,
  )
  .join("")}
</div>`),
    );
  });

  const pick = (r: Record<string, unknown>) => {
    const x = RESTAURANTS.find((y) => y.id === r.restaurant);
    const time = String(r.time ?? "");
    return x && x.slots.includes(time) ? { r: x, time } : undefined;
  };

  app.get("/reserve", (req, res) => {
    const q = query(req.query);
    const p = pick(req.query);
    if (!p) return void res.status(404).send(page(brand, "Not found", "<h1>Table not found</h1>"));
    res.send(
      page(brand, "Contact details", `
<div class="steps">1 Search › 2 Choose time › <b>3 Contact</b> › 4 Pay</div>
<h1>Your details</h1>
<div class="grid" style="grid-template-columns:1.4fr 1fr;align-items:start">
<form class="card grid" method="post" action="/reserve" id="contact-form">
  ${hidden({ city: q.city, date: q.date, party: q.party, restaurant: p.r.id, time: p.time })}
  ${guestFields("Name for the reservation", false)}
  <div><label for="requests">Allergies or requests (optional)</label><textarea id="requests" name="requests" rows="2"></textarea></div>
  <button type="submit" id="continue">Continue to payment</button>
</form>
<aside class="card"><b>${esc(p.r.name)}</b><div class="muted">${esc(q.date)} · ${p.time} · ${q.party} guest${q.party > 1 ? "s" : ""}</div><div class="muted">${esc(p.r.course)}</div><div class="row between" style="margin-top:10px"><span>Prepaid total</span><span class="price">${usdc(p.r.perGuest * q.party)} USDC</span></div></aside>
</div>`),
    );
  });

  app.post("/reserve", (req, res) => {
    const q = query(req.body);
    const p = pick(req.body);
    const g = req.body as Record<string, string>;
    if (!p || !g.full_name?.trim() || !g.email?.trim()) return void res.status(400).send(page(brand, "Missing details", "<h1>Please fill in every required field</h1>"));
    const b = store.create({
      title: `${p.r.name}, ${q.date} ${p.time}`,
      detail: { restaurant: p.r.name, area: `${p.r.area}, ${CITIES[q.city]}`, date: q.date, time: p.time, guests: q.party, course: p.r.course },
      guest: { full_name: g.full_name.trim(), email: g.email.trim(), requests: (g.requests ?? "").trim() },
      total: String(p.r.perGuest * q.party),
    });
    res.redirect(303, `/booking?id=${b.id}`);
  });

  checkout(app, { brand, store, payTo, description: "Sumi Table prepaid reservation", steps: ["Search", "Choose time", "Contact", "Pay"], net: NEAR_NET });
  return app;
}
