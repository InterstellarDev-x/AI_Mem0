# Hindsight Learning — Notes

The full write-up for the hindsightLearning project. Lessons in order.

## The idea

An LLM is stateless: every call sends the whole `messages` array back and
nothing persists between calls. "Memory" for an agent is therefore never a
property of the model — it is always a system we build *around* the model:
something we keep, somewhere we find it again, and a decision about what to
put back into the next prompt.

Hindsight is the most ambitious open-source version of that system. Its core
claim: memory should be *structured at write time*, *consolidated in the
background*, and *reflected over* — not dumped into a flat vector pile and
hoped back out.

We learn it by building a toy version of each layer, bottom-up, then
studying the real thing.

## Lesson index

| # | One idea | Note | Code |
|---|----------|------|------|
| 1 | Memory = a list + a search function | [note](lesson1.md) | `../src/lesson1.ts` |
| 2 | Statistical meaning: TF-IDF + cosine | — | — |
| 3 | Dense meaning: real embeddings | — | — |
| 4 | Keyword search done right: BM25 | — | — |
| 5 | Hybrid retrieval + reciprocal rank fusion | — | — |
| 6 | Cross-encoder reranking | — | — |
| 7 | Time: timestamps and temporal recall | — | — |
| 8 | Structure on write: entities + graph | — | — |
| 9 | retain ≠ append: write-time normalization | — | — |
| 10 | Consolidation into observations | — | — |
| 11 | Refinement, not replacement | — | — |
| 12 | Mental models: standing answers | — | — |
| 13 | Banks: strict isolation | — | — |
| 14 | Memory defense: secrets/PII scanning | — | — |
| 15 | The real server: retain/recall/reflect | — | — |
| 16 | Reflect: reasoning over memory | — | — |
| 17 | LLM wrapper: 2-line integration | — | — |
| 18 | MCP server: memory as tools | — | — |
| 19 | Coding-agent integration | — | — |
| 20 | Production: pgvector, monitoring, Cloud | — | — |

Full plan: [lesson-plan.md](lesson-plan.md).
