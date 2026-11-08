// A thin wrapper over the agent-browser CLI: one isolated headless session per trip.
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/.bin/agent-browser");

export class Browser {
  log: { cmd: string; out: string; at: string }[] = [];
  constructor(readonly session: string) {}

  run(args: string[], timeoutMs = 45_000): Promise<string> {
    const flags = ["--session", this.session, ...(process.env.BROWSER_PATH ? ["--executable-path", process.env.BROWSER_PATH] : [])];
    return new Promise((resolve, reject) => {
      execFile(BIN, [...flags, ...args], { timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
        const out = String(stdout).trim();
        this.log.push({ cmd: args.join(" ").slice(0, 300), out: out.slice(0, 1000), at: new Date().toISOString() });
        if (err) reject(new Error(`agent-browser ${args[0]}: ${String(stderr || err.message).trim().slice(0, 300)}`));
        else resolve(out);
      });
    });
  }

  open = (url: string) => this.run(["open", url]);
  click = (sel: string) => this.run(["click", sel]);
  fill = (sel: string, text: string) => this.run(["fill", sel, text]);
  select = (sel: string, value: string) => this.run(["select", sel, value]);
  url = () => this.run(["get", "url"]);
  wait = (selOrMs: string) => this.run(["wait", selOrMs]);
  waitText = (text: string, timeoutMs = 30_000) => this.run(["wait", "--text", text], timeoutMs + 5_000);
  screenshot = (file: string) => this.run(["screenshot", file]);
  viewport = (w: number, h: number) => this.run(["set", "viewport", String(w), String(h)]);
  close = () => this.run(["close"]).catch(() => "");

  /** Runs JS in the page and parses its JSON result. */
  async json<T>(js: string): Promise<T> {
    let out: unknown = await this.run(["eval", `JSON.stringify((() => { ${js} })())`]);
    for (let i = 0; i < 2 && typeof out === "string"; i++) {
      try {
        out = JSON.parse(out as string);
      } catch {
        break;
      }
    }
    return out as T;
  }
}
