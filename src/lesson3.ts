// Lesson 3: Recall by meaning — dense embeddings + cosine similarity.
//
// The one idea: lessons 1–2 matched *tokens*. "boss" never appears in the
// store, so no counter could ever link it to "manager". A dense embedding
// represents text as a vector where *meaning is direction* — paraphrases
// land close together even with zero shared words. Cosine similarity over
// those vectors retrieves by meaning, not spelling.
//
// We embed on the write path: retain() stores the vector alongside the fact
// (this mirrors Hindsight, which embeds documents as they are retained).
// Vectors are L2-normalized, so cosine similarity is just a dot product.
//
// The model is all-MiniLM-L6-v2, running locally via Transformers.js — real
// embeddings, no API key. (Hindsight's default is OpenAI text-embedding-3-small
// over HTTP; a local sentence-transformers model is its supported offline
// option. Same idea, different model.) First run downloads the model once
// (~90MB) and caches it. Set OPENAI_API_KEY to use text-embedding-3-small
// via the official SDK instead — the demo prints which embedder ran.
//
// Run it:
//
//     bun install    # once — pulls @xenova/transformers
//     bun run lesson3

import { pipeline } from "@xenova/transformers";
import OpenAI from "openai";

interface Fact {
  content: string;
  at: string;
  vector: number[]; // L2-normalized; dims depend on the embedder (see below)
}

interface Scored {
  fact: Fact;
  score: number;
}

type Extractor = Awaited<ReturnType<typeof pipeline>>;
let extractor: Extractor | null = null;
let openai: OpenAI | null = null;

/**
 * Embed text to a normalized dense vector. Two backends:
 * - OPENAI_API_KEY set → text-embedding-3-small via the official SDK
 *   (Hindsight's default; 1536 dims, L2-normalized here).
 * - otherwise → all-MiniLM-L6-v2 locally via Transformers.js (384 dims).
 * The lesson is identical either way; the demo prints which one ran.
 */
async function embed(text: string): Promise<number[]> {
  if (process.env.OPENAI_API_KEY) {
    openai ??= new OpenAI(); // reads OPENAI_API_KEY from env
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      encoding_format: "float",
    });
    const v = res.data[0]!.embedding;
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  }
  extractor ??= (await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
  )) as Extractor;
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}

function embedderName(): string {
  return process.env.OPENAI_API_KEY
    ? "openai text-embedding-3-small (1536 dims)"
    : "local all-MiniLM-L6-v2 (384 dims)";
}

/** Cosine similarity. Inputs are normalized, so this is just a dot product. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

class Memory {
  private facts: Fact[] = [];

  /** Keep something — and embed it now, so recall is just arithmetic. */
  async retain(content: string): Promise<void> {
    this.facts.push({
      content,
      at: new Date().toISOString(),
      vector: await embed(content),
    });
  }

  /** Rank by angle between meaning-vectors. No tokens are compared. */
  async recall(query: string, k = 3): Promise<Scored[]> {
    const qv = await embed(query);
    return this.facts
      .map((fact) => ({ fact, score: cosine(qv, fact.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

async function demo(): Promise<void> {
  console.log(`embedder: ${embedderName()}\n`);
  const m = new Memory();
  for (const s of [
    "Alice works at Google as a software engineer",
    "Alice loves hiking in Yosemite",
    "Bob is Alice's manager",
    "Bob likes chess",
    "Alice prefers tea over coffee",
  ]) {
    await m.retain(s);
  }

  // --- paraphrase with zero token overlap on the key word ---
  const q1 = "Alice's boss";
  console.log(`Q: ${q1}\n`);
  for (const { fact, score } of await m.recall(q1, 3)) {
    console.log(`  ${score.toFixed(3)}  ${fact.content}`);
  }
  console.log(
    "\n'boss' appears nowhere in the store. TF-IDF would give it zero weight",
  );
  console.log(
    "and tie every Alice fact on 'alice'. The embedding knows boss ≈ manager,",
  );
  console.log("so the right fact wins decisively. That is recall by meaning.");

  // --- the honest limit ---
  const q2 = "what is Alice's job?";
  console.log(`\nQ: ${q2}\n`);
  for (const { fact, score } of await m.recall(q2, 2)) {
    console.log(`  ${score.toFixed(3)}  ${fact.content}`);
  }
  console.log(
    "\nCloser than counting ever got ('job' is no longer invisible — 0.668),",
  );
  console.log(
    "but the small model still prefers 'manager' (0.745). Semantic similarity",
  );
  console.log(
    "is a signal, not a verdict. Production systems don't trust one signal —",
  );
  console.log("lesson 5 combines several (hybrid), lesson 6 double-checks (rerank).");
}

await demo();
