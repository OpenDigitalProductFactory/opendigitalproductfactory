# Build coworker tool rejection — observations (2026-05-12)

## Scope

Observations only. No causal claims about the appropriate fix. This document records what I saw, where I saw it, and the open questions that follow. Use it as a starting point for diagnosis — not as a diagnosis.

## Symptom

Fresh Build Studio submission `/build` → New textbox. Build is created in `ideate`. Chat coworker (`build-specialist`) returns a final message of the form "Every tool I call — `update_feature_brief`, `save_build_notes`, ... — is being rejected by the runtime as 'No such tool available' ...". Build does not advance. No `designDoc` is persisted. `Advance to Plan` stays disabled.

Reproduced on 2026-05-12 with build `FB-D14EDB7C`.

## Observations

### O1. The string "No such tool available" originates in the Claude CLI binary

`strings` against `/usr/local/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-linux-x64-musl/claude` (Claude Code v2.1.139, as installed in the sandbox image timestamped 2026-05-12T05:49) emits:

```
tool_not_found
tengu_tool_use_error
No such tool available:
<tool_use_error>Error: No such tool available:
```

Adjacent strings include `registerTool`, `registerToolTask`, `unregisterTool`, and `eval_registered__` (apparent runtime-registered tool prefix), plus `mcp__` (apparent MCP-mounted tool prefix).

I did NOT trace the exact JS function that emits the string. I did NOT verify how `registerTool`/`mcp__`/`eval_registered__` interact, nor whether `--allowedTools <name>` synthesizes a registration.

### O2. The model emits real Anthropic-shaped `tool_use` content blocks, not text mentions

Claude CLI session log `/home/node/.claude/projects/-workspace/64c6b3fe-0373-47ed-9919-5d040bddfcb3.jsonl` (copied to `D:/DPF/.claude/cli-session-64c.jsonl` for archival) for FB-D14EDB7C records 9 `tool_use` content blocks with valid server-assigned `toolu_…` IDs across 8 platform tool names. Every one is paired with a `tool_result` `is_error:true` carrying `<tool_use_error>Error: No such tool available: <name></tool_use_error>` for the matching `tool_use_id`.

Same pattern in older sessions (e.g. `df390e75-…` on FB-72EB9C06). Same pattern across totally unrelated coworkers — `023ffa5b-…` (`create_licensing_readiness_issue` from a licensing flow), `121df029-…` (`run_discovery_triage` + `create_backlog_item` from an inventory cadence run), `13addf88-…` (`run_hive_scout_ingest` + `create_backlog_item` + `report_quality_issue` from a hive scout scheduled run). I scanned every `*.jsonl` in `/home/node/.claude/projects/-workspace/`: in every session that has at least one `tool_use` block, the count of `tool_use_error` results equals the count of `tool_use` calls (`tu=err` for every file).

### O3. Build-specialist DID successfully execute platform tools historically

`ToolExecution` rows for `agentId='build-specialist'` show successful side-effecting calls through 2026-04-29 09:41:41 (`saveBuildEvidence`, `save_phase_handoff`, `update_feature_brief`, `start_ideate_research`, `start_scout_research`, `reviewBuildPlan`, plus `suggest_taxonomy_placement`/`confirm_taxonomy_placement`). After that timestamp the only side-effecting successes recorded are on 2026-05-01 03:44 (`start_ideate_research` × 4 in `executionMode='immediate'`). After 2026-05-01 there are zero side-effecting `success=true` rows for this agent.

Joining `ToolExecution.threadId` to `AgentMessage.providerId` (last assistant message in the same thread at or before each ToolExecution) for the Apr 29 successes:

| toolName | providerId for the thread |
| -------- | ------------------------- |
| `suggest_taxonomy_placement` (×3) | anthropic-sub |
| `confirm_taxonomy_placement` (×2) | anthropic-sub |
| `saveBuildEvidence`, `save_phase_handoff`, `search_project_files`, `read_project_file`, `list_project_directory`, `describe_model`, `reviewBuildPlan`, `save_build_notes`, `start_ideate_research`, `suggest_taxonomy_placement` (×N), `confirm_taxonomy_placement` (×N) | codex |

Every successful side-effecting tool call on Apr 29 for this agent was served by `codex`, not by `anthropic-sub`. The `anthropic-sub` rows are all taxonomy tools.

I have NOT verified what code path made the taxonomy tools succeed on `anthropic-sub` — they may be proposal-mode tools that bypass the CLI dispatcher, or they may be cases where the rescue text extractor at `apps/web/lib/routing/cli-adapter.ts:176-181` recovered them from `parseCliJsonOutput`'s text branch.

### O4. The cli-adapter changed in a way that may be relevant — confirmed by file history, NOT confirmed by experiment

`git log apps/web/lib/routing/cli-adapter.ts --since='2026-04-01'`:

```
0c48e9b7 fix(cli-adapter): suppress Claude Code native tools so platform tools aren't shadowed (BI-931303FF) (#405)   [merged 2026-05-10]
f2a205a7 fix(cli): detect auth errors on stdout, stop shipping them as content (#145)
2a5c2647 chore(adapters): durable tool-call extraction trace (codex + claude CLI) (#140)
de4d7519 fix(claude-cli): rescue tool_use blocks emitted as assistant text (#118)
```

PR #405 (merged 2026-05-10) introduced `--disallowedTools "${CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE}"` on the `claude` invocation. Its commit message explicitly notes:

> The platform's MCP-style tools are described in plain text inside the system prompt. The model's training strongly prefers native tool_use over text-described tools, so the platform tools were ignored. Until the proper fix (mount platform tools as a real MCP server via --mcp-config — see plan 2026-04-11) lands, suppress the native tools so the only path forward is the platform's text-described surface.

The test added in that PR (`cli-adapter.test.ts:238-266`) verifies the flag is **passed**. I did NOT find a test that verifies the **end-to-end behavior** — i.e. that with `--disallowedTools` in place the model actually emits platform-tool calls in a shape the CLI doesn't intercept.

### O5. The image was rebuilt on 2026-05-12

Sandbox image creation timestamps:

- `dpf-sandbox-init:latest` — 2026-04-27T05:49
- `dpf-sandbox:latest` — 2026-05-12T05:49

`Dockerfile.sandbox` installs `@anthropic-ai/claude-code` with no version pin (`RUN npm install -g @anthropic-ai/claude-code`). The version installed in today's image is 2.1.139 (from the package.json inside the container).

I have NOT verified what Claude Code version was previously installed, nor whether the CLI's tool-dispatch behavior differs between versions, nor whether earlier `anthropic-sub` builds that hit this code path got past it (the data in O3 already suggests they did not).

### O6. Codex-cli-adapter does not have an equivalent "disallow" flag and was the working path

`apps/web/lib/routing/codex-cli-adapter.ts` does not pass `--disallowedTools` (Codex CLI has a different surface). Its parser treats the CLI output as plain text and runs the cross-adapter rescue extractor (`apps/web/lib/routing/extract-tool-calls.ts`) which accepts `<tool_use>…</tool_use>` XML, fenced JSON, and inline `{"type":"tool_use",…}` JSON.

I have NOT verified whether Codex CLI ever auto-rejects unrecognized tool_use blocks the way Claude CLI does. The observation is only that Codex's plain-text output path made it possible for the platform's rescue extractor to recover the calls.

## Open questions (NOT answered by this audit)

1. **Does the Claude CLI binary auto-reject `tool_use` blocks for any name not in its registered list?** I read the strings; I did not test the executable directly with a controlled prompt. Until verified, "the CLI auto-rejects" is an inference from O1+O2, not a proven mechanism.
2. **What does `--allowedTools <unregistered-name>` do?** Per `claude --help` it is described as a filter, not a registration. Untested.
3. **What does `--mcp-config` actually require for the CLI to expose a tool as callable?** The plan `docs/superpowers/plans/2026-04-11-platform-mcp-tool-server-implementation.md` describes the proposed wiring; the actual implementation surface inside the CLI binary is not documented here.
4. **Is the right fix to revert PR #405, change the system prompt shape to something the CLI won't intercept, wire `--mcp-config`, or something else?** Each has trade-offs; none has been tested.
5. **Were there any successful `anthropic-sub` → side-effecting tool calls between 2026-04-30 and 2026-05-10 (the PR #405 window)?** I see none in `ToolExecution`; need to confirm there isn't a different audit table.

## Files

- `apps/web/lib/routing/cli-adapter.ts`
- `apps/web/lib/routing/codex-cli-adapter.ts`
- `apps/web/lib/routing/extract-tool-calls.ts`
- `Dockerfile.sandbox`
- `docs/superpowers/plans/2026-04-11-platform-mcp-tool-server-implementation.md`

## Archived evidence

- Sandbox CLI session log: copied to `D:/DPF/.claude/cli-session-64c.jsonl` (FB-D14EDB7C, 9 tool_use ↔ 9 tool_use_error pairs).
- Three additional session logs sampled (sess-023/121/13a) cover unrelated coworkers and show the same pattern: 100% of `tool_use` blocks → `tool_use_error`.

## What this audit does NOT do

- Does not propose a fix or rank options.
- Does not edit any code, prompt, or seed.
- Does not assert which of the candidate causes (PR #405 vs. CLI version vs. something else not yet noticed) is responsible.
- Does not assume the user-facing message is or is not faithful to the underlying mechanism.

Its only job is to record what I saw with file paths and IDs so the next investigator (or the same one, awake) can verify or refute each observation independently.
