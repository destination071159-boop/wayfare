// OpenAI for the two judgment calls (understanding the request, choosing between options). Without a key, callers
// fall back to simple rules, and the plan says which one decided.
import OpenAI from "openai";

export const hasLLM = () => !!process.env.OPENAI_API_KEY;
export const MODEL = () => process.env.OPENAI_MODEL || "gpt-4.1-mini";

let client: OpenAI | undefined;
const openai = () => (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 }));

/** One structured answer that must match `schema` (OpenAI strict JSON schema). */
export async function askJSON<T>(system: string, user: string, name: string, schema: Record<string, unknown>): Promise<T> {
  const res = await openai().chat.completions.create({
    model: MODEL(),
    temperature: 0,
    max_completion_tokens: 1200,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
  });
  const text = res.choices[0]?.message?.content;
  if (!text) throw new Error("the model returned nothing");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`the model's answer was not valid JSON (${res.choices[0]?.finish_reason}): ${text.slice(0, 300)}…`);
  }
}
