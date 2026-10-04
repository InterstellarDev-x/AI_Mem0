// Lesson 23: Documents — memory beyond conversation.
//
// The one idea: banks don't only remember conversations. They ingest
// *documents* — files chunked into pieces that stay linked to their source
// document, browsable as a knowledge-base tree. A recalled chunk is a
// pointer; the document is the territory.
//
// Grounded in the real Hindsight: the MCP surface exposes list_documents,
// get_document, and get_knowledge_base_tree alongside recall — documents are
// first-class memory units, chunked on ingest, and the reflect expand tool
// can pull a memory's chunk or its whole document back out (lesson 24).
//
// Our version: DocBank over lesson 13's Engine. ingestDocument() splits text
// into paragraph chunks and retains each one tagged with its document;
// tree() prints the knowledge-base tree; recall finds chunks the usual way.
// The chunk text carries its document title, so a hit always knows where it
// came from.
//
// Run it:
//
//     bun run lesson23

import { Engine } from "./lesson13.ts";

export interface Doc {
  id: number;
  title: string;
  chunkIds: number[];
}

export class DocBank {
  private docs: Doc[] = [];
  constructor(readonly engine: Engine) {}

  /** Documents for expansion: title + the chunk fact ids in order. */
  getDocuments(): { title: string; chunkIds: number[] }[] {
    return this.docs.map((d) => ({ title: d.title, chunkIds: [...d.chunkIds] }));
  }

  /** Ingest a document: chunk it, retain each chunk linked to its source. */
  async ingestDocument(title: string, text: string): Promise<void> {
    const chunks = text
      .split(/\n\s*\n/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    const doc: Doc = { id: this.docs.length, title, chunkIds: [] };
    this.docs.push(doc);
    let stored = 0;
    for (let i = 0; i < chunks.length; i++) {
      const ids = await this.engine.retain(`[${title} §${i + 1}/${chunks.length}] ${chunks[i]}`);
      doc.chunkIds.push(...ids);
      stored += ids.length;
    }
    // ids.length can be 0 per chunk: the dedupe set drops re-ingested text.
    console.log(`  [ingest] "${title}": ${chunks.length} chunks, ${stored} new facts → doc #${doc.id}`);
  }

  /** The knowledge-base tree: documents and their chunk counts. */
  tree(): void {
    console.log("\nknowledge-base tree:");
    for (const d of this.docs) {
      console.log(`  📄 #${d.id} "${d.title}" (${d.chunkIds.length} chunks)`);
    }
    if (this.docs.length === 0) console.log("  (empty)");
  }

  chunksOf(docId: number): string[] {
    const doc = this.docs[docId];
    if (!doc) throw new Error(`unknown document #${docId}`);
    // Resolve fact ids directly: an empty recall query scores nothing, so
    // recall can never serve as the lookup here.
    const mem = (
      this.engine as unknown as { mem: { getFacts(): { id: number; content: string }[] } }
    ).mem;
    const facts = mem.getFacts();
    return doc.chunkIds.map(
      (id) => facts.find((f) => f.id === id)?.content ?? `(chunk ${id}: forgotten)`,
    );
  }
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
    "Team Notes",
    `Alice left Google last week to join a startup.

The team ships every Friday with demos on Thursdays at 4pm.`,
  );

  bank.tree();

  console.log('\nrecall("deploy key"):');
  for (const h of bank.engine.recall("deploy key", 3)) {
    console.log(`  → ${h.text}`);
  }
  console.log("  (the hit is a chunk — it knows its document: [Employee Handbook §2/3])");

  console.log("\nA conversation is a stream. A document is a place. The bank keeps both.");
}

if (import.meta.main) {
  await demo();
}
