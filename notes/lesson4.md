# Lesson 4 — Keyword search done right: BM25 (2026-10-03)

## The one idea

Lesson 2's TF-IDF has two flaws. First, term frequency is **linear**: a fact
saying "chess" four times scores 4x one saying it once — but the 4th "chess"
carries almost no new information. Second, length handling is implicit.
**BM25** fixes both: the tf contribution *saturates* (diminishing returns,
hard-capped at `k1+1`) and document length is normalized explicitly, with a
tunable knob (`b`).

```
score(D, Q) = Σ IDF(qi) · [ f(qi,D)·(k1+1) ] / [ f(qi,D) + k1·(1−b+b·|D|/avgdl) ]
IDF(qi)     = ln( 1 + (N − n(qi) + 0.5) / (n(qi) + 0.5) )
```

`k1 = 1.2`, `b = 0.75`: the defaults the whole industry uses. This is the
workhorse sparse retriever — battle-tested, no model, no vectors.

## What we built

`src/lesson4.ts`: the same `Memory` class, `recall()` rebuilt around BM25.
Still dependency-free. The demo prints the saturation curve first — the
whole lesson in one table: at 10 repetitions, linear tf says 10.0x, BM25
says 1.96x, asymptoting to 2.2x no matter how much you stuff.

## What it fixes

On "chess" (×1 in a short fact vs ×4 in a long one), lesson 2's TF-IDF gave
0.739 vs 0.463 — the repetition bought a 1.6x advantage. BM25 gives 1.516
vs 1.219: a 1.24x advantage. Same winner, but keyword stuffing pays less.
That is saturation at work — and why BM25, not raw TF-IDF, is the sparse
retriever everything else gets fused with.

## Grounded in the real Hindsight

Verified in the upstream source: Hindsight does **not** hand-roll BM25. Its
keyword arm is Postgres' native full-text search (`tsvector`/`tsquery`),
exposed as the "BM25" arm with a score floor (`bm25_min_score`) gating
candidates into fusion. We implement it by hand to learn the mechanics; in
production you let the database do it. (This is also why lesson 5's fusion
exists — the arms are separate systems with incomparable scores.)

## What's next

Lesson 5: hybrid retrieval — run semantic (lesson 3) + BM25 (lesson 4) in
parallel, merge with reciprocal rank fusion. This is Hindsight's recall
core, minus the graph and temporal arms.

## Try it

```
bun run lesson4
```

Play with `k1` and `b`: set `b = 0` and length normalization vanishes —
watch the long chess-club fact's advantage grow. Parameters with visible
effects beat magic constants.
