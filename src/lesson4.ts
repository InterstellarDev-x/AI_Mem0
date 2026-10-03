// Lesson 4: Keyword search done right — BM25.
//
// The one idea: lesson 2's TF-IDF has two flaws. First, term frequency is
// linear: a fact saying "chess" four times scores 4x a fact saying it once —
// but the 4th "chess" tells you almost nothing new. Second, length handling
// is implicit. BM25 fixes both: the tf contribution *saturates* (diminishing
// returns, capped at k1+1) and document length is normalized explicitly with
// a tunable knob (b).
//
//   score(D, Q) = Σ IDF(qi) · [ f(qi,D)·(k1+1) ] / [ f(qi,D) + k1·(1−b+b·|D|/avgdl) ]
//   IDF(qi)     = ln( 1 + (N − n(qi) + 0.5) / (n(qi) + 0.5) )
//
// k1 = 1.2, b = 0.75: the defaults the whole industry uses.
//
// Grounded note: the real Hindsight does NOT hand-roll this. Its keyword arm
// is Postgres' native full-text search (tsvector/tsquery), exposed as the
// "BM25" arm with a score floor gating candidates into fusion. We hand-roll
// it here to learn the mechanics; in production you let the database do it.
//
// No dependencies. Run it:
//
//     bun run lesson4

interface Fact {
  content: string;
  at: string;
}

interface Scored {
  fact: Fact;
  score: number;
}

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

class Memory {
  private facts: Fact[] = [];
  private docs: string[][] = [];

  /** Keep something. The write path is still just a list. */
  retain(content: string): void {
    this.facts.push({ content, at: new Date().toISOString() });
    this.docs.push(tokenize(content));
  }

  /** Rank with BM25: saturated tf, explicit length normalization. */
  recall(query: string, k = 3): Scored[] {
    const qTerms = [...new Set(tokenize(query))];
    const N = this.docs.length;
    const avgdl = this.docs.reduce((s, d) => s + d.length, 0) / N;

    // n(t): how many facts contain t?
    const n = new Map<string, number>();
    for (const d of this.docs) {
      for (const t of new Set(d)) n.set(t, (n.get(t) ?? 0) + 1);
    }

    return this.facts
      .map((fact, i) => {
        const d = this.docs[i]!;
        const tf = new Map<string, number>();
        for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
        let score = 0;
        for (const t of qTerms) {
          const nt = n.get(t);
          if (!nt) continue;
          const idf = Math.log(1 + (N - nt + 0.5) / (nt + 0.5));
          const f = tf.get(t) ?? 0;
          score +=
            (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / avgdl));
        }
        return { fact, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/** Lesson 2's tf weight for comparison: linear, no saturation. */
const linearTf = (f: number): number => f;
/** BM25's tf component at average document length: saturating. */
const bm25Tf = (f: number): number => (f * (K1 + 1)) / (f + K1);

function demo(): void {
  // --- the saturation curve: the whole lesson in one table ---
  console.log("tf weight as a word repeats: linear (lesson 2) vs BM25\n");
  console.log("  repeats:  1     2     3     5     10");
  const lin = [1, 2, 3, 5, 10].map((f) => linearTf(f).toFixed(2).padStart(5));
  const sat = [1, 2, 3, 5, 10].map((f) => bm25Tf(f).toFixed(2).padStart(5));
  console.log(`  linear: ${lin.join(" ")}`);
  console.log(`  BM25:   ${sat.join(" ")}`);
  console.log(
    "\nNo matter how often a word repeats, its BM25 contribution caps at",
  );
  console.log(`k1+1 = ${(K1 + 1).toFixed(1)}x the single-occurrence weight. Keyword`,
  );
  console.log("stuffing has diminishing returns — by design.");

  // --- what that means for ranking ---
  const m = new Memory();
  for (const s of [
    "Alice works at Google as a software engineer",
    "Alice loves hiking in Yosemite",
    "Bob is Alice's manager",
    "Bob likes chess",
    "Alice prefers tea over coffee",
    "chess club weekly chess puzzles chess books and more chess",
  ]) {
    m.retain(s);
  }
  const q = "chess";
  console.log(`\nQ: ${q}  ("chess" x1 in a short fact vs x4 in a long one)\n`);
  for (const { fact, score } of m.recall(q, 2)) {
    console.log(`  ${score.toFixed(3)}  ${fact.content}`);
  }
  console.log(
    "\nLesson 2's TF-IDF scored this pair 0.739 vs 0.463 — the 4x repetition",
  );
  console.log(
    "bought a 1.6x advantage. BM25 scores 1.516 vs 1.219: a 1.24x advantage.",
  );
  console.log(
    "Same winner, but stuffing the keyword pays less. That is saturation at work.",
  );
  console.log(
    "\n(BM25 scores are unbounded ranking signals, not similarities — they",
  );
  console.log("only mean anything relative to each other. Lesson 5 fuses them.)");
}

demo();
