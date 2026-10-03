// Lesson 15: Forgetting — deletion is a first-class operation.
//
// The one idea: deleting the row is easy. The hard part is noticing that
// everything built on top of it is now standing on air. Forgetting cascades:
// the fact moves to invalidated (the row stops existing), observations lose
// proof and quotes, observations with no grounding left are swept — and
// every pinned claim gets its grounding partitioned into live vs retracted.
// A retraction is the *absence* of a row, so the pipeline can't see it until
// something turns that absence into a value.
//
// Grounded in the real Hindsight:
// - reflect/retractions.py: "A retraction is the absence of a row, so it
//   raises no watermark and reaches no prompt. This module turns that
//   absence into a value." When a fact is "invalidated (moved to
//   invalidated_memory_units), deleted, or swept away as a stale
//   observation, the row simply stops existing — retrieval can never return
//   it again, but the document keeps stating it and keeps citing it."
// - "Why the cause is not distinguished: invalidated, deleted, and
//   re-ingested all present identically: an id in based_on with no live
//   row." So the cascade asks one question — "is it live?" — never why.
// - Observation history is the audit trail: it records what was believed,
//   it is not a live claim, so forgetting doesn't touch it.
//
// Our version: Memory.forget() (added to lesson 11's store) plus a small
// pinned-claim layer that partitions grounding on every forget. The cascade
// — not the deletion — is the lesson.
//
// Run it:
//
//     bun run lesson15

import { Memory } from "./lesson11.ts";

interface PinnedClaim {
  text: string;
  citedIds: number[]; // fact ids this claim stands on
}

class ForgetfulMind {
  readonly mem = new Memory();
  private models = new Map<string, PinnedClaim[]>();

  async retain(input: string, at: Date = new Date()): Promise<void> {
    await this.mem.retain(input, at);
  }
  async consolidate(): Promise<void> {
    await this.mem.consolidate();
  }

  pin(question: string, claims: PinnedClaim[]): void {
    this.models.set(question, claims);
    console.log(`pinned "${question}" (${claims.length} claims)`);
  }

  /**
   * Audit: partition every claim's grounding into live vs retracted.
   * This is Hindsight's partition_retracted — pure, no LLM, no database:
   * the absence of a row becomes a value the pipeline can act on.
   */
  audit(): void {
    console.log("\naudit — grounding partition:");
    for (const [q, claims] of this.models) {
      console.log(`  "${q}"`);
      for (const c of claims) {
        const live = c.citedIds.filter((i) => this.mem.isLive(i));
        const retracted = c.citedIds.filter((i) => !this.mem.isLive(i));
        const status =
          retracted.length === 0
            ? "supported"
            : live.length === 0
              ? "UNSUPPORTED — stands on nothing"
              : `partially retracted (lost [${retracted}], keeps [${live}])`;
        console.log(`    • "${c.text}" → ${status}`);
      }
    }
  }

  forget(id: number): void {
    const fact = this.mem.getFacts().find((f) => f.id === id);
    console.log(`\nforgetting fact #${id}: "${fact?.content}"`);
    const { swept, weakened } = this.mem.forget(id);
    for (const w of weakened) {
      const o = this.mem.getObservations().find((o) => o.id === w)!;
      console.log(`  obs #${w} weakened → proof=${o.proofCount}, rev=${o.rev}`);
    }
    for (const s of swept) console.log(`  obs #${s} swept — no grounding left`);
    this.audit();
  }

  stats(): void {
    const m = this.mem;
    console.log(
      `\nstore: ${m.getFacts().length} live facts, ${m.getInvalidated().length} invalidated, ` +
        `${m.getObservations().length} observations`,
    );
  }
}

async function demo(): Promise<void> {
  const mind = new ForgetfulMind();
  const D = (s: string): Date => new Date(s + "T00:00:00Z");

  await mind.retain("Alice works at Google as a software engineer.", D("2026-06-02"));
  await mind.retain("Alice shipped the new ranking model.", D("2026-06-18"));
  await mind.retain("Bob is Alice's manager.", D("2026-06-05"));
  await mind.consolidate();

  mind.pin("What does Alice do?", [
    { text: "Alice is a software engineer at Google", citedIds: [0] },
    { text: "Alice shipped the ranking model", citedIds: [1] },
  ]);
  mind.audit();

  // "Alice works at Google" turns out to be wrong — retract it.
  mind.forget(0);
  mind.stats();

  // Now the ranking-model fact goes too.
  mind.forget(1);
  mind.stats();

  console.log("\nDeleting the row was the easy part. The cascade was the lesson:");
  console.log("proof dropped, quotes went, the empty observation was swept, and");
  console.log("every claim got its grounding partitioned — absence turned into a value.");
}

if (import.meta.main) {
  await demo();
}
