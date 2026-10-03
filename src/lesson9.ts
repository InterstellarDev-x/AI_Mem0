// Lesson 9: retain ≠ append — normalize on write.
//
// The one idea: everything so far appended raw input to the store. But raw
// input is messy — "Alice", "alice" and "Alice's" are three strings for one
// entity; "Alice works at Google." retained twice is one fact stored twice;
// "She started at Google" names nobody. The write path is where quality is
// made: split input into atomic facts, canonicalize entities, drop
// duplicates — so the read path stays simple. One fact, one place.
//
// Grounded in the real Hindsight (README): "retain uses an LLM to extract
// key facts, temporal data, entities, and relationships. It passes these
// through a normalization process to transform extracted data into canonical
// entities, time series, and search indexes." Our extractor is rule-based by
// default; set OPENAI_API_KEY and it uses gpt-4o-mini instead — run both and
// feel *why* the retain path wants an LLM.
//
// What we implement (the mechanics, engine-agnostic):
//   1. split    — one input → atomic facts (sentences)
//   2. extract  — entities per fact (rules, or LLM with coreference)
//   3. canon    — "Alice's" → "alice" (one name, one place)
//   4. dedupe   — normalized-equal facts stored once
//
// Semantic merging ("these two facts say the same thing") is NOT dedup —
// that's consolidation's job (lesson 10). This lesson is the cheap,
// mechanical hygiene before it.
//
// Run it:
//
//     bun run lesson9
//     OPENAI_API_KEY=... bun run lesson9   # compare the LLM extractor

interface Fact {
  content: string; // normalized text
  at: Date;
  entities: string[]; // canonical
}

interface Extracted {
  text: string;
  entities: string[]; // raw, as found
}

/** Split input into atomic facts. Sentences are a crude but honest atom. */
function splitFacts(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Crude entity extraction: capitalized phrases. Wrong in known ways. */
function ruleEntities(text: string): string[] {
  const found = new Set<string>();
  const re = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(m[0]);
  return [...found];
}

/** Canonical form: lowercase, possessives stripped, whitespace collapsed. */
function canonEntity(e: string): string {
  return e
    .toLowerCase()
    .replace(/'s$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonFactText(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
}

interface Extractor {
  name: string;
  extract(text: string, ref: Date): Promise<Extracted[]>;
}

const rulesExtractor: Extractor = {
  name: "rules (capitalized phrases, no coreference)",
  extract: async (text: string): Promise<Extracted[]> =>
    splitFacts(text).map((t) => ({ text: t, entities: ruleEntities(t) })),
};

import OpenAI from "openai";

/** LLM extractor — only used when OPENAI_API_KEY is set. Falls back to rules
 *  on any failure, and says so. */
async function llmExtractor(): Promise<Extractor | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const client = new OpenAI(); // reads OPENAI_API_KEY from env
  return {
    name: "gpt-4o-mini (coreference + canonical names)",
    extract: async (text: string, ref: Date): Promise<Extracted[]> => {
      const res = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Split the input into atomic facts. For each fact return its text, the entities involved using ONE canonical name per entity (resolve pronouns like 'she'/'her' and aliases to the canonical name), and when it happened. " +
              'Return JSON: {"facts": [{"text": "...", "entities": ["alice", "google"], "when": "2026-06-01 or null"}]}.',
          },
          {
            role: "user",
            content: `Reference date: ${ref.toISOString().slice(0, 10)}. Text: ${text}`,
          },
        ],
      });
      const content = res.choices[0]?.message.content;
      if (!content) throw new Error("empty response");
      const parsed = JSON.parse(content) as {
        facts: { text: string; entities: string[] }[];
      };
      return parsed.facts.map((f) => ({
        text: f.text,
        entities: f.entities ?? [],
      }));
    },
  };
}

class Memory {
  private facts: Fact[] = [];
  private seen = new Set<string>(); // normalized texts — the dedup index
  private entityIndex = new Map<string, number[]>(); // canonical entity → fact ids

  constructor(private extractor: Extractor) {}

  /** The write pipeline: split → extract → canonicalize → dedupe → store. */
  async retain(input: string, at: Date = new Date()): Promise<void> {
    let items: Extracted[];
    try {
      items = await this.extractor.extract(input, at);
    } catch (e) {
      console.log(
        `  [extractor failed (${(e as Error).message}) — falling back to rules]`,
      );
      items = await rulesExtractor.extract(input, at);
    }
    for (const item of items) {
      const norm = canonFactText(item.text);
      if (this.seen.has(norm)) {
        console.log(`  skip duplicate: "${item.text}"`);
        continue;
      }
      this.seen.add(norm);
      const entities = [...new Set(item.entities.map(canonEntity))].filter(
        (e) => e.length > 1,
      );
      const id = this.facts.length;
      this.facts.push({ content: item.text.trim(), at, entities });
      for (const e of entities) {
        const list = this.entityIndex.get(e) ?? [];
        list.push(id);
        this.entityIndex.set(e, list);
      }
      console.log(
        `  stored #${id}: "${item.text.trim()}"  [${entities.join(", ")}]`,
      );
    }
  }

  /** Entity lookup — the read path stays trivial because the write path
   *  did the work. */
  byEntity(entity: string): Fact[] {
    return (this.entityIndex.get(canonEntity(entity)) ?? []).map(
      (i) => this.facts[i]!,
    );
  }

  dump(): void {
    console.log(`\nstore: ${this.facts.length} facts`);
    for (const [e, ids] of this.entityIndex) {
      console.log(`  entity "${e}" → facts [${ids.join(", ")}]`);
    }
  }
}

async function demo(): Promise<void> {
  const llm = await llmExtractor().catch(() => null);
  const extractor = llm ?? rulesExtractor;
  console.log(`extractor: ${extractor.name}\n`);

  const m = new Memory(extractor);
  const D = (s: string): Date => new Date(s + "T00:00:00Z");

  await m.retain("Alice works at Google.", D("2026-06-02"));
  await m.retain("Alice's role is software engineer.", D("2026-06-03"));
  await m.retain("Alice works at Google.", D("2026-06-04"));
  await m.retain("She started at Google last June. Bob is her manager.", D("2026-10-01"));
  m.dump();

  console.log('\nlookup "alice":');
  for (const f of m.byEntity("alice")) {
    console.log(`  "${f.content}"  [${f.entities.join(", ")}]`);
  }
  if (!llm) {
    console.log(
      "\nNote 'she'/'her' above: rules can't resolve pronouns — 'she' is stored",
    );
    console.log(
      "as its own entity. Set OPENAI_API_KEY and rerun to watch the LLM map",
    );
    console.log("them to alice. That gap is why Hindsight's retain path uses an LLM.");
  }
}

await demo();
