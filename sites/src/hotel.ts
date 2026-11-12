// Lantern Stays: a demo hotel booking site (fictional hotels). Checkout is paid with x402.
import express, { type Express } from "express";
import { Store } from "./store.js";
import { checkout } from "./checkout.js";
import { esc, page, type Brand, FONTS } from "./ui.js";
import { NETS, usdc } from "./x402.js";

const brand: Brand = {
  chain: NETS.arb.label,
  name: "Lantern Stays",
  tagline: "Hotels & ryokan in Japan",
  accent: "#8a3f1f",
  accentInk: "#fff8ef",
  bg: "#f6efe4",
  logo: `<svg width="30" height="34" viewBox="0 0 30 34" aria-hidden><path d="M11 2h8M15 2v3" stroke="#8a3f1f" stroke-width="2" stroke-linecap="round"/><path d="M8 7h14v2c3 3 3 13 0 16v2H8v-2c-3-3-3-13 0-16Z" fill="#e0782e"/><path d="M6 12h18M5.5 17h19M6 22h18" stroke="#8a3f1f" stroke-width="1.4" opacity=".55"/><path d="M8 27h14v2H8z" fill="#8a3f1f"/><path d="M15 29v4" stroke="#8a3f1f" stroke-width="2" stroke-linecap="round"/></svg>`,
  theme: {
    font: FONTS.sans,
    headFont: FONTS.serif,
    radius: 16,
    headerBg: "#fbf6ee",
    headerInk: "#3b2316",
    headerBorder: "1px solid #eadfcd",
    hero: "linear-gradient(135deg, #8a3f1f 0%, #b85a2b 50%, #e0913e 100%)",
    extra: ".logo { font-weight:600; font-size:22px; letter-spacing:0; } h1, h2 { font-weight:600; letter-spacing:-.01em; } .card { border-color:#eadfcd; }",
  },
};

type Room = { id: string; name: string; beds: string; size: string; nightly: number; refundable: boolean };
type Hotel = { id: string; city: string; name: string; area: string; stars: number; rating: number; reviews: number; blurb: string; amenities: string[]; hue: number; rooms: Room[] };

// nightly prices in USDC base units (1/100 of a real price: 1_200_000 = 1.20 USDC ≈ a $120 room)
const HOTELS: Hotel[] = [
  { id: "gion-hanare", city: "kyoto", name: "Gion Hanare Ryokan", area: "Gion, 4 min to Yasaka Shrine", stars: 4, rating: 9.2, reviews: 812, blurb: "A quiet machiya ryokan on a lantern-lit lane, with tatami rooms and a cypress bath.", amenities: ["Breakfast", "Onsen bath", "Free Wi-Fi"], hue: 8,
    rooms: [
      { id: "tatami-twin", name: "Tatami Twin", beds: "2 futons", size: "22 m²", nightly: 1_450_000, refundable: true },
      { id: "garden-suite", name: "Garden Suite with Private Bath", beds: "1 king futon", size: "38 m²", nightly: 2_900_000, refundable: false },
    ] },
  { id: "kamo-river", city: "kyoto", name: "Kamo River Hotel", area: "Kawaramachi, riverside", stars: 3, rating: 8.6, reviews: 1430, blurb: "Modern rooms over the Kamo river, a short walk to Pontocho and Nishiki Market.", amenities: ["Free Wi-Fi", "24h desk"], hue: 200,
    rooms: [
      { id: "standard-double", name: "Standard Double", beds: "1 double", size: "16 m²", nightly: 980_000, refundable: true },
      { id: "river-view", name: "River View Twin", beds: "2 singles", size: "24 m²", nightly: 1_380_000, refundable: true },
    ] },
  { id: "higashiyama-house", city: "kyoto", name: "Higashiyama House", area: "Higashiyama, near Kiyomizu-dera", stars: 5, rating: 9.5, reviews: 344, blurb: "Five suites in a restored tea merchant's house with a moss garden.", amenities: ["Breakfast", "Garden", "Tea ceremony"], hue: 140,
    rooms: [{ id: "moss-suite", name: "Moss Garden Suite", beds: "1 king", size: "52 m²", nightly: 4_200_000, refundable: false }] },
  { id: "station-inn", city: "kyoto", name: "Kyoto Station Inn", area: "Kyoto Station, 2 min walk", stars: 3, rating: 8.1, reviews: 2210, blurb: "Simple, clean rooms right by the Shinkansen gates.", amenities: ["Free Wi-Fi", "Luggage storage"], hue: 30,
    rooms: [{ id: "compact-double", name: "Compact Double", beds: "1 double", size: "14 m²", nightly: 820_000, refundable: true }] },
  { id: "shibuya-loft", city: "tokyo", name: "Shibuya Loft Hotel", area: "Shibuya, 5 min to the crossing", stars: 4, rating: 8.8, reviews: 1902, blurb: "Design hotel above the city lights.", amenities: ["Bar", "Free Wi-Fi"], hue: 280,
    rooms: [{ id: "loft-king", name: "Loft King", beds: "1 king", size: "28 m²", nightly: 1_900_000, refundable: true }] },
  { id: "asakusa-ryokan", city: "tokyo", name: "Asakusa Sumida Ryokan", area: "Asakusa, near Senso-ji", stars: 3, rating: 8.9, reviews: 760, blurb: "Family-run ryokan with river views of the Skytree.", amenities: ["Breakfast", "Shared onsen"], hue: 15,
    rooms: [{ id: "tatami-double", name: "Tatami Double", beds: "2 futons", size: "18 m²", nightly: 1_150_000, refundable: true }] },
  { id: "dotonbori-stay", city: "osaka", name: "Dotonbori Canal Stay", area: "Namba, on the canal", stars: 3, rating: 8.4, reviews: 1120, blurb: "Steps from Osaka's food streets.", amenities: ["Free Wi-Fi"], hue: 330,
    rooms: [{ id: "canal-double", name: "Canal Double", beds: "1 double", size: "17 m²", nightly: 950_000, refundable: true }] },
];

const CITIES: Record<string, string> = { kyoto: "Kyoto", tokyo: "Tokyo", osaka: "Osaka" };
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
const photo = (h: Hotel, label = "") => `<div class="photo" style="background:linear-gradient(160deg,hsl(${h.hue} 55% 46%),hsl(${(h.hue + 40) % 360} 45% 22%))">${esc(label)}</div>`;
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

type Q = { city: string; checkin: string; nights: number; guests: number };
function query(q: Record<string, unknown>): Q {
  const nights = Math.min(14, Math.max(1, Number(q.nights) || 1));
  const guests = Math.min(6, Math.max(1, Number(q.guests) || 1));
  const checkin = /^\d{4}-\d{2}-\d{2}$/.test(String(q.checkin ?? "")) ? String(q.checkin) : tomorrow();
  const city = CITIES[String(q.city)] ? String(q.city) : "kyoto";
  return { city, checkin, nights, guests };
}
const qs = (q: Q, extra: Record<string, string> = {}) => new URLSearchParams({ city: q.city, checkin: q.checkin, nights: String(q.nights), guests: String(q.guests), ...extra }).toString();
const checkoutDate = (q: Q) => new Date(Date.parse(q.checkin) + q.nights * 86_400_000).toISOString().slice(0, 10);

function searchForm(q: Q) {
  return `<form class="search" action="/search" method="get">
  <div><label for="city">Destination</label><select id="city" name="city">${Object.entries(CITIES).map(([k, v]) => `<option value="${k}"${k === q.city ? " selected" : ""}>${v}</option>`).join("")}</select></div>
  <div><label for="checkin">Check-in</label><input id="checkin" name="checkin" type="date" value="${esc(q.checkin)}"></div>
  <div><label for="nights">Nights</label><input id="nights" name="nights" type="number" min="1" max="14" value="${q.nights}"></div>
  <div><label for="guests">Guests</label><input id="guests" name="guests" type="number" min="1" max="6" value="${q.guests}"></div>
  <div style="display:flex;align-items:end"><button type="submit">Search</button></div>
</form>`;
}

export function hotelSite(payTo: string): Express {
  const store = new Store("lantern-stays", "LS");
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (req, res) => {
    const q = query(req.query);
    res.send(
      page(brand, "Hotels in Japan", `
<section class="hero"><h1>Find your stay in Japan</h1><p style="margin:0;opacity:.9">Ryokan, design hotels and machiya houses. Book in minutes, pay with x402.</p>${searchForm(q)}</section>
<h2>Popular in Kyoto</h2>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
${HOTELS.filter((h) => h.city === "kyoto").slice(0, 3).map((h) => `<a class="card" style="text-decoration:none" href="/hotel?${qs(q, { id: h.id })}">${photo(h, h.area)}<div style="margin-top:10px;font-weight:700">${esc(h.name)}</div><div class="muted">${h.rating} · ${h.reviews} reviews</div></a>`).join("")}
</div>`),
    );
  });

  app.get("/search", (req, res) => {
    const q = query(req.query);
    const list = HOTELS.filter((h) => h.city === q.city);
    res.send(
      page(brand, `Hotels in ${CITIES[q.city]}`, `
<div class="steps"><b>1 Search</b> › 2 Choose room › 3 Guest details › 4 Pay</div>
<h1>${list.length} stays in ${CITIES[q.city]}</h1>
<p class="muted">${esc(q.checkin)} → ${checkoutDate(q)} · ${q.nights} night${q.nights > 1 ? "s" : ""} · ${q.guests} guest${q.guests > 1 ? "s" : ""}</p>
<div class="grid">
${list
  .map((h) => {
    const from = Math.min(...h.rooms.map((r) => r.nightly));
    return `<article class="card hotel" data-hotel="${h.id}" style="display:grid;grid-template-columns:220px 1fr auto;gap:18px;align-items:stretch">
  ${photo(h)}
  <div><h2 style="margin:0">${esc(h.name)}</h2><div class="stars">${stars(h.stars)}</div><div class="muted">${esc(h.area)}</div><p style="margin:8px 0">${esc(h.blurb)}</p>${h.amenities.map((a) => `<span class="tag">${esc(a)}</span>`).join("")}</div>
  <div style="text-align:right;display:flex;flex-direction:column;justify-content:space-between"><div><b>${h.rating}</b> <span class="muted">(${h.reviews})</span></div><div><div class="muted" style="font-size:13px">from</div><div class="price">${usdc(from)} USDC</div><div class="muted" style="font-size:13px">per night</div></div><a class="btn" href="/hotel?${qs(q, { id: h.id })}">View rooms</a></div>
</article>`;
  })
  .join("")}
</div>`),
    );
  });

  app.get("/hotel", (req, res) => {
    const q = query(req.query);
    const h = HOTELS.find((x) => x.id === req.query.id);
    if (!h) return void res.status(404).send(page(brand, "Not found", "<h1>Hotel not found</h1>"));
    res.send(
      page(brand, h.name, `
<div class="steps">1 Search › <b>2 Choose room</b> › 3 Guest details › 4 Pay</div>
${photo(h, h.area)}
<h1 style="margin-top:16px">${esc(h.name)}</h1><div class="stars">${stars(h.stars)}</div>
<p>${esc(h.blurb)}</p>
<p class="muted">${esc(q.checkin)} → ${checkoutDate(q)} · ${q.nights} night${q.nights > 1 ? "s" : ""} · ${q.guests} guest${q.guests > 1 ? "s" : ""}</p>
<div class="grid">
${h.rooms
  .map(
    (r) => `<div class="card room row between" data-room="${r.id}" data-nightly="${r.nightly}">
  <div><h2 style="margin:0">${esc(r.name)}</h2><div class="muted">${esc(r.beds)} · ${esc(r.size)}</div>${r.refundable ? '<span class="tag good">Free cancellation</span>' : '<span class="tag">Non-refundable</span>'}</div>
  <div style="text-align:right"><div class="price">${usdc(r.nightly * q.nights)} USDC</div><div class="muted" style="font-size:13px">${q.nights} night${q.nights > 1 ? "s" : ""} · ${usdc(r.nightly)} / night</div>
  <a class="btn" style="margin-top:8px" href="/reserve?${qs(q, { hotel: h.id, room: r.id })}">Reserve</a></div>
</div>`,
  )
  .join("")}
</div>`),
    );
  });

  const pick = (q: Record<string, unknown>) => {
    const h = HOTELS.find((x) => x.id === q.hotel);
    const r = h?.rooms.find((x) => x.id === q.room);
    return h && r ? { h, r } : undefined;
  };

  app.get("/reserve", (req, res) => {
    const q = query(req.query);
    const p = pick(req.query);
    if (!p) return void res.status(404).send(page(brand, "Not found", "<h1>Room not found</h1>"));
    const total = p.r.nightly * q.nights;
    res.send(
      page(brand, "Guest details", `
<div class="steps">1 Search › 2 Choose room › <b>3 Guest details</b> › 4 Pay</div>
<h1>Guest details</h1>
<div class="grid" style="grid-template-columns:1.4fr 1fr;align-items:start">
<form class="card grid" method="post" action="/reserve" id="guest-form">
  ${Object.entries({ city: q.city, checkin: q.checkin, nights: q.nights, guests: q.guests, hotel: p.h.id, room: p.r.id }).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("")}
  <div><label for="full_name">Full name (as on passport)</label><input id="full_name" name="full_name" required autocomplete="name"></div>
  <div><label for="passport_no">Passport number</label><input id="passport_no" name="passport_no" required></div>
  <div><label for="email">Email for the confirmation</label><input id="email" name="email" type="email" required></div>
  <div><label for="requests">Special requests (optional)</label><textarea id="requests" name="requests" rows="2"></textarea></div>
  <button type="submit" id="continue">Continue to payment</button>
</form>
<aside class="card"><b>${esc(p.h.name)}</b><div class="muted">${esc(p.r.name)}</div><p class="muted">${esc(q.checkin)} → ${checkoutDate(q)} · ${q.nights} night${q.nights > 1 ? "s" : ""}</p><div class="row between"><span>Total</span><span class="price">${usdc(total)} USDC</span></div></aside>
</div>`),
    );
  });

  app.post("/reserve", (req, res) => {
    const q = query(req.body);
    const p = pick(req.body);
    const g = req.body as Record<string, string>;
    if (!p || !g.full_name?.trim() || !g.passport_no?.trim() || !g.email?.trim()) return void res.status(400).send(page(brand, "Missing details", "<h1>Please fill in every required field</h1>"));
    const b = store.create({
      title: `${p.h.name}, ${p.r.name}`,
      detail: { hotel: p.h.name, room: p.r.name, city: CITIES[q.city], checkin: q.checkin, checkout: checkoutDate(q), nights: q.nights, guests: q.guests },
      guest: { full_name: g.full_name.trim(), passport_no: g.passport_no.trim(), email: g.email.trim(), requests: (g.requests ?? "").trim() },
      total: String(p.r.nightly * q.nights),
    });
    res.redirect(303, `/booking?id=${b.id}`);
  });

  // Lantern Stays takes USDC on Arbitrum; the other sites on Base
  checkout(app, { brand, store, payTo, description: "Lantern Stays room booking", steps: ["Search", "Choose room", "Guest details", "Pay"], net: NETS.arb });
  return app;
}
