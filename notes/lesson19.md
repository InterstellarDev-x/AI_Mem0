# Lesson 19 — Coding-agent integration: per-repo project memory (2026-10-03)

## The one idea

A coding agent's memory is scoped to the *repo*. Git history and past
sessions flow into the repo's bank automatically in the background; every
new session starts with the repo's curated knowledge pages plus recalled
context injected up front. The premise (Hindsight's own): most of a fix is
derivable from the code, but the last mile hinges on a project-specific
decision that isn't in the code at all — a rounding rule, a retry allowlist,
a tie-break policy. Those decisions live in git history and past
conversations.

## What we built

`src/lesson19.ts`: `RepoMemory` over lesson 13's Engine. `ingestGitHistory()`
is the background job (here one call; in real life a daemon) — it retains
this repo's own git log, so the demo dogfoods itself. `onSessionStart(task)`
injects knowledge pages (architecture, conventions, in-flight — Hindsight's
curated pages) plus recall for the task; `onStop(summary)` writes the session
back. The demo: session 1 asks about the OpenAI integration → the two real
commits surface; session 2 asks what the last session was about → the
write-back note surfaces. No setup command was run.

## Two honest findings from building it

1. Lesson 13's `toks` didn't strip stopwords, so the glue word "for" (rare
   across docs → high idf) outscored real content words. Fixed with the
   stopword list from lesson 2 — glue words carry no signal, as lesson 2
   taught. All lessons 11–18 re-run green.
2. The rules-path consolidation groups by first entity, so the 15 "Lesson
   N:" commits merged into one observation (first entity "Lesson" for all of
   them). A keyed run with the LLM extractor would keep them distinct —
   documented coarseness of the rules path, not a flaw in the integration.
   The demo asks questions the store answers correctly.

## Grounded in the real Hindsight

Verified in hindsight-integrations/coding-agents: one package, many agents
(Claude Code, Codex, opencode, Cursor, Copilot CLI, …) — a shared
reflect-and-inject core with a thin entry point per agent; ingestion "fully
automatic… a repo's git history and conversations flow into its memory bank
in the background as you work"; hooks on SessionStart / UserPromptSubmit /
Stop for injection and write-back; curated knowledge pages (architecture,
conventions, in-flight initiatives) that future sessions start from.

## What's next

Lesson 20: production — Postgres + pgvector, monitoring, webhooks, Cloud.
The last one.

## Try it

```
bun run lesson19
```

Point `ingestGitHistory` at any repo you own and ask it what it did last
month. Then add a fourth knowledge page — "Gotchas" — and watch every future
session start with your hard-won lessons instead of re-learning them.
