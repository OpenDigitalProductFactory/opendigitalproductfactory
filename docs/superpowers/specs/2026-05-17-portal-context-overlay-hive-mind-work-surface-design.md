# Portal Context Overlay and Hive-Mind Work Surface Design

| Field | Value |
|---|---|
| Status | Implemented through Phase 2; A2A child execution dependency remains |
| Date | 2026-05-17 |
| Backlog | EP-CAPSULE / BI-7529B658 |
| Author | Codex + Mark Bodman |
| Primary audience | Platform architecture, Build Studio, coworker runtime, Work Capsule UX |
| Related repo areas | `apps/web/components/agent/*`, `apps/web/lib/actions/agent-coworker.ts`, `apps/web/lib/tak/*`, `apps/web/lib/work-capsules/*`, `apps/web/app/(shell)/build/*`, `packages/db/prisma/schema.prisma` |
| Related artifacts | `2026-05-14-portal-work-capsule-control-harness-design.md`, `2026-05-10-ai-coworker-visual-control-surface-design.md`, `2026-04-23-a2a-aligned-coworker-runtime-design.md`, `2026-04-29-coworker-execution-adapter-substrate-design.md`, `2026-04-01-phase-handoff-and-human-authority-engagement-design.md` |

## Implementation Note - 2026-05-20

The first implementation branch delivered the `PortalContextEnvelope` projection, Build Studio/Work Control strip and drawer, prompt digest injection, hive recommendations, and broad Work Capsule invalidation. Phase 2 adds explicit Hive tab invocation, child `TaskRun` dedupe, request artifacts, Work Capsule/backlog evidence writes, substantive coworker response artifacts, resolver timeout/source fallback, scoped cache invalidation helpers, and URL-backed Build Studio active-build selection.

The remaining dependency is not the overlay contract itself. It is the existing child-thread dispatch seam: `dispatchAgentThread` is still a placeholder in mainline, so hive invocation can now create durable task/evidence records and open the child thread context, but autonomous child-agent execution still depends on the A2A/team-orchestration runtime landing behind that dispatcher.

## 1. Purpose

DPF should move development work into the portal in a way that tests the portal's own work process while keeping the backlog, Work Capsules, evidence, route context, and coworker runtime live and useful.

The goal is not to make the portal a novelty code editor. The goal is to make every development surface carry the surrounding operational context:

- what object the user is looking at
- which backlog item, epic, build, capsule, task, branch, and evidence chain it belongs to
- which coworkers should be involved
- what the platform already knows about the user, organization, route, permissions, design, and verification state
- what must be recorded back to the backlog/capsule instead of being trapped in chat

This spec defines the context overlay and hive-mind work surface that sits on top of the existing Work Capsule and coworker runtime. It is a projection layer first. It must not create a second source of truth for work, evidence, routing, or agent events.

## 2. Problem Statement

The current portal has strong pieces, but the user experience still separates them too much:

- Build Studio knows the active feature build.
- Work Control knows active/adoptable Work Capsules.
- The coworker panel knows route context and active build thread context.
- Backlog items and epics own intake and prioritization.
- `TaskRun`, `TaskMessage`, and `TaskArtifact` are emerging as the task-native coworker substrate.
- `ToolExecution`, `ToolExecutionReceipt`, `BacklogItemActivity`, `WorkCapsuleActivity`, and `ExternalEvidenceRecord` provide evidence and audit trails.

The missing layer is a consistent, portal-native context envelope that follows the user across work surfaces. Without it, the platform keeps re-solving context in each route, and AI coworkers can still drift into chat-only reasoning instead of acting through the portal's instituted structure.

The user direction is explicit: development can still happen outside the portal, but portal development needs to be integrated with the portal's design. As people use the portal, their context should become an overlay, and the hive mind should join from that shared context.

## 3. Current Repo Truth

This section reflects `origin/main` at `5c700df4` on 2026-05-17, plus live backlog checks through the DPF MCP server.

### 3.1 Live Backlog

MCP backlog checks showed:

- `EP-CAPSULE` is in progress with the new item `BI-7529B658` for this spec.
- Work Capsule Phase 1 and Phase 2 items are done.
- Work Capsule Phase 3 planning remains in progress.
- `BI-20E6AC44`, Build Studio attachment to capsules and backlog activity, is done and merged to `origin/main` via PR #724. Current code includes `attachBuildStudioWorkCapsule` and stores Build Studio linkage on `WorkCapsule.featureBuildId`, `backlogItemId`, `epicId`, and `workspaceState`.
- `EP-A2A` has `BI-9DB7C332` in progress for coworker team orchestration.
- `EP-BUILD-STUDIO` still has open blockers around runtime crash, backlog-to-Build-Studio handoff, and ideate stall visibility.

Design consequence: this spec must compose with the landed Build Studio attachment implementation and still tolerate historical or manually created builds that do not have a linked capsule.

### 3.2 Work Capsule Foundation

`origin/main` already has:

- `WorkCapsule` and `WorkCapsuleActivity` models.
- `apps/web/lib/work-capsules.ts` enum constants for status, source, executor kind, activity kind, branch taxonomy, and evidence kind.
- MCP handlers for capsule list/get/create/adopt/plan/claim/release/heartbeat/status/evidence.
- `/build/work` Work Control UI and `/build/work/[capsuleId]` detail route.
- Launch instruction presenter for creating a worktree and seeding MCP credentials.
- Scope claims stored in `WorkCapsule.scopeClaims`.
- Lease and stale-cache health projection in `apps/web/lib/work-capsules/work-capsule-presenter.ts`.

The overlay should read and enrich those records; it should not replace the Work Capsule UI.

### 3.3 Coworker Context Foundation

The coworker shell already:

- resolves route-local context through `routeContext`
- tracks active Build Studio build IDs on `/build`
- scopes Build Studio threads as `/build#<buildId>` so one build does not pollute another build's chat history
- defaults `/build` coworker mode to `act`, while other routes default to `advise`
- streams progress through `/api/agent/stream?threadId=...`

The server action `sendMessage` already assembles:

- route data context
- route context definition and sensitivity
- model tier by route
- skills and page actions
- Build Studio context when the route starts with `/build`
- wiki/context recall
- task classification and autonomous work run metadata
- governed tool execution context including route, thread, build, attachment, and task references

Design consequence: the context overlay should be resolved server-side and exposed to the coworker panel as a compact envelope. It should not let the browser invent context fields that later become audit truth.

**Active-build state limitation.** `BuildStudio.tsx` tracks the currently selected build through a client-side `build-studio-active-build` event, not through the URL. The server-side envelope can only resolve an exact build anchor when `buildId` is present in URL search params. Until active-build selection is URL-backed, the envelope for `/build` without a `buildId` param resolves route-only context and emits a `no_active_build` attention signal rather than guessing from latest-build heuristics. The UI must make this limitation visible and give the user a way to anchor the build in the URL.

### 3.4 Task and Evidence Foundation

The schema already includes:

- `TaskRun` with `taskRunId`, `contextId`, `buildId`, `parentTaskRunId`, `routeContext`, A2A-shaped `status`, `authorityScope`, `a2aMetadata`, and `progressPayload`.
- `TaskMessage` and `TaskArtifact`.
- `AgentThread` and `AgentMessage` for current presentation context.
- `ToolExecution` with `threadId`, `agentId`, `userId`, `toolName`, `routeContext`, `taskRunId`, `skillId`, and audit metadata.
- `ToolExecutionReceipt`.
- `BacklogItemActivity` and `WorkCapsuleActivity`.
- `ExternalEvidenceRecord`.

Existing helpers already project coworker chat into task messages and project persisted task progress back into stream events.

Design consequence: hive-mind collaboration should create or extend task-native records and artifacts. It must not remain a free-form chat transcript.

### 3.5 AI Operations Map Guardrail

The AI coworker visual control surface spec is directly relevant. It says the map must:

- project from canonical `AgentEvent`, `ToolExecution`, `ToolExecutionReceipt`, `BacklogItemActivity`, `ExternalEvidenceRecord`, and task-state primitives
- avoid a parallel event union, state machine, transport, or evidence ledger
- project handoffs from existing queue/orchestrator/task events before adding new discriminants

The context overlay follows the same rule.

### 3.6 Dependency Status

The following dependency states must be explicitly accommodated before or during implementation.

| Item | Status | Impact on this spec |
|---|---|---|
| Build Studio Work Capsule attachment (BI-20E6AC44, PR #724) | Landed on main | The overlay should read the landed `WorkCapsule` linkage fields, but it must still include a typed `capsule_not_linked` attention signal and create/link fallback for historical or unlinked builds. |
| EP-A2A / BI-9DB7C332 — coworker team orchestration | In progress | Hive-mind `TaskRun` child creation must not conflict with A2A team orchestration records. Child task source and parentage must remain compatible with whatever `BI-9DB7C332` lands. Check for schema/API overlap before opening the implementation PR. |
| EP-BUILD-STUDIO open blockers (runtime crash, ideate stall) | Open | Overlay must not depend on Build Studio being crash-free; all envelope resolution must tolerate a build in an error or stall phase and surface that as an attention signal. |

## 4. Research and Benchmarking

### 4.1 Open-Source References

**OpenHands.** OpenHands documents runtimes as environments where agents can edit files and run commands, with Docker as the default isolation path and managed sandboxes in cloud mode. DPF should adopt the runtime boundary lesson: the portal may coordinate work, but actual execution environments must remain explicit and inspectable. DPF rejects making the portal pretend all execution is local to the web page. Reference: [OpenHands runtime overview](https://docs.openhands.dev/openhands/usage/v0/runtimes/V0_overview).

**LangGraph / LangSmith threads.** LangGraph treats a thread as a persistent state container across runs, and Studio can inspect a thread's execution history, state changes, and checkpoints. DPF should adopt the persistent-state inspection pattern, but DPF's primary state carrier must be the Work Capsule and `TaskRun` envelope, not a generic graph thread alone. Reference: [LangGraph threads](https://docs.langchain.com/langgraph-platform/use-threads).

**LangGraph human-in-the-loop.** LangGraph's server API supports human review/edit/approval of tool calls through interrupts. DPF should adopt the mid-task interruption model, but keep approval authority in DPF's capability, grant, and proposal-mode controls. Reference: [LangGraph human-in-the-loop](https://docs.langchain.com/langgraph-platform/add-human-in-the-loop).

**AutoGen Studio.** AutoGen Studio provides team building, live message streaming, control transition graph visibility, pause/stop controls, and a gallery/deployment surface, while warning that Studio itself is not production-ready and lacks security features expected in deployed apps. DPF should adopt the team/run visibility pattern and reject research-prototype security assumptions. Reference: [AutoGen Studio docs](https://microsoft.github.io/autogen/0.5.4/user-guide/autogenstudio-user-guide/index.html).

**A2A protocol.** The current A2A specification centers task operations, task status, messages, parts, artifacts, streaming events, agent cards, and context/task identifier semantics. DPF should keep aligning internal coworker work with `TaskRun`, `TaskMessage`, and `TaskArtifact` so future A2A projection is a projection task, not a rewrite. Reference: [A2A latest specification](https://a2a-protocol.org/latest/specification/).

### 4.2 Commercial References

**GitHub Copilot cloud agent.** GitHub's cloud agent can research a repository, create a plan, make branch changes, and optionally open a PR; GitHub positions branch logs and commits as transparency/collaboration surfaces. DPF should adopt the branch/commit transparency pattern, but keep PR creation as merge-ready only per AGENTS.md and the Work Capsule spec. Reference: [GitHub Copilot cloud agent docs](https://docs.github.com/en/copilot/using-github-copilot/coding-agent/about-assigning-tasks-to-copilot).

**Cursor background agents.** Cursor background agents run asynchronously in isolated remote environments, work on separate branches, push to the repo, and can be viewed, followed up with, or taken over. DPF should adopt the "view status, follow up, take over" pattern, but route all ownership, leases, scope claims, and evidence through Work Capsules. Reference: [Cursor background agents](https://docs.cursor.com/en/background-agents).

**Linear triage and issue relations.** Linear makes incoming work reviewable before it enters team workflow; its issue relations expose blocked, blocking, related, and duplicate links in the issue sidebar, while Triage Intelligence suggests assignee/labels/related issues from workspace history. DPF should adopt contextual relationship surfacing and reject a flat task list. The overlay should show blockers, related capsules, duplicate risk, and likely reviewers near the work. References: [Linear triage](https://linear.app/docs/triage) and [Linear issue relations](https://linear.app/docs/issue-relations/).

### 4.3 Synthesis

The strongest pattern across the benchmarks is not "chat with agents." It is durable object context plus transparent execution state:

- persistent thread/task context
- visible branch/run state
- inspectable history and evidence
- explicit human interruption points
- team composition that can be paused, resumed, or taken over
- relationships and blockers surfaced near the work object

DPF's differentiator should be that those pieces are governed by the portal's business/work structures instead of by an external issue tracker, IDE sidebar, or research prototype state store.

## 5. Design Decision

DPF should implement a **Portal Context Overlay** that resolves a server-side `PortalContextEnvelope` for the current route and object, then uses that envelope to power:

1. a quiet UI overlay inside the portal shell and Build/Work surfaces
2. coworker prompt/context assembly
3. hive-mind coworker participation
4. evidence and progress presentation
5. backlog and Work Capsule updates

The first implementation target is Build Studio plus Work Capsules:

- `/build`
- `/build?buildId=...`
- `/build/work`
- `/build/work/[capsuleId]`

The contract must be global from day one so later routes can attach their own object anchors without redesigning the overlay.

## 6. Options Considered

### Option A: Global chat overlay only

Put a smarter chat panel on every route and add more prompt context.

Rejected because it keeps the work model chat-first. It may feel helpful in the moment, but it does not guarantee backlog/capsule/task/evidence updates.

### Option B: Full task-native rewrite first

Finish the A2A-shaped task runtime and then build the overlay.

Rejected as the first step because it blocks portal adoption on a larger runtime migration. The current `TaskRun`/`TaskMessage`/`TaskArtifact` foundation is sufficient for a projection-first overlay.

### Option C: Work Capsule-first context projection

Resolve a context envelope from current route/object/work records, project it into the UI and coworker runtime, and write actions/evidence back through existing primitives.

Recommended. It improves the user experience now while making the portal's instituted structure more central, not less.

## 7. Core Concept: PortalContextEnvelope

`PortalContextEnvelope` is a server-resolved projection. It is not a Prisma model in V1.

Suggested TypeScript shape:

```ts
export type PortalContextEnvelope = {
  envelopeId: string;
  resolvedAt: string;
  route: {
    pathname: string;
    routeContext: string;
    domain: string;
    sensitivity: string;
    docsPath?: string | null;
  };
  organization: {
    organizationId: string | null;
    name: string | null;
    archetypeId?: string | null;
  };
  user: {
    userId: string;
    principalId: string | null;
    platformRole: string;
  };
  anchors: PortalObjectAnchor[];
  work: {
    backlogItem?: WorkBacklogAnchor | null;
    epic?: WorkEpicAnchor | null;
    capsule?: WorkCapsuleAnchor | null;
    featureBuild?: FeatureBuildAnchor | null;
    taskRun?: TaskRunAnchor | null;
    agentThread?: AgentThreadAnchor | null;
    branch?: GitBranchAnchor | null;
  };
  evidence: EvidenceSummary[];
  authority: AuthoritySummary;
  coworkers: HiveMindCandidate[];
  attention: AttentionSignal[];
  promptDigest: string;
};
```

### 7.1 Anchor and Signal Types

All types referenced in `PortalContextEnvelope` are defined below. They are pure TypeScript projection shapes; none map to Prisma models in V1.

```ts
export type PortalObjectAnchor = {
  kind: "backlogItem" | "epic" | "capsule" | "build" | "taskRun" | "agentThread" | "branch";
  id: string;
  label: string;
  href?: string | null;
};

export type WorkBacklogAnchor = {
  backlogItemId: string;
  title: string;
  status: string;
  epicId: string | null;
  href: string;
};

export type WorkEpicAnchor = {
  epicId: string;
  title: string;
  status: string;
  href: string;
};

export type WorkCapsuleAnchor = {
  capsuleId: string;
  title: string;
  status: string;
  executorKind: string;
  leaseExpiresAt: string | null;
  isLeaseExpired: boolean;
  isStale: boolean;
  scopeClaims: string[];
  branchName: string | null;
  href: string;
};

export type FeatureBuildAnchor = {
  buildId: string;
  title: string;
  phase: string;
  status: string;
  evidenceComplete: boolean;
  href: string;
};

export type TaskRunAnchor = {
  taskRunId: string;
  contextId: string;
  status: string;
  authorityScope: string;
  parentTaskRunId: string | null;
};

export type AgentThreadAnchor = {
  threadId: string;
  routeContext: string;
  buildId: string | null;
};

export type GitBranchAnchor = {
  branchName: string;
  worktreePath: string | null;
  commitSha: string | null;
};

export type EvidenceSummary = {
  kind: string;
  source:
    | "capsule_activity"
    | "backlog_activity"
    | "tool_execution"
    | "task_artifact"
    | "external_evidence"
    | "build_evidence";
  recordId: string;
  label: string;
  recordedAt: string;
  isGap: boolean;
};

export type AuthoritySummary = {
  canActOnCapsule: boolean;
  canActOnBuild: boolean;
  canReviewPromotion: boolean;
  grantedToolKeys: string[];
  proposalModeActive: boolean;
};

export type AttentionSignal = {
  kind:
    | "missing_evidence"
    | "lease_expired"
    | "scope_overlap"
    | "build_stalled"
    | "capsule_not_linked"
    | "no_active_build"
    | "missing_grants"
    | "context_conflict"
    | "source_unavailable"
    | "envelope_timeout"
    | "unknown_route";
  severity: "info" | "warning" | "error";
  message: string;
  actionLabel?: string | null;
  actionHref?: string | null;
};
```

### 7.2 Envelope Design Rules

1. `envelopeId` is a deterministic hash of route/object/work anchors plus `resolvedAt` bucket. It is used for UI caching and logs, not as durable truth.
2. The browser can request an envelope but cannot submit envelope facts as authority.
3. Tool execution receives stable IDs from the server-resolved context, not client-invented context.
4. If a source is unavailable, the envelope includes a typed missing-source signal and still renders from remaining sources.
5. Prompt injection defense applies at the projection boundary: user-authored free text is summarized into `promptDigest` and not blindly copied into tool instructions.

### 7.3 Resolver Input Type

The public API of `resolvePortalContextEnvelope` accepts:

```ts
export type PortalContextInput = {
  pathname: string;
  routeContext: string;
  buildId?: string | null;
  capsuleId?: string | null;
  threadId?: string | null;
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
};
```

`buildId` must come from URL search params, not from client-side active-build state. See the active-build state limitation in Section 3.3.

## 8. Context Resolution

The public entry point is a single server-side function:

```ts
export async function resolvePortalContextEnvelope(
  input: PortalContextInput,
  userId: string
): Promise<PortalContextEnvelope>
```

It must not be called from Client Components. The result is passed as a prop from RSC page or layout into Client Components as needed. See Section 15.2 for component boundary rules.

Create `apps/web/lib/portal-context/` as the first implementation home:

- `types.ts`
- `route-resolver.ts`
- `work-resolver.ts`
- `evidence-resolver.ts`
- `hive-mind-resolver.ts`
- `prompt-digest.ts`
- `index.ts`

### 8.1 Route Resolver

Inputs:

- `pathname`
- `routeContext`
- optional `buildId`
- optional `capsuleId`
- optional `threadId`

Sources:

- `resolveRouteContext(routeContext)`
- `getRouteDataContext(routeContext, userId)`
- `ROUTE_CONTEXT_MAP`
- `buildCoworkerContextKey(routeContext)`

Output:

- route domain/sensitivity/docs path
- current object anchors
- available skills/page actions
- route-level data summary

### 8.2 Work Resolver

Sources:

- `WorkCapsule`
- `FeatureBuild`
- `BacklogItem`
- `Epic`
- `TaskRun`
- `AgentThread`
- git branch/worktree fields already stored on the capsule

Resolution order for Build Studio:

1. If `capsuleId` is present, load that capsule and its linked build/backlog/task records using `WorkCapsule.featureBuildId`, `backlogItemId`, `epicId`, and `workspaceState`.
2. Else if `buildId` is present (from URL search params), load the build and its linked capsule via `WorkCapsule.featureBuildId`.
3. Else resolve route context only and emit a `no_active_build` attention signal. Do not attempt to infer the active build from client state, session data, or latest-build heuristics — the server cannot see the client-selected build without URL backing.

Resolution order for generic routes:

1. route-specific object ID from URL
2. route context data provider
3. linked active TaskRun for current thread
4. linked active Work Capsule if a route or path scope claim matches
5. related open backlog items from MCP/DB-backed search only when explicitly requested by the user or by a hive-mind trigger

### 8.3 Evidence Resolver

V1 reads, summarizes, and links:

- `WorkCapsuleActivity`
- `BacklogItemActivity` where `kind = "evidence"` or work-link activity kinds
- `ToolExecution`
- `ToolExecutionReceipt`
- `TaskArtifact`
- `ExternalEvidenceRecord`
- Build Studio evidence fields on `FeatureBuild`

It does not create a new evidence ledger.

### 8.4 Hive-Mind Resolver

The resolver recommends coworkers by combining:

- route domain and skills
- `Agent` registry metadata
- route capability requirements
- current capsule executor and scope claims
- task state and stall/failure signals
- evidence gaps
- user intent from the current action

The output is a ranked list of `HiveMindCandidate` values:

```ts
export type HiveMindCandidate = {
  agentId: string;
  label: string;
  role: "builder" | "reviewer" | "architect" | "tester" | "operator" | "specialist";
  reason: string;
  activation: "passive-suggestion" | "ask-now" | "required-before-promotion";
  requiredGrantKeys: string[];
  taskType: "conversation" | "analysis" | "code_generation" | "verification";
};
```

`taskType` maps to the `TaskRun.taskType` field used by the existing coworker runtime for routing and model-tier selection. The resolver must emit a `taskType` that is valid per the current `TaskRun` schema enum; do not invent new values. The UI uses `taskType` only for display labelling; the runtime uses it for dispatch.

### 8.5 Envelope Caching

`PortalContextEnvelope` is produced by server-side code and cached using Next.js server caching.

**Caching API:** Before implementing, check `next.config.js` for `dynamicIO: true`. If set, use the `"use cache"` directive with `cacheTag()` and `cacheLife()` from `next/cache` — this is the Next.js 15/16 preferred path. If not set, use `unstable_cache` from `next/cache`. Both expose `revalidateTag` for invalidation. Do not mix both patterns in the same file.

Caching rules:

- `resolvedAt` bucket: floor timestamp to the nearest 30 seconds. This keeps the cache warm across sibling render calls on the same page load without serving staleness longer than one work action cycle.
- `envelopeId`: `sha256(pathname + buildId + capsuleId + threadId + userId + bucketedTimestamp).hex().slice(0, 16)`. Use Node's built-in `crypto.createHash` — no additional dependency.
- Cache key tags: `["portal-context", userId, buildId ?? "", capsuleId ?? "", threadId ?? ""]`. Tag the call so Next.js can targeted-revalidate it.
- Cache `revalidate`: 30 seconds. This is the outer ceiling; internal resolution may be faster.
- Invalidation: call `revalidateTag("portal-context")` when `WorkCapsuleActivity`, `TaskRun.status`, or `FeatureBuild.phase` changes.
- The browser receives the resolved envelope as a serialized prop or via a server action; it does not cache the envelope or construct its fields. A Client Component may hold a local reference for the lifetime of the current render only.

## 9. Hive-Mind Activation Model

The hive mind is not a separate product mode. It is a coordination pattern over one context envelope.

### 9.1 Passive Context

Every supported work route can show:

- current owner/executor
- suggested reviewers
- missing evidence
- blocked or overlapping capsules
- likely next handoff
- recent tool/evidence activity

This should be quiet and scannable. It must not interrupt normal page use.

### 9.2 Explicit Invocation

The user can ask:

- "ask an architect to review this"
- "bring in the UI reviewer"
- "have the tester check this before we continue"
- "compare two approaches"
- "what does the hive think is risky here?"

The system creates or reuses a child `TaskRun` with:

- same `contextId`
- `parentTaskRunId`
- same Work Capsule and Build Studio anchors in `a2aMetadata`
- `a2aMetadata.hiveMindContextId` and `a2aMetadata.hiveMindRole` to identify the hive invocation
- current route context and sensitivity
- clear expected artifact type

**Dedup rule:** Before creating a child `TaskRun`, query for an existing child with the same `parentTaskRunId`, `contextId`, and `hiveMindRole` that is not in a terminal state (`completed`, `failed`, `cancelled`). If one exists, reuse it rather than create a duplicate. Parallel hive invocations for different roles are allowed; parallel invocations for the same role against the same parent are not.

The coworker output becomes a `TaskArtifact` and, when it affects delivery state, Work Capsule or backlog evidence.

### 9.3 Automatic Triggers

Automatic hive-mind suggestions appear when:

- Build Studio stalls or reaches a typed exhausted outcome.
- a build/test/UX verification fails.
- scope claims overlap with another active capsule.
- a production-visible promotion is being prepared.
- evidence is missing for the next phase.
- a high-risk route or schema area is touched.
- the user asks for broad changes without a backlog/capsule anchor.
- a route-specific agent lacks the needed grant or skill.

Automatic activation must remain advisory unless the existing governance model requires review or approval. The overlay may recommend; it does not silently delegate side-effect work.

## 10. UI Design

The overlay should feel like an operational layer inside the portal, not like a marketing surface or separate app.

### 10.1 Placement

V1 uses:

- a compact context strip in Build Studio and Work Control showing active build/capsule/backlog/evidence health
- a right-side overlay drawer opened from existing coworker/AI shell chrome
- inline links from Work Control rows and Build Studio header to the relevant envelope detail

It must not add a competing top-level navigation model.

### 10.2 Drawer Layout

Suggested tabs:

- `Context`: route, object anchors, current objective, active user/principal, sensitivity
- `Work`: capsule, build, backlog, task, branch, scope claims, lease/stale health
- `Hive`: recommended coworkers, why they matter, active child tasks
- `Evidence`: latest evidence, receipts, failed checks, missing proof

The drawer should use dense, scan-friendly rows and small controls. No nested cards inside cards. No decorative blobs/orbs. Theme tokens only.

### 10.3 Build Studio First Screen

For `/build`, the first overlay slice should show:

- current `FeatureBuild.buildId` and phase
- linked Work Capsule when available
- linked backlog item/epic when available
- active `TaskRun` and thread context
- Build Studio evidence completeness
- next expected evidence or gate
- recommended coworker for the next review/handoff

For builds that predate capsule linkage or that were created without a capsule, the UI should show "Capsule not linked" with an action to create/link a capsule through the same Work Capsule store.

### 10.4 Work Control First Screen

For `/build/work` and `/build/work/[capsuleId]`, the overlay should show:

- capsule status, executor, branch, lease, health, and scope claims
- linked Build Studio build when present
- linked backlog and epic
- latest capsule activities
- launch state
- missing evidence before PR/promotion readiness

### 10.5 Accessibility and Theme Rules

All UI follows AGENTS.md and `docs/platform-usability-standards.md`:

- no hardcoded colors
- use DPF CSS variables
- 44px touch targets for interactive controls
- semantic buttons and tabs
- keyboard-visible focus states
- no hidden-only context that screen readers cannot reach
- no text that explains obvious application behavior inside the app

## 11. Data and Source-of-Truth Rules

1. `PortalContextEnvelope` is a projection, not a new durable record in V1.
2. Work ownership stays with `WorkCapsule`.
3. Intake and prioritization stay with `BacklogItem` and `Epic`.
4. Build execution stays with `FeatureBuild`.
5. Coworker execution stays with `TaskRun`, `TaskMessage`, and `TaskArtifact`.
6. Chat presentation stays with `AgentThread` and `AgentMessage` during migration.
7. Tool audit stays with `ToolExecution` and `ToolExecutionReceipt`.
8. Evidence stays with existing Work Capsule, backlog, task artifact, external evidence, receipt, and Build Studio evidence surfaces.
9. Identity uses `Principal` and `PrincipalAlias`; do not add a parallel user/agent identity model.
10. Route knowledge uses route context providers and wiki/context recall; do not add a hardcoded overlay prompt registry.

## 12. Refactoring Budget

Every implementation plan from this spec must reserve at least 20 percent of implementation capacity for refactoring the seams it touches.

Approved refactoring targets:

- centralize route/object/work context resolution in `apps/web/lib/portal-context/` — this collapses the duplicated Build Studio context assembly that currently lives separately in component-local state, coworker prompt assembly, and overlay rendering
- replace one-off `/build#<buildId>` handling with a named helper that documents the URL-hash vs search-param compatibility boundary
- introduce typed presenter functions for overlay rows instead of formatting raw Prisma rows in components
- extract `BuildStudioHeaderLayout` from `BuildStudio.tsx` to separate header-context concerns from phase-workflow rendering
- remove any new helper that becomes redundant after the context resolver lands

Not approved:

- redesigning Build Studio phases in this slice
- replacing Work Control
- rewriting the main coworker loop
- changing A2A task-state vocabulary
- adding a new durable context table before projection evidence proves it is needed

## 13. Security and Governance

- All envelope reads are scoped by the current user's platform role and existing route permissions.
- Sensitive `ToolExecution.parameters` and `result` stay summarized unless the user has auditor-level access.
- The overlay must not expose secrets, provider tokens, environment values, or raw MCP bearer tokens.
- Agent recommendations are filtered by user capability and agent tool grants.
- Side-effecting hive-mind work runs through existing proposal/tool execution controls.
- Any automatic action suggestion must identify the underlying work object before asking a coworker to act.
- External/desktop executor state is never trusted from local files alone; the portal reads capsule metadata and recorded evidence first, then treats git scanner data as refreshable cache.

## 14. Failure Handling

| Failure | Behavior |
|---|---|
| Work Capsule source unavailable | Render route/build context and show missing capsule source signal |
| Build ID has no linked capsule | Render build context and offer create/link action |
| `/build` route with no `buildId` in URL | Render route-only context with `no_active_build` signal; direct user to select or anchor a build in the URL |
| Capsule has expired lease | Show lease-expired signal and recommend heartbeat/reassignment |
| Tool evidence query fails | Render remaining evidence sources and show evidence-source warning |
| Route data provider fails | Render route definition plus object/work anchors; log structured error |
| Hive candidate lacks grants | Show candidate as unavailable with missing grant summary, no activation button |
| Context conflicts across sources | Prefer canonical durable records over cache, surface conflict as attention signal |
| Envelope resolution times out | Return a partial envelope with `source_unavailable` and `envelope_timeout` attention signals; never throw at the page level |
| Route not registered in resolver | Return a route-only envelope with `unknown_route` attention signal; overlay renders in read-only info mode with no work anchors |
| All hive candidates lack grants | Render the Hive tab as empty with a single `missing_grants` attention signal listing the required grant keys; show no activation buttons |

## 15. First Implementation Slice

The first code slice after review should be small and Build Studio-centered.

### 15.1 Foundation

Add `apps/web/lib/portal-context/` with:

- `resolvePortalContextEnvelope(input, userId)`
- route resolver for `/build` and `/build/work`
- Work Capsule/FeatureBuild/Backlog/TaskRun anchor resolver
- evidence summary resolver for Work Capsule and Build Studio evidence fields
- hive-mind candidate resolver with deterministic, testable rules
- prompt digest generator

### 15.2 UI

Add:

- `PortalContextStrip` for Build Studio and Work Control
- `PortalContextOverlayDrawer`
- `PortalContextSummaryRows`
- `HiveMindCandidateList`
- `EvidenceSummaryList`

Integrate with:

- `BuildStudio.tsx`
- `WorkControlPanel.tsx`
- `AgentCoworkerShell.tsx` or the nearest shell-level AI chrome, using the existing panel rather than a parallel floating product

**Server vs Client boundary**: `resolvePortalContextEnvelope` runs in RSC page or layout. The resolved `PortalContextEnvelope` is passed as a serializable prop to Client Component boundaries. The `PortalContextOverlayDrawer` and `PortalContextStrip` are Client Components so they can respond to user interaction. `PortalContextSummaryRows`, `HiveMindCandidateList`, and `EvidenceSummaryList` may be Server Components if they receive static envelope slices, or Client Components when they need interactive controls. Mark the boundary explicitly with `"use client"`; do not leave it implicit. Use the existing local tab pattern from `apps/web/components/build-studio/ArtifactTabs.tsx` for the drawer tab bar. Do not add Radix or another component-library dependency in V1.

### 15.3 Coworker Runtime

Update `sendMessage` context assembly so the server can resolve a portal context digest for supported routes and include it alongside the current route/build context. The prompt should receive a compact summary and stable IDs, not the full envelope JSON by default.

### 15.4 Tests

Required focused tests:

- route resolver maps `/build` with `buildId` to build/capsule/backlog/task anchors
- route resolver maps `/build` without `buildId` to route-only context with `no_active_build` attention signal
- route resolver maps `/build/work/[capsuleId]` to capsule/build/backlog anchors using `WorkCapsule.featureBuildId`
- unknown route returns `unknown_route` attention signal and does not throw
- missing capsule does not crash envelope resolution; `capsule_not_linked` signal is emitted
- evidence resolver deduplicates equivalent Build Studio and activity evidence
- hive resolver recommends UI reviewer for user-facing UI changes
- hive resolver recommends architect/reviewer before promotion or high-risk scope
- all hive candidates lacking grants renders empty Hive tab with `missing_grants` signal, no activation buttons
- hive dedup rule: second invocation with same parent + role + non-terminal state returns existing TaskRun, not a new one
- drawer renders with theme tokens and no hardcoded colors
- coworker prompt digest includes stable IDs and excludes raw tool payloads

## 16. Verification Plan

For the first implementation slice:

1. Focused Vitest for `apps/web/lib/portal-context/*`.
2. Component tests for the strip/drawer/list components.
3. `pnpm --filter web typecheck`.
4. `pnpm --filter web exec vitest run <focused files>`.
5. `cd apps/web && pnpm exec next build` or the repo-pinned equivalent required by AGENTS.md at implementation time.
6. UX verification against the Docker-served portal:
   - log in as `admin@dpf.local`
   - open `/build`
   - select or create a build
   - verify the context strip shows build/capsule/backlog/task state
   - open the overlay drawer
   - verify Hive and Evidence tabs render useful state without overlap
   - open `/build/work`
   - open a capsule detail route and verify the overlay follows the capsule

For this doc-only spec branch:

- Markdown sanity check
- `git diff --check`
- record spec-review evidence on `BI-7529B658`

## 17. Acceptance Criteria

The first shipped overlay slice is acceptable when:

1. `/build` shows active context without relying on chat history.
2. `/build/work` and `/build/work/[capsuleId]` show capsule context and evidence health.
3. The coworker prompt for supported routes gets the same stable work anchors shown in the UI.
4. Hive-mind recommendations are explainable, grant-aware, and tied to the current work object.
5. Any coworker participation writes to `TaskRun`/`TaskArtifact` and relevant Work Capsule/backlog evidence, not only chat.
6. The UI uses DPF theme tokens and remains dense, calm, and scan-friendly.
7. No new durable evidence/event/context source of truth is introduced.
8. At least 20 percent of implementation work is spent on reducing duplicated context seams.

## 18. Non-Goals

- Solving database backup or recovery. That is tracked separately.
- Replacing Work Capsules.
- Replacing Build Studio.
- Replacing the AI Operations Map.
- Creating public A2A endpoints.
- Full task-native runtime cutover.
- Adding a new portal-wide command center route in V1.
- Creating PRs before merge readiness.
- Letting the browser author audit truth.

## 19. Open Questions

**Open: Q1 — Overlay drawer placement.**
Should `PortalContextOverlayDrawer` live inside the existing `AgentCoworkerShell` (sharing its open/close state) or as a sibling shell-level component that the coworker panel can also invoke? The trade-off is coupling vs. coordination overhead. This decision affects where the drawer open control sits and whether the coworker panel and overlay drawer can be open simultaneously. **Resolution required before the first implementation PR is opened.**

**Resolved: Q2 — Build Studio attachment dependency.**
Build Studio attachment has landed on `origin/main` via PR #724. The overlay implementation should consume the landed Work Capsule linkage fields and keep the create/link fallback only for historical or unlinked builds.

**Resolved: Q3 — hive-mind `TaskRun` source value.**
Use `source = "coworker"` in V1 and carry hive-mind identity in a typed `a2aMetadata` field on the `TaskRun` (e.g. `hiveMindContextId`, `hiveMindRole`). Adding a new `source` enum value requires Prisma migration, MCP enum parity, and test updates across multiple packages — cost is disproportionate for V1 and `a2aMetadata` is already present and JSON-typed.

**Resolved: Q4 — `promptDigest` persistence.**
Keep `promptDigest` ephemeral in V1. The spec's rule 1 (envelope is not a durable record) and rule 4 (tool execution uses server-resolved stable IDs, not client facts) already remove the audit-trail need for the digest itself. If high-assurance audit is later required, the stable IDs in the envelope are sufficient to reconstruct context; persist those as `TaskArtifact` fields at that point, not the digest string.

## 20. Recommendation

Proceed with the Work Capsule-first context projection.

The overlay should make the portal feel like the active work environment even when some execution still happens in Codex desktop, Claude desktop, or a sandbox. The user should see what the portal knows, what the work is attached to, what evidence exists, who should help, and what must happen next. The hive mind should join through that shared envelope and leave artifacts/evidence behind in the product.
