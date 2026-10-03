// Lesson 22: Bank mission — why the bank exists.
//
// The one idea: every bank carries a *mission* — a purpose statement
// rendered into the reflect system prompt as "Mission: …". Disposition
// (lesson 16) is how the bank reasons; directives (lesson 21) are what it
// must never do; mission is what it is *for*. Together they compose the
// bank's character: mission first, then disposition, then directives.
//
// Grounded in the real Hindsight: banks are created with (bank_id, name,
// mission, disposition); the reflect prompt builder renders the mission
// ("Mission: {mission}", with a default role when absent) and the final
// system prompt is composed as build_final_system_prompt(mission, …,
// directives). Our version composes the same three layers over lesson 13's
// Engine and prints the composed prompt so the layering is visible. Keyed,
// gpt-6-luna answers inside all three; keyless, the composition is the demo.
//
// Run it:
//
//     bun run lesson22
//     OPENAI_API_KEY=... bun run lesson22   # the model reasons inside the mission

import { Engine } from "./lesson13.ts";
import OpenAI from "openai";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-6-luna";

interface BankProfile {
  name: string;
  mission: string; // why this bank exists
  disposition: string; // how it reasons (lesson 16)
  directives: string[]; // what it must never do (lesson 21)
}

function composePrompt(p: BankProfile): string {
  const lines = [`You are ${p.name}.`, `Mission: ${p.mission || "Answer questions from memory."}`];
  if (p.disposition) lines.push(`Disposition: ${p.disposition}`);
  if (p.directives.length > 0) {
    lines.push("Directives (hard rules):");
    for (const d of p.directives) lines.push(`- ${d}`);
  }
  return lines.join("\n");
}

let openai: OpenAI | null = null;
function llm(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  openai ??= new OpenAI({ baseURL: process.env.OPENAI_API_BASE });
  return openai;
}

async function demo(): Promise<void> {
  const engine = new Engine();
  const D = (s: string): Date => new Date(s + "T00:00:00Z");
  await engine.retain("Alice left Google last week.", D("2026-10-01"));
  await engine.retain("The team ships every Friday.", D("2026-09-01"));

  const banks: BankProfile[] = [
    {
      name: "team-tracker",
      mission: "Track the team's employment status accurately and without speculation.",
      disposition: "skeptical: flag uncertainty, never state guesses as fact.",
      directives: ["Never reveal anyone's phone number."],
    },
    {
      name: "newsletter",
      mission: "Help write a warm, upbeat team newsletter.",
      disposition: "empathetic: consider emotional context.",
      directives: [],
    },
  ];

  for (const b of banks) {
    console.log(`\n--- bank "${b.name}" ---`);
    console.log(composePrompt(b).split("\n").map((l) => `  ${l}`).join("\n"));
    const client = llm();
    const hits = engine.recall("What changed for Alice?", 3);
    if (client) {
      const res = await client.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: composePrompt(b) },
          {
            role: "user",
            content: `Question: What changed for Alice?\nMemories:\n${hits.map((h) => `- ${h.text}`).join("\n")}`,
          },
        ],
      });
      console.log(`  answer: ${res.choices[0]?.message.content?.trim()}`);
    } else {
      console.log(`  [keyless: the mission shapes the prompt above; a model would reason inside it]`);
      console.log(`  evidence: ${hits.map((h) => h.text).join(" ")}`);
    }
  }

  console.log("\nMission is the why, disposition the how, directives the never.");
  console.log("Three layers, one prompt, composed in that order.");
}

if (import.meta.main) {
  await demo();
}
