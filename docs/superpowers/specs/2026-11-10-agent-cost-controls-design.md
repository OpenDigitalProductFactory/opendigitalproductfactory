---
status: draft
---

# Experience-driven agent cost controls and tooling repair

Status: draft; implementation not admitted. Backlog: BI-7B1D74B3. Workroom: WC-37CCCC19.

## Objective and scope

**OBJ-1:** Reduce repeated discovery through evidence-backed learning across sessions.
**OBJ-2:** Reduce unused tool-definition context without reducing authorized capability.
**OBJ-3:** Redirect unsuccessful repetition while allowing useful progress.
**OBJ-4:** Turn tooling defects and missing capabilities into evidence-linked repair work.
**OBJ-5:** Apply the controls to platform coworkers and verified external executors, with honest support reporting and net-cost measurement.

The operator authorized all three TokenEconomizer mechanisms and explicitly added tooling gaps and issues on 2026-11-10. This is platform runtime work. No additional permission is required merely to move between delivery phases; existing action-specific gates still apply.

## Existing owners and implementation boundaries

| Concern | Existing source owner | Required extension |
|---|---|---|
| Learning | `apps/web/lib/tak/memory-consolidation.ts`, `memory-scope.ts`, `memory-corpus-promotion.ts` | Correlate independent evidence across sessions; only recall confirmed, current, authorized facts. Preserve provenance, contradiction handling, expiry and scope. |
| Tool selection | `apps/web/lib/tak/tool-intent.ts`, `apps/web/lib/mcp/tool-tier.ts` | Use demonstrated exposure and usage to propose smaller advertised sets between sessions. Keep discovery and required control tools available. Never change grants. |
| Loop recovery | `apps/web/lib/tak/runtime-issues.ts`, `agentic-loop.ts` | Detect repeated unsuccessful approaches even when arguments vary; issue bounded recovery guidance. Retain existing hard stops and refusal handling. |
| Tool repair | `apps/web/lib/operate/mcp-call-efficiency/analysis.ts`, `refusal-codes.ts`, `aiops-handoff.ts`; `apps/web/lib/work-management/stage-tool-gaps.ts` | Classify and deduplicate missing/broken-tool evidence through existing improvement signals and backlog ingestion; track repair verification. |
| External execution | `apps/web/lib/workroom-runtime/types.ts`, `codex-app-server-adapter.ts`, `claude-stream-adapter.ts`; `packages/dpf-skill-pack/client-capabilities.json` | Normalize observed tool outcomes and usage, inject bounded guidance through supported adapters, and publish verified capabilities. |
| Measurement | `apps/web/lib/tak/thread-cost-ledger.ts`, `context-economy-metrics.ts`, `apps/web/lib/routing/adapter-telemetry-writer.ts` | Attribute optimization overhead and outcomes through existing telemetry. Do not add a competing cost ledger. |

No new service, dependency, memory store, grant plane or ledger is proposed. Resolve exact existing persistence fields and event owners against refreshed source before extending contracts.

## Runtime behavior

1. Observe actual tool exposure, calls, outcome category, task/session identity and available usage through the existing execution owners. Missing telemetry is unknown, not zero usage or success. Deduplicate replayed adapter events before counting evidence.
2. Classify tool outcomes as success/progress, discovery miss, unsupported capability, invalid arguments, transient infrastructure/provider failure, confirmed defect, or governed refusal. Use typed codes first. Unclassified failures remain unknown; prose similarity alone cannot establish root cause.
3. Learn from independent sessions. Repeated evidence for a fact must retain source identities and revision/currency. A contradiction invalidates recall pending reconciliation. Conversation/tool output is data, never authority to rewrite doctrine or policy. Sensitive and personal facts retain existing scope restrictions.
4. Propose tool disclosure changes only from evidence that the tool was actually available. Absence of calls when a tool was not exposed is not disuse. Freeze the selected surface within a turn and prefer changes at a new session boundary to avoid prompt-cache churn. A task-required broken tool triggers repair, not concealment. Explicit restoration and discovery remain available.
5. Detect failure loops within the same authenticated run. Matching outcome categories and tool identity can reveal repetition despite changing arguments. A successful intervening recovery resets failure evidence. Long but progressing tasks and ordinary polling are not loops merely because they are long. Bound redirects and preserve cancellation, existing hard stops and refusal precedence.
6. Route durable tooling findings through existing improvement-signal and backlog ingestion, with stable origin keys and evidence references. Do not place raw arguments, secrets or private tool results in shared findings. Cap per-run findings. Repeated sightings update the existing signal rather than create duplicate work. Record repair owner/status and only resolve after observed functional verification.
7. Compare controls enabled/disabled on representative repeated tasks. Account for uncached input, cache reads/writes, output and optimization calls. Preserve unavailable billing as unavailable. Report task completion, false redirects, rediscovery/restoration, latency and net cost together.

## Execution surfaces

Platform coworker and native Build Studio runs use DPF's agent loop. Workrooms that launch supervised Codex/Claude executors need normalized external observations; the inspected RuntimeEvent currently reports turns/messages/requests, not complete tool outcomes and usage. Codex steering already exists and should be reused. Native audit-only CLI rows must not be mistaken for platform-dispatched calls.

Standalone external chats require independently verified client observation/injection paths. The inspected capability registry marks Codex desktop hooks unproven. Do not claim that attaching a workroom installs these controls in an already running desktop chat. Unsupported observation or injection returns explicit unavailable/unsupported status without breaking authorized task execution. Server-side learning, repair ownership and recovery must not depend on a client hook remaining alive.

## Acceptance

| Acceptance ID | Objective IDs | Statement |
|---|---|---|
| AC-1 | OBJ-1 | Independent-session evidence confirms a scoped fact; duplicate/replayed evidence does not count twice; contradiction, expiry or revoked access prevents recall. |
| AC-2 | OBJ-2 | Pruning changes advertised context only, retains discovery and required controls, supports restoration, and does not classify unavailable tools as unused. |
| AC-3 | OBJ-3 | Repeated failures with changed arguments receive bounded guidance; intervening progress prevents false loop detection; existing refusal and stop controls retain precedence. |
| AC-4 | OBJ-4 | Missing/broken tools create or update one evidence-linked repair signal; correct authorization refusals are not classified as tool defects. |
| AC-5 | OBJ-4 | Repair completion requires observed successful behavior, with owner and evidence preserved; pruning cannot hide an unresolved required-tool defect. |
| AC-6 | OBJ-5 | Platform and each supported external executor pass functional observation/injection checks; unsupported standalone hosts are identified explicitly. |
| AC-7 | OBJ-5 | Enabled/disabled comparisons include optimization overhead and cache pricing, and show completion quality and latency alongside net cost; unknown usage is not reported as zero. |

## Research and benchmarking

Primary sources inspected during this work:

| Implementation / standard | Adopt | Reject / DPF difference |
|---|---|---|
| [Microsoft TokenEconomizer](https://github.com/microsoft/TokenEconomizer), including `docs/ARCHITECTURE.md` | Separate mechanisms from host/domain adapters; repeated-session learning; reversible disclosure; bounded redirects; count mechanism overhead in billed cost. | Do not add another Python runtime, local-only knowledge store or competing cost ledger. Whole-package Codex pruning cannot replace DPF's existing fine-grained discovery. Published benchmark savings are not DPF results. |
| [Mem0 memory operations](https://docs.mem0.ai/core-concepts/memory-operations/add) | Stable user/agent/session scoping and explicit expiry are useful memory boundaries. | Its documented add flow is additive; DPF must retain its existing consolidation/supersession and independently deduplicate session evidence. Do not install a second memory service or equate raw insert with verified learning. |
| [Microsoft AutoGen termination](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/termination.html) | Stateful conditions scoped/reset per run; token/time/external-stop conditions can be composed with behavioral detection. | A message-count or token threshold alone does not prove failure. Keep DPF's progress checks, authority refusals and human cancellation; the adaptive redirect cannot grant more budget or override a hard stop. |
| [MCP 2025-11-25 tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | Preserve `tools/list`, pagination, invocation and advertised list-change behavior. Use existing `load_tools` and the session-store owner for reversible disclosure. | Discovery is not authorization. Do not assume every host refreshes its catalog, or interpret untrusted tool annotations as authority. |

TokenEconomizer's architecture document was successfully retrieved; additional
host-specific implementation inspection remains required before claiming a
standalone client supported. The three comparisons select an extension of
existing DPF owners over installing a parallel agent framework.

## Concrete evidence and integration contract

Use the existing `ImprovementSignal.evidence` JSON and its stable source identity
for bounded learning candidates and tooling findings. Correlate distinct persisted
session/task identities; repeated events within one session cannot establish
cross-session confirmation. A candidate is promoted through existing scoped memory
writers only after the configured evidence threshold and current access/currency
checks. `CoworkerMemoryNote` already has provenance, supersession and usage expiry;
its `useCount` measures recall and MUST NOT be reused as a confirmation count.
Record contradictions against the existing candidate and withdraw recall before
reconfirmation. Personal facts remain subject to the existing privacy classifier.

Retain per-session exposure manifests and observed usage in existing task/workroom
artifact evidence, joined to actual executor/session identity. Missing exposure
manifests mean unknown opportunity, not an unused tool. Tool-selection decisions
compose the existing tool-intent/tier/session-store contracts; preserve the
protected floor, requested tools and restore/discovery paths. Changes take effect
at session boundaries, with bounded evidence and explicit override/restore behavior.

Extend existing runtime issue detection and reflection/improvement writers for
repeated failures, including changed-argument failures. Stable structured failure
categories outrank error-text similarity. A successful recovery resets the failure
streak. Emit at most one redirect per configured run allowance; further actions
use the existing hard-stop/escalation policy. A permission denial never triggers
an alternate-authority workaround or becomes a reported tool defect.

Normalize actual tool-outcome, usage and session-completion events through the
existing supervised executor adapters. Standalone clients use only individually
verified plugin events and the existing evidence intake; client-provided material
is untrusted data and cannot manufacture authority or a completion receipt.
Unsupported observation/injection is explicit. Confirmed tooling gaps update the
existing improvement signal/backlog origin, with bounded evidence and repair
ownership; close only after functional repair evidence.

The pure decision functions, persistence adapters and served integrations must be
verified separately. Evaluation includes repeated-session confirmation/replay,
contradiction/privacy/expiry, exposed-but-unused versus unavailable tools,
restoration/cache-prefix stability, failure versus progress/refusal, tool-gap
deduplication and complete net cost. No additional paid model call is required for
the deterministic observation path; any optional proposer/judge call is attributed
to the task's existing cost and authority limits.

## Delivery, compatibility and rollback

Deliver learning, disclosure, loop recovery, tooling feedback and external adapters as independently reviewable changes with live backlog mappings and immutable plan coverage. Do not proceed to application code before required design/research/review/coverage gates pass. Any schema or provider event extension must retain old callers, represent unknown observations explicitly, and receive appropriate migration/contract checks. New heuristics begin in observation/proposal mode until functional and comparison evidence supports activation. Rollback disables the new controls through existing configuration owners, restores advertised tools, and preserves evidence and repair history. Existing authorization, cancellation and hard-stop paths remain authoritative.

## Current evidence and remaining gates

The feature branch is reconciled onto verified current source `41afd6e6bb5bce14b3fd84068cdaac5a2e930402`. After canonical recovery, its real normal edit-path claim succeeded. The unrelated restart candidate is preserved at tag `codex-restart-candidate-BI224` and removed from this feature diff. Managed dependencies were provisioned in the existing worktree. Feature implementation, feature tests, served verification, independent design approval and covered implementation plan remain pending. This draft and infrastructure test evidence are not delivery of the feature.
