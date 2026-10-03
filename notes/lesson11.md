# Lesson 11 — Refinement, not replacement (2026-10-03)

## The one idea

Lesson 10's updater just appended. Real new evidence does three different
things to a belief: **strengthens** it (more proof), **weakens** it
(contradiction), or **extends** it (a new facet). And a belief that changes
keeps its receipts: proof count, exact quotes, counter-quotes, and the
history of what it used to say. Refinement, not replacement.

## What we built

`src/lesson11.ts`: every new fact gets a verdict against the current belief
— supports / contradicts / extends / unrelated. The verdict goes to
gpt-6-luna when `OPENAI_API_KEY` is set (one JSON call per batch); the rule
fallback uses explicit contradiction markers and says it's coarse. Then:
supports/extends → `proofCount` up, quote kept; contradicts → pre-update
text snapshotted into `history`, counter-quote kept, belief revised;
unrelated → left for its own scope.

## What it shows

Run `bun run lesson11`. Two facts → obs #0 (proof=2). "Teammates praise her
code reviews" → STRENGTHEN (proof=3). "Alice left Google last week" →
WEAKEN: history snapshot, counter-quote kept, belief flagged contested —
not silently overwritten. The keyed path rewrites the belief properly
("Alice was a software engineer at Google (left last week)…"); the rule
path flags because rules can't rewrite. That gap is stated, not hidden.

## Grounded in the real Hindsight

Verified in `engine/consolidation/consolidator.py`: consolidation "updates
existing observations when new evidence supports/contradicts/refines them";
observations carry `proof_count` (supporting memories), `source_memory_ids`,
and `history` — every update archives a pre-update snapshot into
`observation_history`. Update drift that collides with another observation
gets folded (dedup merge) — ours doesn't implement that yet.

## What's next

Lesson 12: mental models — pinned reflections, distinct from observations
(auto-generated bottom-up vs user-defined queries refreshed via reflect).

## Try it

```
bun run lesson11
OPENAI_API_KEY=... bun run lesson11   # LLM verdicts + rewritten beliefs
```

Retain "Alice's ranking model was rolled back." and consolidate: is that a
contradiction or an extension? The rules say one thing; the model another.
