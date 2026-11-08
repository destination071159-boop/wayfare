// The intent parser: plain English → a structured trip request the agent can shop for.
// With OPENAI_API_KEY it uses the model (strict JSON schema, only places the merchants serve); without one, a small
// rule-based parser handles the common shape "<from> to <to>, N nights, dinner, under $X".
import { askJSON, hasLLM, MODEL } from "./llm.js";

export const AIRPORTS = { bkk: "Bangkok", sin: "Singapore", icn: "Seoul", hnd: "Tokyo Haneda", kix: "Osaka Kansai" } as const;
export const STATIONS = { tokyo: "Tokyo", shinagawa: "Shinagawa", nagoya: "Nagoya", kyoto: "Kyoto", osaka: "Shin-Osaka" } as const;
export const CITIES = { kyoto: "Kyoto", tokyo: "Tokyo", osaka: "Osaka" } as const;

export type TripRequest = {
  summary: string;
  travelers: number;
  budget_usd: number | null;
  flight: { from: keyof typeof AIRPORTS; to: keyof typeof AIRPORTS; date: string; cabin: "economy" | "premium" } | null;
  train: { from: keyof typeof STATIONS; to: keyof typeof STATIONS; date: string; class: "ordinary" | "green" } | null;
  hotel: { city: keyof typeof CITIES; checkin: string; nights: number; preferences: string } | null;
  dinner: { city: keyof typeof CITIES; date: string; party: number; time: string; preferences: string } | null;
  not_possible: string[];
  parsed_by: string;
};

const nullable = (o: Record<string, unknown>) => ({ anyOf: [o, { type: "null" }] });
const obj = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const DATE = { type: "string", description: "YYYY-MM-DD" };

const SCHEMA = obj({
  summary: { type: "string", description: "One line in plain ASCII, e.g. 'Bangkok to Kyoto, 19-21 Nov, 1 traveler'" },
  travelers: { type: "integer" },
  budget_usd: { anyOf: [{ type: "number" }, { type: "null" }], description: "Total budget in real US dollars if given" },
  flight: nullable(obj({ from: { type: "string", enum: Object.keys(AIRPORTS) }, to: { type: "string", enum: Object.keys(AIRPORTS) }, date: DATE, cabin: { type: "string", enum: ["economy", "premium"] } })),
  train: nullable(obj({ from: { type: "string", enum: Object.keys(STATIONS) }, to: { type: "string", enum: Object.keys(STATIONS) }, date: DATE, class: { type: "string", enum: ["ordinary", "green"] } })),
  hotel: nullable(obj({ city: { type: "string", enum: Object.keys(CITIES) }, checkin: DATE, nights: { type: "integer" }, preferences: { type: "string" } })),
  dinner: nullable(obj({ city: { type: "string", enum: Object.keys(CITIES) }, date: DATE, party: { type: "integer" }, time: { type: "string", description: "HH:MM wanted, or '' if any" }, preferences: { type: "string" } })),
  not_possible: { type: "array", items: { type: "string" }, description: "Parts of the request the merchants can't serve" },
});

const SYSTEM = (today: string) => `You turn a traveler's request into a trip request for a booking agent. Today is ${today}.
The agent can only book with these merchants:
- Kumo Air flights between airports: ${Object.entries(AIRPORTS).map(([k, v]) => `${k}=${v}`).join(", ")}.
- Kiseki Rail bullet trains between stations: ${Object.entries(STATIONS).map(([k, v]) => `${k}=${v}`).join(", ")} (Kansai airport travelers usually take the train from osaka).
- Lantern Stays hotels in: ${Object.keys(CITIES).join(", ")}.
- Sumi Table restaurants in: ${Object.keys(CITIES).join(", ")}.
Rules:
- Book only what the trip needs or the traveler asked for. To reach a city by air then rail, fly to the nearest airport and add the train the same day (hnd: train from tokyo; kix: train from osaka).
- Resolve relative dates ("next Friday") from today. The hotel check-in is the arrival day unless stated.
- If the traveler names a time for dinner, use HH:MM; otherwise "".
- Put anything that can't be served (other cities, cars, tours…) in not_possible and leave it out.
- Write every text field in plain ASCII (no arrows or dashes).
- budget_usd is the total the traveler states in real dollars, or null.`;

export async function parseIntent(text: string, today = new Date().toISOString().slice(0, 10)): Promise<TripRequest> {
  if (hasLLM()) {
    const r = await askJSON<Omit<TripRequest, "parsed_by">>(SYSTEM(today), text, "trip_request", SCHEMA);
    return { ...r, parsed_by: `openai:${MODEL()}` };
  }
  return { ...ruleParse(text, today), parsed_by: "rules" };
}

/** Fallback: "<from> to <city> on <YYYY-MM-DD>, N nights, (sushi) dinner, under $X". */
export function ruleParse(text: string, today: string): Omit<TripRequest, "parsed_by"> {
  const t = text.toLowerCase();
  const find = <T extends Record<string, string>>(m: T, s: string) => (Object.keys(m) as (keyof T & string)[]).find((k) => s.includes(k) || s.includes(m[k].toLowerCase().split(" ")[0]));
  const [, fromPart = "", toPart = t] = t.match(/(?:from\s+)?(.+?)\s+to\s+(.+)/) ?? [];
  const city = (find(CITIES, toPart) ?? "kyoto") as keyof typeof CITIES;
  const origin = find(AIRPORTS, fromPart);
  const date = t.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? new Date(Date.parse(today) + 14 * 86_400_000).toISOString().slice(0, 10);
  const nights = Number(t.match(/(\d+)\s*nights?/)?.[1] ?? 2);
  const travelers = Number(t.match(/(\d+)\s*(?:people|travelers|guests|adults)/)?.[1] ?? 1);
  const budget = Number(t.match(/\$\s?([\d,]+)/)?.[1]?.replace(/,/g, "") ?? NaN);
  const airport = city === "tokyo" ? "hnd" : "kix";
  const station = city === "tokyo" ? null : airport === "kix" ? "osaka" : "tokyo";
  return {
    summary: `${origin ? AIRPORTS[origin] + " → " : ""}${CITIES[city]}, ${nights} night${nights > 1 ? "s" : ""} from ${date}`,
    travelers,
    budget_usd: Number.isFinite(budget) ? budget : null,
    flight: origin && origin !== airport ? { from: origin, to: airport, date, cabin: "economy" } : null,
    train: origin && station && city !== "osaka" ? { from: station, to: city === "kyoto" ? "kyoto" : "tokyo", date, class: "ordinary" } : null,
    hotel: { city, checkin: date, nights, preferences: t.match(/(ryokan|near [a-z]+|cheap|luxury)/)?.[0] ?? "" },
    dinner: /dinner|sushi|restaurant|omakase/.test(t) ? { city, date: new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10), party: travelers, time: "", preferences: t.match(/sushi|kaiseki|yakitori|tofu/)?.[0] ?? "" } : null,
    not_possible: [],
  };
}
