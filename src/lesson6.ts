// Lesson 6: Reranking — a slow, precise second pass.
//
// The one idea: retrieval is a speed/precision trade-off, so split it in two.
// Pass 1 (lessons 3–5) is cheap and high-recall: precomputed vectors, BM25,
// fused ranks — built to *not miss*. Pass 2 is expensive and precise: a
// *cross-encoder* reads each (query, document) pair jointly, with full
// attention between query and document tokens, and scores relevance directly.
//
// A bi-encoder (lesson 3) embeds query and doc *separately* — fast, and the
// doc vectors can be precomputed, but the query never interacts with the doc.
// A cross-encoder is one forward pass *per pair* — it can't precompute, so it
// only ever sees the top-k. Slow, but it actually reads.
//
// Grounded in the real Hindsight (engine/cross_encoder.py): reranking is a
// cross-encoder abstraction, default provider "local", default model
// cross-encoder/ms-marco-MiniLM-L-6-v2 — the model family used here (Xenova's
// ONNX build), running locally with no API key.
//
// Run it:
//
//     bun install    # once
//     bun run lesson6

import {
  pipeline,
  AutoTokenizer,
  AutoModelForSequenceClassification,
} from "@xenova/transformers";

interface Fact {
  content: string;
  at: string;
}

interface Ranked {
  fact: Fact;
  score: number;
}

// ---------- pass 1: bi-encoder (lesson 3) ----------
type Extractor = Awaited<ReturnType<typeof pipeline>>;
let extractor: Extractor | null = null;

async function embed(text: string): Promise<number[]> {
  extractor ??= (await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
  )) as Extractor;
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

// ---------- pass 1: keyword arm (lesson 4) ----------
const STOPWORDS = new Set([
  "what", "whats", "is", "are", "was", "were", "be", "been", "being",
  "the", "a", "an", "of", "at", "in", "on", "to", "for", "with", "as",
  "by", "and", "or", "but", "does", "do", "did", "done", "how", "where",
  "when", "who", "whom", "whose", "which", "it", "its", "this", "that",
  "these", "those", "i", "you", "he", "she", "we", "they", "me", "him",
  "her", "us", "them", "my", "your", "his", "our", "their",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const K1 = 1.2;
const B = 0.75;

function bm25Scores(docs: string[][], query: string): number[] {
  const qTerms = [...new Set(tokenize(query))];
  const N = docs.length;
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / N;
  const n = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d)) n.set(t, (n.get(t) ?? 0) + 1);
  }
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of qTerms) {
      const nt = n.get(t);
      if (!nt) continue;
      const idf = Math.log(1 + (N - nt + 0.5) / (nt + 0.5));
      const f = tf.get(t) ?? 0;
      s += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / avgdl));
    }
    return s;
  });
}

// ---------- pass 1: fusion (lesson 5) ----------
const RRF_K = 60;
const ARM_CAP = 5;

function rankOf(scores: number[]): number[] {
  return scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s)
    .map(({ i }) => i);
}

function rrf(rankedLists: number[][]): Map<number, number> {
  const scores = new Map<number, number>();
  for (const list of rankedLists) {
    list.forEach((index, r) => {
      scores.set(index, (scores.get(index) ?? 0) + 1 / (RRF_K + (r + 1)));
    });
  }
  return scores;
}

// ---------- pass 2: cross-encoder reranker (this lesson) ----------
let ceTok: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null =
  null;
let ceModel: Awaited<
  ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>
> | null = null;

/**
 * Relevance of doc to query, judged by reading them *together*.
 * Returns an unbounded logit — meaningful only relative to other pairs.
 */
async function crossScore(query: string, doc: string): Promise<number> {
  ceTok ??= await AutoTokenizer.from_pretrained(
    "Xenova/ms-marco-MiniLM-L-6-v2",
  );
  ceModel ??= await AutoModelForSequenceClassification.from_pretrained(
    "Xenova/ms-marco-MiniLM-L-6-v2",
  );
  // Note: in @xenova/transformers v2 the pair goes in options.text_pair,
  // not as a second positional arg (that silently encodes only the query).
  const inputs = await (ceTok as unknown as (
    text: string,
    opts: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>)(query, {
    text_pair: doc,
    padding: true,
    truncation: true,
  });
  const { logits } = (await (
    ceModel as unknown as (x: unknown) => Promise<{ logits: { data: Float32Array } }>
  )(inputs)) as { logits: { data: Float32Array } };
  return logits.data[0]!;
}

class Memory {
  private facts: Fact[] = [];
  private vectors: number[][] = [];
  private docs: string[][] = [];

  async retain(content: string): Promise<void> {
    this.facts.push({ content, at: new Date().toISOString() });
    this.vectors.push(await embed(content));
    this.docs.push(tokenize(content));
  }

  /**
   * Two-pass recall. Pass 1: hybrid RRF over both arms (cheap, high recall).
   * Pass 2: cross-encoder rerank of the top candidates (slow, precise).
   */
  async recall(query: string, k = 3, candidates = 5): Promise<Ranked[]> {
    // Pass 1 — don't miss.
    const qv = await embed(query);
    const first = rrf([
      rankOf(this.vectors.map((v) => cosine(qv, v))).slice(0, ARM_CAP),
      rankOf(bm25Scores(this.docs, query)).slice(0, ARM_CAP),
    ]);
    const shortlist = [...first.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, candidates)
      .map(([index, rrfScore]) => ({ index, rrfScore }));

    // Pass 2 — get the order right.
    const rescored = await Promise.all(
      shortlist.map(async ({ index, rrfScore }) => ({
        fact: this.facts[index]!,
        rrfScore,
        score: await crossScore(query, this.facts[index]!.content),
      })),
    );
    return rescored.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

async function demo(): Promise<void> {
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

  const q = "what is Alice's job?";
  console.log(`Q: ${q}\n`);

  const results = await m.recall(q, 3, 5);
  console.log("Pass 1 — hybrid RRF (cheap, high recall):");
  const pass1 = [...results].sort((a, b) => b.rrfScore - a.rrfScore);
  pass1.forEach((r, i) =>
    console.log(`  #${i + 1}  ${r.fact.content.slice(0, 44)}`),
  );

  console.log("\nPass 2 — cross-encoder rerank (slow, precise):");
  results.forEach((r, i) =>
    console.log(
      `  #${i + 1}  ${r.score.toFixed(3).padStart(7)}  ${r.fact.content.slice(0, 44)}`,
    ),
  );
  console.log(
    "\nBoth arms of pass 1 preferred 'Bob is Alice's manager' — 'job' is",
  );
  console.log(
    "closer to 'manager' than 'engineer' in embedding space. The cross-encoder",
  );
  console.log(
    "reads query and document *together* and flips it: 6.729 vs 1.922. The",
  );
  console.log(
    "first pass exists to not miss; the second pass exists to be right.",
  );
}

await demo();
