# Lesson 21 — Directives: hard rules, not learned beliefs (2026-10-04)

## The one idea

A directive is a *hard rule injected into prompts*. Mental models (lesson
12) are automatically consolidated from memories; directives are explicit
user instructions, always included in relevant prompts, and the reflect
agent checks compliance before it may call done. Learned vs. instructed.

## What we built

`src/lesson21.ts`: `DirectiveBank` over lesson 13's Engine. Directives are
added/removed by the user, rendered into the reflect prompt ("obey even if
memory suggests otherwise"), and enforced by a compliance gate on the draft
answer. Keyed, gpt-6-luna does the compliance check as Hindsight does;
keyless, rule tests stand in. Demo: the bank *knows* the office phone number
but the directive "Never reveal anyone's phone number" blocks it — while an
unrelated question passes straight through.

## Grounded in the real Hindsight

Verified in engine/directives/models.py: "A directive is a hard rule
injected into prompts… Unlike mental models which are automatically
consolidated from memories, directives are explicit instructions that are
always included in relevant prompts." The reflect agent extracts directive
rules and runs a compliance confirmation on done.

## Try it

```
bun run lesson21
OPENAI_API_KEY=... bun run lesson21   # the model enforces the directives
```

Add a directive the rules can't test ("Always answer in formal English") and
run it keyed — watch the compliance gate catch what regex never could.
