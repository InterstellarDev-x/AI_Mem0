// Lesson 10: Consolidation — from a pile of facts to beliefs.
//
// The one idea: lessons 1–9 store *facts*. But an agent that has seen fifty
// facts about Alice shouldn't recall fifty rows — it should recall what it
// *believes* about Alice. Consolidation is the background job that turns
// facts into **observations**: fewer, denser, each citing its sources. New
// evidence then *updates* a belief instead of piling on beside it.
//
// Grounded in the real Hindsight (engine/consolidation/consolidator.py):
// "The consolidation engine runs as a background job after retain operations
// complete." It processes *unconsolidated* memories in batches and the LLM
// decides per batch: CREATE a new observation, UPDATE an existing one, or
// DELETE one — every action citing source_fact_ids, with temporal bounds
// merged from its sources.
//
// Our version: the write pipeline from lesson 9 (compact), plus
// consolidate(). Grouping is by shared entity (Hindsight batches by scope);
// the update-vs-create decision is rule-based and transparent; the
// observation *prose* uses gpt-6-luna when OPENAI_API_KEY is set, else a
// clearly-labeled mechanical join. The mechanics are the lesson.
//
// Run it:
//
//     bun run lesson10
//     OPENAI_API_KEY=... bun run lesson10   # LLM-written observations

import OpenAI from "openai";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-6-luna";

interface Fact {
  id: number;
  content: string;
  at: Date;
  entities: string[];
  consolidated: boolean;
}

interface Observation {
  id: number;
  text: string;
  sourceIds: number[];
  entities: string[];
  scope: string; // the batching key that owns this observation (like Hindsight's scopes)
  from: Date; // temporal bounds, merged from sources (like Hindsight)
  to: Date;
}

// ---------- lesson-9 write pipeline, compact ----------
function splitFacts(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function ruleEntities(text: string): string[] {
  const found = new Set<string>();
  const re = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(m[0]);
  return [...found];
}

const canonEntity = (e: string): string =>
  e.toLowerCase().replace(/'s$/, "").replace(/\s+/g, " ").trim();
const canonText = (t: string): string =>
  t.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.]+$/, "");

let openai: OpenAI | null = null;
function llm(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  openai ??= new OpenAI({ baseURL: process.env.OPENAI_API_BASE });
  return openai;
}

/** Write one observation's prose. LLM when keyed, mechanical join otherwise. */
async function writeObservation(facts: Fact[]): Promise<{ text: string; via: string }> {
  const client = llm();
  if (!client) {
    return {
      text: facts.map((f) => f.content).join(" "),
      via: "mechanical join (no key)",
    };
  }
  const res = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Summarize these facts into ONE observation: 1-2 sentences capturing what is believed. No preamble, just the observation.",
      },
      { role: "user", content: facts.map((f) => `- ${f.content}`).join("\n") },
    ],
  });
  return {
    text: res.choices[0]?.message.content?.trim() ?? "",
    via: CHAT_MODEL,
  };
}

/** Fold new facts into an existing observation's prose. */
async function updateObservation(obs: Observation, facts: Fact[]): Promise<{ text: string; via: string }> {
  const client = llm();
  if (!client) {
    return { text: obs.text + " " + facts.map((f) => f.content).join(" "), via: "mechanical join (no key)" };
  }
  const res = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Revise the observation to incorporate the new facts. Return 1-2 sentences, just the revised observation.",
      },
      {
        role: "user",
        content: `Current observation: ${obs.text}\nNew facts:\n${facts.map((f) => `- ${f.content}`).join("\n")}`,
      },
    ],
  });
  return {
    text: res.choices[0]?.message.content?.trim() ?? obs.text,
    via: CHAT_MODEL,
  };
}

class Memory {
  private facts: Fact[] = [];
  private observations: Observation[] = [];
  private seen = new Set<string>();

  async retain(input: string, at: Date = new Date()): Promise<void> {
    for (const piece of splitFacts(input)) {
      const norm = canonText(piece);
      if (this.seen.has(norm)) continue; // dedupe (lesson 9)
      this.seen.add(norm);
      const entities = [...new Set(ruleEntities(piece).map(canonEntity))].filter(
        (e) => e.length > 1,
      );
      this.facts.push({
        id: this.facts.length,
        content: piece,
        at,
        entities,
        consolidated: false,
      });
    }
  }

  /**
   * The background job. Takes unconsolidated facts, groups them by shared
   * entity (Hindsight batches by scope), and per group either UPDATEs the
   * observation with the most entity overlap or CREATEs a new one. Every
   * observation cites its source fact ids and merges their temporal bounds.
   */
  async consolidate(): Promise<void> {
    const fresh = this.facts.filter((f) => !f.consolidated);
    if (fresh.length === 0) {
      console.log("  nothing unconsolidated");
      return;
    }

    // Group by entity (one fact can seed multiple groups; first wins).
    // This mirrors Hindsight's scope batching: a batch belongs to a scope,
    // and an observation belongs to the scope that created it.
    const groups = new Map<string, Fact[]>();
    for (const f of fresh) {
      const key = f.entities[0] ?? "__none__";
      const g = groups.get(key) ?? [];
      g.push(f);
      groups.set(key, g);
    }

    for (const [scope, group] of groups) {
      // UPDATE the observation owned by this scope, if one exists;
      // otherwise CREATE. (Real scope resolution is richer — overlapping
      // scopes, tags — but the shape is the same: batches map to owners.)
      const existing = this.observations.find((o) => o.scope === scope);

      if (existing) {
        const { text, via } = await updateObservation(existing, group);
        existing.text = text;
        existing.sourceIds.push(...group.map((f) => f.id));
        existing.entities = [...new Set([...existing.entities, ...group.flatMap((f) => f.entities)])];
        existing.to = new Date(Math.max(existing.to.getTime(), ...group.map((f) => f.at.getTime())));
        console.log(`  UPDATE obs #${existing.id} (+${group.length} facts) [${via}]`);
        console.log(`    → "${text}"`);
      } else {
        const { text, via } = await writeObservation(group);
        const id = this.observations.length;
        const ats = group.map((f) => f.at.getTime());
        this.observations.push({
          id,
          text,
          sourceIds: group.map((f) => f.id),
          entities: [...new Set(group.flatMap((f) => f.entities))],
          scope,
          from: new Date(Math.min(...ats)),
          to: new Date(Math.max(...ats)),
        });
        console.log(`  CREATE obs #${id} (${group.length} facts, scope=${scope}) [${via}]`);
        console.log(`    → "${text}"`);
      }
      for (const f of group) f.consolidated = true;
    }
  }

  stats(): void {
    console.log(
      `\nstore: ${this.facts.length} facts → ${this.observations.length} observations`,
    );
    for (const o of this.observations) {
      console.log(
        `  obs #${o.id}: "${o.text}"  sources=[${o.sourceIds.join(",")}]`,
      );
    }
  }
}

async function demo(): Promise<void> {
  const m = new Memory();
  const D = (s: string): Date => new Date(s + "T00:00:00Z");

  console.log("retaining 5 facts…");
  await m.retain("Alice works at Google as a software engineer.", D("2026-06-02"));
  await m.retain("Alice's role is software engineer.", D("2026-06-03"));
  await m.retain("Alice shipped the new ranking model.", D("2026-06-18"));
  await m.retain("Bob is Alice's manager.", D("2026-06-05"));
  await m.retain("Bob likes chess.", D("2026-09-20"));

  console.log("\nconsolidate() — background job runs:");
  await m.consolidate();
  m.stats();

  console.log("\nnew evidence arrives…");
  await m.retain("Alice got promoted to senior software engineer.", D("2026-10-01"));
  console.log("\nconsolidate() again:");
  await m.consolidate();
  m.stats();

  console.log(
    "\n6 facts in, 2 beliefs out. The promotion didn't pile on as fact #6 —",
  );
  console.log(
    "it *updated* the Alice observation, which still cites every source.",
  );
}

await demo();
