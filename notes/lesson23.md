# Lesson 23 — Documents: memory beyond conversation (2026-10-04)

## The one idea

Banks don't only remember conversations. They ingest *documents* — files
chunked into pieces that stay linked to their source, browsable as a
knowledge-base tree. A recalled chunk is a pointer; the document is the
territory.

## What we built

`src/lesson23.ts`: `DocBank` over lesson 13's Engine. `ingestDocument()`
splits text into paragraph chunks, retains each tagged `[title §i/n]`;
`tree()` prints the knowledge-base tree; recall finds chunks the usual way,
and every hit knows its document. Demo ingests an Employee Handbook and Team
Notes; "deploy key" recalls the exact chunk with its provenance attached.

## Grounded in the real Hindsight

Verified in the MCP surface: list_documents, get_document, and
get_knowledge_base_tree sit alongside recall — documents are first-class
memory units, chunked on ingest, and the reflect expand tool pulls a
memory's chunk or whole document back out (lesson 24).

## Try it

```
bun run lesson23
```

Ingest a real file: read any markdown doc, pass its text to
`ingestDocument`, and ask the bank about it. Notice the failure mode the
demo exposed: one sentence per paragraph keeps chunks == facts; multi-
sentence paragraphs split further (lesson 9's splitter), so chunk counts
and fact counts diverge — chunking is a policy, not a given.
