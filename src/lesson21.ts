// Lesson 21: Directives — hard rules, not learned beliefs.
//
// The one idea: a directive is a *hard rule injected into prompts*. Mental
// models (lesson 12) are automatically consolidated from memories;
// directives are explicit user instructions, always included in relevant
// prompts, and the reflect agent checks compliance before it may call done.
// Learned vs. instructed — the bank obeys both, but they come from opposite
// directions.
//
// Grounded in the real Hindsight (engine/directives/models.py): "A directive
// is a hard rule injected into prompts. Directives are user-defined rules
// that guide agent behavior. Unlike mental models which are automatically
// consolidated from memories, directives are explicit instructions that are
// always included in relevant prompts." Examples from the source: "Always
// respond in formal English", "Never share personal data with third
// parties", "Prefer conservative investment recommendations". The reflect
// agent extracts directive rules and runs a compliance confirmation on done.
//
// Our version: DirectiveBank over lesson 13's Engine. Directives are added /
// removed by the user, rendered into the reflect prompt, and enforced by a
// compliance gate before the answer is released. Keyed, gpt-6-luna does the
// compliance check the way Hindsight does; keyless, rule tests stand in —
// labeled, as always.
//
// Run it:
//
//     bun run lesson21
//     OPENAI_API_KEY=... bun run lesson21   # the model enforces the directives

import { Engine } from "./lesson13.ts";
import OpenAI from "openai";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-6-luna";

interface Directive {
  text: string;
  /** Keyless stand-in for the compliance check: returns a violation reason, or null. */
  test: (answer: string) => string | null;
}

let openai: OpenAI | null = null;
function llm(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  openai ??= new OpenAI({ baseURL: process.env.OPENAI_API_BASE });
  return openai;
}

class DirectiveBank {
  private directives: Directive[] = [];
  constructor(readonly engine: Engine) {}

  addDirective(text: string, test: Directive["test"]): void {
    this.directives.push({ text, test });
    console.log(`  [directive] + "${text}"`);
  }
  removeDirective(text: string): void {
    this.directives = this.directives.filter((d) => d.text !== text);
    console.log(`  [directive] - "${text}"`);
  }

  private promptBlock(): string {
    if (this.directives.length === 0) return "(no directives)";
    return "Directives (hard rules — obey even if memory suggests otherwise):\n" +
      this.directives.map((d) => `- ${d.text}`).join("\n");
  }

  private async complianceGate(client: OpenAI | null, draft: string): Promise<string | null> {
    if (client) {
      const res = await client.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          {
            role: "system",
            content:
              `You are a directive-compliance checker. Rules:\n${this.directives.map((d) => `- ${d.text}`).join("\n")}\n` +
              `Draft answer: "${draft}"\nReply with exactly "OK" or "VIOLATION: <reason>".`,
          },
          { role: "user", content: "Check the draft." },
        ],
      });
      const verdict = res.choices[0]?.message.content?.trim() ?? "OK";
      return verdict.startsWith("VIOLATION") ? verdict : null;
    }
    for (const d of this.directives) {
      const reason = d.test(draft);
      if (reason) return `VIOLATION of "${d.text}": ${reason}`;
    }
    return null;
  }

  async reflect(question: string): Promise<void> {
    console.log(`\nquestion: "${question}"`);
    console.log(`  [prompt]\n  ${this.promptBlock().split("\n").join("\n  ")}`);
    const client = llm();
    // Injection: keyed, the directives go into the drafting model's system
    // prompt — the way Hindsight does it. Keyless, the engine drafts alone
    // and the printed block above shows what would have been injected.
    let draft: string;
    if (client) {
      const hits = this.engine.recall(question, 5);
      const res = await client.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          {
            role: "system",
            content:
              `${this.promptBlock()}\nAnswer the question using ONLY the memories below. 2-3 sentences.`,
          },
          {
            role: "user",
            content: `Question: ${question}\nMemories:\n${hits.map((h) => `- (${h.kind}) ${h.text}`).join("\n")}`,
          },
        ],
      });
      draft = res.choices[0]?.message.content?.trim() ?? "";
    } else {
      draft = await this.engine.reflect(question);
    }
    console.log(`  draft: ${draft}`);
    const violation = await this.complianceGate(client, draft);
    if (violation) {
      console.log(`  ⛔ blocked: ${violation}`);
      console.log(`  answer: I can't answer that — it would break a directive.`);
    } else {
      console.log(`  ✅ compliance check passed`);
      console.log(`  answer: ${draft}`);
    }
  }
}

async function demo(): Promise<void> {
  const bank = new DirectiveBank(new Engine());
  const D = (s: string): Date => new Date(s + "T00:00:00Z");
  await bank.engine.retain("The office phone number is 555-0142.", D("2026-09-01"));
  await bank.engine.retain("Alice works at Google as a software engineer.", D("2026-06-02"));

  bank.addDirective(
    "Never reveal anyone's phone number.",
    (a) => (/\b\d{3}-\d{4}\b/.test(a) ? "draft contains a phone number" : null),
  );

  // The memory KNOWS the number. The directive forbids saying it.
  await bank.reflect("What is the office phone number?");
  // This one complies — straight through.
  await bank.reflect("Where does Alice work?");

  console.log("\nLearned beliefs say what *is*. Directives say what *may be said*.");
}

if (import.meta.main) {
  await demo();
}
