# Lesson 22 — Bank mission: why the bank exists (2026-10-04)

## The one idea

Every bank carries a *mission* — a purpose statement rendered into the
reflect system prompt as "Mission: …". Disposition (lesson 16) is how the
bank reasons; directives (lesson 21) are what it must never do; mission is
what it is *for*. Three layers, composed in that order.

## What we built

`src/lesson22.ts`: `composePrompt()` builds `You are {name}. / Mission:
{mission} / Disposition: … / Directives: …` — the same composition the real
system does (mission first, directives last). Demo: two banks, same evidence,
different missions ("track employment status accurately" vs "write a warm
newsletter") — the composed prompts diverge, and keyed, the answers would
diverge with them.

## Grounded in the real Hindsight

Verified: banks are created with (bank_id, name, mission, disposition); the
reflect prompt builder renders "Mission: {mission}" (with a default role when
absent) and composes the final system prompt as
build_final_system_prompt(mission, …, directives).

## Try it

```
bun run lesson22
OPENAI_API_KEY=... bun run lesson22
```

Keyed, ask both banks "What changed for Alice?" — the tracker states the
fact dryly, the newsletter wraps it warmly. Same memory, different purpose.
