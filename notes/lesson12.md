# Lesson 12 — Mental models: reflections you pin (2026-10-03)

## The one idea

Observations (lessons 10–11) *happen* — the background job makes them
whether you ask or not. A **mental model** is the opposite: a question you
*pin*, answered on demand. `reflect()` re-runs the question against current
memory and refreshes the answer. First run builds the document from scratch
(**full**); later runs diff against the baseline (**delta**). Every refresh
is recorded — including the ones that change nothing, because "nothing new"
is itself an answer.

## What we built

`src/lesson12.ts` (imports lesson 11's memory — Layer 2 stacking):
`pinModel(question)` stores the question; `reflect(id)` resolves scope,
gathers evidence, and refreshes. Evidence is the *belief layer*: relevant
observations (versioned by revision counter, so a refined belief counts as
fresh) plus relevant facts never consolidated — raw facts already folded
into an observation don't appear twice. The document is a claim list;
delta = diff (+added/−removed). Claim prose via gpt-6-luna when keyed,
mechanical otherwise.

## What it shows

Run `bun run lesson12` — one demo, all four real outcomes:
1. `[full] content_written` — the baseline document is built.
2. `[delta] content_unchanged` — "Alice joined Anthropic" strengthened the
   observation (rev bumped, delta ran) but the document stands. The model
   looked and confirmed.
3. `[delta] content_written` (+1 −1) — "Alice no longer works at Anthropic"
   contradicted the belief; the claim was revised.
4. `[delta] content_preserved_no_new_facts` — silence. Nothing new.

## Grounded in the real Hindsight

Verified: consolidator.py — "Mental models: user-defined queries stored in
the mental_models table, refreshed on demand via reflect", distinct from
observations ("auto-generated bottom-up"). mental_model_refresh.py: "A
refresh resolves a scope, picks full-vs-delta, runs reflect over a bounded
snapshot, and (in delta mode) applies structured operations to the existing
document" — with outcomes content_written / content_unchanged /
content_preserved_no_new_facts / refresh_failed_empty_candidate, every run
recorded in mental_model_history. Our revision counter + claim diff is a
simplification of their structured delta ops; same shape.

## What's next

Lesson 13: the full engine — retain, recall, and reflect wired together,
the way Hindsight's MemoryEngine exposes them.

## Try it

```
bun run lesson12
OPENAI_API_KEY=... bun run lesson12   # LLM-written claims
```

Pin a second model — "Who does Alice work with?" — and reflect it after
each consolidation. Watch two pinned questions diverge over the same
evidence.
