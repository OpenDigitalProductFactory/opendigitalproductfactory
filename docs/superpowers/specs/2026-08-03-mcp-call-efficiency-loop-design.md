---
status: active
---

# MCP Call Efficiency Loop (BI-A08EBAEC) — Design

## Problem

External MCP clients (Claude/Codex/Grok) and in-portal coworkers burn tokens via high tool-call volume, retries, and thrash (same tool many times per thread). Operators lack a continuous loop that **measures** governed tool calls and **files** concrete optimization actions (skills, tool merge, webhooks, instruction fixes).

## Research & Benchmarking

| Source | What we adopt | What we reject |
|--------|---------------|----------------|
| [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) | Vocabulary: `execute_tool`-like spans, tool name, success, duration, token usage, surface/session identity. Map onto existing `ToolExecution` fields rather than exporting OTel first. | Full OTel export pipeline in this slice — later optional bridge. |
| [Langfuse MCP tracing / agent observability](https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse) | Sequence analysis (thrash, unnecessary tool chains), dashboards for success rate + latency, optimize workflows from traces. | Third-party SaaS dependency for core ledger; DPF keeps `ToolExecution` as SoT. |
| LangSmith-style full agent traces | End-to-end agent run trees for deep debug. | Requiring every path to emit full prompt payloads (privacy + volume). |

**Verdict:** Keep `ToolExecution` as the single ledger; add **analytics + periodic findings** that recommend skills / tool changes / webhooks. Align field names with GenAI conventions in comments and report JSON (`tool.name`, `usage`, surface).

## Completeness inventory (slice 1)

| Path | Writes `ToolExecution`? | Notes |
|------|-------------------------|--------|
| `/api/mcp/v1` `tools/call` | Yes via `governedExecuteTool` | `executionMode` = `external-jsonrpc` or `internal-mcp-session`; `apiTokenId` when PAT. |
| `/api/mcp/v1` `tools/list` | **No** | Gap: discovery thrash invisible. Slice 1 documents; optional metrics_only later. |
| Portal coworker / agentic-loop | Yes | `executionMode` = `agentic-loop`. |
| REST `/api/mcp/call` | Yes | `executionMode` = `rest` / `jsonrpc`. |
| Build Studio sandbox tools | Partial | Via governed execute when tools go through it; native sandbox runner also creates rows. |
| Denied auth before execute | **No** | Gap: failed tokens not in ledger. Track as follow-up. |

**Enough detail to optimize?** **Partially.** Volume, thrash, failure rate, surface, duration, and skill id are enough for high-value findings. Missing: tools/list, denied-auth, full multi-turn LLM token cost per MCP call (tokens on tool rows often null).

## Analytics contract

### Dimensions
- **Surface:** `executionMode` (+ `apiTokenId` present ⇒ external PAT)
- **Identity:** `agentId`, `userId`, `threadId`, `taskRunId`, `skillId`
- **Tool:** `toolName`, success, governed-refusal flag, `durationMs`
- **Window:** default 24h, max 7d

### A governed refusal is not a tool failure
`ToolExecution.success` is false for two different events: a tool that broke, and a gate that correctly said no. Counting them together makes a working gate read as a misbehaving tool. Measured on the live install over seven days (2026-09-02): of ~5,700 failed executions, ~4,900 were governed refusals — `gate_evidence_blocked` alone was 4,520 — against ~235 genuine caller defects (`missing_required`, `invalid_input`, `invalid_status`).

`refusal-codes.ts` holds the closed list, read from the tool's own `result.error`. Refusals are excluded from `failCount` **and** from the `high_failure` denominator, so a tool is rated on the calls it was answerable for; they are reported separately as `refusalCount`. The list is deliberately conservative — an unrecognised code stays a failure, because a missed finding is re-detected on the next scan while a wrongly-excused fault is not.

A `retry_storm` whose pairs are mostly refusals is still reported (retrying a non-retryable refusal is waste, and the loop cannot end by succeeding) but is worded to point at the caller's retry loop rather than at the tool or its instructions.

### Finding kinds
1. `thrash` — same tool ≥ N times in one thread within window  
2. `retry_storm` — failure followed by same tool again quickly  
3. `high_volume` — top tools by count (relative + absolute floor)  
4. `high_failure` — fail rate ≥ threshold with minimum sample  

### Recommended actions (enum)
- `add_skill` — multi-step playbook missing  
- `merge_tools` / `richer_tool` — too many list-then-get hops  
- `webhook_or_event` — poll-style re-query of status tools  
- `fix_instructions` — bad params / repeated fails on same tool  
- `investigate` — needs human judgment  

## Improvement loop

1. **On demand:** MCP tool `analyze_mcp_call_efficiency` (optimization pack).  
2. **Scheduled:** daily Inngest job (06:15 UTC) runs same analysis; posts `PlatformNotification` when high-severity findings exist.  
3. **Closed loop (slice 2):** when warning/critical findings exist:
   - Persist full report as `TaskArtifact` (`metadata.kind=mcp-call-efficiency-report`) under a proactive `TaskRun` owned by `platform-engineer`.
   - Touch `ImprovementSignal` rows (`sourceType=mcp-call-efficiency`, `sourceId=kind:toolName`) for every actionable finding.
   - **Immediately file backlog items** for **critical** findings via `ingestBacklogItem` (prefix `BI-MCP-EFF-*`, workType from recommended action).
   - Enqueue a **one-shot** `ScheduledAgentTask` (`mcp-efficiency-aiops-YYYYMMDD`) for the AI Ops coworker with a mandate prompt; `agent/task-dispatch` runs it within ~5 minutes; task deactivates after one fire.
4. **Human/AI Ops:** coworker reviews remaining warnings, avoids re-filing already-sourced BIs, proposes skill/tool/webhook work.

Later slices: tools/list metrics_only; OTel export; authority UI panel; auto-promote selected BIs to Build Studio.

## Slice 1 deliverables

- Pure analysis + DB loader  
- MCP tool + grants  
- Daily cron + notification  
- Design + unit tests  
- No new Prisma models  

## Slice 2 deliverables (this PR)

- `dispatchMcpEfficiencyAiOps` handoff module + unit tests  
- Cron wires `dispatchAiOps: true` + scheduled owner principal  
- Critical BI auto-file + ImprovementSignals + TaskRun artifact  
- One-shot platform-engineer review task  
- MCP tool gains optional `dispatchAiOps`  
- Catalog purpose updated  

## Docs impact

Operator-facing: tool appears in MCP tool list for agents with `agent_control_read`; daily job purpose describes AI Ops dispatch. Architecture: this design note. No user-guide route until a portal page ships.
