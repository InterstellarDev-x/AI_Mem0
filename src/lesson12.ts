// Lesson 12: Mental models — reflections you pin.
//
// The one idea: observations (lessons 10–11) *happen* — the background job
// makes them whether you ask or not. A **mental model** is the opposite: a
// question you *pin*, answered on demand. `reflect()` re-runs the question
// against current memory and refreshes the answer. First run builds the
// document from scratch (full); later runs diff against the baseline
// (delta). Every refresh is recorded, including the ones that change
// nothing — because "nothing new" is itself an answer.
//
// Grounded in the real Hindsight:
// - consolidator.py: "Mental models: user-defined queries stored in the
//   mental_models table, refreshed on demand via reflect" — distinct from
//   observations, which are "auto-generated bottom-up".
// - mental_model_refresh.py: "A refresh resolves a scope, picks full-vs-delta,
//   runs reflect over a bounded snapshot, and (in delta mode) applies
//   structured operations to the existing document." Outcomes:
//   content_written, content_unchanged, content_preserved_no_new_facts,
//   refresh_failed_empty_candidate… every run recorded in mental_model_history.
//
// Our version: the document is a claim list (structured, like Hindsight's
// structured document); delta = diff old vs new claims (added/removed).
// Evidence = relevant observations + relevant new facts. Claim prose via
// gpt-6-luna when OPENAI_API_KEY is set, mechanical otherwise. The
// lifecycle — pin, reflect, full/delta, history — is the lesson.
//
// Run it:
//
//     bun run lesson12
//     OPENAI_API_KEY=... bun run lesson12   # LLM-written claims

import { Memory as FactMemory, type Observation } from "./lesson11.ts";
import OpenAI from "openai";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-6-luna";

type RefreshOutcome =
  | "content_written"
  | "content_unchanged"
  | "content_preserved_no_new_facts"
  | "refresh_failed_empty_candidate";
type RefreshMode = "full" | "delta";

interface MentalModel {
  id: number;
  question: string;
  claims: string[] | null; // the pinned document
  seenIds: Set<string>; // evidence already incorporated
  history: { at: Date; mode: RefreshMode; outcome: RefreshOutcome; claims: string[] }[];
}

interface Evidence {
  id: string;
  text: string;
}

const canon = (t: string): string => t.toLowerCase().replace(/\s+/g, " ").trim();

let openai: OpenAI | null = null;
function llm(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  openai ??= new OpenAI({ baseURL: process.env.OPENAI_API_BASE });
  return openai;
}

/** Build the claim list. LLM when keyed; mechanical otherwise. */
async function buildClaims(
  mm: MentalModel,
  evidence: Evidence[],
): Promise<{ claims: string[]; via: string }> {
  const client = llm();
  if (!client) {
    // Mechanical: one claim per evidence item, latest revision wins per
    // observation (o0r2 replaces o0r1). Raw facts appear only if never
    // consolidated — reflect reads the belief layer first.
    const byKey = new Map<string, string>();
    for (const e of evidence) byKey.set(e.id.replace(/r\d+$/, ""), e.text);
    return { claims: [...byKey.values()], via: "mechanical (no key)" };
  }
  const res = await client.chat.completions.create({
    model: CHAT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You maintain a pinned reflection: a list of claims answering the question. " +
          "Given the previous claims (may be empty) and the evidence, return the updated " +
          'claim list as JSON {"claims": ["..."]}. Keep claims that still hold, revise or ' +
          "drop stale ones, add claims supported by the evidence. One sentence per claim.",
      },
      {
        role: "user",
        content:
          `Question: ${mm.question}\n` +
          `Previous claims: ${JSON.stringify(mm.claims ?? [])}\n` +
          `Evidence:\n${evidence.map((e) => `- ${e.text}`).join("\n")}`,
      },
    ],
  });
  const content = res.choices[0]?.message.content;
  if (!content) throw new Error("empty response");
  const parsed = JSON.parse(content) as { claims?: unknown };
  const claims = Array.isArray(parsed.claims)
    ? parsed.claims.filter((c): c is string => typeof c === "string")
    : [];
  return { claims, via: CHAT_MODEL };
}

class Mind {
  private mem = new FactMemory();
  private models: MentalModel[] = [];

  retain(input: string, at?: Date): Promise<void> {
    return this.mem.retain(input, at);
  }
  consolidate(): Promise<void> {
    return this.mem.consolidate();
  }

  /** Pin a question. Nothing is answered yet — that's reflect's job. */
  pinModel(question: string): number {
    const id = this.models.length;
    this.models.push({ id, question, claims: null, seenIds: new Set(), history: [] });
    console.log(`pinned model #${id}: "${question}"`);
    return id;
  }

  /** Resolve scope → gather evidence → full-or-delta refresh → record.
   *
   *  Evidence is the *belief layer*: relevant observations (versioned by
   *  revision, so a refined belief counts as fresh evidence) plus relevant
   *  facts that were never consolidated. Raw facts already folded into an
   *  observation don't appear twice — the pile already became beliefs.
   */
  async reflect(id: number): Promise<RefreshOutcome> {
    const mm = this.models[id];
    const q = canon(mm.question);
    const covered = new Set<number>();
    for (const o of this.mem.getObservations()) for (const s of o.sourceIds) covered.add(s);
    const evidence: Evidence[] = [];
    for (const o of this.mem.getObservations()) {
      if (o.entities.some((e) => q.includes(e)))
        evidence.push({ id: `o${o.id}r${o.rev}`, text: o.text });
    }
    for (const f of this.mem.getFacts()) {
      if (f.consolidated || covered.has(f.id)) continue;
      if (f.entities.some((e) => q.includes(e))) evidence.push({ id: `f${f.id}`, text: f.content });
    }

    const mode: RefreshMode = mm.claims === null ? "full" : "delta";
    const fresh = evidence.filter((e) => !mm.seenIds.has(e.id));

    let outcome: RefreshOutcome;
    if (evidence.length === 0) {
      outcome = "refresh_failed_empty_candidate";
      console.log(`  [${mode}] ${outcome} — no evidence for the question`);
    } else if (mode === "delta" && fresh.length === 0) {
      outcome = "content_preserved_no_new_facts";
      console.log(`  [${mode}] ${outcome} — nothing new since last reflect`);
    } else {
      const { claims, via } = await buildClaims(mm, evidence);
      const old = mm.claims ?? [];
      const added = claims.filter((c) => !old.includes(c));
      const removed = old.filter((c) => !claims.includes(c));
      outcome = added.length === 0 && removed.length === 0 ? "content_unchanged" : "content_written";
      mm.claims = claims;
      for (const e of evidence) mm.seenIds.add(e.id);
      console.log(`  [${mode}] ${outcome} [${via}]: +${added.length} −${removed.length}`);
      for (const c of added) console.log(`    + "${c}"`);
      for (const c of removed) console.log(`    − "${c}"`);
    }
    mm.history.push({ at: new Date(), mode, outcome, claims: mm.claims ?? [] });
    return outcome;
  }

  show(id: number): void {
    const mm = this.models[id];
    console.log(`\nmodel #${id}: "${mm.question}"`);
    for (const c of mm.claims ?? []) console.log(`  • ${c}`);
    console.log(`  refreshes: ${mm.history.map((h) => `${h.mode}/${h.outcome}`).join(", ")}`);
  }
}

async function demo(): Promise<void> {
  const mind = new Mind();
  const D = (s: string): Date => new Date(s + "T00:00:00Z");

  await mind.retain("Alice works at Google as a software engineer.", D("2026-06-02"));
  await mind.retain("Alice shipped the new ranking model.", D("2026-06-18"));
  await mind.retain("Alice left Google last week.", D("2026-10-01"));
  await mind.consolidate();

  const pin = mind.pinModel("What is Alice's career trajectory?");
  console.log("\nreflect #1 (no baseline → full):");
  await mind.reflect(pin);
  mind.show(pin);

  console.log("\nsupporting evidence arrives…");
  await mind.retain("Alice joined Anthropic as a staff engineer.", D("2026-10-02"));
  await mind.consolidate();

  console.log("\nreflect #2 (baseline exists → delta, document stands):");
  await mind.reflect(pin);
  mind.show(pin);

  console.log("\ncontradicting evidence arrives…");
  await mind.retain("Alice no longer works at Anthropic.", D("2026-10-03"));
  await mind.consolidate();

  console.log("\nreflect #3 (delta, document revised):");
  await mind.reflect(pin);
  mind.show(pin);

  console.log("\nreflect #4 (nothing new):");
  await mind.reflect(pin);

  console.log("\nThe question was pinned once. The answer stays fresh on demand —");
  console.log("full when there's no baseline, delta afterwards, silence when there's nothing new.");
}

if (import.meta.main) {
  await demo();
}
