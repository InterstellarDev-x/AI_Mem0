// Lesson 25: Causal links — why, not just what.
//
// The one idea: memories aren't only linked by shared entities (lesson 8's
// graph). They're linked by *cause and effect*: this happened *because* that
// happened. Causal edges let the bank answer "why" — follow the caused_by
// links backward from an event to its reasons.
//
// Grounded in the real Hindsight (engine/causal_links.py): causal edges
// live in memory_links with types "caused_by" (canonical; legacy: "causes",
// "enables", "prevents") and a weight. They are *extraction output* — the
// retain pipeline's extractor finds them — not derived data. And because
// they're extraction output, invalidation can't just delete them: the edge
// descriptor (from, to, type, weight) is parked on the curation archive so a
// revert can rematerialize the edge.
//
// Our version: CausalBank over lesson 13's Engine. The rules-path extractor
// watches for causal phrasing ("because", "led to", "caused", "so"); edges
// carry type + weight; forget() archives the edge descriptor instead of
// dropping it. The demo: "why did the deploy fail?" walks caused_by edges
// to "the key expired" — then forgets the cause and shows the archived edge.
//
// Run it:
//
//     bun run lesson25

import { Engine } from "./lesson13.ts";

type LinkType = "caused_by" | "causes" | "enables" | "prevents";

interface CausalEdge {
  from: number; // fact id of the cause
  to: number; // fact id of the effect
  type: LinkType;
  weight: number;
}

// Rules-path causal extraction: cause phrasing → (cause, effect) split.
const CAUSE_RES = [
  /(.+?)\s+because\s+(.+)/i,
  /(.+?)\s+led to\s+(.+)/i,
  /(.+?)\s+caused\s+(.+)/i,
];

class CausalBank {
  private edges: CausalEdge[] = [];
  /** Archived edge descriptors — parked on forget, rematerializable on revert. */
  readonly archive: CausalEdge[] = [];
  constructor(readonly engine: Engine) {}

  async retain(content: string): Promise<number[]> {
    const ids = await this.engine.retain(content);
    // extraction: one causal edge per matched phrasing, cause → effect
    for (const id of ids) {
      const fact = this.factText(id);
      for (const re of CAUSE_RES) {
        const m = fact.match(re);
        if (!m) continue;
        const causeId = await this.ensureFact(m[2].trim());
        this.edges.push({ from: causeId, to: id, type: "caused_by", weight: 1.0 });
        console.log(`  [causal] #${causeId} --caused_by--> #${id}  ("${m[2].trim().slice(0, 40)}")`);
        break;
      }
    }
    return ids;
  }

  private factText(id: number): string {
    const mem = (this.engine as unknown as { mem: { getFacts(): { id: number; content: string }[] } }).mem;
    return mem.getFacts().find((f) => f.id === id)?.content ?? "";
  }

  private async ensureFact(content: string): Promise<number> {
    const mem = (this.engine as unknown as { mem: { getFacts(): { id: number; content: string }[] } }).mem;
    const existing = mem.getFacts().find((f) => f.content === content);
    if (existing) return existing.id;
    const [id] = await this.engine.retain(content);
    return id;
  }

  /** Walk caused_by edges backward from a fact: why did this happen? */
  why(factId: number): string[] {
    return this.edges
      .filter((e) => e.to === factId && (e.type === "caused_by" || e.type === "causes"))
      .map((e) => this.factText(e.from));
  }

  /** Forget a fact: its edges aren't deleted — their descriptors are archived. */
  forgetFact(factId: number): void {
    const kept: CausalEdge[] = [];
    for (const e of this.edges) {
      if (e.from === factId || e.to === factId) {
        this.archive.push({ ...e });
        console.log(`  [archive] edge #${e.from} --${e.type}--> #${e.to} parked (revert can rematerialize it)`);
      } else kept.push(e);
    }
    this.edges = kept;
  }
}

async function demo(): Promise<void> {
  const bank = new CausalBank(new Engine());
  await bank.retain("The deploy failed because the deploy key expired.");
  await bank.retain("Alice left Google last week.");

  const [hit] = bank.engine.recall("deploy failed", 1);
  console.log(`\n"why did the deploy fail?"`);
  const reasons = bank.why(hit.id);
  console.log(`  → ${reasons.join("; ") || "(no causal links)"}`);

  console.log("\nforgetting the cause (fact with 'the deploy key expired'):");
  const causeId = bank.engine.recall("deploy key expired", 1)[0]?.id;
  if (causeId !== undefined) bank.forgetFact(causeId);
  console.log(`  archive holds ${bank.archive.length} edge descriptor(s)`);

  console.log("\nEntities say what's related. Causes say what *mattered*.");
}

if (import.meta.main) {
  await demo();
}
