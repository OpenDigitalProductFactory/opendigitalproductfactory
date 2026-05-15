# Paused AI Work Approval Surface Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first-class Paused AI Work approval inbox where operators can find, understand, approve, reject, or redirect autonomous coworker TaskRuns that pause in `input-required` or `auth-required`.

**Architecture:** Treat `TaskRun` as the canonical paused-work record and keep `AgentActionProposal` as the older proposal-card path, not the owner of autonomous coworker pauses. V1 creates a small domain service for paused work, an AI Operations route with list/detail/action UX, server actions that record decisions through the existing governance audit trail, and Operations Map links that send attention events to the approval context instead of raw JSON. No schema migration is required for V1; decisions are recorded in `AuthorizationDecisionLog`, `TaskMessage`, and `TaskRun.progressPayload`.

**Tech Stack:** Next.js 16 App Router, React server/client components, Prisma 7, existing DPF TAK/TaskRun models, CSS custom properties from the DPF theme system, Vitest, Docker Compose production-path verification.

---

## Locked Architectural Decisions

These are binding for V1. They are *decisions*, not judgment calls. They exist so that downstream slices (Active Runs surface, CWQ unification, V2 resume paths) do not collide with V1 contracts.

1. **Status vocabulary is closed.** `TaskRun.status` continues to use the A2A-aligned set documented at `packages/db/prisma/schema.prisma:3914` — `submitted | working | input-required | auth-required | completed | failed | canceled | rejected | archived`. "Request changes" is not a new status; it appends a `TaskMessage` and leaves the run at `input-required`. No `needs-revision` / `paused` / `awaiting` strings introduced anywhere.
2. **`AuthorizationDecisionLog.actionKey` vocabulary is locked to:** `task.paused.approve`, `task.paused.reject`, `task.paused.request_changes`. Future paused-work decision types extend this namespace; they do not invent parallel ones.
3. **Decision `TaskMessage` shape is locked.** `role = "user"`, `metadata.kind = "operator-decision"`, `metadata.decision = "approve" | "reject" | "request_changes"`, `metadata.actorPrincipalId`, `metadata.actionKey`. Anything else goes in `metadata.detail`.
4. **Principal convergence (AGENTS.md §11, 2026-05-09 addendum).** `AuthorizationDecisionLog.actorRef` and `humanContextRef` carry resolved `Principal` ids — never raw `User.id`. The alias kind (`mcp-token`, `mcp-session`, `web-session`, etc.) goes in the rationale payload alongside the decision context. `TaskRun.userId` continues to carry the `Principal` id per the runtime spec §9.2.
5. **`auth-required` is "missing credential / authority", not "human judgment".** V1 lists `auth-required` runs in the inbox so they are not invisible, surfaces the missing scope or credential, and disables `Approve and resume` for them. The remediation flow (re-issue token, grant scope, attach delegation) is V2. Reject and request-changes remain available because they audit the decision to abandon or clarify.
6. **Approve-and-resume scope.** V1 implements resume only for `a2aMetadata.trigger === "external-mcp"`. Paused `scheduled`, `build`, `interactive`, `deliberation`, and `capacity-continuity` runs appear in the inbox (so they are not invisible) and support reject + request-changes, but `Approve and resume` is disabled with a clear "resume not yet wired for this trigger" message. Each trigger's resume path is its own slice and must use the same `AutonomousWorkRun` seam.
7. **Idempotency is enforced by status-conditional update, not by application checks.** Every decision writes through a Prisma `update` whose `where` includes the current status (`status: { in: ["input-required", "auth-required"] }`) and returns a count. Zero affected rows means another operator already decided; the action returns a conflict result without re-reading first.
8. **Operator authorization rule.** A user may decide a paused `TaskRun` if (a) their resolved `Principal` matches `TaskRun.userId`, or (b) their platform role grants the `governance.approve_task` capability. Pick the existing capability key during implementation (`apps/web/lib/permissions.ts` is the source of truth — if no exact match, add it in the same commit as the decision module, not later). No "owner can always" carve-outs beyond (a).
9. **`AgentActionProposal` is read-only linkage, never the owning record.** If a paused `TaskRun` has a related `AgentActionProposal` (via `AgentActionProposal.taskRunId`), the detail panel shows it as evidence. The decision still writes to `AuthorizationDecisionLog` + `TaskMessage` on the `TaskRun`. The proposal-card API path is not invoked.
10. **No `WorkItem` rows created in V1.** `WorkItem` / `WorkQueue` (EP-CWQ-001) are a separate ownership/routing primitive. Re-evaluate unification when *either* (a) the same `TaskRun` legitimately needs to appear in multiple operator queues with independent claim state, *or* (b) the autonomous-runtime spec's "Active Runs" surface lands and Paused Work becomes a filtered view of it. Until then, Paused Work is a read-projection over `TaskRun`.
11. **Naming alignment with the runtime spec.** The autonomous-coworker-runtime spec §8.1 names "Active Runs" as the broader surface; this slice ships the narrower, action-focused "Paused Work" first. When Active Runs lands, "Paused Work" becomes a default-filtered view inside it, not a sibling page. The route `/platform/ai/paused-work` is preserved as a stable deep-link target.
12. **`a2aMetadata` JSON-path is the V1 query surface; columns are not promoted yet.** Loaders read `riskClass`, `trigger`, `sourceRef`, `apiTokenId` from `a2aMetadata` / `progressPayload`. Promotion of `triggerKind` or `riskClass` to indexed columns is deferred to autonomous-runtime spec Slice 5 metrics or to the point where the Operations-Map paused-count query exceeds 50 ms p95 — whichever comes first.
13. **Hooks into existing escalation primitives are not built, but are not blocked either.** `ValueStreamHitlGate.channels`, `escalationPath`, and `escalationTimeoutMinutes` exist. V1 does not consume them and does not introduce a parallel notification stack. The V2 notification slice attaches to those.

---

## Current State

The runtime already has the important substrate:

- Remote MCP `tasks/submit` creates `TaskRun` rows through `apps/web/lib/mcp-task-submit.ts`, persists the initial `TaskMessage`, stores `riskClass`, `idempotencyKey`, `apiTokenId`, and `sourceRef`, and pauses `high-risk` work as `status = "input-required"` before any side-effecting tool execution.
- `apps/web/lib/tak/autonomous-work-run.ts` is the shared seam for creating and executing autonomous work. The approval implementation should extend this seam instead of adding a second execution path.
- `packages/db/prisma/schema.prisma` already has `TaskRun`, `TaskMessage`, `TaskArtifact`, `TaskNode`, and `AuthorizationDecisionLog`. V1 should avoid adding `HumanTouchpoint` or `WorkItem` until metrics show that TaskRun metadata and messages are insufficient.
- `apps/web/lib/ai-operations-map/project-events.ts` already maps `input-required` and `auth-required` to attention severity, but `projectTaskRun()` links detail to `/api/internal/tasks/:taskId`, which is a JSON API rather than an operator approval surface.
- `apps/web/lib/ai-operations-map/load-map-data.ts` currently reads recent proactive runs only. That can miss paused work outside the recent window and does not include all trigger sources.
- `apps/web/components/platform/AiTabNav.tsx` and `apps/web/components/platform/platform-nav.ts` are the two AI Operations navigation surfaces that need a new tab/sub-item.
- Older proposal approvals exist through `AgentActionProposal` and `/api/v1/governance/approvals`, but those are conversation proposal cards. They should be linked as related evidence only if a paused TaskRun has a proposal, not reused as the primary data model for TaskRun pauses.

Live backlog was checked through the DPF MCP surface on 2026-05-13. No direct open item was found for "Paused AI Work approval inbox"; the closest active epic is `EP-TAK-3F9A21` for TAK/GAID governance. Implement this as a focused slice under the autonomous coworker runtime/TAK governance family, not as a broad queue-platform rewrite.

## Product Doctrine

This surface exists to reduce human cognitive overload, not to move the burden back into an approval queue.

The governing principle remains:

> Move repeatable cognitive load from humans to AI agents, then move stabilized agent behavior into procedural code.

For HITL pauses, that means the product must ask the human for the smallest accountable judgment:

- what the coworker wants to do,
- why it paused,
- what risk class or authority boundary applies,
- what evidence and prior messages support the decision,
- what will happen if the operator approves, rejects, or requests changes,
- whether this pause pattern should later become procedural policy or deterministic code.

Approval prompts that require the human to rediscover context are failure states. The AI should prepare the decision brief; the human should supply judgment, authority, or missing context.

## Research and Precedents

- OpenAI Agents SDK HITL guidance models approval as a durable pause/resume flow: tools declare approval requirements, runs surface interruptions, state is serialized, decisions are applied, and the original run resumes. DPF should mirror the durable state and resume contract, but use `TaskRun` as the persisted work identity. Source: [OpenAI Agents SDK Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/).
- Microsoft Azure agent orchestration guidance says HITL gates should be explicit, including whether input is optional or mandatory and whether the human response approves, refines, or redirects the workflow. DPF should therefore support `approve`, `reject`, and `request changes` from the first usable slice. Source: [AI agent orchestration patterns](https://learn.microsoft.com/azure/architecture/ai-ml/guide/ai-agent-design-patterns).
- OWASP AI agent security material treats HITL as a control for sensitive actions, but OWASP's "Lies in the Loop" warning shows why the approval surface must resist prompt-padding and misleading summaries. DPF should show the raw requested action/context alongside the AI-written brief, source attribution, and audit facts. Source: [OWASP HITL Dialog Forging](https://owasp.org/www-community/attacks/Lies_in_the_Loop).
- OWASP AIVSS identifies "Overwhelming Human in the Loop" as an agentic AI risk pattern. DPF should use risk classes, batching, contextual deep links, and later proceduralization metrics to prevent approval fatigue. Source: [AIVSS Scoring System for OWASP Agentic AI Core Security Risks](https://aivss.owasp.org/assets/publications/AIVSS%20Scoring%20System%20For%20OWASP%20Agentic%20AI%20Core%20Security%20Risks%20v0.5.pdf).
- The existing DPF autonomous coworker runtime spec already grounds this in Cognitive Load Theory, cognitive offloading, Bainbridge's "Ironies of Automation", MCP/A2A alignment, and the Operations Map benchmark against tracing products. This plan is an implementation slice of that doctrine, not a new architectural direction.

## UX Decision

Use a canonical route named `Paused Work` under AI Operations:

- Route: `/platform/ai/paused-work`
- AI tab label: `Paused Work`
- Platform family sub-item label: `Paused Work`
- Operations Map attention links: `/platform/ai/paused-work?taskRunId=TR-...`

Rejected names:

- `Approvals`: too narrow; `input-required` can be clarification, missing auth, or requested changes.
- `Approval Inbox`: useful conceptually, but it hides `auth-required` and request-changes flows.
- `AI Work Queue`: too broad for V1 and risks colliding with the Collaborative Work Queue spec.

Primary layout:

- A dense, work-focused page with a left list and right detail panel on desktop.
- On mobile or narrow widths, a list-first page with a full-page detail view driven by `taskRunId`.
- No nested cards. Use full-width page regions and individual row/detail panels only.
- Use icons from the existing icon library if present in the touched files; otherwise keep text labels plain and compact.
- Use only DPF theme CSS variables. No hardcoded Tailwind gray classes, no hardcoded hex colors, and no inline non-token color styles.

The list row should show: title, status, risk class, trigger/source, coworker, route context, and age (time since `startedAt`).

List ordering is fixed: **high-risk first, then bounded-write, then read; within each tier, oldest paused first (FIFO).** This is an approval queue, not an activity feed. Tests must pin this order — see Task 2.

No "decision SLA" column in V1. Per Locked Decision 13, escalation timeouts live on `ValueStreamHitlGate` and are not consumed yet; we do not invent a parallel SLA on `TaskRun`.

The detail panel should show:

- **AI-prepared decision brief.** V1 source order: (a) `progressPayload.decisionBrief` if the coworker wrote one before pausing, (b) `progressPayload.summary` if present, (c) computed fallback = first 240 chars of the user prompt + a one-line tool/risk summary. The brief is always labeled "AI-prepared" so the operator knows it is not raw evidence. Future slices may have coworkers author the brief explicitly before pausing; the loader contract does not change.
- **Raw requested action / prompt — unaltered.** This is the first `TaskMessage` with `role = "user"` for the run, rendered verbatim. It is shown adjacent to the AI brief, not nested inside it. This is the OWASP "Lies in the Loop" defense: the operator must always be able to compare AI summary against original text.
- pause reason,
- risk class and authority scope,
- initiating source (`mcp-token`, `mcp-session`, `scheduled-task`, etc.),
- token/source attribution where present (`a2aMetadata.sourceRef`, `apiTokenId`),
- coworker and route context,
- prior `TaskMessage` entries,
- related `ToolExecution` rows scoped by `taskRunId`,
- related `AgentActionProposal` rows joined on `AgentActionProposal.taskRunId` — display-only evidence, never decided here,
- raw `a2aMetadata` and `progressPayload` disclosure in an advanced section,
- action bar with `Approve and resume`, `Reject`, and `Request changes`. `Approve and resume` is **disabled** for `auth-required` runs and for any trigger other than `external-mcp` in V1, with a tooltip explaining why and what slice will unlock it.

## Email and Messaging Approval Policy

V1 should not implement email or messaging one-click approvals.

V1 may add notification hooks only if an existing notification service is already clear and low-risk, but the canonical decision must happen in the portal. Email, Slack, Teams, and similar surfaces should initially carry secure deep links to `/platform/ai/paused-work?taskRunId=...`.

Reasoning:

- High-risk remote MCP/code/data actions need authenticated portal context, not a stripped-down email body.
- Email approval tokens already exist for bill and expense flows, but those are domain-specific public token pages. Reusing that pattern for autonomous coworker authority would create a larger security design problem.
- Later slices can add signed, expiring one-click approval only for low-risk, reversible, policy-classified actions after the portal approval artifact is proven and audited.

## File Structure

Create:

- `apps/web/lib/paused-ai-work/types.ts` — domain types for paused TaskRun summaries, detail, decision input, and decision results.
- `apps/web/lib/paused-ai-work/data.ts` — server-only Prisma loaders for paused work list/detail/count. This is the single read path for the UI and Operations Map badge counts.
- `apps/web/lib/paused-ai-work/decisions.ts` — server-only decision functions for approve/resume, reject, and request changes. This owns audit logging, status transitions, and idempotency checks.
- `apps/web/lib/paused-ai-work/resume-remote-task.ts` — isolated resume logic for external MCP TaskRuns. It reconstructs the original remote task context from `TaskRun`, `TaskMessage`, and metadata, then calls the autonomous work seam. Keep this file narrow so later scheduled/build resume paths do not tangle with remote MCP specifics.
- `apps/web/app/(shell)/platform/ai/paused-work/page.tsx` — route entry, server loader, and page composition.
- `apps/web/app/(shell)/platform/ai/paused-work/page.test.tsx` — route rendering and query-param selection tests.
- `apps/web/components/platform/PausedAiWorkClient.tsx` — client-side list/detail selection, filters, and action form state.
- `apps/web/components/platform/PausedAiWorkList.tsx` — focused list component.
- `apps/web/components/platform/PausedAiWorkDetail.tsx` — detail panel and action controls.
- `apps/web/lib/paused-ai-work/data.test.ts` — loader coverage.
- `apps/web/lib/paused-ai-work/decisions.test.ts` — decision and audit coverage.
- `apps/web/lib/paused-ai-work/resume-remote-task.test.ts` — remote resume reconstruction and duplicate-prevention coverage.

Modify:

- `apps/web/components/platform/AiTabNav.tsx` — add `Paused Work` tab, preferably before Operations Map because it is an action inbox.
- `apps/web/components/platform/platform-nav.ts` — add the matching AI Operations sub-item.
- `apps/web/components/platform/platform-nav.test.ts` — assert the new sub-item exists.
- `apps/web/lib/ai-operations-map/project-events.ts` — point paused TaskRun attention links to `/platform/ai/paused-work?taskRunId=...`.
- `apps/web/lib/ai-operations-map/project-events.test.ts` — assert paused TaskRun links use the approval surface.
- `apps/web/lib/ai-operations-map/load-map-data.ts` — include currently paused TaskRuns regardless of recent-window ordering and include relevant non-proactive sources.
- `apps/web/lib/ai-operations-map/load-map-data.test.ts` — update mocks and assertions for paused TaskRun inclusion.
- `apps/web/lib/mcp-task-submit.ts` — extract the common "execute parsed remote task" path so submit and resume do not duplicate runtime execution. This is the planned refactoring budget for this slice.

Do not modify:

- `packages/db/prisma/schema.prisma` unless implementation proves a V1 migration is unavoidable.
- Public token approval pages under `apps/web/app/(storefront)/s/approve/[token]` or `expense-approve/[token]`.
- `AgentActionProposal` schema or proposal-card APIs except for optional linking in display queries.

## Chunk 1: Paused Work Read Model

### Task 1: Define Paused AI Work Types

**Files:**
- Create: `apps/web/lib/paused-ai-work/types.ts`

- [ ] **Step 1: Add type definitions**

Define narrow exported types:

```ts
export const PAUSED_AI_WORK_STATUSES = ["input-required", "auth-required"] as const;
export type PausedAiWorkStatus = (typeof PAUSED_AI_WORK_STATUSES)[number];
export type PausedAiWorkDecision = "approve" | "reject" | "request_changes";
```

Include summary/detail types with `taskRunId`, `title`, `status`, `riskClass`, `trigger`, `sourceRef`, `routeContext`, `currentAgentId`, `startedAt`, `updatedAt`, `progressSummary`, `messageCount`, `toolExecutionCount`, and `rawMetadata`.

- [ ] **Step 2: Run focused typecheck**

Run: `pnpm --filter web typecheck`

Expected: PASS or only unrelated pre-existing failures, which must be documented before continuing.

### Task 2: Write Paused Work Loader Tests

**Files:**
- Create: `apps/web/lib/paused-ai-work/data.test.ts`
- Create: `apps/web/lib/paused-ai-work/data.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- list returns only unarchived `input-required` and `auth-required` TaskRuns;
- list orders by `riskClass` (high-risk, bounded-write, read) then by `startedAt` ascending (FIFO within tier) — Locked Decision 11 plus the ordering rule in §UX Decision;
- list extracts `riskClass`, `trigger`, `sourceRef`, `apiTokenId`, and summary from `a2aMetadata` / `progressPayload`;
- detail includes `TaskMessage` entries (ordered `createdAt` asc) and related `ToolExecution` rows by `taskRunId`;
- detail joins related `AgentActionProposal` rows via `AgentActionProposal.taskRunId` and returns them as evidence only — Locked Decision 9;
- the raw-prompt field of the detail is exactly the first `TaskMessage` with `role = "user"`, unaltered — OWASP "Lies in the Loop" defense;
- count returns only actionable paused work for nav badges.

Run: `pnpm --filter web exec vitest run apps/web/lib/paused-ai-work/data.test.ts`

Expected: FAIL because `data.ts` is not implemented.

- [ ] **Step 2: Implement minimal loaders**

Implement:

- `listPausedAiWork({ userId?: string })`
- `getPausedAiWorkDetail(taskRunId: string)`
- `countPausedAiWork()`

Use Prisma `taskRun.findMany/findUnique` and include:

- `messages` ordered by `createdAt`,
- `ToolExecution` rows where the audit schema exposes `taskRunId` or equivalent route-context metadata,
- no schema-level assumptions beyond current fields.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter web exec vitest run apps/web/lib/paused-ai-work/data.test.ts`

Expected: PASS.

- [ ] **Step 4: Refactor for clarity**

Spend the planned refactoring budget here: extract metadata parsing helpers inside `data.ts` or a private `metadata.ts` only if the parsing starts to obscure the query logic. Keep the public surface small.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/lib/paused-ai-work
git commit -s -m "feat(ai): add paused work read model"
```

## Chunk 2: Approval Surface UI

### Task 3: Add Navigation Entries

**Files:**
- Modify: `apps/web/components/platform/AiTabNav.tsx`
- Modify: `apps/web/components/platform/platform-nav.ts`
- Modify: `apps/web/components/platform/platform-nav.test.ts`

- [ ] **Step 1: Update nav tests**

Assert `Paused Work` exists under AI Operations with `href: "/platform/ai/paused-work"`.

Run: `pnpm --filter web exec vitest run apps/web/components/platform/platform-nav.test.ts`

Expected: FAIL before implementation.

- [ ] **Step 2: Add nav entries**

Add `Paused Work` immediately before `Operations Map` in both nav sources.

- [ ] **Step 3: Run nav tests**

Run: `pnpm --filter web exec vitest run apps/web/components/platform/platform-nav.test.ts`

Expected: PASS.

### Task 4: Build the Paused Work Page

**Files:**
- Create: `apps/web/app/(shell)/platform/ai/paused-work/page.tsx`
- Create: `apps/web/app/(shell)/platform/ai/paused-work/page.test.tsx`
- Create: `apps/web/components/platform/PausedAiWorkClient.tsx`
- Create: `apps/web/components/platform/PausedAiWorkList.tsx`
- Create: `apps/web/components/platform/PausedAiWorkDetail.tsx`

- [ ] **Step 1: Write route/component tests**

Cover:

- empty state explains that no AI work is waiting;
- rows render risk class, source, coworker, route, and age;
- `taskRunId` query param selects the matching detail;
- detail shows raw prompt/message and AI decision brief separately;
- action buttons are absent or disabled for non-paused statuses;
- all visible styling uses DPF tokens.

Run: `pnpm --filter web exec vitest run apps/web/app/(shell)/platform/ai/paused-work/page.test.tsx`

Expected: FAIL before implementation.

- [ ] **Step 2: Implement page and components**

Use server loader in the route and pass serializable props into a client component. Keep row rendering and detail rendering in separate files.

UX constraints:

- dense operational layout, no marketing copy;
- no cards inside cards;
- no hardcoded color classes;
- action area remains visible without covering evidence;
- raw metadata is collapsed by default.

- [ ] **Step 3: Run route/component tests**

Run: `pnpm --filter web exec vitest run apps/web/app/(shell)/platform/ai/paused-work/page.test.tsx`

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add apps/web/app/(shell)/platform/ai/paused-work apps/web/components/platform/PausedAiWork*.tsx apps/web/components/platform/AiTabNav.tsx apps/web/components/platform/platform-nav.ts apps/web/components/platform/platform-nav.test.ts
git commit -s -m "feat(ai): add paused work approval surface"
```

## Chunk 3: Decisions, Audit, and Resume

### Task 5: Implement Decision Logging and Status Changes

**Files:**
- Create: `apps/web/lib/paused-ai-work/decisions.ts`
- Create: `apps/web/lib/paused-ai-work/decisions.test.ts`
- Modify: `apps/web/components/platform/PausedAiWorkDetail.tsx`
- Modify: `apps/web/components/platform/PausedAiWorkClient.tsx`

- [ ] **Step 1: Write failing decision tests**

Cover:

- reject only works for `input-required` / `auth-required`;
- reject sets `status = "rejected"`, `completedAt`, and decision metadata in `progressPayload`;
- request changes appends a `TaskMessage` (role `user`, `metadata.kind = "operator-decision"`, `metadata.decision = "request_changes"` — Locked Decision 3), leaves status `input-required`, and records decision metadata in `progressPayload`;
- all decisions write `AuthorizationDecisionLog` with `actionKey` in the locked vocabulary — `task.paused.approve` | `task.paused.reject` | `task.paused.request_changes` (Locked Decision 2) — and `actorRef` / `humanContextRef` set to the resolved `Principal` id, not `User.id` (Locked Decision 4);
- idempotency: a duplicate decision attempt issued through a status-conditional update returns zero affected rows and the function returns a `{ kind: "conflict" }` result without re-reading state (Locked Decision 7);
- operator authorization: only the originating `Principal` or a user with the `governance.approve_task` capability can decide; any other caller gets a `{ kind: "forbidden" }` result (Locked Decision 8) — the test uses the same capability key the implementation lands;
- `auth-required` runs: reject and request-changes succeed; approve returns a structured `{ kind: "unsupported", reason: "auth-required-needs-credential" }` result and does **not** mutate status (Locked Decision 5).

Run: `pnpm --filter web exec vitest run apps/web/lib/paused-ai-work/decisions.test.ts`

Expected: FAIL before implementation.

- [ ] **Step 2: Implement `rejectPausedAiWork` and `requestPausedAiWorkChanges`**

Do these before approve/resume because they establish the audit and idempotency pattern without invoking the agentic loop.

- [ ] **Step 3: Wire UI forms**

Use server actions or the repo's established route-action pattern. Show pending, success, and error states without losing detail context.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web exec vitest run apps/web/lib/paused-ai-work/decisions.test.ts apps/web/app/(shell)/platform/ai/paused-work/page.test.tsx`

Expected: PASS.

### Task 6: Resume External MCP Paused Work

**Files:**
- Create: `apps/web/lib/paused-ai-work/resume-remote-task.ts`
- Create: `apps/web/lib/paused-ai-work/resume-remote-task.test.ts`
- Modify: `apps/web/lib/mcp-task-submit.ts`
- Modify: `apps/web/lib/paused-ai-work/decisions.ts`

- [ ] **Step 1: Write failing resume tests**

Cover:

- approving a high-risk external MCP pause reconstructs the original `agentId`, `routeContext`, `prompt`, `riskClass`, `threadId`, `apiTokenId`, and `authorityScope`;
- approve changes status to `working` before execution and `completed` or `failed` after execution;
- tool execution receives the original `apiTokenId` for audit attribution;
- approve refuses missing/invalid metadata with a clear `request_changes`-style message;
- approve is idempotent and cannot double-run a completed/resumed TaskRun.

Run: `pnpm --filter web exec vitest run apps/web/lib/paused-ai-work/resume-remote-task.test.ts`

Expected: FAIL before implementation.

- [ ] **Step 2: Refactor `mcp-task-submit.ts`**

Extract common execution into a function shaped like:

```ts
export async function executeParsedRemoteCoworkerTask(input: {
  parsed: RemoteTaskSubmitParams;
  token: RemoteTaskSubmitAuth;
  userContext: UserContext;
  threadId: string;
  taskRunId: string;
  taskRunRecordId: string;
  contextId: string | null;
}): Promise<Record<string, unknown>>;
```

Keep parsing, idempotency lookup, and initial pause creation in `submitRemoteCoworkerTask`. The extracted function should own only agent/tool resolution, agentic-loop execution, assistant `TaskMessage`, and final TaskRun status update.

- [ ] **Step 3: Implement remote resume**

`resumeRemotePausedTaskRun()` should:

- load the paused TaskRun and first user `TaskMessage`;
- validate `a2aMetadata.trigger === "external-mcp"`;
- validate `riskClass === "high-risk"`;
- validate source attribution and token id;
- mark the run `working` with approval metadata;
- call the extracted execution function;
- write an approval `AuthorizationDecisionLog`;
- append a decision `TaskMessage`.

- [ ] **Step 4: Add approve decision wrapper**

`approvePausedAiWork()` routes only `external-mcp` TaskRuns to remote resume in V1 (Locked Decision 6). For any other trigger, return `{ kind: "unsupported", reason: "approve-not-wired-for-trigger", trigger }` and leave status untouched. For `auth-required` runs of any trigger, return `{ kind: "unsupported", reason: "auth-required-needs-credential" }` per Locked Decision 5. In both cases, no status mutation, no `AuthorizationDecisionLog` row written — these are pre-decision validation failures, not decisions.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/paused-ai-work/decisions.test.ts apps/web/lib/paused-ai-work/resume-remote-task.test.ts apps/web/app/api/mcp/v1/route.test.ts apps/web/lib/tak/autonomous-work-run.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/lib/paused-ai-work apps/web/lib/mcp-task-submit.ts apps/web/components/platform/PausedAiWork*.tsx
git commit -s -m "feat(ai): resume approved paused coworker work"
```

## Chunk 4: Operations Map Integration

### Task 7: Link Attention Events to Paused Work

**Files:**
- Modify: `apps/web/lib/ai-operations-map/project-events.ts`
- Modify: `apps/web/lib/ai-operations-map/project-events.test.ts`
- Modify: `apps/web/lib/ai-operations-map/load-map-data.ts`
- Modify: `apps/web/lib/ai-operations-map/load-map-data.test.ts`

- [ ] **Step 1: Write failing projection tests**

Assert a TaskRun with `status = "input-required"` or `status = "auth-required"` gets:

- severity `attention`;
- `historyHref = "/platform/ai/paused-work?taskRunId=..."`;
- stable refs containing `taskRunId`.

Run: `pnpm --filter web exec vitest run apps/web/lib/ai-operations-map/project-events.test.ts`

Expected: FAIL before implementation.

- [ ] **Step 2: Update projection links**

Only paused statuses should link to Paused Work. Completed/working task runs can keep the existing history target until a full TaskRun detail page exists.

- [ ] **Step 3: Include paused work in map data**

Update loader so current paused TaskRuns are included regardless of recent-window limit. Keep deduplication simple by `id`.

- [ ] **Step 4: Run map tests**

Run: `pnpm --filter web exec vitest run apps/web/lib/ai-operations-map/project-events.test.ts apps/web/lib/ai-operations-map/load-map-data.test.ts apps/web/components/platform/AiOperationsMap.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/lib/ai-operations-map
git commit -s -m "feat(ai): route paused map events to approval surface"
```

## Per-Chunk Build-Gate Hygiene (AGENTS.md §4–§5)

This work runs in a topic worktree, not the root clone. Before starting Chunk 1: `git worktree add ../DPF-paused-ai-work-approval -b doc/paused-ai-work-approval-surface` from the root clone, then `scripts/seed-worktree-mcp.ps1` (or `.sh`) inside the new worktree.

At the end of every chunk (1 through 4), run:

```bash
pnpm --filter web typecheck
```

The pre-commit hook runs this on changed files, but per-chunk catches cross-file regressions before the chunk commits and stops failures from compounding into Chunk 5. Do not defer typecheck to E2E.

## Chunk 5: End-to-End Verification

### Task 8: Local Verification

**Files:**
- No new files unless verification evidence is recorded through the existing evidence path.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/paused-ai-work/data.test.ts apps/web/lib/paused-ai-work/decisions.test.ts apps/web/lib/paused-ai-work/resume-remote-task.test.ts apps/web/app/(shell)/platform/ai/paused-work/page.test.tsx apps/web/lib/ai-operations-map/project-events.test.ts apps/web/lib/ai-operations-map/load-map-data.test.ts apps/web/components/platform/platform-nav.test.ts apps/web/app/api/mcp/v1/route.test.ts apps/web/lib/tak/autonomous-work-run.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `pnpm --filter web build`

Expected: PASS.

- [ ] **Step 4: Rebuild local Docker production path**

Run:

```bash
docker compose build --no-cache portal portal-init sandbox
docker compose up -d
```

Expected: portal, portal-init, and sandbox containers rebuild and start.

- [ ] **Step 5: Live MCP pause smoke**

Submit a high-risk remote task through `/api/mcp/v1` using `tasks/submit` with a fresh `idempotencyKey`.

Expected:

- JSON-RPC result returns `status = "input-required"`;
- Paused Work page shows the task;
- Operations Map attention event links to the Paused Work detail;
- zero `ToolExecution` rows exist before approval.

- [ ] **Step 6: Live approve/resume smoke**

In the portal, approve the paused TaskRun.

Expected:

- task transitions through `working`;
- final status becomes `completed` or `failed` with a clear summary;
- `TaskMessage` contains the approval decision and assistant result/error;
- `AuthorizationDecisionLog` contains the approval;
- any resulting `ToolExecution` rows carry the original `apiTokenId`;
- replaying the same approve action does not execute the task twice.

- [ ] **Step 7: Live reject smoke**

Submit another high-risk task and reject it.

Expected:

- task status becomes `rejected`;
- `completedAt` is set;
- no tool execution occurs;
- `AuthorizationDecisionLog` and `TaskMessage` show the rejection.

- [ ] **Step 8: UX verification**

Exercise:

- `/platform/ai/paused-work`
- `/platform/ai/paused-work?taskRunId=<id>`
- `/platform/ai/operations-map`
- narrow viewport list/detail behavior

Expected:

- no text overlap;
- action buttons remain clear;
- raw prompt/evidence and AI brief are distinguishable;
- no hardcoded gray/hex styling was introduced;
- no approval prompt requires the operator to infer missing context.

- [ ] **Step 9: Final commit and PR**

Run:

```bash
git status --short
git push -u origin doc/paused-ai-work-approval-surface
gh pr create --draft --title "feat(ai): add paused AI work approval surface" --body "<summary, tests, UX verification, Docker verification>"
```

Expected: draft PR created with verification evidence.

## Open Judgment Calls

Most of the prior open questions have been promoted into Locked Architectural Decisions above. Remaining open:

1. **Badge count:** V1 can omit a nav badge if the existing nav components do not have a badge pattern. If a badge is cheap and token-safe, show the paused count on `Paused Work`; otherwise rely on the tab and Operations Map attention links. Pick during Task 3 implementation.
2. **`governance.approve_task` capability key:** Locked Decision 8 binds the rule but lets implementation pick the capability key from existing `apps/web/lib/permissions.ts`. If no exact-fit key exists, add it in the same commit as `decisions.ts` — do not defer.
3. **Email/messaging:** Per §Email and Messaging Approval Policy, V1 stays portal-canonical. The follow-on realtime/mobile notification track is captured in `docs/superpowers/specs/2026-05-13-realtime-hitl-mobile-companion-design.md`; add Slack/Teams/email deep-link notifications via the existing `ValueStreamHitlGate.channels` primitive only after this route proves the decision artifact and UX.
4. **Decision-brief authorship by coworkers.** V1 falls back to `progressPayload.summary` + prompt prefix. Whether and when coworkers should populate `progressPayload.decisionBrief` explicitly before pausing is a coworker-prompt change owned by a separate slice — flagged here so the loader contract for `decisionBrief` is non-breaking when that lands.
5. **Proceduralization feedback:** This slice stores enough decision metadata to support autonomous-runtime spec Slice 5 metrics (decision counts by `actionKey` + `trigger` + `riskClass`). It does not build the proceduralization dashboard.

## Done Criteria

- A paused high-risk remote MCP TaskRun is visible without hunting through raw API endpoints.
- The operator sees enough context to decide without reconstructing the entire run manually, and the raw user prompt is always shown adjacent to (not nested inside) the AI-prepared brief.
- Approve resumes `external-mcp` paused work through the existing autonomous runtime seam; non-`external-mcp` triggers and `auth-required` runs return a clear `unsupported` result without mutating state.
- Reject and request-changes paths are audited (every decision writes `AuthorizationDecisionLog` with an `actionKey` from the locked vocabulary and a resolved `Principal` id) and idempotent by status-conditional update.
- Operations Map attention events deep-link to the paused decision context.
- Focused tests, typecheck (per chunk and at E2E), production build, Docker rebuild, and live MCP pause/approve/reject smokes pass.
- The implementation reduces cognitive load and does not create a new approval-fatigue inbox without evidence and policy context.
- Zero new status strings, zero new identity-bearing entities outside `Principal`, zero new approval API surfaces — all locked decisions hold.
