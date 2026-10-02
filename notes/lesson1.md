# Lesson 1 — Memory is a list + a search function (2026-10-02)

## The one idea

An LLM is stateless. Everything an agent "remembers" is just stuff we kept
somewhere and found again. So the entire memory problem reduces to two
functions:

- `retain(content)` — keep something
- `recall(query)` — find the relevant things again

Even a Python list of strings plus substring matching is a memory system.
It's dumb, but it's complete: it has a write path and a read path, and you
can already see the shape of every memory system that comes after —
Hindsight included.

## What we built

`src/lesson01.py`: a `Memory` class. `retain()` appends a fact (with a
timestamp). `recall()` scores stored facts by how many query words appear in
them and returns the best match. The demo stores three facts about Alice and
asks "what does Alice do?"

## What broke

Substring/word-overlap recall is brittle in exactly the ways you'd expect.
Run the demo and look at the second answer: "what is Alice's job?" returns
"Bob is Alice's manager" — not just a miss, a *confident wrong answer*.
The store has the knowledge ("software engineer"), but the search can't rank
by meaning, so it hands the agent the wrong memory and the agent will happily
state it as fact.

That gap — having the knowledge but not being able to retrieve it — is the
whole motivation for lesson 2 onward. Every retrieval strategy Hindsight runs
(semantic, keyword, graph, temporal) exists to close exactly this gap.

## What's next

Lesson 2: score by *statistical* meaning (TF-IDF + cosine) instead of raw
word overlap. First ranked retrieval, still stdlib-only.

## Try it

```
python3 src/lesson01.py
```

Change the facts, change the queries, watch where recall fails. The failures
are the lesson.
