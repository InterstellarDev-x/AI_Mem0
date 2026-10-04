# Lesson 26 — Memory defense: not everything deserves to be remembered (2026-10-04)

## The one idea

Retain is a trust boundary. Before anything enters the bank, a defense
policy screens it: ALLOW it in, REDACT the dangerous part, or BLOCK it
entirely. Memory poisoning — planting false memories or smuggling secrets
into the store — is stopped at the door, not cleaned up later.

## What we built

`src/lesson26.ts`: `DefendedBank` over lesson 13's Engine. Policy is a list
of {on, action} rules; detectors are sensitive_data (SSN / spaced or
contiguous card numbers / API keys with a lookbehind so `task-123` doesn't
false-positive) and prompt_injection (the classic override phrasings). The
screen runs before retain; redactions are marked ([REDACTED:SSN]) so the
bank never pretends it saw the original; blocked items never enter. Demo: a
smuggled secret is stored redacted, an injection attempt is blocked
outright, and recall proves the attack was never stored.

## Grounded in the real Hindsight

Verified in extensions/memory_defense.py and engine/retain/orchestrator.py:
DefenseAction = allow / redact / block; policy rules name a detector in
`on`; the OSS extension screens for sensitive_data while other detectors are
dispatched by loaded extensions; blocked items surface per-item, and a fully
blocked batch fails the retain.

## Try it

```
bun run lesson26
```

Flip the injection rule to redact and watch what happens: the attack text
stays, neutered — which is precisely why the real default is block. Some
threats you don't keep around in any form.
