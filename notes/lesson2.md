# Lesson 2 — Not all words are equal: TF-IDF + cosine (2026-10-02)

## The one idea

Lesson 1 counted shared words, treating every word the same. But words
carry different amounts of information: "alice" (in 4 of 5 facts) tells you
almost nothing, while "engineer" (in 1 of 5) tells you a lot. **TF-IDF**
weights each word by rarity across the store; **cosine similarity** compares
query and fact by the angle between their weighted vectors, so long facts
don't win just for being long. Same two functions as lesson 1 —
`retain()` and `recall()` — but `recall()` finally *ranks*.

- **tf** (term frequency): how often the word appears in *this* fact.
- **idf** (inverse document frequency): `log(N / df)` — how rare the word is
  across *all* facts. Rare words get high weight.
- **cosine**: `dot(a, b) / (|a| * |b|)`. Direction of meaning, not magnitude.

## What we built

`src/lesson2.ts`: the same `Memory` class, with `recall()` rebuilt around
TF-IDF vectors and cosine similarity. Still dependency-free — the "index"
is just a document-frequency map computed at query time. (A real system
would maintain it incrementally; we recompute it because the corpus is tiny
and the mechanics are clearer that way.) Stopwords are dropped with a small
hardcoded list, since glue words like "is" and "the" only add noise.

## What it fixes

Run `bun run lesson2`. On the query "Alice engineer Bob", raw word-overlap
ties 2–2 between the top two facts and picks by insertion order — luck, not
ranking. TF-IDF scores them 0.439 vs 0.256 and ranks the software-engineer
fact first, *because* "engineer" (idf 1.61) is rarer than "bob" (idf 0.92)
is rarer than "alice" (idf 0.22). The ranking now has a reason.

## What it doesn't fix

The demo ends with "what is Alice's job?" — and TF-IDF still returns
"Bob is Alice's manager". "job" never appears in the store, so it
contributes nothing, and nothing in the system links "job" to "engineer".
Counting words — however cleverly weighted — cannot cross a vocabulary gap.
That needs *meaning*, not tokens.

## What's next

Lesson 3: dense embeddings + cosine — recall by meaning, so paraphrase works.
First lesson that needs a model (or a documented stand-in until we wire one).

## Try it

```
bun run lesson2
```

Change the facts and watch the idf values shift: add ten more facts about
Alice and "alice" becomes nearly worthless as a signal. That dynamic —
weights that adapt to the corpus — is the whole point.
