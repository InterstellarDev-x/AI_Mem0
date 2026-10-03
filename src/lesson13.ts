// Lesson 13: The full engine — retain, recall, reflect.
//
// The one idea: twelve lessons built the parts; now they become one
// interface with three verbs. retain() writes (normalize → index, then the
// background job learns). recall() reads (retrieve → prefer observations →
// budget). reflect() answers (synthesis over recall, read-only — it persists
// nothing). The wiring between them is the lesson: consolidation runs after
// retain; recall prefers beliefs over the raw facts they absorbed; reflect
// calls recall internally.
//
// Grounded in the real Hindsight (engine/memory_engine.py):
// - retain(bank_id, content, context, event_date) → unit IDs.
//   "Store content as memory units with temporal and semantic links."
// - recall(): "N*4-way parallel retrieval (semantic, BM25, graph, temporal)
//   → RRF merge → cross-encoder rerank → MMR diversify → token-budget
//   filter." With prefer_observations: "drop raw facts that a returned
//   observation was consolidated from" — beliefs supersede their sources
//   at read time.
// - reflect_async(bank_id, query): "Reflect and formulate an answer using an
//   agentic loop with tools" (lookup mental models, recall facts, search
//   observations). "Reflect is read-only: it synthesizes an answer from the
//   bank's stored memories and persists nothing."
//
// Our version: the write side is lesson 11's memory (imported, not
// rewritten); recall is a compact scorer run in the same staged shape;
// reflect synthesizes via gpt-6-luna when OPENAI_API_KEY is set. The
// engineering — one store, three verbs, background learning — is the lesson.
//
// Run it:
//
//     bun run lesson13
//     OPENAI_API_KEY=... bun run lesson13   # LLM-synthesized reflections

import { Memory, type Fact, type Observation } from "./lesson11.ts";
import OpenAI from "openai";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-6-luna";

export interface Hit {
  kind: "fact" | "observation";
  id: number;
  text: string;
  score: number;
  sourceIds: number[]; // facts this hit absorbs (itself for a raw fact)
}

const STOPWORDS = new Set(
  "what whats is are was were be been being the a an of at in on to for with as by and or but does do did done how where when who whom whose which it its this that these those i you he she we they me him her us them my your his our their".split(
    " ",
  ),
);
const toks = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

let openai: OpenAI | null = null;
function llm(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  openai ??= new OpenAI({ baseURL: process.env.OPENAI_API_BASE });
  return openai;
}

export class Engine {
  private mem = new Memory();

  /**
   * WRITE. Normalize → index (lesson 9/11), then the background
   * consolidation job. Hindsight fires it fire-and-forget after retains
   * complete; we await it so the demo is deterministic.
   */
  async retain(content: string, at: Date = new Date()): Promise<number[]> {
    const before = this.mem.getFacts().length;
    await this.mem.retain(content, at);
    const ids = this.mem.getFacts().slice(before).map((f) => f.id);
    await this.mem.consolidate(); // the background job (lesson 10)
    return ids;
  }

  /**
   * READ. Staged like Hindsight's recall:
   *  1. retrieve — score facts + observations (compact TF-IDF-ish scorer;
   *     lessons 3–6 built the full versions of this stage)
   *  2. prefer_observations — drop raw facts absorbed into a returned
   *     observation (Hindsight's prefer_observations)
   *  3. budget — cap total characters (Hindsight's max_tokens filter)
   */
  recall(query: string, k: number = 5, budgetChars: number = 2000): Hit[] {
    const facts = this.mem.getFacts();
    const obss = this.mem.getObservations();
    const docs: { kind: "fact" | "observation"; id: number; text: string; sourceIds: number[] }[] = [
      ...facts.map((f) => ({ kind: "fact" as const, id: f.id, text: f.content, sourceIds: [f.id] })),
      ...obss.map((o) => ({
        kind: "observation" as const,
        id: o.id,
        text: o.text,
        // absorbed = supporting sources + counter-evidence: the observation
        // processed all of these, so recall needn't return them separately
        sourceIds: [...o.sourceIds, ...o.counterIds],
      })),
    ];
    // idf over the corpus
    const N = docs.length;
    const df = new Map<string, number>();
    const docToks = docs.map((d) => {
      const t = new Set(toks(d.text));
      for (const w of t) df.set(w, (df.get(w) ?? 0) + 1);
      return t;
    });
    const idf = (w: string): number => Math.log((N + 1) / ((df.get(w) ?? 0) + 1)) + 1;

    const qt = toks(query);
    let hits: Hit[] = docs.map((d, i) => {
      let s = 0;
      for (const w of qt) if (docToks[i].has(w)) s += idf(w);
      if (d.kind === "observation") s *= 1.5; // beliefs outrank raw rows
      return { ...d, score: s };
    })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score);

    // prefer_observations: a returned observation absorbs its source facts
    const absorbed = new Set<number>();
    for (const h of hits) if (h.kind === "observation") for (const s of h.sourceIds) absorbed.add(s);
    hits = hits.filter((h) => h.kind === "observation" || !absorbed.has(h.id));

    // budget
    const out: Hit[] = [];
    let chars = 0;
    for (const h of hits.slice(0, k)) {
      if (chars + h.text.length > budgetChars) break;
      out.push(h);
      chars += h.text.length;
    }
    return out;
  }

  /**
   * ANSWER. Read-only synthesis: recall internally, then the LLM answers
   * from the hits. Persists nothing — the store is identical afterwards.
   */
  async reflect(question: string): Promise<string> {
    const before = `${this.mem.getFacts().length}f/${this.mem.getObservations().length}o`;
    const hits = this.recall(question, 5);
    const client = llm();
    let answer: string;
    if (!client || hits.length === 0) {
      answer = hits.map((h) => `[${h.kind} #${h.id}] ${h.text}`).join("\n");
    } else {
      const res = await client.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Answer the question using ONLY the memories below. If they don't contain the answer, say so. 2-3 sentences.",
          },
          {
            role: "user",
            content: `Question: ${question}\nMemories:\n${hits.map((h) => `- (${h.kind}) ${h.text}`).join("\n")}`,
          },
        ],
      });
      answer = res.choices[0]?.message.content?.trim() ?? "";
    }
    const after = `${this.mem.getFacts().length}f/${this.mem.getObservations().length}o`;
    console.log(`  [reflect read-only check: store ${before} → ${after}]`);
    return answer;
  }

  stats(): void {
    console.log(
      `\nengine store: ${this.mem.getFacts().length} facts, ${this.mem.getObservations().length} observations`,
    );
  }
}

async function demo(): Promise<void> {
  const e = new Engine();
  const D = (s: string): Date => new Date(s + "T00:00:00Z");

  console.log("retain ×3 (consolidation runs after each):");
  await e.retain("Alice works at Google as a software engineer.", D("2026-06-02"));
  await e.retain("Alice shipped the new ranking model.", D("2026-06-18"));
  await e.retain("Alice left Google last week.", D("2026-10-01"));

  console.log("\nrecall('Where does Alice work?'):");
  for (const h of e.recall("Where does Alice work?")) {
    console.log(`  [${h.kind} #${h.id} score=${h.score.toFixed(2)}] ${h.text.slice(0, 90)}`);
  }
  console.log("  → the observation answers; every raw fact it processed — supporting");
  console.log("    or contradicting — is absorbed (prefer_observations). The belief speaks for its sources.");

  console.log("\nreflect('What is Alice's career trajectory?'):");
  console.log(`  ${await e.reflect("What is Alice's career trajectory?")}`);

  e.stats();
  console.log("\nThree verbs, one store. retain() writes and the background job learns;");
  console.log("recall() reads beliefs first; reflect() answers without writing.");
}

if (import.meta.main) {
  await demo();
}
