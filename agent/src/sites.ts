// Site skills: how the agent searches each merchant in the browser, the way a person would (fill the search form,
// press search, read the result cards). Choosing between results is the planner's job.
import type { Browser } from "./browser.js";
import type { TripRequest } from "./intent.js";
import { MERCHANTS } from "./merchants.js";

export type Kind = "flight" | "train" | "hotel" | "dinner";
export type Candidate = { text: string; action: string; href: string; price?: number };

const url = (id: string) => MERCHANTS.find((m) => m.id === id)!.url;

type Skill = {
  merchant: string;
  /** search form values: [field name, value, is a <select>] */
  form: (r: TripRequest) => [string, string, boolean][];
  /** hotels list hotels first; the rooms are one page deeper */
  twoLevel?: boolean;
};

export const SKILLS: Record<Kind, Skill> = {
  flight: {
    merchant: "kumo-air",
    form: (r) => [
      ["from", r.flight!.from, true],
      ["to", r.flight!.to, true],
      ["date", r.flight!.date, false],
      ["pax", String(r.travelers), false],
    ],
  },
  train: {
    merchant: "kiseki-rail",
    form: (r) => [
      ["from", r.train!.from, true],
      ["to", r.train!.to, true],
      ["date", r.train!.date, false],
      ["pax", String(r.travelers), false],
    ],
  },
  hotel: {
    merchant: "lantern-stays",
    twoLevel: true,
    form: (r) => [
      ["city", r.hotel!.city, true],
      ["checkin", r.hotel!.checkin, false],
      ["nights", String(r.hotel!.nights), false],
      ["guests", String(r.travelers), false],
    ],
  },
  dinner: {
    merchant: "sumi-table",
    form: (r) => [
      ["city", r.dinner!.city, true],
      ["date", r.dinner!.date, false],
      ["party", String(r.dinner!.party), false],
    ],
  },
};

const usdcBase = (s: string) => {
  const m = s.match(/([\d.]+)\s*USDC/);
  return m ? Math.round(Number(m[1]) * 1_000_000) : undefined;
};

/** Every bookable action on the page: one per button inside a result card. */
export async function readCandidates(b: Browser): Promise<Candidate[]> {
  const cards = await b.json<{ text: string; links: { text: string; href: string }[] }[]>(`
    return [...document.querySelectorAll("article.card, .card.room")].map(c => ({
      text: c.innerText.replace(/\\s+/g, " ").trim().slice(0, 500),
      links: [...c.querySelectorAll("a.btn")].map(a => ({ text: a.innerText.trim(), href: a.href })),
    }));`);
  return cards.flatMap((c) => c.links.map((l) => ({ text: c.text, action: l.text, href: l.href, price: usdcBase(l.text) ?? usdcBase(c.text) })));
}

/** Opens the merchant, fills its search form and submits it, like a person. Returns the results' candidates. */
export async function search(b: Browser, kind: Kind, r: TripRequest): Promise<Candidate[]> {
  const s = SKILLS[kind];
  await b.open(url(s.merchant));
  const fields = s.form(r);
  for (const [name, value, isSelect] of fields) {
    const sel = `form.search [name="${name}"]`;
    if (isSelect) await b.select(sel, value);
    // date inputs ignore typed text: set the value the way a date picker does, and tell the page it changed
    else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) await b.json(`const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return e.value;`);
    else await b.fill(sel, value);
  }
  // read the form back before searching: a wrong date or city would book the wrong thing
  const got = await b.json<Record<string, string>>(`return Object.fromEntries([...new FormData(document.querySelector("form.search")).entries()]);`);
  const wrong = fields.filter(([name, value]) => got[name] !== value);
  if (wrong.length) throw new Error(`${s.merchant}: the search form didn't take ${wrong.map(([n, v]) => `${n}=${v} (has ${got[n]})`).join(", ")}`);
  await b.click("form.search button[type=submit]");
  await b.wait("article.card");
  return readCandidates(b);
}

/** The total on a booking form page (the order summary). */
export async function readTotal(b: Browser): Promise<number | undefined> {
  const t = await b.json<string | null>(`return document.querySelector("aside .price")?.innerText ?? null;`);
  return t ? usdcBase(t) : undefined;
}
