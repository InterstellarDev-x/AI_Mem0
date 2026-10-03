# Lesson 10 — Consolidation: from a pile of facts to beliefs (2026-10-03)

## The one idea

Lessons 1–9 store *facts*. But an agent that has seen fifty facts about
Alice shouldn't recall fifty rows — it should recall what it *believes*
about Alice. **Consolidation** is the background job that turns facts into
**observations**: fewer, denser, each citing its sources. New evidence then
*updates* a belief instead of piling on beside it.

## What we built

`src/lesson10.ts`: `retain()` marks facts unconsolidated; `consolidate()`
takes the unconsolidated batch, groups by entity (mirroring Hindsight's
scope batching), and per group either **UPDATE**s the observation owned by
that scope or **CREATE**s a new one. Every observation cites `sourceIds` and
merges temporal bounds from its sources. The observation *prose* uses
gpt-6-luna when `OPENAI_API_KEY` is set, else a clearly-labeled mechanical
join — the mechanics (batch → decide → cite) are the lesson, not the prose.

## What it shows

Run `bun run lesson10`. Five facts → two observations (alice, bob), each
with sources. Then "Alice got promoted to senior software engineer" arrives
and the second `consolidate()` *updates* obs #0 instead of creating a third:
6 facts in, 2 beliefs out. With the key, the prose is real: "Alice was
promoted to senior software engineer at Google and shipped the new ranking
model." — sources [0,1,2,5].

## Grounded in the real Hindsight

Verified in `engine/consolidation/consolidator.py`: "The consolidation
engine runs as a background job after retain operations complete." It
processes unconsolidated rows in batches; the LLM decides CREATE / UPDATE /
DELETE per batch, every action citing `source_fact_ids` with a one-sentence
`reason`. Our scope-ownership is a simplification of Hindsight's scope
resolution (which handles overlapping scopes and tags) — same shape.

## What's next

Lesson 11: refinement, not replacement — new evidence strengthens, weakens,
or extends an observation, with proof counts and exact quotes kept.

## Try it

```
bun run lesson10
OPENAI_API_KEY=... bun run lesson10   # LLM-written observations
```

Retain "Alice left Google." and consolidate: watch what the updater does
with a *contradicting* fact. (Spoiler: our updater just appends — handling
contradiction properly is lesson 11.)
