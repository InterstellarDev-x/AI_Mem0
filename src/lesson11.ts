// Lesson 11: Refinement, not replacement.
//
// The one idea: lesson 10's consolidation created and updated beliefs — but
// its updater just appended. Real new evidence does three different things:
// it *strengthens* a belief (more proof), *weakens* it (contradiction), or
// *extends* it (a new facet). And a belief that changes must keep its
// receipts: proof count, exact quotes, and the history of what it used to
// say. Refinement, not replacement.
//
// Grounded in the real Hindsight (engine/consolidation/consolidator.py):
// consolidation "updates existing observations when new evidence
// supports/contradicts/refines them". Observations carry proof_count
// (supporting memories), source_memory_ids, and history — every update
// archives a pre-update snapshot into observation_history.
//
// Our version: per new fact, a verdict — supports / contradicts / extends /
// unrelated. The verdict goes to gpt-6-luna when OPENAI_API_KEY is set
// (it's a judgment call); the rule fallback uses explicit contradiction
// markers and is honest about its coarseness. The bookkeeping — proof
// counts, quotes, counter-quotes, history snapshots — is identical either
// way, because the bookkeeping is the lesson.
//
// Run it:
//
//     bun run lesson11
//     OPENAI_API_KEY=... bun run lesson11   # LLM verdicts + rewritten beliefs

import OpenAI from "openai";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-6-luna";

export interface Fact {
  id: number;
  content: string;
  at: Date;
  entities: string[];
  consolidated: boolean;
}

type Verdict = "supports" | "contradicts" | "extends" | "unrelated";

export interface Observation {
  id: number;
  text: string;
  sourceIds: number[]; // supporting facts only
  quotes: string[]; // exact supporting quotes
  proofCount: number; // = sourceIds.length (like Hindsight's proof_count)
  counterQuotes: string[]; // exact contradicting quotes — kept, not hidden
  counterIds: number[]; // ids of contradicting facts (absorbed, but not proof)
  history: { text: string; at: Date; reason: string }[]; // pre-update snapshots
  rev: number; // revision counter — bumped on every refinement
  entities: string[];
  scope: string;
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

// ---------- verdicts ----------
const CONTRADICT_MARKERS =
  /\b(not|n't|no longer|never|isn't|aren't|wasn't|weren't|left|quit|stopped|denies|denied|wrong)\b/i;

/** Rule-based verdicts: explicit contradiction markers, else supports.
 *  Coarse — it can't tell "extends" from "supports", and it says so. */
function ruleVerdict(fact: Fact): Verdict {
  return CONTRADICT_MARKERS.test(fact.content) ? "contradicts" : "supports";
}

interface Judgment {
  verdicts: { id: number; verdict: Verdict }[];
  revised: string;
}

/** Parse + validate a model judgment; falls back to rules on schema drift. */
export function parseJudgment(content: string, obs: Observation, facts: Fact[]): Judgment {
  const parsed = JSON.parse(content) as Partial<Judgment>;
  // Defensive: if the model drifts from the schema, fall back to rules
  // rather than crashing the consolidation job.
  if (!Array.isArray(parsed.verdicts) || typeof parsed.revised !== "string") {
    return {
      verdicts: facts.map((f) => ({ id: f.id, verdict: ruleVerdict(f) })),
      revised: obs.text,
    };
  }
  const valid: Verdict[] = ["supports", "contradicts", "extends", "unrelated"];
  return {
    verdicts: parsed.verdicts
      .filter((v) => facts.some((f) => f.id === v.id) && valid.includes(v.verdict))
      .map((v) => ({ id: v.id, verdict: v.verdict })),
    revised: parsed.revised,
  };
}

/** One LLM call judges a whole batch against the current belief. */
async function llmJudge(obs: Observation, facts: Fact[]): Promise<Judgment> {
  const client = llm()!;
  const res = await client.chat.completions.create({
    model: CHAT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are refining a belief against new evidence. For each fact, verdict: " +
          '"supports" (strengthens the belief), "contradicts" (undermines it), ' +
          '"extends" (adds a new facet consistent with it), or "unrelated". ' +
          "Then give the revised belief: 1-2 sentences incorporating the new evidence, " +
          "preserving what still holds, correcting what doesn't. " +
          'Return JSON: {"verdicts": [{"id": 0, "verdict": "supports"}], "revised": "..."}. ' +
          "Fact ids are the numbers shown.",
      },
      {
        role: "user",
        content:
          `Current belief: ${obs.text}\n` +
          `Proof so far (${obs.proofCount}): ${obs.quotes.map((q) => `"${q}"`).join("; ")}\n` +
          `New evidence:\n${facts.map((f) => `${f.id}: "${f.content}"`).join("\n")}`,
      },
    ],
  });
  const content = res.choices[0]?.message.content;
  if (!content) throw new Error("empty response");
  return parseJudgment(content, obs, facts);
}

async function writeObservation(facts: Fact[]): Promise<string> {
  const client = llm();
  if (!client) return facts.map((f) => f.content).join(" ");
  const res = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: "Summarize these facts into ONE observation: 1-2 sentences, just the observation." },
      { role: "user", content: facts.map((f) => `- ${f.content}`).join("\n") },
    ],
  });
  return res.choices[0]?.message.content?.trim() ?? "";
}

export class Memory {
  private facts: Fact[] = [];
  private observations: Observation[] = [];

  /** Read access for upper layers (e.g. lesson 12's reflect). */
  getFacts(): Fact[] {
    return this.facts;
  }
  getObservations(): Observation[] {
    return this.observations;
  }
  private seen = new Set<string>();

  async retain(input: string, at: Date = new Date()): Promise<void> {
    for (const piece of splitFacts(input)) {
      const norm = canonText(piece);
      if (this.seen.has(norm)) continue;
      this.seen.add(norm);
      const entities = [...new Set(ruleEntities(piece).map(canonEntity))].filter(
        (e) => e.length > 1,
      );
      this.facts.push({ id: this.facts.length, content: piece, at, entities, consolidated: false });
    }
  }

  async consolidate(): Promise<void> {
    const fresh = this.facts.filter((f) => !f.consolidated);
    if (fresh.length === 0) {
      console.log("  nothing unconsolidated");
      return;
    }

    const groups = new Map<string, Fact[]>();
    for (const f of fresh) {
      const key = f.entities[0] ?? "__none__";
      const g = groups.get(key) ?? [];
      g.push(f);
      groups.set(key, g);
    }

    for (const [scope, group] of groups) {
      const existing = this.observations.find((o) => o.scope === scope);
      if (!existing) {
        const text = await writeObservation(group);
        const id = this.observations.length;
        this.observations.push({
          id, text,
          sourceIds: group.map((f) => f.id),
          quotes: group.map((f) => f.content),
          proofCount: group.length,
          counterQuotes: [],
          counterIds: [],
          history: [],
          rev: 1, // bumped on every refinement — lets upper layers (lesson 12) see that the belief changed
          entities: [...new Set(group.flatMap((f) => f.entities))],
          scope,
        });
        console.log(`  CREATE obs #${id} (${group.length} facts, proof=${group.length})`);
        console.log(`    → "${text}"`);
        for (const f of group) f.consolidated = true;
      } else {
        const handled = await this.refine(existing, group);
        for (const f of group) if (handled.has(f.id)) f.consolidated = true;
      }
    }
  }

  /**
   * Refinement: judge each new fact against the belief, then apply.
   * supports/extends → proofCount up, quote kept. contradicts → history
   * snapshot, counter-quote kept, belief revised. unrelated → left for a
   * future CREATE (out of scope for this demo's groups).
   */
  private async refine(obs: Observation, group: Fact[]): Promise<Set<number>> {
    const handled = new Set<number>();
    const client = llm();
    let verdicts: { id: number; verdict: Verdict }[];
    let revised: string;

    if (client) {
      const j = await llmJudge(obs, group);
      verdicts = j.verdicts;
      revised = j.revised;
    } else {
      verdicts = group.map((f) => ({ id: f.id, verdict: ruleVerdict(f) }));
      revised = obs.text; // rules can't rewrite — they flag (see below)
    }

    for (const { id, verdict } of verdicts) {
      const f = group.find((g) => g.id === id)!;
      if (verdict === "contradicts") {
        obs.history.push({ text: obs.text, at: new Date(), reason: `contradicted by fact #${id}` });
        obs.counterQuotes.push(f.content);
        obs.counterIds.push(f.id);
        obs.text = client ? revised : `${obs.text} [CONTESTED by: "${f.content}"]`;
        handled.add(id);
        console.log(`  WEAKEN obs #${obs.id}: fact #${id} contradicts`);
        console.log(`    counter-quote kept: "${f.content}"`);
      } else if (verdict === "unrelated") {
        console.log(`  (fact #${id} unrelated — left unconsolidated for its own scope)`);
      } else {
        // supports | extends — the belief stands, more firmly, or broader
        obs.sourceIds.push(f.id);
        obs.quotes.push(f.content);
        obs.proofCount = obs.sourceIds.length;
        if (client) obs.text = revised;
        handled.add(id);
        console.log(`  STRENGTHEN obs #${obs.id}: fact #${id} ${verdict} (proof=${obs.proofCount})`);
      }
    }
    if (!client) {
      console.log(`    [rules can't rewrite beliefs — contradictions are flagged, not resolved]`);
    }
    if (handled.size > 0) obs.rev += 1;
    return handled;
  }

  stats(): void {
    console.log(`\nstore: ${this.facts.length} facts → ${this.observations.length} observations`);
    for (const o of this.observations) {
      console.log(`  obs #${o.id}: "${o.text}"`);
      console.log(`    proof=${o.proofCount} sources=[${o.sourceIds.join(",")}] history=${o.history.length} contested=${o.counterQuotes.length}`);
      for (const q of o.counterQuotes) console.log(`    ✗ "${q}"`);
    }
  }
}

async function demo(): Promise<void> {
  const m = new Memory();
  const D = (s: string): Date => new Date(s + "T00:00:00Z");

  console.log("retaining initial facts…");
  await m.retain("Alice works at Google as a software engineer.", D("2026-06-02"));
  await m.retain("Alice shipped the new ranking model.", D("2026-06-18"));
  console.log("\nconsolidate():");
  await m.consolidate();

  console.log("\nsupporting evidence arrives…");
  await m.retain("Alice's teammates praise her code reviews.", D("2026-07-01"));
  console.log("\nconsolidate():");
  await m.consolidate();

  console.log("\ncontradicting evidence arrives…");
  await m.retain("Alice left Google last week.", D("2026-10-01"));
  console.log("\nconsolidate():");
  await m.consolidate();

  m.stats();
  console.log(
    "\nThe belief wasn't replaced — it was refined. Proof count, exact quotes,",
  );
  console.log("the counter-quote, and the history of what it used to say: all kept.");
}

if (import.meta.main) {
  await demo();
}
