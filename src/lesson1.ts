// Lesson 1: Memory is a list + a search function.
//
// The one idea: an LLM is stateless, so agent memory is always a system we
// build around the model — a write path and a read path:
//
//     retain(content) -> keep something
//     recall(query)   -> find the relevant things again
//
// Even this dumb version is complete. Run it:
//
//     bun run lesson1

interface Fact {
  content: string;
  at: string;
}

class Memory {
  private facts: Fact[] = []; // the entire memory system: a list

  /** Keep something. Append-only; we worry about structure later. */
  retain(content: string): void {
    this.facts.push({ content, at: new Date().toISOString() });
  }

  /** Find the best match by word overlap. Dumb, but it's retrieval. */
  recall(query: string): Fact | null {
    const queryWords = new Set(query.toLowerCase().split(/\s+/));
    let best: Fact | null = null;
    let bestScore = 0;
    for (const fact of this.facts) {
      const factWords = new Set(fact.content.toLowerCase().split(/\s+/));
      const score = [...queryWords].filter((w) => factWords.has(w)).length;
      if (score > bestScore) {
        best = fact;
        bestScore = score;
      }
    }
    return best;
  }
}

function demo(): void {
  const m = new Memory();

  // --- write path: retain ---
  m.retain("Alice works at Google as a software engineer");
  m.retain("Alice loves hiking in Yosemite");
  m.retain("Bob is Alice's manager");

  // --- read path: recall ---
  const q1 = "what does Alice do?";
  const r1 = m.recall(q1);
  console.log(`Q: ${q1}`);
  console.log(`A: ${r1 ? r1.content : "nothing found"}\n`);

  // --- where it breaks ---
  const q2 = "what is Alice's job?";
  const r2 = m.recall(q2);
  console.log(`Q: ${q2}`);
  console.log(`A: ${r2 ? r2.content : "nothing found"}`);
  console.log("\nThe store HAS the knowledge ('software engineer').");
  console.log("The search returned the wrong fact. That gap is lesson 2.");
}

demo();
