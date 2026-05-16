# Coworker Execution Substrate - Status Review and Direction

| Field | Value |
| --- | --- |
| **Generated** | 2026-04-29 |
| **Author** | Codex, updating Claude Opus 4.7's initial status review at Mark's request |
| **Status** | Status review and direction proposal; ready to promote into a design spec |
| **Sibling audits** | [Persona audit](./2026-04-27-coworker-persona-audit.md), [Tool-grant audit](./2026-04-27-coworker-tool-grant-audit.md), [Self-assessment](./2026-04-28-coworker-self-assessment.md) |
| **Question being answered** | Should the AI Coworker panel use Claude Code CLI / Codex CLI as execution substrates instead of, or alongside, direct provider HTTP so non-CLI users can benefit from harness-native capabilities such as slash commands, MCP, hooks, subagents, plan mode, todos, web access, and richer execution traces? |
| **Out of scope** | New tool implementations, persona rewrites, A2A task substrate implementation, public protocol exposure. Those have separate specs or audits. |

---

## 1. Executive Assessment

The coworker panel is currently an HTTP-first product surface with a partial and mostly invisible CLI path. Build Studio already proves that DPF can run Claude Code and Codex as subprocess substrates, but the panel does not yet present the richer state those harnesses can produce.

The architectural opportunity is real, but the sharp edge is also real: **a CLI is not just another model provider**. It is an execution harness with its own permissions, session lifecycle, event stream, filesystem posture, MCP attachment model, hooks, and cost / quota behavior.

The next design should therefore make **execution adapter** a first-class routing dimension alongside provider, model, capability, sensitivity, and cost. It should not hard-code "Claude CLI" or "Codex CLI" as special cases in inference code.

Recommended direction:

1. Model HTTP, Claude Code CLI, Codex CLI, and local adapters as explicit execution adapters.
2. Add adapter capability probes instead of relying on static assumptions about CLI features.
3. Support single, shadow, and race execution modes through routing policy.
4. Preserve HTTP paths for latency-sensitive, low-cost, and utility work.
5. Surface CLI-native events in the coworker UI only after they are normalized into DPF task / tool / approval / artifact events.
6. Spend at least 20% of the implementation budget on refactoring adapter boundaries, event normalization, and panel state separation before adding new user-visible controls.

The winning architecture is not "put Claude Code inside chat." It is a governed execution substrate that can route across harnesses honestly and show users what each harness actually did.

## 2. Current Repo Truth

### 2.1 Coworker panel is HTTP-first

The main panel path starts in [agent-coworker.ts](../../../apps/web/lib/actions/agent-coworker.ts). The flow resolves a route-aware agent, assembles context, arbitrates the prompt budget, and calls into routed inference.

Current stack:

- [routed-inference.ts](../../../apps/web/lib/routing/routed-inference.ts) ranks endpoints and handles fallback.
- [adapter-registry.ts](../../../apps/web/lib/routing/adapter-registry.ts) maps providers to HTTP adapters.
- [chat-adapter.ts](../../../apps/web/lib/routing/chat-adapter.ts) performs provider HTTP calls.
- [agentic-loop.ts](../../../apps/web/lib/tak/agentic-loop.ts) handles platform tool calls, proposal interruptions, and `ToolExecution` audit rows.

That means the normal panel experience is controlled by DPF's own tool registry and HTTP routing path. It is not a native Claude Code or Codex session from the user's point of view.

### 2.2 Build Studio already uses CLI substrates

Build Studio has separate subprocess dispatch paths:

- [claude-dispatch.ts](../../../apps/web/lib/integrate/claude-dispatch.ts) runs Claude Code inside the sandbox container.
- [codex-dispatch.ts](../../../apps/web/lib/integrate/codex-dispatch.ts) runs Codex inside the sandbox container.

Those paths are proof that DPF can operate CLI substrates, preserve branch/worktree context, and collect structured results. They are not yet the same execution contract as the coworker panel.

### 2.3 Partial coworker CLI support exists, but it is not a product surface

[cli-adapter.ts](../../../apps/web/lib/routing/cli-adapter.ts) already parses Claude Code stream output for some tool-use events. The path is gated by routing state and is not exposed as a general panel substrate.

The important gap is not only "can the CLI run?" It is:

- Does the adapter preserve session state?
- Does it normalize events?
- Does it attach MCP servers safely?
- Does it expose hooks and subagents in a governed way?
- Does the panel know how to render the state without turning into a raw terminal transcript?
- Does cost, token, duration, and quota telemetry land in the same ledger as HTTP inference?

Today the answer is partial at best.

## 3. Capability Gap

The panel currently cannot reliably expose harness-native capabilities as first-class user experiences.

| Capability | Claude Code CLI | Codex CLI | Coworker panel today | Architectural implication |
| --- | --- | --- | --- | --- |
| Slash commands / skills | Supported by Claude Code docs | Varies by Codex client surface | Not represented as panel commands | Needs command capability discovery and DPF permission mapping |
| MCP attachment | Supported | Supported by Codex configuration docs | Platform tools only, statically routed | Needs adapter-level MCP profile and token hygiene |
| Subagents | Supported by Claude Code docs | Not equivalent in current local path | Not rendered | Needs task/delegate event normalization |
| Hooks | Supported by Claude Code docs | Not equivalent in current local path | Not rendered | Needs policy review before exposing |
| Plan / todo state | Harness-specific | Harness-specific | Not first-class | Needs normalized task state, not transcript scraping |
| Web fetch / search | Harness or tool dependent | Harness or model dependent | Partial platform support only | Needs explicit grant and route sensitivity checks |
| Session continuity | CLI session IDs | Codex session behavior depends on client mode | DB thread continuity | Needs session lifecycle abstraction |
| Sandboxed command execution | CLI-native in sandbox | CLI-native in sandbox | Indirect through platform tools | Needs clear boundary between harness tools and DPF tools |

The table should not become a permanent hand-maintained claim. It should be generated or checked by adapter probes as part of implementation.

## 4. Research and Benchmarking

This status review draws on current public product patterns and official documentation. The useful pattern is not that every platform has the same features; it is that mature agent systems expose execution state, permission boundaries, and long-running work as product concepts instead of hiding them inside a transcript.

### 4.1 Open-source and standards-led references

1. **Claude Code**
   - Official docs describe slash commands / skills, subagents, hooks, and MCP-aware hook behavior.
   - Adopt: treat harness-native features as discoverable capabilities.
   - Reject: assuming the raw Claude Code transcript is the right DPF product UI.

2. **OpenAI Codex / Codex CLI**
   - Official docs and the OpenAI Codex repo describe non-interactive `codex exec` and MCP configuration patterns.
   - Adopt: keep Codex as a first-class execution adapter, especially for repo work and MCP-aware coding sessions.
   - Reject: claiming Claude Code feature parity where the client does not expose an equivalent structured event contract.

3. **A2A / task-native agent protocols**
   - Adopt: task, message, artifact, and status events as the projection shape for cross-agent work.
   - Reject: treating protocol compatibility as a substitute for DPF's `TAK` runtime controls.

### 4.2 Commercial references

1. **OpenAI background / long-running agent work**
   - Adopt: long-running work should be pollable, cancellable, and decoupled from one synchronous chat turn.
   - Reject: outsourcing DPF's canonical task state to provider-owned response objects.

2. **Copilot Studio approvals**
   - Adopt: approvals belong in explicit workflow state with clear user action surfaces.
   - Reject: burying approvals in chat text or one-off cards without durable task linkage.

3. **Salesforce Agentforce-style action governance**
   - Adopt: action boundaries and guardrails should be visible in the product.
   - Reject: vague "agent can do everything" personas that make capability discovery trial-and-error.

## 5. Architectural Direction

### 5.1 Execution adapter becomes a routing dimension

The routing plan should carry an execution adapter, not infer one from provider ID.

```ts
type ExecutionAdapterKind = "http" | "claude-code-cli" | "codex-cli" | "local-runtime";

type AdapterCapabilityProfile = {
  adapterKind: ExecutionAdapterKind;
  supportsStreamingEvents: boolean;
  supportsMcpAttach: boolean;
  supportsSubagents: boolean;
  supportsHooks: boolean;
  supportsPlanState: boolean;
  supportsTodoState: boolean;
  supportsWebAccess: boolean;
  supportsSessionResume: boolean;
  maxInteractiveLatencyMs: number;
  supportedAuthModes: Array<"api-key" | "oauth" | "local">;
};
```

Adapter capability is observed and cached. It should not be assumed forever from a provider name or a doc table.

### 5.2 Separate model provider from execution harness

The current mental model tends to combine:

- Anthropic provider
- Claude model
- Claude Code CLI harness
- OAuth subscription quota

Those are separate concerns.

Likewise:

- OpenAI provider
- Codex model family
- Codex CLI harness
- ChatGPT / API auth posture

The router needs to know the difference. A model can be reachable through more than one adapter, and an adapter can carry harness capabilities unrelated to model quality.

### 5.3 Single, shadow, and race modes

The platform should support three execution modes:

| Mode | Behavior | Default use |
| --- | --- | --- |
| `single` | Run one selected adapter and return result | Normal production work |
| `shadow` | Run the selected adapter live, run one or more alternatives in the background, log comparison only | Calibration, rollout, regression detection |
| `race` | Run multiple adapters, accept the first policy-valid result, cancel or ignore the rest | Latency-sensitive or degraded-provider scenarios |

Shadow and race modes must be budgeted, sampled, and kill-switchable. They cannot be a hidden spend multiplier.

### 5.4 Outcome scoring must be adapter-aware

Adapter selection should score more than model rank.

Minimum outcome dimensions:

- task success
- user acceptance
- latency
- token cost
- subscription quota consumption
- tool-call validity
- artifact quality
- policy violations
- provider or harness degradation
- retry rate
- whether harness-native capabilities materially helped

The useful metric is not "fastest answer." It is "lowest-risk accepted outcome for this task class."

## 6. Product and UI Direction

### 6.1 Do not expose raw harness complexity

The coworker panel should not become a terminal emulator or a Claude Code clone. Most users do not need to see raw hook payloads, subprocess logs, or internal command syntax.

The product surface should translate harness events into DPF-native states:

- task started
- plan proposed
- todo added / completed
- tool used
- subtask delegated
- approval required
- artifact produced
- verification passed / failed
- adapter degraded

### 6.2 Add a compact execution cockpit

The panel should evolve from a transcript drawer into a compact execution cockpit:

- **Header:** coworker identity, selected adapter, trust / health badge, current route or workspace.
- **Status rail:** active task, pending approval, adapter health, memory health, delegated work count.
- **Transcript:** human and coworker messages, plus only the task events needed for understanding.
- **Artifacts:** generated files, specs, verification output, evidence summaries.
- **Approvals:** pending proposal cards with scope, effect, and post-approval result.
- **Trace:** provider / adapter, tool calls, MCP sources, latency, token / cost summary.

This is especially important if CLI adapters are introduced. CLI sessions produce more internal state than HTTP calls. Without a better UI shape, that state will either disappear or flood the transcript.

### 6.3 Theme and usability constraints

Any panel changes must follow DPF's theme-aware styling standard:

- no hardcoded colors
- CSS variables for text, surfaces, borders, accents, warnings, and errors
- progressive disclosure for trace detail
- dense operational UI, not a marketing layout
- visible trust and health state
- responsive panel behavior that does not hide approvals or task status on smaller screens

## 7. Governance and Security Requirements

### 7.1 CLI adapters are higher-risk than HTTP adapters

HTTP inference usually sees a bounded prompt, bounded tools, and provider API credentials.

CLI harnesses may additionally see:

- filesystem state
- project instructions
- MCP server configuration
- shell tools
- hooks
- long-lived session files
- OAuth credentials
- subprocess environment

That does not make CLI wrong. It makes it a higher-governance adapter.

### 7.2 Required controls

Before the panel can use CLI adapters broadly, DPF needs:

- adapter-specific tool grants
- route sensitivity checks for CLI access
- explicit MCP server allowlist and token scoping
- workspace/session isolation
- filesystem write policy
- hook policy and audit
- unified `ToolExecution` / action receipt logging
- cost and duration capture for CLI runs
- operator-visible degradation state

### 7.3 `TAK` and `GAID` fit

`TAK` should govern the execution adapter as part of the operating profile. The adapter is material runtime state because it changes tools, context, autonomy, and evidence quality.

`GAID` should treat adapter posture as part of the versioned operating profile, not the stable agent identity. The same coworker may keep the same identity while switching from HTTP to CLI, but that switch changes the receipt and evidence story.

## 8. Refactor Budget

The next implementation plan should reserve **at least 20% of the token / engineering budget for refactoring**. This is not polish. It is the cost of making the substrate maintainable.

Required refactor areas:

1. **Adapter contract extraction**
   - Pull execution adapter selection out of provider-specific special cases.
   - Create one interface for HTTP, CLI, and local runtime adapters.

2. **Event normalization**
   - Convert harness-native events into DPF task/tool/artifact/approval events.
   - Keep raw adapter payloads as trace detail, not primary UI state.

3. **Session lifecycle service**
   - Own CLI session IDs, thread-to-session mapping, workspace isolation, timeout, resume, and cleanup.

4. **Cost and outcome ledger**
   - Capture duration, token estimates, provider cost, subscription quota impact, acceptance, retries, and failure class for every adapter run.

5. **Panel state separation**
   - Separate transcript state from task state, artifact state, approval state, and trace state.

If the implementation skips these refactors, it will likely produce a demo that works once and a substrate that becomes expensive to reason about.

## 9. Open Questions Before Spec Promotion

1. **Codex structured output:** What structured event stream does the local Codex path expose today, and is it stable enough for UI rendering?
2. **Session pooling:** Should CLI panel work use long-lived per-thread sessions, pooled sandbox sessions, or per-task sessions?
3. **MCP boundary:** Which MCP servers can be attached to panel-driven CLI sessions, and how are tokens scoped?
4. **Provider quota strategy:** Should the router intentionally spread load across HTTP and CLI quota pools for the same provider family?
5. **Shadow sampling:** What percentage of production work can be shadowed without creating unacceptable spend?
6. **Race acceptance:** If two adapters disagree, what makes one result policy-valid enough to accept?
7. **User visibility:** How much adapter identity should a normal user see by default, versus an operator or admin?
8. **Artifact custody:** When a CLI writes or proposes file changes, which object owns the evidence: task artifact, tool execution, Build Studio record, or all three through one receipt?

## 9b. Research findings against the open questions

Three background agents plus a live `docker exec dpf-sandbox-1 codex exec --json` probe were run on 2026-04-29 to ground the questions above. Raw transcript at [evidence/2026-04-29-codex-jsonl-probe.md](./evidence/2026-04-29-codex-jsonl-probe.md). Findings below; answers replace assumptions in §3 and §6.

### Q1 — Codex structured output: stream exists, schema is unstable, MCP attach is degraded

**Confirmed empirically.** Codex CLI 0.125.0 exposes `codex exec --json`, emitting a normalized envelope:

```jsonl
{"type":"thread.started","thread_id":"019ddb89..."}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_0","type":"command_execution",...}}
{"type":"item.completed","item":{"id":"item_0","type":"command_execution","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done"}}
{"type":"turn.completed","usage":{"input_tokens":...,"reasoning_output_tokens":...}}
```

Item types observed/documented: `agent_message`, `command_execution`, `reasoning`, `file_change`, `mcp_tool_call`, `web_search`, `plan_update`. This is **richer than §3's table assumed** — Codex *does* emit plan/todo state and structured tool calls.

**However — three landmines:**

1. **Unversioned schema, recent silent breaks.** `--json` was `--experimental-json` until recently. Issue [openai/codex#4776](https://github.com/openai/codex/issues/4776) documents a silent rename in the last 6 months: `item_type → type` and `assistant_message → agent_message`. No `schema_version` field exists.
2. **`--json` is silently ignored when MCP tools are active** (issue [#15451](https://github.com/openai/codex/issues/15451)). This is a showstopper for the substrate vision unless we pin a Codex version and add a runtime guard.
3. **MCP attach is static-only.** Servers must live in `~/.codex/config.toml`; no per-invoke `--mcp-config` like Claude Code. The `codex mcp` subcommand mutates user config.

**Bonus surface the audit didn't anticipate:**

- `codex mcp-server` — Codex itself runs as an MCP server over stdio. DPF could expose Codex *to* coworkers via MCP, in addition to (or instead of) shelling out.
- `codex exec resume <uuid>` and `--last` — built-in session continuity, relevant to Q2.
- `codex apply` — applies the latest agent diff via `git apply` to the local working tree, relevant to Q8.
- `--output-schema <file>` — JSON Schema validation of the final response (gpt-5 family only per issue [#4181](https://github.com/openai/codex/issues/4181)).

**Implication for spec.** The cli-adapter for Codex must:
- pin a Codex version and reject divergent stream shapes loudly,
- detect "MCP active + `--json` requested" and refuse the run with a clear error rather than parse malformed output,
- normalize Codex's `item.completed` envelope and Claude Code's `tool_use` blocks into one DPF event taxonomy (the §6.1 normalized states),
- treat the `mcp-server` mode as a separate adapter strategy worth its own §5 row, not a footnote.

§3's row "Subagents — Codex: Not equivalent" stands. Row "Plan / todo state — Codex: Harness-specific" upgrades to "yes, via `plan_update` items, when MCP isn't active."

### Q2 — Session pooling: current model is per-task; per-thread is the right target but needs schema + concurrency work

**Current state (per-task, ephemeral):**
- Build Studio dispatches at [claude-dispatch.ts:238-239](apps/web/lib/integrate/claude-dispatch.ts#L238) pass `--session-id` only when explicitly provided; the build orchestrator deliberately omits it ([build-orchestrator.ts:906-962](apps/web/lib/integrate/build-orchestrator.ts#L906)) because Claude Code's `--session-id` is single-use and parallel tasks collide on it.
- Containers are long-lived (sandbox pool of 3 per docker-compose, default `DPF_SANDBOX_POOL_SIZE=3`); each task is a fresh `docker exec`, not a fresh container. That's good — cold-start cost is at the CLI level, not Docker.
- **No `cliSessionId` column anywhere in `AgentThread` or `AgentMessage`** ([schema.prisma:2642-2676](packages/db/prisma/schema.prisma#L2642)). Thread continuity is semantic only.
- **No workspace isolation between concurrent tasks** — all share `/workspace`. For Build Studio this is tolerated; for a coworker panel running CLI per turn this is a correctness hazard.
- No orphan-session sweeper, no resume-from-checkpoint mid-task. Timeout = `SIGTERM` and abandon.

**Answer to the open question.** The right substrate target is **per-thread long-lived sessions, with per-task ephemeral sessions as fallback for parallel work**. Reasoning:

- Per-task: cheapest, already shipping, but loses the harness's plan/todo/memory state across coworker turns. Defeats the whole point of using a CLI in the panel.
- Pooled-sandbox: container pool already exists, but pooling at the *container* layer doesn't solve session continuity, only resource contention.
- Per-thread: session ID survives across panel turns within one thread → plan/todo/MCP state persists → matches user mental model.

**What per-thread requires (delta to today):**
1. `AgentThread.cliSessionId` (or `AgentMessage.cliSessionId` for finer-grain resume) added to Prisma schema.
2. Sandbox pool affinity: thread T pinned to sandbox container N for the duration of its session, so the session file on disk is reachable.
3. Concurrency rule: parallel tasks within one thread must serialize on the session OR fall back to per-task ephemeral mode. Codex's `--ephemeral` + Claude's "no session-id" path is the fallback contract.
4. Session expiry / cleanup: stale-session sweeper (TTL on `cliSessionId` last-use timestamp) so abandoned threads don't pin sandbox slots forever.
5. Resume-on-restart: `codex exec resume <uuid>` and Claude's session reuse both already support this; DPF just needs to record the session UUID and the working directory.

§5.2's claim that "execution adapter is independent of provider+model+auth" stands; per-thread sessions are the *adapter-side* of that decomposition.

### Q8 — Artifact custody: dependency, not a question

**This is already specified.** The receipts design lives at [docs/superpowers/specs/2026-04-27-artifact-provenance-receipts-design.md](../specs/2026-04-27-artifact-provenance-receipts-design.md) — proposes a unified `ToolExecutionReceipt` table linking `FeatureBuild` evidence fields to actual execution receipts. Not yet implemented.

**Today's state — three unlinked ledgers:**
- `ToolExecution` ([schema.prisma:2775](packages/db/prisma/schema.prisma#L2775)) — written by [agentic-loop.ts:1027](apps/web/lib/tak/agentic-loop.ts#L1027) on every coworker tool call. **No `buildId` field.**
- `FeatureBuild` JSON evidence columns ([schema.prisma:2960](packages/db/prisma/schema.prisma#L2960)) — written by `saveBuildEvidence` ([mcp-tools.ts:4029-4174](apps/web/lib/mcp-tools.ts#L4029)). **No provenance check** — agents can claim `verificationOut: {typecheckPassed: true}` without anything having run.
- `BuildActivity` ([schema.prisma:3169](packages/db/prisma/schema.prisma#L3169)) — one-line summary log, has `buildId`, no link to the `ToolExecution` it summarizes.
- `TaskArtifact` (TAK substrate) — separate orchestrator, unlinked to the above.

**CLI dispatch is currently a provenance black hole.** [claude-dispatch.ts](apps/web/lib/integrate/claude-dispatch.ts) returns `executedTools: []` hardcoded. Tool calls Claude Code makes inside its sandbox session never reach `prisma.toolExecution`. Same gap for Codex.

**Answer to the open question.** Don't redesign Q8 in this spec. Two clauses suffice:

1. **Hard dependency.** The substrate spec depends on the receipts spec landing first, or at least its `ToolExecutionReceipt` table.
2. **One CLI-specific clause.** The cli-adapter must mint `ToolExecution` rows (and eventually receipts) for the CLI's *own* tool calls, parsed from its event stream. Specifically:
   - Claude Code: `tool_use` blocks → one `ToolExecution` row each.
   - Codex: `item.completed` with `type ∈ {command_execution, mcp_tool_call, file_change, web_search}` → one row each.
   - Each row carries the CLI session ID + adapter kind so the receipt ledger sees CLI work as a first-class participant.

This is the smallest delta that closes the black hole without re-litigating receipts design.

### Q3, Q5, Q6, Q7 — design decisions, stated in the spec, not researched

These are choices, not discoveries. The spec section answering each:

- **Q3 MCP boundary** — adapter-specific allowlist field on the route plan; tokens scoped per-thread, not per-install; sensitivity floor (e.g., the GitHub MCP requires elevated route sensitivity). Codex's static-only attach (§Q1) means the allowlist enforcement happens at config-load time, not invoke time.
- **Q5 shadow sampling** — formula, not a number: `max_shadow_rate = monthly_shadow_budget / (avg_run_cost × monthly_run_count)`, default cap 5%, kill switch via env flag. Spec defines the formula and the override surface; ops sets the budget.
- **Q6 race acceptance** — first result that is (a) non-error, (b) non-refusal, (c) policy-pass, (d) tool-call-valid (no fabricated tool names), (e) within latency budget. Losing adapters logged for calibration but not surfaced to user.
- **Q7 user visibility** — three roles. Default user: model name + adapter health badge only. Operator: + adapter kind, latency, cost. Admin: + full route plan, capability profile, shadow comparison. Aligns with §6.2 cockpit progressive disclosure.

### Q4 — provider quota spreading: yes, intentionally

Per the [CLI vs API rate limits memory](memory/project_cli_vs_api_rate_limits.md), CLI and Messages API have separate quota pools. The routing policy *should* intentionally spread load across HTTP and CLI for the same provider family — it's a free reliability win against rate-limit storms. Spec to define: per-provider-family quota model with two pool descriptors (api-key pool, oauth/cli pool), and a load balancer that prefers the less-saturated pool when both are policy-valid for the task.

---

## 10. Recommended Next Spec

Promote this audit into a design spec under [docs/superpowers/specs](../specs/) with a name like:

`2026-04-29-cli-execution-adapter-routing-design.md`

That spec should define:

- `ExecutionAdapter` and `AdapterCapabilityProfile`
- adapter capability probe and cache behavior
- routing changes needed to remove hard-coded CLI special cases
- shadow and race mode policy
- cost, quota, and outcome ledger schema
- normalized panel event protocol
- CLI session lifecycle and cleanup rules
- MCP, hook, filesystem, and OAuth boundaries
- first implementation slice with the 20% refactor allocation called out explicitly

## 11. Final Recommendation

Proceed, but do it as substrate work rather than a feature toggle.

The coworker panel should be able to use Claude Code CLI, Codex CLI, HTTP providers, and local runtimes through one governed adapter model. The UI should show normalized task, approval, artifact, health, and trace state rather than raw harness output. Shadow and race modes are valuable, but only after telemetry and budget controls exist.

This is a strong direction for DPF because it turns provider volatility into a routing concern, not a recurring architecture emergency.

## References

- [Claude Code slash commands and skills](https://code.claude.com/docs/en/slash-commands)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [OpenAI Codex non-interactive mode](https://github.com/openai/codex/blob/main/docs/exec.md)
- [OpenAI Docs MCP setup for Codex and other clients](https://developers.openai.com/learn/docs-mcp)
