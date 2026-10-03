// Lesson 17: The LLM wrapper — memory as invisible infrastructure.
//
// The one idea: wrap the client once, and every LLM call automatically
// recalls relevant memories into the prompt and retains the conversation
// afterwards. The app code doesn't change — it keeps calling
// chat.completions.create like always; the wrapper does the memory work
// around it.
//
// Grounded in the real Hindsight
// (hindsight-integrations/litellm/hindsight_litellm/wrappers.py):
// `wrapped = wrap_openai(client, bank_id="my-agent")` — then every call:
//  1. extracts the user query (explicit override, else the last user
//     message — structured/vision content handled too),
//  2. recalls (or reflects for) memories and injects them into the system
//     prompt — appended to an existing system message, or prepended as new,
//  3. makes the real API call with everything else untouched,
//  4. stores the conversation via retain — on a background thread
//     (_retain_background), so it never blocks the response.
// Per-call overrides travel as hindsight_* kwargs, stripped before the call
// (hindsight_use_reflect, hindsight_query, inject_memories,
// store_conversations, …).
//
// Our version: wrapChat(engine, chatFn) — the same four steps over lesson
// 13's Engine. The underlying chat is any ChatFn, so the pattern is
// provider-agnostic by construction (Hindsight itself sits on LiteLLM for
// 100+ models). Keyed, a real model answers from the injected memories;
// keyless, a stub shows exactly what would have been sent. The wrapper —
// not the model — is the lesson.
//
// Run it:
//
//     bun run lesson17
//     OPENAI_API_KEY=... bun run lesson17   # a real model answers from memory

import { Engine } from "./lesson13.ts";
import OpenAI from "openai";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-6-luna";

interface ChatMessage {
  role: string;
  content: string;
}
type ChatFn = (messages: ChatMessage[]) => Promise<string>;

interface WrapOpts {
  inject?: boolean; // recall memories into the prompt (default true)
  store?: boolean; // retain the exchange afterwards (default true)
  query?: string; // override the recall query (default: last user message)
}

let openai: OpenAI | null = null;
function llm(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  openai ??= new OpenAI({ baseURL: process.env.OPENAI_API_BASE });
  return openai;
}

/**
 * Wrap any chat function with automatic memory. Four steps, mirroring
 * Hindsight's wrapper: extract query → inject memories → real call →
 * retain the exchange.
 */
function wrapChat(engine: Engine, chat: ChatFn, defaults: WrapOpts = {}) {
  return async function chatWithMemory(
    messages: ChatMessage[],
    opts: WrapOpts = {},
  ): Promise<string> {
    const o = { inject: true, store: true, ...defaults, ...opts };

    // 1. the user query: explicit override, else the last user message
    const query =
      o.query ?? [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    let outgoing = messages;

    // 2. recall → inject into the system prompt (append or prepend)
    if (o.inject && query) {
      const hits = engine.recall(query, 3);
      if (hits.length > 0) {
        const block =
          `[Relevant memories]\n${hits.map((h) => `- (${h.kind}) ${h.text}`).join("\n")}`;
        const sys = outgoing.findIndex((m) => m.role === "system");
        outgoing =
          sys >= 0
            ? outgoing.map((m, i) =>
                i === sys ? { ...m, content: `${m.content}\n\n${block}` } : m,
              )
            : [{ role: "system", content: block }, ...outgoing];
        console.log(`  [wrapper] injected ${hits.length} memories into the prompt`);
      } else {
        console.log(`  [wrapper] no memories to inject`);
      }
    }

    // 3. the real call — everything else untouched
    const answer = await chat(outgoing);

    // 4. retain the exchange. Hindsight does this on a background thread so
    //    it never blocks the response; we await for a deterministic demo.
    if (o.store && query) {
      await engine.retain(`User: ${query}\nAssistant: ${answer}`);
      console.log(`  [wrapper] retained the exchange`);
    }
    return answer;
  };
}

async function demo(): Promise<void> {
  const engine = new Engine();
  const D = (s: string): Date => new Date(s + "T00:00:00Z");
  await engine.retain("Alice works at Google as a software engineer.", D("2026-06-02"));
  await engine.retain("Alice left Google last week.", D("2026-10-01"));

  const client = llm();
  const chat: ChatFn = client
    ? async (messages) =>
        (await client.chat.completions.create({ model: CHAT_MODEL, messages })).choices[0]
          ?.message.content ?? ""
    : async (messages) => {
        const sys = messages.find((m) => m.role === "system")?.content ?? "(none)";
        return `(stub) saw ${messages.length} messages; system prompt: "${sys.slice(0, 90)}…"`;
      };

  console.log("WITHOUT the wrapper — the model sees only raw messages:");
  console.log(`  ${await chat([{ role: "user", content: "Where does Alice work?" }])}`);

  console.log("\nWITH the wrapper — same call, memory injected, exchange retained:");
  const chatWithMemory = wrapChat(engine, chat);
  console.log(
    `  ${await chatWithMemory([{ role: "user", content: "Where does Alice work?" }])}`,
  );

  console.log("\nPer-call override (hindsight_* style) — no injection, no storing:");
  console.log(
    `  ${await chatWithMemory([{ role: "user", content: "Hi" }], { inject: false, store: false })}`,
  );

  engine.stats();
  console.log("\nTwo lines to wrap; every call after that remembers and learns.");
}

if (import.meta.main) {
  await demo();
}
