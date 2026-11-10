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

- Microsoft TokenEconomizer: <https://github.com/microsoft/TokenEconomizer>. The README was retrieved in the originating assessment. Adopt repeated-evidence learning, reversible disclosure changes, bounded redirects and accounting for optimization overhead. Do not install a competing local-only knowledge store or indiscriminately prune whole Codex capability packages. Its reported benchmark savings are not a DPF result.
- Existing DPF memory consolidation names mem0's consolidation controller as prior art; tool-efficiency analysis references OpenTelemetry GenAI execute-tool concepts. Their current primary-source behavior still needs verification before research is finalized.
- Existing DPF workroom executor contract records T3 Code as prior art. Reuse that implemented supervision boundary instead of introducing another executor manager.

Upstream implementation inspection, current standards verification and a second comparable implementation comparison are incomplete because GitHub access timed out. This section is a research checklist, not a passing research receipt.

## Delivery, compatibility and rollback

Deliver learning, disclosure, loop recovery, tooling feedback and external adapters as independently reviewable changes with live backlog mappings and immutable plan coverage. Do not proceed to application code before required design/research/review/coverage gates pass. Any schema or provider event extension must retain old callers, represent unknown observations explicitly, and receive appropriate migration/contract checks. New heuristics begin in observation/proposal mode until functional and comparison evidence supports activation. Rollback disables the new controls through existing configuration owners, restores advertised tools, and preserves evidence and repair history. Existing authorization, cancellation and hard-stop paths remain authoritative.

## Current evidence and remaining gates

The governed worktree was created on cached `origin/main` after a 25-second refresh timeout on 2026-11-10. Source freshness remains unverified; rebase/reconcile against a successfully refreshed main before implementation. The managed readiness probe reports source-only with missing node_modules and Prisma client. Unit tests, typecheck, served verification, independent reviews and publication are unrun. This draft is not approved design, covered implementation plan or delivery evidence.
