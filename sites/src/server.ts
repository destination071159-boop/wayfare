// Starts the demo merchant sites. Each has its own port and its own receiving address (from wayfare/.env).
import { privateKeyToAccount } from "viem/accounts";
import { diningSite } from "./dining.js";
import { flightSite } from "./flight.js";
import { hotelSite } from "./hotel.js";
import { railSite } from "./rail.js";

const payTo = (envKey: string) => {
  const k = process.env[envKey];
  if (!k) throw new Error(`${envKey} is not set: run pnpm -C agent setup:testnet first`);
  return privateKeyToAccount(k as `0x${string}`).address;
};

const sites = [
  { name: "Kiseki Rail (train)", port: 4101, app: railSite(payTo("MERCHANT_KEY_KISEKI_RAIL")) },
  { name: "Lantern Stays (hotel)", port: 4102, app: hotelSite(payTo("MERCHANT_KEY_LANTERN_STAYS")) },
  { name: "Kumo Air (flight)", port: 4103, app: flightSite(payTo("MERCHANT_KEY_KUMO_AIR")) },
  // paid on NEAR testnet: its own NEAR account (created by setup:testnet)
  { name: "Sumi Table (dining)", port: 4104, app: diningSite(`sumi-table.${process.env.TRAVELER_ACCOUNT}`) },
];

for (const s of sites) s.app.listen(s.port, "127.0.0.1", () => console.log(`${s.name} http://localhost:${s.port}`));
