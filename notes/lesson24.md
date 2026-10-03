# Lesson 24 — Expand: from a memory back to its context (2026-10-04)

## The one idea

A recalled hit is a summary pointer. Expand walks it back: depth "chunk"
returns the hit's neighboring chunks, depth "document" returns the whole
source document. The reflect agent calls it when a memory's one-line form
isn't enough to reason with.

## What we built

`src/lesson24.ts`: `expand(bank, memoryId, depth)` over lesson 23's DocBank.
Chunk depth shows the hit with its siblings (▶ marks the hit); document
depth returns the full source. Unknown ids — or ids from another bank —
read as not found, mirroring the real tool's guard: a shared fact never
opens the rest of a document the reader can't see. Chunk text resolves from
facts (ground truth), not observations, which may merge or rewrite them.

## Grounded in the real Hindsight

Verified in engine/reflect/tools.py::tool_expand: "Expand multiple memories
to get chunk or document context", depth "chunk" or "document", with the
reader's tag filter applied twice — a memory outside it reads as not found,
and a visible memory's document is returned only when that document passes
the filter too.

## Try it

```
bun run lesson24
```

Recall a chunk, expand it, then ask: which questions need the chunk, and
which need the document? The reflect agent (lesson 16) makes that call every
iteration — now you know what it's choosing between.
