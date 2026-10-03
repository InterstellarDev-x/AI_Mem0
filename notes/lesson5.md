# Lesson 5 — Hybrid retrieval: semantic + BM25, fused with RRF (2026-10-03)

## The one idea

Lessons 3 and 4 produce *incomparable* scores: a cosine in [-1, 1], a BM25
that is unbounded positive. Adding 0.766 to 2.764 is meaningless.
**Reciprocal Rank Fusion** dodges the problem: it discards the scores and
fuses *ranks*, which are always comparable.

```
RRF(d) = Σ_over_arms  1 / (k + rank(d)),   k = 60
```

A document ranked #1 by both arms outscores one ranked #1 by a single arm;
a document liked by both arms beats one loved by one and ignored by the
other. `k = 60` dampens the gap between close ranks, so fusion is robust
rather than twitchy — rank 1 vs rank 5 matters less than rank 1 vs rank 50.

## What we built

`src/lesson5.ts`: both arms from lessons 3–4 run in parallel (embeddings on
the write path, tokens on the write path), each capped at its top 5, then
fused by rank. Each fused result carries its per-arm ranks along — the way
Hindsight's `MergedCandidate` carries `source_ranks`.

## What it shows

Run `bun run lesson5`. On "Alice's boss" the arms agree on #1 but split
below it: semantic's #2 is the engineer fact, BM25's #2 is the hiking fact.
Fusion ranks engineer higher — (sem #2, bm25 #3) beats (sem #5, bm25 #2).
Consensus wins. Neither arm alone would have ordered it that way, and no
score-mixing could have either, because the scales don't mix.

## Grounded in the real Hindsight

Verified in `engine/search/fusion.py`: `reciprocal_rank_fusion` with `k=60`
over the arms `[semantic, bm25, graph, temporal]`, with `cap_per_source`
truncating each arm before fusion so one backend can't crowd out the others
(we mirror both). We run 2 of the 4 arms; graph joins in lesson 8, temporal
in lesson 7. There is also an `interleave_fusion` alternative in the same
file — RRF is the default.

## What's next

Lesson 6: reranking — a slow, precise cross-encoder over the fused top-k.
The second pass that corrects the first pass's mistakes.

## Try it

```
bun run lesson5
```

Change `RRF_K` to 1 and watch fusion become twitchy — tiny rank differences
suddenly dominate. `k` is a robustness knob, not a magic constant.
