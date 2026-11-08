// What the agent did, step by step: printed, and saved under wayfare/.data/trips/<run>/ with screenshots, so the
// web app (and anyone checking) can replay a trip.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.data");

export type Step = { at: string; kind: string; text: string; data?: unknown };

export class Activity {
  readonly dir: string;
  readonly steps: Step[] = [];
  constructor(readonly run: string) {
    this.dir = path.join(DATA, "trips", run);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  add(kind: string, text: string, data?: unknown) {
    const s = { at: new Date().toISOString(), kind, text, data };
    this.steps.push(s);
    console.log(`[${s.at.slice(11, 19)}] ${kind.padEnd(8)} ${text}`);
    fs.appendFileSync(path.join(this.dir, "activity.jsonl"), JSON.stringify(s) + "\n");
  }

  file(name: string) {
    return path.join(this.dir, name);
  }

  save(name: string, value: unknown) {
    fs.writeFileSync(this.file(name), JSON.stringify(value, null, 2));
  }
}
