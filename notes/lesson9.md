# Lesson 9 — retain ≠ append: normalize on write (2026-10-03)

## The one idea

Everything so far appended raw input to the store. But raw input is messy:
"Alice", "alice" and "Alice's" are three strings for one entity; retaining
"Alice works at Google." twice stores one fact twice; "She started at
Google" names nobody. **The write path is where quality is made**: split
input into atomic facts, canonicalize entities, drop duplicates — so the
read path stays simple. One fact, one place.

## What we built

`src/lesson9.ts`: `retain()` is now a pipeline — **split** (sentences) →
**extract** (entities per fact) → **canonicalize** ("Alice's" → "alice") →
**dedupe** (normalized-equal facts stored once) → store, with an entity
index maintained as we go. Lookup by entity is then trivial: the read path
stays dumb because the write path did the work.

The extractor is pluggable: rules by default (capitalized phrases, no
coreference), `gpt-6-luna` via the official `openai` SDK when
`OPENAI_API_KEY` is set (`OPENAI_API_BASE` overrides the endpoint for
proxies/gateways; `OPENAI_CHAT_MODEL` overrides the model) — and it falls
back to rules on any API failure, saying so. The LLM gets the already-known
entities as context, so "she" resolves to `alice` instead of becoming an
"unidentified woman" — without that context even the LLM is honest about
not knowing. (gpt-6-luna is a reasoning model: it takes
`max_completion_tokens`, not `max_tokens`.)

## What it shows

Run `bun run lesson9`. Four retains → four facts stored, one duplicate
skipped; "Alice's" canonicalizes to `alice`, so `lookup("alice")` finds both
Alice facts. Then the honest failure: "She started at Google last June"
stores `she` as its own entity and `june` as one too. Rules can't resolve
pronouns. Rerun with `OPENAI_API_KEY` set and watch the LLM map them to
alice — *that gap* is why Hindsight's retain path uses an LLM.

## Grounded in the real Hindsight

Verified in the upstream README: "retain uses an LLM to extract key facts,
temporal data, entities, and relationships. It passes these through a
normalization process to transform extracted data into canonical entities,
time series, and search indexes." (`engine/retain/fact_extraction.py`:
"The LLM only extracts metadata: entities, temporal info, location, people.")
Note what dedup is *not*: semantic merging ("these two facts say the same
thing") — that's consolidation's job, lesson 10. This lesson is the cheap
mechanical hygiene before it.

## What's next

Lesson 10: consolidation — the background job that merges related facts
into observations. From a pile of memories to beliefs. Layer 2 begins.

## Try it

```
bun run lesson9
OPENAI_API_KEY=... bun run lesson9   # compare extractors
```

Retain "Alice works at Google!" (exclamation) and watch normalized dedup
catch it. Then retain "A. Kumar joined Google" — neither extractor links it
to alice. Alias resolution without a knowledge base is the hard version of
this problem.
