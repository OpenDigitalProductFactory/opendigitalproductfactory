# Paused AI Work Approval Surface Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first-class Paused AI Work approval inbox where operators can find, understand, approve, reject, or redirect autonomous coworker TaskRuns that pause in `input-required` or `auth-required`.

**Architecture:** Treat `TaskRun` as the canonical paused-work record and keep `AgentActionProposal` as the older proposal-card path, not the owner of autonomous coworker pauses. V1 creates a small domain service for paused work, an AI Operations route with list/detail/action UX, server actions that record decisions through the existing governance audit trail, and Operations Map links that send attention events to the approval context instead of raw JSON. No schema migration is required for V1; decisions are recorded in `AuthorizationDecisionLog`, `TaskMessage`, and `TaskRun.progressPayload`.

**Tech Stack:** Next.js 16 App Router, React server/client components, Prisma 7, existing DPF TAK/TaskRun models, CSS custom properties from the DPF theme system, Vitest, Docker Compose production-path verification.

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

The list row should show: title, status, risk class, trigger/source, coworker, route context, age, and decision SLA if available.

The detail panel should show:

- decision brief,
- pause reason,
- requested action or prompt,
- risk class and authority scope,
- initiating source (`mcp-token`, `mcp-session`, `scheduled-task`, etc.),
- token/source attribution where present,
- coworker and route context,
- prior `TaskMessage` entries,
- related `ToolExecution` rows if any,
- raw metadata disclosure in an advanced section,
- action bar with `Approve and resume`, `Reject`, and `Request changes`.

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
- list sorts oldest waiting work first inside severity buckets or newest first consistently, with the chosen order documented in the test name;
- list extracts `riskClass`, `trigger`, `sourceRef`, `apiTokenId`, and summary from `a2aMetadata` / `progressPayload`;
- detail includes `TaskMessage` entries and related `ToolExecution` rows by `taskRunId`;
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
- request changes appends a `TaskMessage`, leaves status paused, and records decision metadata;
- all decisions write `AuthorizationDecisionLog`;
- duplicate decision attempts fail clearly;
- unauthorized user cannot decide another user's paused work unless existing platform role checks allow it.

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

`approvePausedAiWork()` routes only `external-mcp` TaskRuns to remote resume in V1. Other paused triggers should return a clear unsupported-trigger error and remain paused.

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

1. **Badge count:** V1 can omit a nav badge if the existing nav components do not have a badge pattern. If a badge is cheap and token-safe, show the paused count in `Paused Work`; otherwise rely on the tab and Operations Map attention links.
2. **Auth-required behavior:** `auth-required` should appear in the inbox immediately, but V1 approval may only support `input-required` external MCP pauses. If stronger auth is not wired yet, the action should explain what credential or authority is missing.
3. **Email/messaging:** Keep portal approval canonical in V1. Add Slack/Teams/email deep-link notifications only after this route proves the decision artifact and UX.
4. **Collaborative Work Queue bridge:** Do not create `WorkItem` rows in this slice. Revisit once the queue implementation exists or once paused-work metrics show multi-worker assignment/escalation is needed.
5. **Proceduralization feedback:** This slice should store enough decision metadata to support Slice 5 metrics. It does not need to build the proceduralization dashboard.

## Done Criteria

- A paused high-risk remote MCP TaskRun is visible without hunting through raw API endpoints.
- The operator sees enough context to decide without reconstructing the entire run manually.
- Approve resumes external MCP paused work through the existing autonomous runtime seam.
- Reject and request-changes paths are audited and idempotent.
- Operations Map attention events deep-link to the paused decision context.
- Focused tests, typecheck, production build, Docker rebuild, and live MCP pause/approve/reject smokes pass.
- The implementation reduces cognitive load and does not create a new approval-fatigue inbox without evidence and policy context.
