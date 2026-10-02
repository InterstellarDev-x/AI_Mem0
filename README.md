# hindsightLearning

Learning agent memory from scratch, bottom-up — the way Hindsight builds it —
to understand every layer of how memory systems for AI agents actually work.

The problem Hindsight solves: an LLM is stateless. Everything it "remembers"
is stuff we kept somewhere and found again. Most agent memory is a flat pile
of vectors + semantic search. Hindsight organizes memory the way human memory
works: structured at write time, consolidated into beliefs, reflected over.

Full write-up and lesson index: **`notes/README.md`**.

## The shape of it

Built in three layers, in order:

```
Layer 3: Real Hindsight   ← server, SDK, MCP, integrations, production
Layer 2: Memory that learns ← consolidation, observations, mental models, banks
Layer 1: memory-loop       ← the core loop (retain → recall → repeat)
```

Starting from the single idea that memory = a list + a search function, and
building up through statistical retrieval, dense embeddings, hybrid search +
rank fusion, reranking, temporal filtering, graph links, write-time
normalization, background consolidation, observations, mental models, and
banks — then the real Hindsight server, reflect, the LLM wrapper, MCP, and
production.

Each lesson has its own dated note in `notes/` and a runnable file in `src/`.
Each lesson adds exactly one idea. See `notes/lesson-plan.md` for the full plan.

## Running a lesson

```
bun install        # once
bun run lesson1    # ... lesson by lesson
```

Each lesson runs dependency-free until its note says otherwise; later
lessons add their npm packages in `package.json`.

## Status

Taught lesson-by-lesson by Muse, in the style of the recodeLearning repo.
Say "next lesson" when you've run and understood the current one.
