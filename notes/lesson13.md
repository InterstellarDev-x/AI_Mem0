# Lesson 13 — The full engine: retain, recall, reflect (2026-10-03)

## The one idea

Twelve lessons built the parts; now they become one interface with three
verbs. **retain()** writes (normalize → index, then the background job
learns). **recall()** reads (retrieve → prefer observations → budget).
**reflect()** answers (synthesis over recall, read-only — it persists
nothing). The wiring is the lesson: consolidation runs after retain; recall
prefers beliefs over the raw facts they absorbed; reflect calls recall
internally.

## What we built

`src/lesson13.ts`: `Engine` wraps lesson 11's memory (imported, not
rewritten). recall() runs Hindsight's staged shape — retrieve (compact
TF-IDF-ish scorer; lessons 3–6 built the full versions), prefer_observations
(drop raw facts the observation processed, supporting or contradicting —
this required tracking `counterIds` in lesson 11), budget (char cap standing
in for max_tokens). reflect() recalls, then gpt-6-luna synthesizes when
keyed; the demo asserts the store is identical afterwards (3f/1o → 3f/1o).

## What it shows

Run `bun run lesson13`. Three retains → one observation. recall("Where does
Alice work?") returns *only* the observation — "…[CONTESTED by: 'Alice left
Google last week.']" — every raw fact absorbed, the belief speaking for its
sources. reflect() answers the trajectory question and the read-only check
prints: store unchanged.

## Grounded in the real Hindsight

Verified in engine/memory_engine.py: retain() "stores content as memory
units with temporal and semantic links"; recall() is "N*4-way parallel
retrieval → RRF → cross-encoder → MMR → token-budget filter" with
prefer_observations ("drop raw facts that a returned observation was
consolidated from"); reflect_async() is "an agentic loop with tools" that is
"read-only: it synthesizes an answer from the bank's stored memories and
persists nothing." Our compact scorer stands in for the 4-way retrieval;
the stage order and the wiring are faithful.

## What's next

Lesson 14: banks — the multi-tenant boundary. One engine, many isolated
stores; why memory is always scoped.

## Try it

```
bun run lesson13
OPENAI_API_KEY=... bun run lesson13   # LLM-synthesized reflection
```

Ask recall("Who is Bob?") — no observation covers him yet. Watch the
difference between a belief hit and a raw-fact hit.
