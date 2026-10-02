// Lesson 2: Not all words are equal — TF-IDF + cosine similarity.
//
// The one idea: lesson 1 counted shared words, treating every word the same.
// But "alice" (in 4 of 5 facts) tells you almost nothing, while "engineer"
// (in 1 of 5) tells you a lot. TF-IDF weights each word by how *rare* it is
// across the store; cosine similarity then compares query and fact by angle,
// not raw count. Same two functions as lesson 1 — retain() and recall() —
// but recall() finally *ranks*.
//
// No dependencies. Run it:
//
//     bun run lesson2

interface Fact {
  content: string;
  at: string;
}

interface Scored {
  fact: Fact;
  score: number;
}

// Tiny stopword list: glue words carry no signal and would only add noise.
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

class Memory {
  private facts: Fact[] = [];

  /** Keep something. Unchanged from lesson 1 — the write path is still a list. */
  retain(content: string): void {
    this.facts.push({ content, at: new Date().toISOString() });
  }

  /**
   * Find the k best matches, ranked by TF-IDF cosine similarity.
   *
   * tf (term frequency): how often the word appears in THIS fact.
   * idf (inverse document frequency): log(N / df) — how rare the word is
   *     across ALL facts. Rare words get high weight.
   * cosine: dot(a, b) / (|a| * |b|) — angle between the two weighted
   *     vectors, so long facts don't win just for being long.
   */
  recall(query: string, k = 3): Scored[] {
    const docs = this.facts.map((f) => tokenize(f.content));
    const qTokens = tokenize(query);
    const N = docs.length;

    // df(t): in how many facts does t appear?
    const df = new Map<string, number>();
    for (const d of docs) {
      for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const idf = (t: string): number => {
      const d = df.get(t);
      return d ? Math.log(N / d) : 0; // unseen words contribute nothing
    };

    // Weighted vector for a token list: { term -> tf * idf }.
    const vector = (tokens: string[]): Map<string, number> => {
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      const v = new Map<string, number>();
      for (const [t, c] of tf) {
        const w = idf(t);
        if (w > 0) v.set(t, c * w);
      }
      return v;
    };
    const norm = (v: Map<string, number>): number =>
      Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));

    const qv = vector(qTokens);
    const qn = norm(qv);

    return this.facts
      .map((fact, i) => {
        const dv = vector(docs[i]);
        let dot = 0;
        for (const [t, w] of qv) dot += w * (dv.get(t) ?? 0);
        const dn = norm(dv);
        const score = qn && dn ? dot / (qn * dn) : 0;
        return { fact, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/** Lesson 1's scorer, kept for comparison: raw shared-word count. */
function overlapRecall(facts: Fact[], query: string): string[] {
  const qw = new Set(tokenize(query));
  return facts
    .map((f) => {
      const fw = new Set(tokenize(f.content));
      const score = [...qw].filter((w) => fw.has(w)).length;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ f, score }) => `${score}  ${f.content}`);
}

function demo(): void {
  const m = new Memory();
  const seed = [
    "Alice works at Google as a software engineer",
    "Alice loves hiking in Yosemite",
    "Bob is Alice's manager",
    "Bob likes chess",
    "Alice prefers tea over coffee",
  ];
  for (const s of seed) m.retain(s);
  const facts: Fact[] = seed.map((content) => ({ content, at: "" }));

  // --- where weighting changes the ranking ---
  const q1 = "Alice engineer Bob";
  console.log(`Q: ${q1}\n`);
  console.log("TF-IDF + cosine:");
  for (const { fact, score } of m.recall(q1, 5)) {
    console.log(`  ${score.toFixed(3)}  ${fact.content}`);
  }
  console.log("\nLesson 1's raw word-overlap on the same query:");
  for (const line of overlapRecall(facts, q1).slice(0, 5)) {
    console.log(`  ${line}`);
  }
  console.log(
    "\n'alice' is in 4 of 5 facts (idf 0.22), 'bob' in 2 of 5 (idf 0.92),",
  );
  console.log(
    "'engineer' in 1 of 5 (idf 1.61). Raw overlap ties 2-2 and picks by",
  );
  console.log(
    "insertion order — luck. TF-IDF ranks the engineer fact first *because*",
  );
  console.log("'engineer' is the rarest shared word. That is ranked retrieval.",
  );

  // --- the honest limit ---
  const q2 = "what is Alice's job?";
  console.log(`\nQ: ${q2}\n`);
  const top = m.recall(q2, 1)[0];
  console.log(`  ${top.score.toFixed(3)}  ${top.fact.content}`);
  console.log(
    "\nStill wrong. 'job' never appears in the store, so it contributes",
  );
  console.log(
    "nothing — and nothing links 'job' to 'engineer'. Counting words can't",
  );
  console.log("cross a vocabulary gap. Lesson 3: embeddings, i.e. meaning.");
}

demo();
