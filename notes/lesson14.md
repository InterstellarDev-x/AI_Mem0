# Lesson 14 — Banks: the multi-tenant boundary (2026-10-03)

## The one idea

Memory is always scoped. One engine serves many isolated stores; every
retain/recall/reflect carries a bank_id, and nothing — facts, observations,
consolidation, mental models — ever crosses a bank boundary. And the bank id
alone isn't the identity: it's the (tenant, bank) pair. Two tenants can both
have a bank called "work" and never see each other's memories.

## What we built

`src/lesson14.ts`: `BankEngine` maps `"tenant/bank"` → an isolated lesson-13
`Engine` (imported, not rewritten). Every operation resolves its bank first —
unknown bank → refused, there is no unscoped path. `deleteBank` drops the
whole store: facts, observations, models. The boundary is structural (each
bank owns its Memory), not a filter applied after the fact.

## What it shows

Run `bun run lesson14`. Three banks, three different Alices: acme/work
knows the Google engineer, acme/personal knows the hiker, globex/work knows
the Globex backend engineer — same bank name "work", zero leakage across
tenants. `recall(acme, "nope", …)` is refused. Deleting acme/personal leaves
acme/work untouched.

## Grounded in the real Hindsight

Verified in engine/memory_engine.py: bank_id is the first argument of
retain, recall, and reflect — every call is bank-scoped. Config resolves
"env -> tenant -> bank". Isolation is by pair: "The key must sit under this
bank in the caller's own tenant: object stores share one bucket across
tenants, so authorizing the bank id alone would let a same-named bank in
another tenant read this one's files." Banks are rows — operations lock
them, and deleting the bank deletes its memories.

## What's next

Lesson 15: forgetting — deletion, retraction, and why "delete" is a
first-class operation, not an afterthought.

## Try it

```
bun run lesson14
```

Retain "Alice quit Google." into acme/work and recall it: watch one bank's
belief get contradicted while the other two Alices stay exactly as they were.
