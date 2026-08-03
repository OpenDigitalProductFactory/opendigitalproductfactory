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
- **Tool:** `toolName`, success, `durationMs`
- **Window:** default 24h, max 7d

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
3. **Human/AI Ops:** act on findings → skill, pack, or webhook BI.  

Later slices: file `ImprovementProposal` / backlog automatically; tools/list metrics_only; OTel export; authority UI panel.

## Slice 1 deliverables

- Pure analysis + DB loader  
- MCP tool + grants  
- Daily cron + notification  
- Design + unit tests  
- No new Prisma models  

## Docs impact

Operator-facing: tool appears in MCP tool list for agents with `agent_control_read`. Architecture: this design note. No user-guide route until a portal page ships.
