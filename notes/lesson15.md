# Lesson 15 — Forgetting: deletion is a first-class operation (2026-10-03)

## The one idea

Deleting the row is easy. The hard part is noticing that everything built on
top of it is now standing on air. Forgetting cascades: the fact moves to
invalidated (the row stops existing), observations lose proof and quotes,
observations with no grounding left are swept — and every pinned claim gets
its grounding partitioned into live vs retracted. A retraction is the
*absence* of a row, so the pipeline can't see it until something turns that
absence into a value.

## What we built

`src/lesson15.ts` + `Memory.forget()` (added to lesson 11's store):
forgetting moves the fact to `invalidated` (like Hindsight's
`invalidated_memory_units`), drops it from observations' sourceIds/quotes
(parallel arrays, spliced together), decrements proof, bumps rev, and sweeps
observations left with no grounding. History is untouched — it's the audit
trail of what was believed, not a live claim. A tiny pinned-claim layer runs
the audit: each claim's cited ids partitioned into live vs retracted, pure
and LLM-free, like Hindsight's `partition_retracted`.

## What it shows

Run `bun run lesson15`. Three facts → observations + two pinned claims.
`forget(0)`: obs #0 weakened (proof 2→1), claim 1 → UNSUPPORTED, claim 2
still supported. `forget(1)`: obs #0 swept, claim 2 → UNSUPPORTED. Final:
1 live fact, 2 invalidated, the Bob observation standing alone.

## Grounded in the real Hindsight

Verified in reflect/retractions.py: "A retraction is the absence of a row,
so it raises no watermark and reaches no prompt. This module turns that
absence into a value." When a fact is invalidated, deleted, or swept, "the
row simply stops existing — retrieval can never return it again, but the
document keeps stating it and keeps citing it." And: "Why the cause is not
distinguished — invalidated, deleted, and re-ingested all present
identically: an id with no live row." Our cascade asks only "is it live?",
never why; re-ingest under a fresh id stays possible (the `seen` set is
cleared on forget).

## What's next

Lesson 16: the agent loop — how an agent actually uses retain/recall/reflect
in a working session, and where the tools from lesson 13's engine surface.

## Try it

```
bun run lesson15
```

Forget fact #2 (Bob's) instead of #0: watch the *other* observation get
swept while the Alice belief stands untouched. Deletion is scoped, like
everything else.
