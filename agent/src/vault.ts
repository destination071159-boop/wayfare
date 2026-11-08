// The traveler's vault: profile fields the agent may need on booking forms (name, passport, email).
// The agent must log each read on NEAR first (record_read); the contract refuses fields the trip didn't grant and
// any read after the trip ends. The profile itself lives in wayfare/.data/vault.json (git-ignored).
import fs from "node:fs";
import path from "node:path";
import type { Account } from "near-api-js";
import { DATA } from "./activity.js";
import { call } from "./near.js";

export type Profile = Record<string, string>;
const FILE = path.join(DATA, "vault.json");
const DEMO: Profile = { full_name: "Aiko Tanaka", passport_no: "TZ1234567", email: "aiko.tanaka@example.com" };

export function profile(): Profile {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Profile;
  } catch {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(DEMO, null, 2));
    return DEMO;
  }
}

/** Logs the read on chain (the contract checks the grant), then returns the values. */
export async function readFields(agent: Account, tripId: string, fields: string[], purpose: string): Promise<{ values: Profile; readId: string; tx: string }> {
  const { value: readId, tx } = await call<string>(agent, "record_read", { trip_id: tripId, fields, purpose });
  const p = profile();
  const values: Profile = {};
  for (const f of fields) {
    if (!(f in p)) throw new Error(`the vault has no ${f}`);
    values[f] = p[f];
  }
  return { values, readId, tx };
}
