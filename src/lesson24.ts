// Lesson 24: Expand — from a memory back to its context.
//
// The one idea: a recalled hit is a *summary pointer*. Expand walks the
// pointer back: depth "chunk" returns the hit's neighboring chunks, depth
// "document" returns the whole source document. The reflect agent calls it
// when a memory's one-line form isn't enough to reason with.
//
// Grounded in the real Hindsight (engine/reflect/tools.py::tool_expand):
// "Expand multiple memories to get chunk or document context." Args:
// memory_ids, depth ("chunk" or "document"). And a security rule we keep:
// a memory outside the reader's scope reads as not found, and a visible
// memory's document is returned only when that document passes the filter
// too — a shared fact never opens the rest of a document the reader can't
// see. (Our banks are already isolated per lesson 14; the demo shows the
// not-found half of the rule.)
//
// Our version: expand() over lesson 23's DocBank. Recall a chunk, then pull
// its context at either depth.
//
// Run it:
//
//     bun run lesson24

import { DocBank } from "./lesson23.ts";
import { Engine } from "./lesson13.ts";

type Depth = "chunk" | "document";

/**
 * Expand a recalled memory back to its context.
 * depth "chunk": the hit plus its sibling chunks.
 * depth "document": the full source document.
 * The id may be a fact id or an observation id — recall returns both, from
 * separate counters. Observation ids resolve through their sourceIds first;
 * without that, an observation id silently lands in the wrong document.
 * Unknown ids read as not found.
 */
function expand(
  bank: DocBank,
  memoryId: number,
  depth: Depth,
  kind: "fact" | "observation" = "fact",
): string {
  const docs = bank.getDocuments();
  const mem = (
    bank.engine as unknown as {
      mem: {
        getFacts(): { id: number; content: string }[];
        getObservations(): { id: number; sourceIds: number[] }[];
      };
    }
  ).mem;
  const textOf = (id: number): string =>
    mem.getFacts().find((f) => f.id === id)?.content ?? `(chunk ${id}: not found)`;
  // Fact ids and observation ids share one numeric space but are separate
  // counters — the kind must travel with the id, or #1 means two things.
  let factId: number | undefined;
  if (kind === "observation") {
    factId = mem.getObservations().find((o) => o.id === memoryId)?.sourceIds[0];
  } else {
    factId = memoryId;
  }
  if (factId === undefined) return `(memory #${memoryId}: not found — outside this bank)`;
  const docIdx = docs.findIndex((d) => d.chunkIds.includes(factId));
  if (docIdx === -1) return `(memory #${memoryId}: not found — outside this bank)`;
  const doc = docs[docIdx];
  {
    const idx = doc.chunkIds.indexOf(factId);
    const texts = doc.chunkIds.map(textOf);
    if (depth === "document") {
      return `document "${doc.title}":\n` + texts.map((t) => `  ${t}`).join("\n");
    }
    const lo = Math.max(0, idx - 1);
    const hi = Math.min(texts.length, idx + 2);
    return `chunk context for memory #${memoryId}:\n` +
      texts.slice(lo, hi).map((t, i) => `${lo + i === idx ? "▶ " : "  "}${t}`).join("\n");
  }
  // unreachable: docIdx === -1 returns above
  return `(memory #${memoryId}: not found — outside this bank)`;
}

async function demo(): Promise<void> {
  const bank = new DocBank(new Engine());
  await bank.ingestDocument(
    "Employee Handbook",
    `Everyone gets 20 vacation days per year with up to 5 rolling over.

The prod deploy key lives in 1Password under 'prod-deploy'.

The on-call rotation starts Monday and changes weekly.`,
  );

  await bank.ingestDocument(
    "Field Notes",
    `Xylophone music soothes cats.

Quantum apples taste purple.`,
  );

  const [hit] = bank.engine.recall("xylophone music", 1);
  console.log(`recall("xylophone music") → ${hit.kind} #${hit.id}: ${hit.text}\n`);

  console.log(expand(bank, hit.id, "chunk", hit.kind));
  console.log("\n" + expand(bank, hit.id, "document", hit.kind));

  console.log("\n" + expand(bank, 999, "chunk"));

  console.log("\nRecall finds the line. Expand finds the room the line is in.");
}

if (import.meta.main) {
  await demo();
}
