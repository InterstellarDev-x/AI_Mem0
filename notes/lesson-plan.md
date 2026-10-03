# Hindsight Learning — Lesson Plan

Learn agent memory bottom-up, the way Hindsight builds it: no frameworks
until we earn them. We start from the single idea that an LLM is stateless —
everything it "remembers" is just stuff we kept somewhere and found again —
and build up through retrieval strategies, consolidation, and finally the
real Hindsight system.

Built in three layers, in order:

```
Layer 3: Real Hindsight   ← server, SDK, MCP, integrations, production
Layer 2: Memory that learns ← consolidation, observations, mental models, banks
Layer 1: memory-loop       ← the core loop (retain → recall → repeat)
```

Each lesson has its own dated note in `notes/` and a runnable file in `src/`.
Each lesson adds exactly one idea.

**Ground rule for teaching:** every claim about how Hindsight itself works
(API names, retrieval paths, consolidation behavior) is verified against the
actual upstream source (`~/workspace/upstream/hindsight/`) before the lesson
is written — never from memory. If the source is ambiguous, the lesson says so.

---

## Layer 1: memory-loop — retain → recall → repeat

1. **Memory is a list + a search function.** A dict of facts and a substring
   `recall()`. Shows that even a dumb store is a memory system — and where it
   breaks. (`src/lesson1.ts`)
2. **Statistical meaning.** TF-IDF + cosine similarity: recall by word
   importance, not substring. First taste of ranked retrieval.
3. **Dense meaning.** Real embeddings + cosine: recall by *meaning*.
   Why paraphrase works now.
4. **Keyword search done right.** BM25: term frequency, document length
   normalization. The workhorse sparse retriever.
5. **Hybrid retrieval.** Run semantic + keyword in parallel, merge with
   reciprocal rank fusion (RRF). This is Hindsight's recall core, minus the
   graph and temporal paths.
6. **Reranking.** Cross-encoder on the top-k: slow but precise second pass.
   Full Hindsight recall pipeline assembled.
7. **Time.** Timestamps at retain, time-range filtering at recall.
   Answering "what happened in June?"
8. **Structure on write.** Extract entities and relationships at retain time;
   walk the graph at recall. Hindsight's graph retrieval path.
9. **retain ≠ append.** Normalize on write: canonical entities, dedupe,
   one fact one place. Why Hindsight uses an LLM in the retain path.

## Layer 2: Memory that learns

10. **Consolidation.** Background job: merge related facts into observations.
    From a pile of memories to beliefs.
11. **Refinement, not replacement.** New evidence strengthens, weakens, or
    extends an observation — with proof counts and exact quotes kept.
12. **Mental models.** Standing answers to standing questions ("what are this
    user's preferences?"), rewritten in the background as the bank learns.
13. **Banks.** Strict isolation: one brain per user/project. Disposition
    traits (skepticism, empathy) shaping reflection.
14. **Memory defense.** Scan every retain for secrets and PII: redact or block.

## Layer 3: Real Hindsight

15. **The real server.** Docker up, client connected. retain/recall/reflect
    for real against the actual system.
16. **Reflect.** Disposition-aware reasoning over memories — answering
    questions that need thinking, not lookup.
17. **LLM wrapper.** Two lines of code: automatic retain/recall on every LLM
    call. 100+ models via LiteLLM.
18. **MCP server.** Memory exposed as tools at `/mcp/{bank_id}/`.
19. **Coding-agent integration.** Per-repo project memory built from git
    history and past sessions.
20. **Production.** Postgres + pgvector, monitoring, webhooks, Cloud.

---

## The later half (after the toy version)

Like recodeLearning goes past the toy runtime into production internals,
lessons 15–20 study the real system: how Hindsight's `retain` pipeline
extracts facts/entities/temporal data, how `recall`'s four strategies merge
via RRF + cross-encoder, how background consolidation is scheduled, and how
banks stay isolated at the storage layer.

## Status

All 20 lessons written, runnable, and pushed. Say "next lesson" is retired —
the course is complete. Revisit any lesson with `bun run lesson<N>`.
