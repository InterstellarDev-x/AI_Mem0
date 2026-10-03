// Lesson 8: The graph arm — link at write time, walk at read time.
//
// The one idea: some relevant facts share no words and no meaning-direction
// with your query — they're relevant *through* another fact. "Where is
// Alice's employer headquartered?" is answered by a fact about Google that
// never mentions Alice. So at retain time, link facts together; at recall,
// take the semantic hits as *seeds* and walk one hop through the links.
//
// Grounded in the real Hindsight (engine/memories/pg/link_expansion.py):
// semantic seeds (bounded, min-similarity) expand through three signals —
// entity links (shared entities, scored by count), semantic links
// (precomputed kNN: each new fact linked to its most similar existing facts
// *at insert time*), and causal links (explicit causes/enables, boosted
// highest). We implement entity + semantic links; causal links need an LLM
// to extract, so they're noted and skipped.
//
// Our entity extractor is deliberately crude — capitalized phrases. Hindsight
// uses an LLM for this (engine/retain/fact_extraction.py: "The LLM only
// extracts metadata: entities, temporal info, location, people"). The
// architecture — extract at write, walk at read — is the lesson, not the NLP.
//
// No dependencies. Run it:
//
//     bun run lesson8

import { pipeline } from "@xenova/transformers";

interface Fact {
  content: string;
  at: Date;
  entities: string[];
}

interface Link {
  to: number;
  kind: "entity" | "semantic";
  weight: number;
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

// ---------- temporal (lesson 7, dormant in this demo) ----------
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function extractWindow(
  query: string,
  ref: Date,
): { from: Date; to: Date } | null {
  const q = query.toLowerCase();
  const mm = q.match(new RegExp(`\\bin\\s+(${MONTHS.join("|")})(?:\\s+(\\d{4}))?\\b`));
  if (mm) {
    const mi = MONTHS.indexOf(mm[1]!);
    let year = ref.getUTCFullYear();
    if (mm[2]) year = parseInt(mm[2], 10);
    else if (mi > ref.getUTCMonth()) year -= 1;
    return {
      from: new Date(Date.UTC(year, mi, 1)),
      to: new Date(Date.UTC(year, mi + 1, 1)),
    };
  }
  return null;
}

// ---------- graph (this lesson) ----------
const SEM_LINK_THRESHOLD = 0.5;
const GRAPH_SEEDS = 3; // Hindsight's GRAPH_SEED_LIMIT is 20; tiny corpus, tiny limit

/**
 * Crude entity extraction: capitalized phrases ("Alice", "Mountain View").
 * Transparent and wrong in known ways — Hindsight uses an LLM here.
 */
function extractEntities(text: string): string[] {
  const found = new Set<string>();
  const re = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[0].replace(/'s$/, ""));
  }
  return [...found];
}

class Memory {
  private facts: Fact[] = [];
  private vectors: number[][] = [];
  private docs: string[][] = [];
  private links: Map<number, Link[]> = new Map();

  /**
   * Keep something — and link it. Entity links to every earlier fact sharing
   * an entity (weight = # shared); one semantic link to the most similar
   * earlier fact above threshold (weight = cosine). Bidirectional.
   */
  async retain(content: string, at: Date = new Date()): Promise<void> {
    const entities = extractEntities(content);
    const vector = await embed(content);
    const i = this.facts.length;
    this.facts.push({ content, at, entities });
    this.vectors.push(vector);
    this.docs.push(tokenize(content));
    this.links.set(i, []);

    const addLink = (a: number, b: number, link: Link): void => {
      this.links.get(a)!.push({ ...link, to: b });
      this.links.get(b)!.push({ ...link, to: a });
    };

    let best = -1;
    let bestSim = SEM_LINK_THRESHOLD;
    for (let j = 0; j < i; j++) {
      const shared = entities.filter((e) =>
        this.facts[j]!.entities.includes(e),
      ).length;
      if (shared > 0) {
        addLink(i, j, { to: j, kind: "entity", weight: shared });
      }
      const sim = cosine(vector, this.vectors[j]!);
      if (sim > bestSim) {
        bestSim = sim;
        best = j;
      }
    }
    if (best >= 0) {
      addLink(i, best, { to: best, kind: "semantic", weight: bestSim });
    }
  }

  /**
   * Four arms: semantic, BM25, temporal (empty unless the query carries a
   * window), graph — semantic seeds expanded one hop through the links,
   * seeds themselves excluded. Fused with RRF.
   */
  async recall(
    query: string,
    k = 3,
    ref: Date = new Date(),
  ): Promise<{ fact: Fact; score: number }[]> {
    const qv = await embed(query);
    const semRank = rankOf(this.vectors.map((v) => cosine(qv, v)));
    const keyRank = rankOf(bm25Scores(this.docs, query));

    const arms: number[][] = [
      semRank.slice(0, ARM_CAP),
      keyRank.slice(0, ARM_CAP),
    ];

    const window = extractWindow(query, ref);
    if (window) {
      arms.push(
        this.facts
          .map((f, i) => ({ f, i }))
          .filter(({ f }) => f.at >= window.from && f.at < window.to)
          .sort((a, b) => b.f.at.getTime() - a.f.at.getTime())
          .map(({ i }) => i)
          .slice(0, ARM_CAP),
      );
    }

    // Graph arm: seeds are the top semantic hits; walk one hop.
    const seeds = semRank.slice(0, GRAPH_SEEDS);
    const seedSet = new Set(seeds);
    const candWeight = new Map<number, number>();
    for (const s of seeds) {
      for (const link of this.links.get(s) ?? []) {
        if (seedSet.has(link.to)) continue;
        candWeight.set(
          link.to,
          Math.max(candWeight.get(link.to) ?? 0, link.weight),
        );
      }
    }
    arms.push(
      [...candWeight.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([i]) => i)
        .slice(0, ARM_CAP),
    );

    const fused = rrf(arms);
    return [...fused.entries()]
      .map(([index, score]) => ({ fact: this.facts[index]!, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** For the demo: what the graph arm alone returns. */
  async graphOnly(
    query: string,
  ): Promise<{ fact: Fact; via: string }[]> {
    const qv = await embed(query);
    const seeds = rankOf(this.vectors.map((v) => cosine(qv, v))).slice(
      0,
      GRAPH_SEEDS,
    );
    const seedSet = new Set(seeds);
    const out: { fact: Fact; via: string }[] = [];
    for (const s of seeds) {
      for (const link of this.links.get(s) ?? []) {
        if (seedSet.has(link.to)) continue;
        out.push({
          fact: this.facts[link.to]!,
          via: `${link.kind} link from "${this.facts[s]!.content.slice(0, 30)}…"`,
        });
      }
    }
    return out;
  }

  linkCount(): number {
    let n = 0;
    for (const ls of this.links.values()) n += ls.length;
    return n / 2; // bidirectional
  }
}

async function demo(): Promise<void> {
  const m = new Memory();
  const D = (s: string): Date => new Date(s + "T00:00:00Z");
  await m.retain("Alice works at Google as a software engineer", D("2026-06-02"));
  await m.retain("Alice loves hiking in Yosemite", D("2026-08-09"));
  await m.retain("Bob is Alice's manager", D("2026-06-05"));
  await m.retain("Google's headquarters are in Mountain View", D("2026-07-14"));
  await m.retain("Bob likes chess", D("2026-09-20"));

  console.log(`graph built at retain time: ${m.linkCount()} links\n`);

  const q = "where is Alice's employer headquartered?";
  console.log(`Q: ${q}\n`);

  console.log("graph arm alone (1 hop from semantic seeds):");
  for (const { fact, via } of await m.graphOnly(q)) {
    console.log(`  "${fact.content.slice(0, 44)}"`);
    console.log(`    via ${via}`);
  }

  console.log("\nfused top-3 (semantic + BM25 + graph):");
  for (const { fact, score } of await m.recall(q, 3, D("2026-10-03"))) {
    console.log(`  ${score.toFixed(4)}  ${fact.content.slice(0, 44)}`);
  }
  console.log(
    "\nThe headquarters fact shares no meaningful words with the query —",
  );
  console.log(
    "'headquartered' isn't in it, 'employer' isn't in it. The semantic arm",
  );
  console.log(
    "ranks it #4 of 5. But it shares the entity Google with the seed fact,",
  );
  console.log(
    "so the graph arm walks Alice → Google → Mountain View in one hop, and",
  );
  console.log("fusion puts it at #1.");
  console.log(
    "\nHonest footnote: the walk also surfaces 'Bob likes chess' via the Bob",
  );
  console.log(
    "entity — graph expansion is high-recall and noisy. That's why Hindsight",
  );
  console.log(
    "caps per-entity fanout (200) and fuses the arm instead of trusting it.",
  );}

await demo();
