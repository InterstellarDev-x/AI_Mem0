# Lesson 17 — The LLM wrapper: memory as invisible infrastructure (2026-10-03)

## The one idea

Wrap the client once, and every LLM call automatically recalls relevant
memories into the prompt and retains the conversation afterwards. The app
code doesn't change — it keeps calling chat.completions.create like always;
the wrapper does the memory work around it.

## What we built

`src/lesson17.ts`: `wrapChat(engine, chatFn)` — any chat function in,
memory-wrapped chat function out. Four steps, mirroring Hindsight: extract
the user query (override or last user message) → recall and inject into the
system prompt (appended to an existing system message, or prepended) → the
real call, untouched → retain the exchange (Hindsight does this on a
background thread; we await for determinism). Per-call overrides
(`{inject: false, store: false}`) play the role of Hindsight's
`hindsight_*` kwargs. Provider-agnostic by construction — the lesson is the
wrapper, not the model, so keyless runs use a stub that reports exactly what
would have been sent.

## What it shows

Run `bun run lesson17`. Without the wrapper the model sees 1 message and no
system prompt; with it, 2 messages with the observation injected — and the
exchange retained afterwards (watch the store grow). The override call shows
both steps switching off independently.

## Grounded in the real Hindsight

Verified in
hindsight-integrations/litellm/hindsight_litellm/wrappers.py:
`wrap_openai(client, bank_id="my-agent")`, then per call: extract query →
recall/reflect → inject into system prompt → real API call → store the
conversation via `_retain_background` (threaded, non-blocking). The
engine-side sibling is `engine/llm_wrapper.py`, which unifies providers
(Hindsight sits on LiteLLM for 100+ models).

## What's next

Lesson 18: the MCP server — memory exposed as tools.

## Try it

```
bun run lesson17
OPENAI_API_KEY=... bun run lesson17   # a real model answers from memory
```

Ask the wrapped chat "Where does Alice work?" keyed, then ask it "What did
I just ask you?" — the second answer comes from the retained exchange, not
from the original facts. Memory of the conversation itself.
