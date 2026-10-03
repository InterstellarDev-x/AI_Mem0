# Lesson 8 — The graph arm: link at write time, walk at read time (2026-10-03)

## The one idea

Some relevant facts share no words and no meaning-direction with your query
— they're relevant *through* another fact. "Where is Alice's employer
headquartered?" is answered by a fact about Google that never mentions
Alice. So **link facts at retain time; at recall, seed with semantic hits
and walk one hop through the links.**

## What we built

`src/lesson8.ts`: `retain()` now also extracts entities (crude capitalized
phrases — documented as such) and builds two link types, both
bidirectional: **entity links** (weight = # shared entities) to every
earlier fact sharing an entity, and **one semantic link** to the most
similar earlier fact above threshold. The graph arm takes the top semantic
hits as seeds (Hindsight: `GRAPH_SEED_LIMIT`), walks one hop, excludes the
seeds themselves, and contributes its ranking to the RRF fusion. Four arms
now; temporal stays dormant unless the query carries a window.

## What it shows

Run `bun run lesson8`. Six links are built at retain time. On "where is
Alice's employer headquartered?", the semantic arm ranks the headquarters
fact #4 of 5 — "headquartered" and "employer" appear nowhere in it. But it
shares the entity Google with the seed fact, so the graph arm walks
Alice → Google → Mountain View in one hop, and fusion puts it at #1.

## Honest limits

The walk also surfaces "Bob likes chess" via the Bob entity link — graph
expansion is high-recall and noisy. That's why Hindsight caps per-entity
fanout (200, via LATERAL) and fuses the arm instead of trusting it. We also
skip Hindsight's third signal, **causal links** (causes/enables/prevents,
boosted highest) — extracting those needs an LLM, which is lesson 9's
whole point.

## Grounded in the real Hindsight

Verified in `engine/memories/pg/link_expansion.py`: seeds → expand through
entity links (shared-entity count), semantic links (precomputed kNN at
insert time, checked both directions), causal links (weight + 1.0). Entity
extraction itself is LLM-based (`engine/retain/fact_extraction.py`: "The LLM
only extracts metadata: entities, temporal info, location, people") —
ours is regex and says so.

## What's next

Lesson 9: retain ≠ append — normalize on write (canonical entities, dedupe).
Why Hindsight uses an LLM in the retain path. The write side gets serious.

## Try it

```
bun run lesson8
```

Add a fact "Google was founded by Larry Page" and watch the Google entity
node gain fanout. Then imagine a million facts sharing the entity "Google"
— that explosion is what the per-entity cap exists for.
