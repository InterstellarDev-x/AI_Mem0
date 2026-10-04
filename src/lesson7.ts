// Lesson 7: Time — the temporal arm.
//
// The one idea: everything so far retrieves by *content*. But "what did
// Alice do in June?" is a question about *when*, and no embedding or BM25
// score knows what "June" means. So time becomes a first-class retrieval
// dimension: stamp every fact at retain, extract a time window from the
// query at recall, and run a temporal arm — in-window facts, newest first —
// fused with the other arms via RRF.
//
// Grounded in the real Hindsight: recall has four arms — semantic, BM25,
// graph, temporal (engine/memories/base.py: `RecallArms`). The temporal arm
// is empty unless a window was given (`temporal_window`); the window comes
// from a query analyzer (engine/query_analyzer.py) that extracts dates with
// rules + dateparser + a small T5 model. We run 3 of the 4 arms here; the
// graph arm joins in lesson 8.
//
// Our extractor is deliberately tiny — "in June", "last week", "yesterday"
// — and says so. The point is the architecture (extract → window → arm),
// not the parser.
//
// No dependencies. Run it:
//
//     bun run lesson7

import { pipeline } from "@xenova/transformers";

interface Fact {
  content: string;
  at: Date;
}

interface TemporalWindow {
  from: Date;
  to: Date;
  label: string;
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
  return dot;
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

// ---------- fusion (lesson 5) ----------
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

// ---------- temporal extraction (this lesson) ----------
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Extract a time window from the query. Tiny and rule-based — it handles
 * "in June", "in June 2026", "last week", "yesterday", and nothing else.
 * Hindsight's real analyzer uses dateparser + rules + flan-t5-small; the
 * architecture (extract → window → arm) is what we're learning here.
 */
function extractWindow(query: string, ref: Date): TemporalWindow | null {
  const q = query.toLowerCase();

  const monthRe = new RegExp(
    `\\bin\\s+(${MONTHS.join("|")})(?:\\s+(\\d{4}))?\\b`,
  );
  const mm = q.match(monthRe);
  if (mm) {
    const mi = MONTHS.indexOf(mm[1]!);
    let year = ref.getUTCFullYear();
    if (mm[2]) year = parseInt(mm[2], 10);
    else if (mi > ref.getUTCMonth()) year -= 1; // "in June" in March → last June
    const from = new Date(Date.UTC(year, mi, 1));
    const to = new Date(Date.UTC(year, mi + 1, 1));
    return { from, to, label: `in ${mm[1]} ${year}` };
  }

  if (/\blast week\b/.test(q)) {
    const to = new Date(ref);
    const from = new Date(ref.getTime() - 7 * 86400000);
    return { from, to, label: "last week" };
  }
  if (/\byesterday\b/.test(q)) {
    const day = new Date(
      Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() - 1),
    );
    return {
      from: day,
      to: new Date(day.getTime() + 86400000),
      label: "yesterday",
    };
  }
  return null;
}

class Memory {
  private facts: Fact[] = [];
  private vectors: number[][] = [];
  private docs: string[][] = [];

  /** Keep something — with a timestamp. Time starts mattering here. */
  async retain(content: string, at: Date = new Date()): Promise<void> {
    this.facts.push({ content, at });
    this.vectors.push(await embed(content));
    this.docs.push(tokenize(content));
  }

  /**
   * Recall with an optional temporal arm. If the query carries a time
   * window, the temporal arm contributes in-window facts (newest first) and
   * RRF fuses all three arms. No window → the arm stays empty, exactly like
   * Hindsight's.
   */
  async recall(
    query: string,
    k = 3,
    ref: Date = new Date(),
  ): Promise<{ fact: Fact; score: number; window: TemporalWindow | null }[]> {
    const window = extractWindow(query, ref);

    const qv = await embed(query);
    const arms: number[][] = [
      rankOf(this.vectors.map((v) => cosine(qv, v))).slice(0, ARM_CAP),
      rankOf(bm25Scores(this.docs, query)).slice(0, ARM_CAP),
    ];
    if (window) {
      const inWindow = this.facts
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => f.at >= window.from && f.at < window.to)
        .sort((a, b) => b.f.at.getTime() - a.f.at.getTime())
        .map(({ i }) => i)
        .slice(0, ARM_CAP);
      arms.push(inWindow);
    }

    const fused = rrf(arms);
    return [...fused.entries()]
      .map(([index, score]) => ({ fact: this.facts[index]!, score, window }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** Semantic-only top-k, for the demo's contrast. */
  async semanticTop(query: string, k: number): Promise<Fact[]> {
    const qv = await embed(query);
    return rankOf(this.vectors.map((v) => cosine(qv, v)))
      .slice(0, k)
      .map((i) => this.facts[i]!);
  }
}

async function demo(): Promise<void> {
  const m = new Memory();
  const D = (s: string): Date => new Date(s + "T00:00:00Z");
  await m.retain("Alice joined Google as a software engineer", D("2026-06-02"));
  await m.retain("Alice shipped the new ranking model", D("2026-06-18"));
  await m.retain("Alice loves hiking in Yosemite", D("2026-08-09"));
  await m.retain("Bob is Alice's manager", D("2026-06-05"));
  await m.retain("Alice prefers tea over coffee", D("2026-09-01"));

  const ref = D("2026-10-03");
  const q = "what did Alice do in June?";
  console.log(`Q: ${q}   (reference date: ${iso(ref)})\n`);

  const results = await m.recall(q, 3, ref);
  const window = results[0]?.window;
  console.log(
    `temporal window extracted: ${window ? `${iso(window.from)} → ${iso(window.to)}` : "none"}\n`,
  );
  console.log("fused top-3 (temporal arm active):");
  for (const { fact, score } of results) {
    console.log(`  ${score.toFixed(4)}  ${iso(fact.at)}  ${fact.content.slice(0, 40)}`);
  }

  // Contrast: the same query with the temporal arm disabled.
  console.log("\nsemantic arm alone (no time):");
  for (const f of await m.semanticTop(q, 3)) {
    console.log(`  ${iso(f.at)}  ${f.content.slice(0, 40)}`);
  }
  console.log(
    "\nWithout time, the top semantic hits leak outside June. The temporal",
  );
  console.log(
    "arm doesn't rank better — it answers a different question: *when*.",
  );
}

await demo();
