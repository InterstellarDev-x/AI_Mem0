// Lesson 5: Hybrid retrieval — run semantic + BM25 in parallel, fuse with RRF.
//
// The one idea: lessons 3 and 4 produce *incomparable* scores — a cosine in
// [-1, 1] and a BM25 score that is unbounded positive. You cannot add 0.766
// to 2.764 and mean anything. Reciprocal Rank Fusion sidesteps the problem
// entirely: it throws the scores away and fuses *ranks*.
//
//   RRF(d) = Σ_over_arms  1 / (k + rank(d)),   k = 60
//
// Ranks are always comparable. A document ranked #1 by both arms outscores
// one ranked #1 by a single arm; a document liked by both arms beats one
// loved by one and ignored by the other. k = 60 (Hindsight's default)
// dampens the gap between close ranks, so fusion is robust, not twitchy.
//
// Grounded in the real Hindsight (engine/search/fusion.py): RRF over the
// arms [semantic, bm25, graph, temporal], each arm capped per-source before
// fusion so one backend can't crowd out the others. We run 2 of the 4 arms
// here; graph (lesson 8) and temporal (lesson 7) join later.
//
// Run it:
//
//     bun install    # once — pulls @xenova/transformers
//     bun run lesson5

import { pipeline } from "@xenova/transformers";

interface Fact {
  content: string;
  at: string;
}

interface Fused {
  fact: Fact;
  score: number; // RRF score
  semRank: number | null; // 1-based rank in the semantic arm
  keyRank: number | null; // 1-based rank in the keyword arm
}

// ---------- semantic arm (lesson 3) ----------
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
  return dot; // inputs are normalized
}

// ---------- keyword arm (lesson 4) ----------
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

// ---------- fusion ----------
const RRF_K = 60; // Hindsight's default (engine/search/fusion.py)
const ARM_CAP = 5; // per-arm cap before fusion, like Hindsight's cap_per_source

/** Best-first order of fact indexes for a score array. */
function rankOf(scores: number[]): number[] {
  return scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s)
    .map(({ i }) => i);
}

/**
 * Reciprocal Rank Fusion over ranked index lists. Raw scores are never
 * mixed — only 1-based ranks feed the formula.
 */
function rrf(rankedLists: number[][], k = RRF_K): Map<number, number> {
  const scores = new Map<number, number>();
  for (const list of rankedLists) {
    list.forEach((index, r) => {
      scores.set(index, (scores.get(index) ?? 0) + 1 / (k + (r + 1)));
    });
  }
  return scores;
}

class Memory {
  private facts: Fact[] = [];
  private vectors: number[][] = [];
  private docs: string[][] = [];

  async retain(content: string): Promise<void> {
    this.facts.push({ content, at: new Date().toISOString() });
    this.vectors.push(await embed(content)); // semantic arm: write path
    this.docs.push(tokenize(content)); // keyword arm: write path
  }

  /** Both arms in parallel, fused by rank. Per-arm ranks ride along, the way
   *  Hindsight's MergedCandidate carries source_ranks. */
  async recall(query: string, k = 3): Promise<Fused[]> {
    const qv = await embed(query);
    const semRank = rankOf(this.vectors.map((v) => cosine(qv, v)));
    const keyRank = rankOf(bm25Scores(this.docs, query));

    const semPos = new Map(semRank.map((idx, r) => [idx, r + 1]));
    const keyPos = new Map(keyRank.map((idx, r) => [idx, r + 1]));
    const fused = rrf([
      semRank.slice(0, ARM_CAP),
      keyRank.slice(0, ARM_CAP),
    ]);

    return [...fused.entries()]
      .map(([index, score]) => ({
        fact: this.facts[index]!,
        score,
        semRank: semPos.get(index) ?? null,
        keyRank: keyPos.get(index) ?? null,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** Native per-arm scores, for the demo's side-by-side. */
  async armScores(query: string): Promise<{ sem: number[]; key: number[] }> {
    const qv = await embed(query);
    return {
      sem: this.vectors.map((v) => cosine(qv, v)),
      key: bm25Scores(this.docs, query),
    };
  }

  get size(): number {
    return this.facts.length;
  }
}

async function demo(): Promise<void> {
  const m = new Memory();
  const seed = [
    "Alice works at Google as a software engineer",
    "Alice loves hiking in Yosemite",
    "Bob is Alice's manager",
    "Bob likes chess",
    "Alice prefers tea over coffee",
    "chess club weekly chess puzzles chess books and more chess",
    "Alice's team ships the new search ranking model",
    "Bob manages the chess club tournament",
  ];
  for (const s of seed) await m.retain(s);

  const q = "Alice's boss";
  console.log(`Q: ${q}\n`);

  const { sem, key } = await m.armScores(q);
  const show = (label: string, scores: number[]) => {
    console.log(`${label} — native scores, different scales, do NOT add:`);
    rankOf(scores)
      .slice(0, 3)
      .forEach((i, r) => {
        console.log(
          `  #${r + 1}  ${scores[i]!.toFixed(3).padStart(6)}  ${seed[i]!.slice(0, 42)}`,
        );
      });
  };
  show("semantic arm (cosine)", sem);
  show("keyword arm (BM25)   ", key);

  console.log("\nRRF fused — ranks only, 1/(60+rank) per arm:");
  for (const f of await m.recall(q, 3)) {
    console.log(
      `  ${f.score.toFixed(4)}  (sem #${f.semRank}, bm25 #${f.keyRank})  ${f.fact.content.slice(0, 42)}`,
    );
  }
  console.log(
    "\nThe arms agree on #1 but split below it: semantic's #2 is the engineer",
  );
  console.log(
    "fact, BM25's #2 is the hiking fact. Fusion ranks the engineer fact",
  );
  console.log(
    "higher — liked by *both* arms (#2 and #3) — over hiking, loved by one",
  );
  console.log("and ignored by the other. Consensus wins. That is hybrid retrieval.");
}

await demo();
