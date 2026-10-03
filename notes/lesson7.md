# Lesson 7 — Time: the temporal arm (2026-10-03)

## The one idea

Everything so far retrieves by *content*. But "what did Alice do in June?"
is a question about *when* — and no embedding or BM25 score knows what
"June" means. So time becomes a first-class retrieval dimension: stamp every
fact at retain, extract a time window from the query at recall, and run a
**temporal arm** — in-window facts, newest first — fused with the other arms
via RRF.

## What we built

`src/lesson7.ts`: `retain()` takes a timestamp; `recall()` extracts a window
with a tiny rule-based parser ("in June", "last week", "yesterday") and, if
one is found, adds a third arm: in-window facts ranked newest-first. No
window → the arm stays empty and fusion runs on two arms, exactly like
Hindsight's ("temporal is empty unless a window was given").

## What it shows

Run `bun run lesson7`. On "what did Alice do in June?" (reference date
2026-10-03), the extractor yields 2026-06-01 → 2026-07-01, and the fused
top-3 are all June facts. The semantic arm alone leaks "Alice loves hiking
in Yosemite" (August) into its top 3. The temporal arm doesn't rank *better*
— it answers a different question: *when*.

## Grounded in the real Hindsight

Verified in the upstream source: recall has four arms — semantic, BM25,
graph, temporal (`RecallArms` in `engine/memories/base.py`), and there are
additionally recency/temporal boosts applied downstream of fusion. The window
itself comes from a query analyzer (`engine/query_analyzer.py`) combining
rules, dateparser, and a small T5 model — ours is rules-only and says so;
the architecture (extract → window → arm) is the lesson, not the parser.

## What's next

Lesson 8: the graph arm — entities and relationships extracted at retain
time, walked at recall. The last of the four arms.

## Try it

```
bun run lesson7
```

Ask "what did Alice do yesterday?" with reference date 2026-10-03: the
extractor fires, the window is empty of facts, and the temporal arm
contributes nothing. An arm that knows when to stay silent is a feature —
that's why Hindsight gates it on the window.
