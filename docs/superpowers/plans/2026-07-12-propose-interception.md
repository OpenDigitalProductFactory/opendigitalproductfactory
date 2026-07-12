# Plan — Propose-interception for scheduled coworker runs (BI-80532D5C)

**Context.** BI-754C9E82 enforced the proactivity plan's `actionBoundary`, but only two of the three rungs: `advise` strips side-effecting tools, `act` runs them directly. It explicitly deferred the middle rung — `propose` — which kept behaving like `act` (registry self-tasks are curated pre-authorized writes, so that was safe for the 3 registered coworkers). This BI closes that gap and is the **safety precondition** for extending self-tasks beyond the curated roster (BI-E962B9CD): once a coworker can run at `propose`, every business-fact write it attempts becomes a human-approved proposal instead of an unreviewed mutation.

**Key alignment discovered in the code (substrate-first).** The existing `approveProposal` server action (`apps/web/lib/actions/proposals.ts`) already treats `AgentActionProposal.actionType` as a **tool name** and runs `executeTool(actionType, parameters, …)` on approval. So propose-interception only needs to *create* a proposal with `actionType = toolName` and `parameters = args`; the approval path executes it verbatim with **zero new approval-side code**.

## Changes

1. **`apps/web/lib/proactivity/propose-interception.ts`** (new, unit-tested):
   - `shouldProposeToolCall(toolDef, proposeSideEffects)` — pure predicate: fires only for `sideEffect === true` tools that are not `coworkerArtifact` and not `executionMode: "proposal"`, under an active propose boundary.
   - `buildProposalToolResult(toolName, proposalId)` — the synthetic, static tool result handed back to the model (pending-approval, "do not retry").
   - `divertToolCallToProposal({ persistence, … })` — persists the assistant message + `AgentActionProposal(status:"proposed")` via an injected persistence port (keeps the decision/wording logic DB-free and testable).
2. **`agentic-loop.ts`** — `runAgenticLoop` gains `proposeSideEffects?: boolean` (default false). At the tool-execution seam, before `governedExecuteTool`, a diverted call is persisted, recorded in `executedTools`/`iterationResults`, and the loop continues (accumulating proposals across a multi-action run) instead of stalling. **Fail-closed:** a persistence error reports failure and does NOT execute the side effect.
3. **`autonomous-work-run.ts`** — `executeAutonomousAgenticLoop` forwards `proposeSideEffects` to the loop.
4. **`agent-task-scheduler.ts`** — sets `proposeSideEffects: boundary === "propose"`; tools still resolve in `act` mode under propose so the model can *call* them (the loop diverts). Stale "deferred remainder" comment updated to describe the three enforced rungs.

## Boundaries / non-goals

- Curated artifact writes (`coworkerArtifact`: knowledge articles, campaign briefs) still run directly — they are idempotent, groundable, non-fact-mutating.
- The required-tool fallback in the scheduler runs only curated artifact producers, so it stays direct.
- No schema change (`AgentActionProposal` already carries everything needed).
- Approval-side execution is unchanged (existing `approveProposal`).

## Verification

Worktree typecheck green; `propose-interception.test.ts` (7) + proactivity/autonomous-run/scheduler suites (67) + agentic-loop suite (96) green. Runtime: `pnpm run pregate`; live UX — set a non-registered coworker to a propose boundary, trigger a scheduled run that attempts a business write, confirm an `AgentActionProposal` lands in the Needs-you inbox and approving it executes the tool.
