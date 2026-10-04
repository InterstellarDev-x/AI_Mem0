// Lesson 16: Reflect — the agent loop with a disposition.
//
// The one idea: reflect isn't a function call, it's an *agent loop*. The
// model gets tools and works hierarchically — curated mental models first,
// then observations, then raw facts as ground truth — up to 10 iterations
// before it must answer. And the loop has a personality: the bank's
// disposition (skepticism / literalism / empathy, each 1–5) is written into
// its prompt, so the same evidence gets reasoned about differently.
//
// Grounded in the real Hindsight:
// - engine/reflect/tools_schema.py: "The tools support a hierarchical
//   retrieval strategy: 1. search_mental_models — user-curated stored
//   reflect responses (try first); 2. search_observations — consolidated
//   knowledge with freshness; 3. recall — raw facts as ground truth."
//   (+ expand for chunk context, + done to finish.)
// - engine/reflect/agent.py: "Execute the reflect agent loop using native
//   tool calling", DEFAULT_MAX_ITERATIONS = 10.
// - engine/response_models.py: DispositionTraits — "skepticism: 1=trusting,
//   5=skeptical; literalism: 1=flexible, 5=literal; empathy: 1=detached,
//   5=empathetic" — rendered into the prompt via bank_disposition_line.
//
// Our version: ReflectAgent over lesson 13's Engine. Keyed, gpt-6-luna
// really picks tools as JSON each iteration (max 5 in the demo; Hindsight
// uses 10). Keyless, the hierarchy runs mechanically and skepticism is
// applied as an explicit rule — labeled, not hidden. The loop and the
// personality are the lesson.
//
// Run it:
//
//     bun run lesson16
//     OPENAI_API_KEY=... bun run lesson16   # the model really drives the loop

import { Engine } from "./lesson13.ts";
import OpenAI from "openai";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-6-luna";

interface Disposition {
  skepticism: number; // 1=trusting … 5=skeptical
  literalism: number; // 1=flexible … 5=literal
  empathy: number; // 1=detached … 5=empathetic
}

const clamp15 = (n: number): number => Math.max(1, Math.min(5, Math.round(n)));

/** Modeled on Hindsight's build_disposition_description. */
function dispositionPrompt(d: Disposition): string {
  const s = clamp15(d.skepticism);
  const l = clamp15(d.literalism);
  const e = clamp15(d.empathy);
  const sk = [
    "You are highly skeptical: question the reliability of information, flag conflicts and hidden assumptions, never state uncertain things as fact.",
    "You are fairly skeptical: question obvious inconsistencies.",
    "You are balanced: neither trusting nor skeptical.",
    "You are fairly trusting: accept information unless clearly contradictory.",
    "You are trusting: take information at face value.",
  ][5 - s];
  const li = [
    "Interpret everything strictly literally.",
    "Interpret mostly literally, allowing slight flexibility.",
    "Interpret with balance.",
    "Interpret flexibly: read between the lines when reasonable.",
    "Interpret very flexibly: intent matters more than wording.",
  ][5 - l];
  const em = [
    "Consider emotional context deeply in every answer.",
    "Weigh emotional context where relevant.",
    "Be neutral about emotional context.",
    "Stay mostly detached and factual.",
    "Stay fully detached: facts only, no emotional framing.",
  ][5 - e];
  return `${sk} ${li} ${em}`;
}

let openai: OpenAI | null = null;
function llm(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  openai ??= new OpenAI({ baseURL: process.env.OPENAI_API_BASE });
  return openai;
}

interface Step {
  tool: string;
  query?: string;
  answer?: string;
}

class ReflectAgent {
  constructor(
    private engine: Engine,
    private disposition: Disposition,
    private notes: { question: string; answer: string }[] = [],
  ) {}

  // ---- tools (all read-only, like Hindsight's reflect tools) ----
  private searchMentalModels(q: string): string[] {
    // length > 2, consistent with the engine tokenizer — "Bob" must match "Bob"
    const qt = new Set(q.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
    return this.notes
      .filter((n) =>
        n.question.toLowerCase().split(/\W+/).some((w) => w.length > 2 && qt.has(w)),
      )
      .map((n) => `Q: ${n.question} A: ${n.answer}`);
  }
  private searchObservations(q: string): string[] {
    return this.engine.recall(q).filter((h) => h.kind === "observation").map((h) => h.text);
  }
  private recallFacts(q: string): string[] {
    return this.engine.recall(q).filter((h) => h.kind === "fact").map((h) => h.text);
  }
  private runTool(tool: string, query: string): string[] {
    switch (tool) {
      case "search_mental_models":
        return this.searchMentalModels(query);
      case "search_observations":
        return this.searchObservations(query);
      case "recall":
        return this.recallFacts(query);
      default:
        return [`unknown tool: ${tool}`];
    }
  }

  /** One LLM turn: pick the next tool (or done) as JSON. */
  private async nextStep(client: OpenAI, question: string, seen: string[]): Promise<Step> {
    const res = await client.chat.completions.create({
      model: CHAT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You are a reflect agent answering from memory. ${dispositionPrompt(this.disposition)}\n` +
            "Tools — respond with exactly one JSON call:\n" +
            '{"tool": "search_mental_models", "query": "..."} — curated Q&A, try first\n' +
            '{"tool": "search_observations", "query": "..."} — consolidated beliefs\n' +
            '{"tool": "recall", "query": "..."} — raw facts, ground truth\n' +
            '{"tool": "done", "answer": "..."} — finish with your answer\n' +
            "Strategy: mental models first, then observations, then recall to verify. Call done when you can answer.",
        },
        {
          role: "user",
          content:
            `Question: ${question}\nTool results so far:\n${seen.join("\n") || "(none yet)"}`,
        },
      ],
    });
    const content = res.choices[0]?.message.content;
    if (!content) throw new Error("empty response");
    try {
      const p = JSON.parse(content) as Partial<Step>;
      if (p.tool === "done") return { tool: "done", answer: String(p.answer ?? "") };
      if (["search_mental_models", "search_observations", "recall"].includes(p.tool ?? "")) {
        return { tool: p.tool!, query: String(p.query ?? question) };
      }
    } catch { /* fall through to done */ }
    return { tool: "done", answer: "(the agent failed to choose a tool)" };
  }

  async run(question: string, maxIterations: number = 5): Promise<void> {
    const d = this.disposition;
    console.log(
      `\nreflect agent — disposition skepticism=${d.skepticism} literalism=${d.literalism} empathy=${d.empathy}`,
    );
    console.log(`question: "${question}"`);
    const client = llm();

    if (!client) {
      // Mechanical: the hierarchy, no choices. Disposition applied as an
      // explicit rule — skepticism refuses firm answers over conflicted evidence.
      const seen: string[] = [];
      for (const tool of ["search_mental_models", "search_observations", "recall"] as const) {
        const r = this.runTool(tool, question);
        seen.push(`${tool}: ${r.length} hit(s)`);
        console.log(`  [${tool}] ${r.length} hit(s)`);
        if (tool === "search_mental_models" && r.length > 0) break;
      }
      const models = this.searchMentalModels(question);
      const obss = this.searchObservations(question);
      const facts = this.recallFacts(question);
      let answer: string;
      if (models.length > 0) answer = models[0];
      else if (obss.length > 0) answer = obss[0];
      else if (facts.length > 0) answer = facts.join(" ");
      else answer = "(no evidence)";
      const contested = [...obss, ...facts].some((t) => /contested/i.test(t));
      if (d.skepticism >= 4 && contested) {
        answer =
          `The evidence conflicts, so no firm answer: ${answer} ` +
          `[skepticism=${d.skepticism}: refusing to state the uncertain as fact]`;
      }
      console.log(`  answer: ${answer}`);
      console.log(`  [mechanical loop — keyed runs let the model drive]`);
      return;
    }

    const seen: string[] = [];
    let answer = "";
    for (let i = 0; i < maxIterations; i++) {
      const step = await this.nextStep(client, question, seen);
      if (step.tool === "done") {
        answer = step.answer ?? "";
        console.log(`  iter ${i + 1}: done`);
        break;
      }
      const r = this.runTool(step.tool, step.query ?? question);
      seen.push(`${step.tool}("${step.query}") → ${r.map((x) => `"${x.slice(0, 80)}"`).join("; ") || "no hits"}`);
      console.log(`  iter ${i + 1}: ${step.tool}("${step.query}") → ${r.length} hit(s)`);
      // Last iteration without done: break with answer unset so the forced
      // synthesis below runs (assigning a placeholder here would make
      // `if (!answer)` dead code and the user would get the placeholder).
    }
    if (!answer) {
      // forced synthesis from the trace
      const res = await client.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: `Answer from the gathered evidence. ${dispositionPrompt(d)}` },
          { role: "user", content: `Question: ${question}\nEvidence:\n${seen.join("\n")}` },
        ],
      });
      answer = res.choices[0]?.message.content?.trim() ?? "";
    }
    console.log(`  answer: ${answer}`);
  }
}

async function demo(): Promise<void> {
  const engine = new Engine();
  const D = (s: string): Date => new Date(s + "T00:00:00Z");
  await engine.retain("Alice works at Google as a software engineer.", D("2026-06-02"));
  await engine.retain("Alice left Google last week.", D("2026-10-01"));

  // A curated note that does NOT cover the question — the loop must fall through.
  const notes = [{ question: "What is Bob's favorite food?", answer: "Bob likes pizza." }];

  const skeptical = new ReflectAgent(engine, { skepticism: 5, literalism: 3, empathy: 2 }, notes);
  await skeptical.run("Where does Alice work?");

  const trusting = new ReflectAgent(engine, { skepticism: 1, literalism: 3, empathy: 2 }, notes);
  await trusting.run("Where does Alice work?");

  console.log("\nSame evidence, same tools, same hierarchy — different dispositions,");
  console.log("different answers. The loop is the machinery; the disposition is the character.");
}

if (import.meta.main) {
  await demo();
}
