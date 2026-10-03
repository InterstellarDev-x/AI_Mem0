# Lesson 16 — Reflect: the agent loop with a disposition (2026-10-03)

## The one idea

Reflect isn't a function call, it's an *agent loop*. The model gets tools
and works hierarchically — curated mental models first, then observations,
then raw facts as ground truth — up to 10 iterations before it must answer.
And the loop has a personality: the bank's disposition (skepticism /
literalism / empathy, each 1–5) is written into its prompt, so the same
evidence gets reasoned about differently.

## What we built

`src/lesson16.ts`: `ReflectAgent` over lesson 13's `Engine`, with read-only
tools `search_mental_models` / `search_observations` / `recall` (+ `done`).
Keyed, gpt-6-luna really picks a JSON tool call each iteration (demo max 5;
Hindsight uses 10). Keyless, the hierarchy runs mechanically and skepticism
is applied as an explicit, labeled rule. Disposition prompts modeled on
Hindsight's `build_disposition_description`.

## What it shows

Run `bun run lesson16`. The evidence is conflicted (Alice works at Google /
Alice left Google). Both agents run the same loop — models (0 hits) →
observations (1) → recall (0) — but the skepticism=5 agent refuses a firm
answer over the conflict while skepticism=1 answers straight. Same
machinery, different character.

## Grounded in the real Hindsight

Verified: tools_schema.py — "hierarchical retrieval strategy: 1.
search_mental_models (try first); 2. search_observations; 3. recall — raw
facts as ground truth" (+ expand, + done). agent.py — "Execute the reflect
agent loop using native tool calling", DEFAULT_MAX_ITERATIONS = 10.
response_models.py — DispositionTraits: "skepticism: 1=trusting, 5=skeptical;
literalism: 1=flexible, 5=literal; empathy: 1=detached, 5=empathetic",
rendered into the prompt via bank_disposition_line.

## What's next

Lesson 17: the LLM wrapper — automatic retain/recall on every LLM call.

## Try it

```
bun run lesson16
OPENAI_API_KEY=... bun run lesson16   # the model really drives the loop
```

Flip literalism to 5 vs 1 and ask "Did Alice *really* leave Google?" — watch
the same loop argue with itself about what "left" commits to.
