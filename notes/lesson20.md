# Lesson 20 — Production: Postgres + pgvector, monitoring, webhooks, Cloud (2026-10-03)

## The one idea

Production is the same engine with three additions — *durable* storage (the
memory survives restarts), *observable* behavior (structured logs + health),
and *event hooks* (the outside world can subscribe to what happens inside).
Nothing about retain/recall/reflect changes; what changes is the contract
around them. Hindsight Cloud is this, hosted.

## What we built

`src/lesson20.ts`: `ProductionMemory` over lesson 13's Engine.
- **Durability** via a write-ahead log: every retain appends a JSON line;
  `ProductionMemory.open()` replays the log on boot with original
  timestamps. (Postgres is the real thing; the WAL is the idea.)
- **Monitoring** via structured JSON log lines (`ts`, `severity`, `event`,
  latency) and a `health()` snapshot (status, uptime, facts, observations,
  subscriptions).
- **Webhooks** via `on(event, url)` subscriptions with fire-and-forget POST
  delivery and logged delivery failures. Event names mirror Hindsight's:
  `retain.completed`, `consolidation.completed`.

The demo: boot 1 retains twice (logs + 2 webhook deliveries to a local
receiver), boot 2 "restarts" and replays the WAL — 2 facts, 2 observations
restored, recall working. The demo also caught a real bug: the log payload's
`event` field collided with the log line's `event` name — renamed to
`webhookEvent`. Production is where field collisions become incidents.

## Grounded in the real Hindsight

Verified: per-bank HNSW indexes on pgvector (`USING hnsw (embedding
vector_cosine_ops)`; DiskANN for pgvectorscale, vchordrq for vchord) via
Alembic migrations; webhook event types `consolidation.completed`,
`retain.completed`, `memory_defense.triggered` with `HINDSIGHT_API_WEBHOOK_*`
config and SSRF hardening (private ranges blocked unless allowlisted — our
localhost receiver would need an allowlist entry on the real system);
structured JSON logging with severity fields for GCP/CloudWatch.

## The arc, complete

1–2: memory is a list + a search function; words have weight. 3–5: meaning
via embeddings, BM25, hybrid RRF. 6–8: rerank, time, graphs. 9: the retain
pipeline. 10–12: consolidation, belief refinement, pinned mental models.
13: the engine. 14: banks. 15: forgetting. 16: the reflect loop with a
disposition. 17: the LLM wrapper. 18: the MCP server. 19: per-repo project
memory. 20: production. Twenty lessons, one idea each, every claim about
Hindsight verified against its source.

## Try it

```
bun run lesson20
```

Kill the process mid-demo and re-run: the WAL is in /tmp/lesson20-mem.wal —
but a fresh boot unlinks it first. Change the demo to *not* unlink, kill -9
it between the two retains, and watch boot 2 recover exactly what survived.
That's the durability contract, tested the honest way.
