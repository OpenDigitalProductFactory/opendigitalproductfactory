# Codex CLI JSONL probe — local evidence

**Date:** 2026-04-29
**Container:** dpf-sandbox-1
**Codex version:** codex-cli 0.125.0
**Purpose:** Capture actual `codex exec --json` event stream to ground audit Q1.

## Probe 1 — basic exec with shell command (default model)

Command:
```
codex exec --json --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox \
  "Run the shell command: echo hello-from-codex. Then say done."
```

Stream:
```jsonl
{"type":"thread.started","thread_id":"019ddb89-fb33-7f31-87cc-6d455b3067fa"}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/sh -lc 'echo hello-from-codex'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"/bin/sh -lc 'echo hello-from-codex'","aggregated_output":"hello-from-codex\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done"}}
{"type":"turn.completed","usage":{"input_tokens":28803,"cached_input_tokens":26368,"output_tokens":38,"reasoning_output_tokens":0}}
```

## Probe 2 — reasoning effort high, simple answer

Command:
```
codex exec --json -c reasoning.effort=high "Think briefly about 2+2, then answer."
```

Stream:
```jsonl
{"type":"thread.started","thread_id":"019ddb8a-21ca-7493-b1bf-eb002585bcc7"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"2 + 2 = 4"}}
{"type":"turn.completed","usage":{"input_tokens":14353,"cached_input_tokens":12160,"output_tokens":21,"reasoning_output_tokens":8}}
```

Note: `reasoning_output_tokens: 8` is reported in usage, but no `reasoning` item was emitted in the stream for this short turn. May surface as `item.completed` with `type: reasoning` for longer turns.

## Probe 3 — gpt-5 explicitly (failure case for ChatGPT auth)

Command:
```
codex exec --json -m gpt-5 "Reply with one short sentence. Then stop."
```

Stream:
```jsonl
{"type":"thread.started","thread_id":"019ddb89-dca6-7593-afcf-fa9e6ea7b201"}
{"type":"turn.started"}
{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-5' model is not supported when using Codex with a ChatGPT account.\"}}"}
{"type":"turn.failed","error":{"message":"..."}}
```

## Surface inventory (`codex --help` and `codex exec --help`)

Subcommands of interest:
- `exec` — non-interactive run (with `--json`, `--output-schema`, `--output-last-message`, `--ephemeral`)
- `exec resume` — resume by session UUID or `--last`
- `mcp` — list / get / add / remove / login / logout MCP servers (static, in `~/.codex/config.toml`)
- `mcp-server` — Codex itself runs as an MCP server over stdio
- `apply` / `a` — applies the latest agent diff via `git apply` to local working tree
- `sandbox` — run commands in the Codex sandbox
- `exec-server` (experimental) — standalone exec service
- `cloud` (experimental) — Codex Cloud task browser
- `review` — non-interactive code review

Flags of interest on `exec`:
- `--json` (JSONL stream)
- `--output-schema <file>` (JSON Schema for final response — gpt-5 family only per issue #4181)
- `--output-last-message <file>` (final message only)
- `--ephemeral` (no session persistence)
- `-s read-only|workspace-write|danger-full-access` (sandbox modes)
- `--add-dir <DIR>` (extra writable dirs)
- `-C, --cd <DIR>` (working root)
- `--ignore-user-config`, `--ignore-rules`
- `--skip-git-repo-check`

## Observed event taxonomy

From these probes plus issue research:

| `type` | When | Fields |
|---|---|---|
| `thread.started` | first event | `thread_id` (UUID) |
| `turn.started` | per turn | — |
| `item.started` | tool/cmd begins | `item.{id,type,...}` |
| `item.completed` | tool/cmd ends, or message | `item.{id,type,text/command/...}` |
| `turn.completed` | success | `usage.{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens}` |
| `turn.failed` | failure | `error.{message}` |
| `error` | mid-turn error | `message` |

`item.type` values seen / documented: `agent_message`, `command_execution`, `reasoning`, `file_change`, `mcp_tool_call`, `web_search`, `plan_update`.

## Stability caveats (from agent research)

- `--json` was `--experimental-json` until recently; underlying schema is not versioned.
- Silent breaking rename observed in recent versions: `item_type` → `type`, `assistant_message` → `agent_message` (issue #4776).
- `--json` and `--output-schema` are silently ignored when MCP tools are active (issue #15451).
- MCP lifecycle events (init/ready/failed) are not yet emitted (issue #17501).
- No schema version field in events.
