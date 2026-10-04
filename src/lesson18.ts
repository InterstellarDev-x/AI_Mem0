// Lesson 18: The MCP server — memory exposed as tools.
//
// The one idea: the same memory engine, served over HTTP as *tools* any
// agent can call. Two modes, exactly like Hindsight:
//   - multi-bank  POST /mcp            → retain, recall, reflect, list_banks, create_bank
//                                        (bank_id: call arguments → X-Bank-Id header → env, like the real order)
//   - single-bank POST /mcp/{bank_id}  → retain, recall, reflect only
//                                        (bank comes from the URL — recommended
//                                        for agent isolation)
// Tool annotations mirror Hindsight's: readOnlyHint on recall/reflect/
// list_banks so clients can auto-approve safe reads, openWorldHint=false
// throughout because this is a closed memory store (no internet access).
//
// Grounded in the real Hindsight (api/mcp.py, mcp_tools.py): the two modes,
// the bank-id resolution order (URL → X-Bank-Id header → env default), the
// explicit tool list (no wildcards), and the annotation semantics. We speak
// minimal JSON-RPC (tools/list + tools/call); real MCP adds an initialize/
// capabilities handshake around this same core.
//
// Run it:
//
//     bun run lesson18
//
// The demo starts the server on an ephemeral port, drives it over the wire,
// and stops it. Watch the isolation: same query, two banks, different answers.

import { Engine } from "./lesson13.ts";

// ---- the store: one engine per bank, like lesson 14 ----
const banks = new Map<string, Engine>();
function getBank(id: string): Engine {
  const e = banks.get(id);
  if (!e) throw new Error(`unknown bank "${id}"`);
  return e;
}

// ---- tools ----
interface Annotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
}
const RO: Annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const RW: Annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

interface Tool {
  name: string;
  description: string;
  annotations: Annotations;
  multiBankOnly?: boolean;
  run: (args: Record<string, any>, bankId: string) => Promise<unknown>;
}

const TOOLS: Tool[] = [
  {
    name: "retain",
    description: "Store content in the bank's memory.",
    annotations: RW,
    run: async (a, bankId) => ({ ids: await getBank(bankId).retain(String(a.content)) }),
  },
  {
    name: "recall",
    description: "Retrieve relevant memories from the bank.",
    annotations: RO,
    run: async (a, bankId) =>
      getBank(bankId)
        .recall(String(a.query), Number(a.k ?? 5))
        .map((h) => ({ kind: h.kind, text: h.text, score: +h.score.toFixed(3) })),
  },
  {
    name: "reflect",
    description: "Answer a question from the bank's memory.",
    annotations: RO,
    run: async (a, bankId) => ({ answer: await getBank(bankId).reflect(String(a.question)) }),
  },
  {
    name: "list_banks",
    description: "List all bank ids.",
    annotations: RO,
    multiBankOnly: true,
    run: async () => ({ banks: [...banks.keys()] }),
  },
  {
    name: "create_bank",
    description: "Create a new empty bank.",
    annotations: RW,
    multiBankOnly: true,
    run: async (a) => {
      const id = String(a.bank_id);
      if (banks.has(id)) throw new Error(`bank "${id}" already exists`);
      banks.set(id, new Engine());
      return { bank_id: id };
    },
  },
];

const toolsFor = (singleBank: boolean): Tool[] =>
  TOOLS.filter((t) => !(singleBank && t.multiBankOnly));

// ---- minimal JSON-RPC server ----
function rpcOk(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}
function rpcErr(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

function startServer(): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const m = url.pathname.match(/^\/mcp(?:\/([^/]+))?\/?$/);
      if (!m || req.method !== "POST") return new Response("not found", { status: 404 });
      const pathBank: string | null = m[1] ?? null; // single-bank mode when present
      const singleBank = pathBank !== null;
      let body: any;
      try {
        body = await req.json();
      } catch {
        return rpcErr(null, -32700, "invalid JSON");
      }

      if (body.method === "tools/list") {
        return rpcOk(body.id, {
          tools: toolsFor(singleBank).map((t) => ({
            name: t.name,
            description:
              t.description + (singleBank ? " (bank comes from the URL)" : ""),
            annotations: t.annotations,
          })),
        });
      }

      if (body.method === "tools/call") {
        const name = body.params?.name;
        const args = body.params?.arguments ?? {};
        const tool = toolsFor(singleBank).find((t) => t.name === name);
        if (!tool) return rpcErr(body.id, -32601, `unknown tool "${name}" on this endpoint`);
        // Bank-id resolution, per the real order: URL → X-Bank-Id header →
        // HINDSIGHT_MCP_BANK_ID env (default "default") → call arguments.
        const bankId = singleBank
          ? pathBank!
          : (args.bank_id ??
            req.headers.get("x-bank-id") ??
            process.env.HINDSIGHT_MCP_BANK_ID ??
            "default");
        try {
          const out = await tool.run(args, bankId);
          return rpcOk(body.id, { content: [{ type: "text", text: JSON.stringify(out) }] });
        } catch (e) {
          return rpcErr(body.id, -32000, e instanceof Error ? e.message : String(e));
        }
      }
      return rpcErr(body.id, -32601, `unknown method "${body.method}"`);
    },
  });
  return { url: `http://localhost:${server.port}`, stop: () => server.stop() };
}

// ---- demo: drive the server over the wire ----
async function call(url: string, method: string, params?: unknown, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
  return body.result;
}
const toolText = (r: any): string => r.content[0].text;

async function demo(): Promise<void> {
  // seed two isolated banks
  banks.set("work", new Engine());
  banks.set("personal", new Engine());
  await banks.get("work")!.retain("The prod deploy key lives in 1Password under 'prod-deploy'.");

  const { url, stop } = startServer();
  console.log(`MCP server up at ${url}\n`);

  const multi = `${url}/mcp`;
  const single = `${url}/mcp/work`;

  const listAll = await call(multi, "tools/list");
  console.log(`tools/list ${multi} →`, listAll.tools.map((t: any) => t.name).join(", "));
  const listOne = await call(single, "tools/list");
  console.log(`tools/list ${single} →`, listOne.tools.map((t: any) => t.name).join(", "));
  console.log("  (single-bank mode drops the bank-management tools)");

  console.log("\nrecall 'deploy key' from bank 'work' (multi-bank):");
  console.log(" ", toolText(await call(multi, "tools/call", { name: "recall", arguments: { query: "deploy key", bank_id: "work" } })));

  console.log("\nrecall 'deploy key' via X-Bank-Id header (no bank_id in args):");
  console.log(" ", toolText(await call(multi, "tools/call", { name: "recall", arguments: { query: "deploy key" } }, { "x-bank-id": "work" })));

  console.log("\nrecall 'deploy key' from bank 'personal' (multi-bank):");
  console.log(" ", toolText(await call(multi, "tools/call", { name: "recall", arguments: { query: "deploy key", bank_id: "personal" } })));
  console.log("  (same query, different bank, no leakage — isolation holds over the wire)");

  console.log("\nretain + recall through the single-bank endpoint (no bank_id needed):");
  console.log(" ", toolText(await call(single, "tools/call", { name: "retain", arguments: { content: "The on-call rotation starts Monday." } })));
  console.log(" ", toolText(await call(single, "tools/call", { name: "recall", arguments: { query: "on-call" } })));

  console.log("\ncreate_bank on the single-bank endpoint:");
  try {
    await call(single, "tools/call", { name: "create_bank", arguments: { bank_id: "oops" } });
  } catch (e) {
    console.log(" ", (e as Error).message, "(correctly not exposed)");
  }

  stop();
  console.log("\nThe engine didn't change — it just grew a door agents can knock on.");
}

if (import.meta.main) {
  await demo();
}
