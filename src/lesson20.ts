// Lesson 20: Production — Postgres + pgvector, monitoring, webhooks, Cloud.
//
// The one idea: production is the same engine with three additions —
// *durable* storage (memory survives restarts), *observable* behavior
// (structured logs + health), and *event hooks* (the outside world can
// subscribe to what happens inside). Nothing about retain/recall/reflect
// changes; what changes is the contract around them. Hindsight Cloud is
// this, hosted.
//
// Grounded in the real Hindsight:
// - Postgres + pgvector with per-bank HNSW indexes
//   ("USING hnsw (embedding vector_cosine_ops)" — DiskANN for pgvectorscale,
//   vchordrq for vchord), schema managed by Alembic migrations.
// - Webhooks: event types consolidation.completed, retain.completed,
//   memory_defense.triggered; configured via HINDSIGHT_API_WEBHOOK_URL /
//   _SECRET / _EVENT_TYPES / _ALLOWED_HOSTS, SSRF-hardened (private ranges
//   blocked unless allowlisted — our demo's localhost receiver would need an
//   allowlist entry on the real system).
// - Monitoring: structured JSON logging with severity fields for GCP/
//   CloudWatch, plus health models.
//
// Our version: ProductionMemory over lesson 13's Engine. Durability via a
// write-ahead log — every retain is appended as a JSON line, and a restart
// replays the log (Postgres is the real thing; the WAL is the idea, and the
// replay keeps original timestamps). Monitoring via structured JSON log
// lines and a health() snapshot. Webhooks via event subscriptions with
// fire-and-forget POST delivery and logged delivery failures.
//
// Run it:
//
//     bun run lesson20

import { appendFileSync, existsSync, readFileSync, unlinkSync } from "fs";
import { Engine } from "./lesson13.ts";

type EventType = "retain.completed" | "consolidation.completed";

class ProductionMemory {
  readonly engine = new Engine();
  private webhooks = new Map<EventType, string[]>();
  private startedAt = Date.now();
  private replaying = false;

  private constructor(private walPath: string) {}

  /** Open (or create) the durable store; a restart replays the write-ahead log. */
  static async open(walPath: string): Promise<ProductionMemory> {
    const pm = new ProductionMemory(walPath);
    if (existsSync(walPath)) {
      pm.replaying = true;
      let n = 0;
      for (const line of readFileSync(walPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        let entry: { content: string; at: string };
        try {
          entry = JSON.parse(line);
        } catch {
          // Torn tail: a crash mid-append leaves a partial last line. A
          // production WAL skips the corrupt tail entry and recovers.
          pm.log("wal.torn_tail_skipped", { path: walPath, entriesRecovered: n });
          break;
        }
        await pm.engine.retain(entry.content, new Date(entry.at));
        n++;
      }
      pm.replaying = false;
      pm.log("wal.replayed", { path: walPath, entries: n });
    }
    return pm;
  }

  /** Structured log line — the monitoring story. */
  private log(event: string, data: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({ ts: new Date().toISOString(), severity: "INFO", event, ...data }));
  }

  /** Subscribe a URL to a memory event — the webhooks story. */
  on(event: EventType, url: string): void {
    const urls = this.webhooks.get(event) ?? [];
    urls.push(url);
    this.webhooks.set(event, urls);
    this.log("webhook.registered", { webhookEvent: event, url });
  }

  private emit(event: EventType, data: Record<string, unknown>): void {
    for (const url of this.webhooks.get(event) ?? []) {
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event, ts: new Date().toISOString(), data }),
      }).catch((e) => this.log("webhook.delivery_failed", { webhookEvent: event, url, error: String(e) }));
    }
  }

  async retain(content: string, at: Date = new Date()): Promise<void> {
    const t0 = Date.now();
    // Write-AHEAD: the intent hits the log before the engine applies it, so a
    // crash between the two replays the write instead of losing it.
    if (!this.replaying) {
      appendFileSync(this.walPath, JSON.stringify({ content, at: at.toISOString() }) + "\n");
    }
    const before = this.counts();
    await this.engine.retain(content, at);
    const after = this.counts();
    this.log("retain.completed", { content: content.slice(0, 60), latencyMs: Date.now() - t0 });
    this.emit("retain.completed", { content: content.slice(0, 60) });
    if (after.facts !== before.facts || after.observations !== before.observations) {
      this.emit("consolidation.completed", {
        facts: after.facts,
        observations: after.observations,
      });
    }
  }

  private counts(): { facts: number; observations: number } {
    const inner = (this.engine as unknown as {
      mem: { getFacts(): unknown[]; getObservations(): unknown[] };
    }).mem;
    return { facts: inner.getFacts().length, observations: inner.getObservations().length };
  }

  recall(query: string, k: number = 5) {
    const t0 = Date.now();
    const hits = this.engine.recall(query, k);
    this.log("recall.completed", { query, hits: hits.length, latencyMs: Date.now() - t0 });
    return hits;
  }

  /** The health story: uptime, store size, subscriptions. */
  health(): Record<string, unknown> {
    const inner = (this.engine as unknown as {
      mem: { getFacts(): unknown[]; getObservations(): unknown[] };
    }).mem;
    return {
      status: "ok",
      uptimeMs: Date.now() - this.startedAt,
      facts: inner.getFacts().length,
      observations: inner.getObservations().length,
      webhooks: [...this.webhooks.entries()].map(([event, urls]) => ({ event, urls: urls.length })),
    };
  }
}

async function demo(): Promise<void> {
  const WAL = "/tmp/lesson20-mem.wal";
  try {
    unlinkSync(WAL);
  } catch { /* fresh start */ }

  // a webhook receiver, standing in for the outside world
  const received: { event: string }[] = [];
  const receiver = Bun.serve({
    port: 0,
    async fetch(req) {
      received.push(await req.json());
      return new Response("ok");
    },
  });

  console.log("--- boot 1: retain, watch the logs, webhooks, and WAL ---");
  const pm = await ProductionMemory.open(WAL);
  pm.on("retain.completed", `http://localhost:${receiver.port}/hook`);
  await pm.retain("The prod deploy key lives in 1Password under 'prod-deploy'.");
  await pm.retain("Alice left Google last week.");
  console.log("health:", JSON.stringify(pm.health()));

  await new Promise((r) => setTimeout(r, 400)); // let fire-and-forget deliveries land
  console.log(`webhook deliveries received: ${received.length} (${received.map((r) => r.event).join(", ")})`);

  console.log("\n--- boot 2: the process 'restarts', the WAL replays ---");
  const pm2 = await ProductionMemory.open(WAL);
  console.log("health:", JSON.stringify(pm2.health()));
  console.log(
    "recall('deploy key') after restart:",
    pm2.recall("deploy key").map((h) => h.text),
  );

  receiver.stop();
  console.log("\nSame engine as lesson 13. Durable, observable, subscribed to. That's production.");
}

if (import.meta.main) {
  await demo();
}
