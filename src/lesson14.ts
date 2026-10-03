// Lesson 14: Banks — the multi-tenant boundary.
//
// The one idea: memory is always scoped. One engine serves many isolated
// stores; every retain/recall/reflect carries a bank_id, and nothing —
// facts, observations, consolidation, mental models — ever crosses a bank
// boundary. And the bank id alone isn't the identity: it's the
// (tenant, bank) pair. Two tenants can both have a bank called "work" and
// never see each other's memories.
//
// Grounded in the real Hindsight (engine/memory_engine.py):
// - Every engine call is bank-scoped: retain(bank_id, …), recall(bank_id,
//   …), reflect(bank_id, …). Bank id is always the first argument.
// - Config resolves "env -> tenant -> bank": a three-level hierarchy.
// - Isolation is by pair, not by name: "The key must sit under this bank in
//   the caller's own tenant: object stores share one bucket across tenants,
//   so authorizing the bank id alone would let a same-named bank in another
//   tenant read this one's files."
// - A bank is a row: operations lock it (SELECT … FOR NO KEY UPDATE),
//   and deleting the bank deletes its memories with it.
//
// Our version: BankEngine maps "tenant/bank" → an isolated lesson-13
// Engine. Unknown bank → the operation refuses (there is no unscoped
// operation). deleteBank drops the whole store. The boundary is structural:
// each bank has its own facts, its own observations, its own consolidation.
// The isolation is the lesson.
//
// Run it:
//
//     bun run lesson14

import { Engine, type Hit } from "./lesson13.ts";

class BankEngine {
  // The identity is the pair — never the bank id alone.
  private banks = new Map<string, Engine>();

  private key(tenant: string, bankId: string): string {
    return `${tenant}/${bankId}`;
  }

  createBank(tenant: string, bankId: string): void {
    const k = this.key(tenant, bankId);
    if (this.banks.has(k)) throw new Error(`bank ${k} already exists`);
    this.banks.set(k, new Engine());
    console.log(`created bank ${k}`);
  }

  /** Every operation resolves its bank first — there is no unscoped path. */
  private use(tenant: string, bankId: string): Engine {
    const e = this.banks.get(this.key(tenant, bankId));
    if (!e) throw new Error(`unknown bank ${this.key(tenant, bankId)} — every operation is bank-scoped`);
    return e;
  }

  retain(tenant: string, bankId: string, content: string, at: Date = new Date()): Promise<number[]> {
    return this.use(tenant, bankId).retain(content, at);
  }
  recall(tenant: string, bankId: string, query: string, k: number = 5): Hit[] {
    return this.use(tenant, bankId).recall(query, k);
  }
  reflect(tenant: string, bankId: string, question: string): Promise<string> {
    return this.use(tenant, bankId).reflect(question);
  }

  /** Deleting the bank deletes its memories with it. */
  deleteBank(tenant: string, bankId: string): void {
    const k = this.key(tenant, bankId);
    if (!this.banks.delete(k)) throw new Error(`unknown bank ${k}`);
    console.log(`deleted bank ${k} — its facts, observations, and models went with it`);
  }
}

async function demo(): Promise<void> {
  const e = new BankEngine();
  const D = (s: string): Date => new Date(s + "T00:00:00Z");

  e.createBank("acme", "work");
  e.createBank("acme", "personal");
  e.createBank("globex", "work"); // same bank NAME, different tenant

  await e.retain("acme", "work", "Alice works at Google as a software engineer.", D("2026-06-02"));
  await e.retain("acme", "personal", "Alice loves weekend hiking trips.", D("2026-06-03"));
  await e.retain("globex", "work", "Alice is a backend engineer at Globex.", D("2026-06-04"));

  const show = (tenant: string, bank: string) => {
    const hits = e.recall(tenant, bank, "Alice");
    console.log(`\nrecall(${tenant}/${bank}, "Alice"):`);
    for (const h of hits) console.log(`  [${h.kind} #${h.id}] ${h.text.slice(0, 80)}`);
  };
  show("acme", "work"); // → Google only
  show("acme", "personal"); // → hiking only
  show("globex", "work"); // → Globex only — "work" in another tenant sees nothing of acme's

  console.log("\nunscoped operation:");
  try {
    e.recall("acme", "nope", "Alice");
  } catch (err) {
    console.log(`  refused: ${(err as Error).message}`);
  }

  console.log("\ndelete acme/personal:");
  e.deleteBank("acme", "personal");
  try {
    e.recall("acme", "personal", "Alice");
  } catch (err) {
    console.log(`  ${(err as Error).message}`);
  }
  show("acme", "work"); // untouched

  console.log("\nOne engine, many stores. The boundary is structural — nothing crosses it:");
  console.log("not facts, not observations, not consolidation, not recall.");
}

if (import.meta.main) {
  await demo();
}
