# Lesson 25 — Causal links: why, not just what (2026-10-04)

## The one idea

Memories aren't only linked by shared entities (lesson 8's graph). They're
linked by *cause and effect*. Causal edges let the bank answer "why" —
follow the caused_by links backward from an event to its reasons.

## What we built

`src/lesson25.ts`: `CausalBank` over lesson 13's Engine. The rules-path
extractor watches for causal phrasing ("because", "led to", "caused") and
emits typed edges (caused_by canonical; causes/enables/prevents legacy).
`why(factId)` walks the edges backward. And because edges are *extraction
output*, not derived data, forgetting doesn't delete them: the edge
descriptor (from, to, type, weight) is parked on an archive so a revert can
rematerialize it — exactly the real system's behavior.

## Grounded in the real Hindsight

Verified in engine/causal_links.py: edges in memory_links with canonical
type "caused_by" (legacy "causes", "enables", "prevents") plus weight;
CausalLinkDescriptor is "what the archive row stores so revert can
rematerialize the edge" after invalidation cascades the rows away.

## Try it

```
bun run lesson25
```

Retain "The build broke because the tests were flaky" and ask why the build
broke. Then chain two: "the tests were flaky because the fixtures leaked
state" — why() walks one hop; extend it to walk the full chain and you've
built root-cause analysis.
