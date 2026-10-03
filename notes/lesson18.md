# Lesson 18 — The MCP server: memory exposed as tools (2026-10-03)

## The one idea

The same memory engine, served over HTTP as *tools* any agent can call.
Two modes: multi-bank `POST /mcp` (retain, recall, reflect, list_banks,
create_bank — bank_id from the arguments) and single-bank
`POST /mcp/{bank_id}` (retain, recall, reflect only — bank from the URL,
the mode Hindsight recommends for agent isolation).

## What we built

`src/lesson18.ts`: a real JSON-RPC server (Bun.serve, ephemeral port) over
one Engine per bank. `tools/list` returns tool definitions with Hindsight's
annotations (readOnlyHint on recall/reflect/list_banks so clients can
auto-approve safe reads; openWorldHint=false throughout — a closed memory
store). `tools/call` dispatches to the engine. The demo drives it over the
wire: tool lists differ by mode, recall from "work" hits while "personal"
returns nothing (isolation holds over the wire), retain+recall work through
the single-bank endpoint with no bank_id, and create_bank is correctly
rejected there.

## Grounded in the real Hindsight

Verified in api/mcp.py: the two modes, bank-id resolution order (URL →
X-Bank-Id header → env default), and the single-bank recommendation for
agent isolation. Verified in mcp_tools.py: the explicit tool list (no
wildcards) and the annotation semantics (readOnlyHint for safe reads,
destructiveHint for deletes, openWorldHint=False — "Hindsight is a closed
memory store"). We speak minimal JSON-RPC; real MCP adds an initialize /
capabilities handshake around this same core.

## What's next

Lesson 19: coding-agent integration — per-repo project memory built from
git history and past sessions.

## Try it

```
bun run lesson18
```

Point a second terminal at it while a variant server runs (keep the server
alive instead of stopping): `curl -X POST localhost:PORT/mcp/work -d
'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"reflect",
"arguments":{"question":"where is the deploy key"}}}'` — the reflect tool
answering over HTTP is the whole lesson in one call.
