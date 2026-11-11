/** USDC base units → "2.90" */
export const usdc = (base: number | string) => (Number(base) / 1e6).toFixed(2);
/** the sites charge 1/100 of real prices: base units → real dollars */
export const usd = (base: number | string) => `$${Math.round(Number(base) / 10_000).toLocaleString("en-US")}`;
export const short = (s?: string | null, n = 6) => (!s ? "" : s.length <= n * 2 + 1 ? s : `${s.slice(0, n + (s.startsWith("0x") ? 2 : 0))}…${s.slice(-n)}`);
export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
export const KIND_LABEL: Record<string, string> = { flight: "Flight", train: "Train", hotel: "Stay", dinner: "Dinner" };
