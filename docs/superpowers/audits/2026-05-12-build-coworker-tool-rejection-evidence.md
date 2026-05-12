# Build coworker tool rejection — evidence audit (2026-05-12)

## Symptom

A fresh Build Studio submission in the **ideate** phase produces a final assistant message of the form:

> Every tool I call — `update_feature_brief`, `save_build_notes`, `assess_complexity`, `query_backlog`, `start_scout_research` — is being rejected by the runtime as "No such tool available," despite all being advertised in this turn's tool list. This is a platform-side registry issue blocking the build; nothing on the FB-… record can be persisted until the tool registry is restored.

Build stays in ideate, `Advance to Plan` remains disabled, no `designDoc` is persisted.

## Evidence chain (not speculation)

### Adapter trace (portal logs)

```
[tools] route=/build agent=build-specialist buildPhase=ideate count=26 tools=[query_backlog, update_feature_brief, ... assess_complexity, ... start_scout_research, ...]
[agentic-loop] iter=0 provider=anthropic-sub model=claude-opus-4-1-20250805 toolCalls=0 contentLen=2851 nudges=0 executedTools=0 content="I tried `start_scout_research`, `read_project_file` (both files), `start_ideate_research`, and `saveBuildEvidence` — every call was rejected with \"No such tool available\" despite all four appearing in this turn's advertised tool list…"
[tool-trace] adapter=claude-cli extracted=0 names=[] mentioned=["read_project_file","saveBuildEvidence"]
[tool-trace] adapter=claude-cli NO-CALL-BUT-MENTIONED raw=…
```

Reading these in isolation suggests the model is fabricating the rejection (because `extracted=0` and `toolCalls=0`). It is not. See next section.

### Claude CLI session log (the ground truth)

`/home/node/.claude/projects/-workspace/64c6b3fe-0373-47ed-9919-5d040bddfcb3.jsonl` (copied locally to `D:/DPF/.claude/cli-session-64c.jsonl` for archival). For the FB-D14EDB7C build, this session emitted **9 real `tool_use` content blocks** across 8 platform tool names with server-assigned `toolu_…` IDs. Every one was paired by the CLI itself with a synthesized `tool_result` content block:

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [{
      "type": "tool_result",
      "content": "<tool_use_error>Error: No such tool available: start_scout_research</tool_use_error>",
      "is_error": true,
      "tool_use_id": "toolu_01BCq9RwD5Ra6fM8MEFs6xim"
    }]
  }
}
```

Observed tool names rejected this way in the session: `start_scout_research`, `search_project_files`, `read_project_file` (×2), `list_project_directory`, `check_sandbox`, `get_my_coworker_profile`, `query_backlog`, `assess_complexity`. The same `<tool_use_error>: No such tool available` pattern was also recorded in the older FB-72EB9C06 session.

The model is reporting accurately. The platform tools are described in the system prompt but **not registered** with the Claude CLI as dispatchable tools, so the CLI's internal tool router auto-rejects every `tool_use` for those names and loops back to the model with `is_error: true`. `--output-format json` returns only the final assistant text, so the tool_use ↔ tool_result exchange never crosses the adapter's stdout — that's why `[tool-trace] extracted=0`.

## Why this isn't a model regression

- The cli-adapter's prompt builder ([`apps/web/lib/routing/cli-adapter.ts:302-308`](../../../apps/web/lib/routing/cli-adapter.ts)) tells the model: "output ONE JSON object using exactly this shape: `{\"type\":\"tool_use\",...}`".
- That shape **is** an Anthropic-API `tool_use` content block. When Claude Code CLI emits one to its internal dispatcher, the dispatcher looks the name up in its registered tool catalog (Claude's native tools, minus everything in `--disallowedTools`).
- Platform tools (`saveBuildEvidence`, `query_backlog`, `start_scout_research`, …) are not in that catalog. They never were. There is no `--mcp-config` mounting them as an MCP server (yet).
- The CLI's auto-rejection is correct given the input. The defect is the missing tool registration on the adapter side.

The existing comment at [`apps/web/lib/routing/cli-adapter.ts:31-46`](../../../apps/web/lib/routing/cli-adapter.ts) acknowledges this exact gap and points at the prepared fix:
[docs/superpowers/plans/2026-04-11-platform-mcp-tool-server-implementation.md](../plans/2026-04-11-platform-mcp-tool-server-implementation.md).

## Adapter comparison

- **`cli-adapter.ts` (anthropic-sub → Claude CLI):** has no tool registration path; CLI auto-rejects every platform tool_use as shown.
- **`codex-cli-adapter.ts` (codex / codex-agent → Codex CLI):** Codex `exec` returns plain text (not Anthropic content blocks). Tool calls are extracted from text by `extractToolCalls`. There is no internal dispatcher to reject. This is why the codex path can advance Build Studio builds while the anthropic-sub path cannot.
- **`chat-adapter.ts` (anthropic API key):** uses the real Anthropic Messages API with `tools[]` registered in the request body. No registration mismatch possible. Not exercised today because no install has an `anthropic` (API key) provider configured — only `anthropic-sub`, `codex-agent`, `local`.

## Implications

- All routes whose agents are routed to `anthropic-sub` and rely on platform tool dispatch (most prominently `/build` with the `build-specialist` coworker) are non-functional in this state.
- Reframing the failure as a model "hallucination" or "frustration" pattern in `agentic-loop.ts` would be incorrect — the model is doing the right thing under the rules it has.
- Routes that go via `codex-cli-adapter` (where Codex's plain-text output bypasses native tool dispatch) are not affected by the same mechanism.

## Repro

1. Fresh install OR live install with `anthropic-sub` active and no `anthropic` API key configured.
2. Sign in as admin, open `/build`, submit any new feature in the textbox.
3. Observe: build appears in `ideate`; chat coworker quickly returns the message at the top of this doc; no `designDoc` is persisted; `Advance to Plan` stays disabled.
4. Inspect: portal logs include `[tools] route=/build … count=26` followed by `toolCalls=0 executedTools=0` for every iteration. Sandbox CLI session log under `/home/node/.claude/projects/-workspace/*.jsonl` contains the `<tool_use_error>: No such tool available: <name>` pairs.

## Fix scope (per existing plan)

Implementing the plan at [docs/superpowers/plans/2026-04-11-platform-mcp-tool-server-implementation.md](../plans/2026-04-11-platform-mcp-tool-server-implementation.md):

1. Add a short-lived signed session token helper.
2. Make `/api/mcp/v1` accept session tokens with `userId`/`platformRole`/`agentId`/`routeContext`/`buildPhase`/`mode` claims; filter `tools/list` accordingly.
3. In `cli-adapter.ts`, mint a session token per call, write an `mcp-config.json` into the sandbox declaring `dpf` as an HTTP MCP server pointing at `http://portal:3000/api/mcp/v1` with `Authorization: Bearer <session-token>`, and pass it to `claude` via `--mcp-config`.
4. Have the agentic loop treat `cli-adapter` results that came back through native MCP execution as single-pass responses (no second platform-side dispatch).
5. Share a `recordToolExecution()` helper between `agentic-loop.ts` and the MCP route so audit rows still land.

The fix is non-trivial — see the plan's Section 2 (Spec Evaluation Summary) for corrections required against the original spec. It is the next logical work item; deferring to a focused implementation pass rather than a drive-by patch.

## What this audit does NOT do

- Does not propose a code change.
- Does not retitle the existing plan.
- Does not edit `cli-adapter.ts`, `agentic-loop.ts`, or the prompt template.

Its only job is to record the evidence so the planned implementation can proceed without re-doing the diagnosis.
