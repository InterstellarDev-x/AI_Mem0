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
 * Unknown ids — or ids from another bank — read as not found.
 */
function expand(bank: DocBank, memoryId: number, depth: Depth): string {
  const docs = bank.getDocuments();
  // Chunk text lives on the facts (ground truth); observations may merge or
  // rewrite them, so expand resolves fact ids directly.
  const mem = (
    bank.engine as unknown as {
      mem: { getFacts(): { id: number; content: string }[] };
    }
  ).mem;
  const textOf = (id: number): string =>
    mem.getFacts().find((f) => f.id === id)?.content ?? `(chunk ${id}: not found)`;
  for (const doc of docs) {
    const idx = doc.chunkIds.indexOf(memoryId);
    if (idx === -1) continue;
    const texts = doc.chunkIds.map(textOf);
    if (depth === "document") {
      return `document "${doc.title}":\n` + texts.map((t) => `  ${t}`).join("\n");
    }
    const lo = Math.max(0, idx - 1);
    const hi = Math.min(texts.length, idx + 2);
    return `chunk context for memory #${memoryId}:\n` +
      texts.slice(lo, hi).map((t, i) => `${lo + i === idx ? "▶ " : "  "}${t}`).join("\n");
  }
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

  const [hit] = bank.engine.recall("deploy key", 1);
  console.log(`recall("deploy key") → #${hit.id}: ${hit.text}\n`);

  console.log(expand(bank, hit.id, "chunk"));
  console.log("\n" + expand(bank, hit.id, "document"));

  console.log("\n" + expand(bank, 999, "chunk"));

  console.log("\nRecall finds the line. Expand finds the room the line is in.");
}

if (import.meta.main) {
  await demo();
}
