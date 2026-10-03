# Lesson 3 — Recall by meaning: dense embeddings + cosine (2026-10-03)

## The one idea

Lessons 1–2 matched *tokens*. No counter, however weighted, can link "boss"
to "manager" — the word isn't in the store. A **dense embedding** represents
text as a vector where *meaning is direction*: paraphrases land close
together even with zero shared words. Cosine similarity over those vectors
retrieves by meaning, not spelling.

## What we built

`src/lesson3.ts`: the same `Memory` class, but `retain()` now embeds each
fact with all-MiniLM-L6-v2 (384 dims, L2-normalized) and stores the vector
alongside the text — embedding on the **write path**, the way Hindsight does
it (its retain path embeds documents as they arrive). `recall()` embeds the
query and ranks by cosine similarity. Because vectors are normalized, cosine
is just a dot product.

The model runs locally via Transformers.js: real embeddings, no API key.
(Hindsight's default is OpenAI `text-embedding-3-small` over HTTP; a local
sentence-transformers model is its supported offline option — verified in
the upstream source. Same idea, different model.) First run downloads the
model once (~90MB, cached afterwards). New dependency in `package.json`:
`@xenova/transformers`.

Set `OPENAI_API_KEY` and the lesson uses `text-embedding-3-small` via the
official `openai` SDK instead (1536 dims, L2-normalized here) — the demo
prints which embedder ran. If your key lives behind a proxy/gateway, set
`OPENAI_API_BASE` too (defaults to `https://api.openai.com/v1`). Later
lessons (5–8) stay on the local embedder for reproducibility; the idea they
teach doesn't depend on the model.

## What it fixes

Run `bun run lesson3`. Query "Alice's boss": the word "boss" appears nowhere
in the store — TF-IDF would give it zero weight and tie every Alice fact on
"alice". Embeddings score the manager fact **0.766** and it wins decisively.
The system knows boss ≈ manager without ever being told.

## What it doesn't fix

The demo ends with "what is Alice's job?" — engineer fact 0.668, manager
fact 0.745. Strictly better than counting ("job" is no longer invisible),
but the small model still conflates the two senses. Semantic similarity is
a *signal*, not a verdict — which is exactly why production systems never
trust a single signal. Lesson 5 combines several (hybrid retrieval + RRF);
lesson 6 double-checks the top-k (reranking).

## What's next

Lesson 4: BM25 — keyword search done right (term frequency saturation,
document-length normalization). The workhorse sparse retriever, and the
other half of the hybrid in lesson 5.

## Try it

```
bun install      # once — pulls @xenova/transformers
bun run lesson3
```

Try paraphrases of your own: "Alice's pastime", "who does Alice report to".
Watch where meaning carries you — and where the small model still stumbles.
