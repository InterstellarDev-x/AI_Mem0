# Lesson 6 — Reranking: a slow, precise second pass (2026-10-03)

## The one idea

Retrieval is a speed/precision trade-off, so split it in two. **Pass 1**
(lessons 3–5) is cheap and high-recall: precomputed vectors, BM25, fused
ranks — built to *not miss*. **Pass 2** is expensive and precise: a
**cross-encoder** reads each (query, document) pair *jointly*, with full
attention between query and document tokens, and scores relevance directly.

A bi-encoder (lesson 3) embeds query and doc *separately* — fast, and doc
vectors precompute, but the query never interacts with the doc. A
cross-encoder is one forward pass *per pair*: it can't precompute anything,
so it only ever sees the top-k shortlist. Slow, but it actually reads.

## What we built

`src/lesson6.ts`: `recall()` is now two-pass. Pass 1 runs the lesson-5
hybrid and takes the top candidates; pass 2 scores each candidate with the
cross-encoder and re-sorts. No new dependencies — same Transformers.js,
second model.

## What it fixes

Run `bun run lesson6`. On "what is Alice's job?", pass 1 ranks "Bob is
Alice's manager" first — in embedding space "job" sits closer to "manager"
than "engineer", and BM25 can't see "job" at all. The cross-encoder flips
it: engineer 6.729 vs manager 1.922. Joint reading beats separate
embeddings where it counts, and it only had to read 5 pairs to do it.

## Grounded in the real Hindsight

Verified in `engine/cross_encoder.py`: reranking is a cross-encoder
abstraction with a local default — model `cross-encoder/ms-marco-MiniLM-L-6-v2`,
the family used here (Xenova's ONNX build, local, no API key). Remote
providers (Cohere, FlashRank, TEI, …) are opt-in. With this lesson, the full
recall pipeline is assembled: semantic + BM25 → RRF → cross-encoder.

## What's next

Lesson 7: time — timestamps at retain, time-range filtering at recall.
Answering "what happened in June?" (Hindsight's temporal arm.)

## Try it

```
bun run lesson6
```

Time the two passes: pass 1 is milliseconds on precomputed vectors; pass 2
is a model forward pass per candidate. That cost gap is *why* the pipeline
has two passes — reranking everything would be absurd.
