// Lesson 19: Coding-agent integration — per-repo project memory.
//
// The one idea: a coding agent's memory is scoped to the *repo*. Git history
// and past sessions flow into the repo's bank automatically in the
// background; every new session starts with the repo's curated knowledge
// pages plus recalled context injected up front. The premise (Hindsight's
// own words): most of a fix is derivable from the code, but the last mile
// hinges on a project-specific decision that isn't in the code at all — a
// rounding rule, a retry allowlist, a tie-break policy. Those decisions
// live in git history and past conversations.
//
// Grounded in the real Hindsight
// (hindsight-integrations/coding-agents): one package, many agents (Claude
// Code, Codex, opencode, Cursor, Copilot CLI, …) — a shared
// reflect-and-inject core with a thin entry point per agent. Ingestion is
// fully automatic: "a repo's git history and conversations flow into its
// memory bank in the background as you work." Hooks on SessionStart /
// UserPromptSubmit / Stop do the injection and the write-back, and a curated
// set of knowledge pages (architecture, conventions, in-flight initiatives)
// is what future sessions start from.
//
// Our version: RepoMemory over lesson 13's Engine. ingestGitHistory() is
// the background job (here, one call — in real life a daemon). onSessionStart
// injects knowledge pages + recall; onStop writes the session back. The demo
// dogfoods our own repo: its git log becomes the project memory.
//
// Run it:
//
//     bun run lesson19

import { execSync } from "child_process";
import { Engine } from "./lesson13.ts";

interface KnowledgePage {
  title: string;
  body: string;
}

class RepoMemory {
  readonly engine = new Engine();
  private pages: KnowledgePage[] = [];

  constructor(readonly repoName: string) {}

  /** Curated pages future sessions start from (architecture, conventions, in-flight). */
  addPage(title: string, body: string): void {
    this.pages.push({ title, body });
    console.log(`  [pages] "${title}"`);
  }

  /**
   * The background ingestion job: a repo's git history flows into its bank.
   * Hindsight does this continuously as you work; here it's one call.
   */
  async ingestGitHistory(repoDir: string, n: number = 30): Promise<void> {
    const out = execSync(`git -C "${repoDir}" log --format='%h|%ad|%s' --date=short -n ${n}`, {
      encoding: "utf8",
    });
    let count = 0;
    for (const line of out.trim().split("\n")) {
      const [hash, date, ...rest] = line.split("|");
      if (!hash) continue;
      await this.engine.retain(`commit ${hash} (${date}): ${rest.join("|")}`, new Date(`${date}T00:00:00Z`));
      count++;
    }
    console.log(`  [ingest] ${count} commits from git history → bank "${this.repoName}"`);
  }

  /** SessionStart hook: knowledge pages + recall, injected up front. */
  onSessionStart(task: string): string {
    const pageBlock = this.pages.map((p) => `# ${p.title}\n${p.body}`).join("\n\n");
    const recalled = this.engine.recall(task, 3);
    const recallBlock =
      recalled.length > 0
        ? recalled.map((h) => `- (${h.kind}) ${h.text}`).join("\n")
        : "(nothing relevant recalled)";
    return [
      `[repo memory: ${this.repoName}]`,
      "",
      "## Knowledge pages",
      pageBlock || "(none)",
      "",
      "## Recalled for this task",
      recallBlock,
    ].join("\n");
  }

  /** Stop hook: the session writes itself back into the bank. */
  async onStop(summary: string): Promise<void> {
    await this.engine.retain(`session note: ${summary}`);
    console.log(`  [write-back] session note retained`);
  }
}

async function demo(): Promise<void> {
  const repo = new RepoMemory("AI_Mem0");
  repo.addPage(
    "Architecture",
    "One Engine per bank. Lessons layer bottom-up: retrieval → consolidation → engine → serving.",
  );
  repo.addPage(
    "Conventions",
    "Every claim about Hindsight verified against ~/workspace/upstream/hindsight before teaching. One idea, one runnable file per lesson.",
  );
  repo.addPage("In-flight", "Lesson 19: coding-agent integration demo, in progress.");

  await repo.ingestGitHistory("/home/hatch/workspace/hindsight-learning", 20);

  console.log('\n--- session 1 starts: task = "what did we change about the OpenAI integration?" ---');
  console.log(repo.onSessionStart("what did we change about the OpenAI integration?"));
  await repo.onStop("built lesson 19: per-repo project memory from git history");

  console.log('\n--- session 2 starts: task = "what was the last session about?" ---');
  console.log(repo.onSessionStart("what was the last session about?"));

  console.log(
    "\nNo setup command was run. The git history was already there; the",
    "sessions wrote themselves back. That's the whole integration:",
    "background ingestion in, injected context out.",
  );
}

if (import.meta.main) {
  await demo();
}
