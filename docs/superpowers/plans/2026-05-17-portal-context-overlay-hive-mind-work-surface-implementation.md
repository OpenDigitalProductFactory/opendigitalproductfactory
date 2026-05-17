# Portal Context Overlay and Hive-Mind Work Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make portal development work happen in context by resolving a server-side `PortalContextEnvelope` for Build Studio and Work Capsule routes, rendering that context inside the portal UI, and passing the same stable work anchors into coworker runtime prompts and hive-mind recommendations.

**Architecture:** Add a projection layer under `apps/web/lib/portal-context/` that reads existing route, work, evidence, authority, and coworker sources. Do not create a durable context table in V1. Server components resolve the envelope, client components render the strip/drawer, and side-effect actions continue through existing Work Capsule, Build Studio, TaskRun, ToolExecution, and backlog primitives.

**Tech Stack:** Next.js 16 app router, React Server Components, Prisma via `@dpf/db`, existing route context helpers, Vitest, React Testing Library, lucide-react, existing DPF CSS custom properties. No new component-library dependency in V1.

---

## Source Inputs

- Spec: `docs/superpowers/specs/2026-05-17-portal-context-overlay-hive-mind-work-surface-design.md`
- Initial routes: `/build`, `/build?buildId=...`, `/build/work`, `/build/work/[capsuleId]`
- Build Studio entry: `apps/web/app/(shell)/build/page.tsx`
- Build Studio client shell: `apps/web/components/build/BuildStudio.tsx`
- Work Control entry: `apps/web/app/(shell)/build/work/page.tsx`
- Capsule detail entry: `apps/web/app/(shell)/build/work/[capsuleId]/page.tsx`
- Work Control client shell: `apps/web/components/build/work-control/WorkControlPanel.tsx`
- Local tab pattern: `apps/web/components/build-studio/ArtifactTabs.tsx`
- Route context: `apps/web/lib/tak/route-context-map.ts`, `apps/web/lib/tak/route-context.ts`, `apps/web/lib/tak/agent-coworker-context.ts`
- Coworker send path: `apps/web/lib/actions/agent-coworker.ts`
- Work Capsule actions: `apps/web/lib/actions/work-capsules.ts`
- Build read actions: `apps/web/lib/actions/build-read.ts`

## Current Repo Constraints

- `@radix-ui/react-tabs` is not present in `package.json`, `apps/web/package.json`, or `pnpm-lock.yaml`; use the existing local tab pattern and improve accessibility where the overlay owns the code.
- `BuildStudio.tsx` currently owns active build selection and emits `build-studio-active-build` from client state. The server-side envelope can only be exact for explicit `buildId` until active-build state is reflected through URL/search params or a server action.
- Build Studio Work Capsule attachment has landed on main through PR #724. The resolver should use the landed `WorkCapsule.featureBuildId`, `backlogItemId`, `epicId`, and `workspaceState` linkage, while still tolerating historical or unlinked builds with a typed `capsule_not_linked` attention signal.
- The A2A team orchestration item is still in progress. Hive-mind child work must use existing `TaskRun` parentage and typed metadata without changing task-state vocabulary.
- This slice must not add a new durable context model, rewrite Build Studio phases, replace Work Control, or change the main coworker loop.

## File Structure

Create:

```text
apps/web/lib/portal-context/types.ts
apps/web/lib/portal-context/cache.ts
apps/web/lib/portal-context/route-resolver.ts
apps/web/lib/portal-context/work-resolver.ts
apps/web/lib/portal-context/evidence-resolver.ts
apps/web/lib/portal-context/hive-mind-resolver.ts
apps/web/lib/portal-context/prompt-digest.ts
apps/web/lib/portal-context/index.ts
apps/web/lib/portal-context/portal-context.test.ts
apps/web/lib/portal-context/prompt-digest.test.ts
apps/web/components/portal-context/PortalContextStrip.tsx
apps/web/components/portal-context/PortalContextOverlayDrawer.tsx
apps/web/components/portal-context/PortalContextTabs.tsx
apps/web/components/portal-context/PortalContextSummaryRows.tsx
apps/web/components/portal-context/HiveMindCandidateList.tsx
apps/web/components/portal-context/EvidenceSummaryList.tsx
apps/web/components/portal-context/PortalContextOverlayDrawer.test.tsx
apps/web/components/portal-context/PortalContextStrip.test.tsx
```

Modify:

```text
apps/web/app/(shell)/build/page.tsx
apps/web/app/(shell)/build/work/page.tsx
apps/web/app/(shell)/build/work/[capsuleId]/page.tsx
apps/web/components/build/BuildStudio.tsx
apps/web/components/build/work-control/WorkControlPanel.tsx
apps/web/lib/actions/agent-coworker.ts
```

Refactor if needed:

```text
apps/web/lib/actions/build-read.ts
apps/web/lib/actions/work-capsules.ts
apps/web/components/build-studio/ArtifactTabs.tsx
```

---

## Phase 1 - Projection Types and Cache Boundary

- [ ] Create `apps/web/lib/portal-context/types.ts` with the exact projection types from the spec.

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

- [ ] Add the remaining anchor, evidence, authority, attention, and hive-mind candidate types from the spec in the same file.
- [ ] Create `apps/web/lib/portal-context/cache.ts` with deterministic bucket, cache key, and tag helpers.

```ts
import { createHash } from "node:crypto";

const ENVELOPE_BUCKET_MS = 30_000;

export function bucketPortalContextTimestamp(now = new Date()): Date {
  return new Date(Math.floor(now.getTime() / ENVELOPE_BUCKET_MS) * ENVELOPE_BUCKET_MS);
}

export function createPortalContextEnvelopeId(input: PortalContextInput, userId: string, bucket: Date): string {
  const parts = [
    input.pathname,
    input.buildId ?? "",
    input.capsuleId ?? "",
    input.threadId ?? "",
    userId,
    bucket.toISOString(),
  ];

  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}
```

- [ ] Implement `portalContextCacheTags(input, userId)` returning `["portal-context", user-specific tag, and non-empty entity tags]`. Include the broad `portal-context` tag required by the spec and entity-specific tags for later targeted invalidation.
- [ ] Add focused tests for bucket stability, envelope ID determinism, and tag generation.

Expected test command:

```powershell
pnpm --filter web exec vitest run apps/web/lib/portal-context/portal-context.test.ts
```

---

## Phase 2 - Server Resolver Foundation

- [ ] Create `apps/web/lib/portal-context/route-resolver.ts`.
- [ ] Use `resolveRouteContext`, `getRouteDataContext`, and `buildCoworkerContextKey` to produce route domain, sensitivity, docs path, route data summary, and route-only anchors.
- [ ] Unknown routes must return a route-only projection plus an `unknown_route` attention signal, not throw.
- [ ] Create `apps/web/lib/portal-context/work-resolver.ts`.
- [ ] Resolve work anchors in this order:
  - [ ] explicit `capsuleId`
  - [ ] explicit `buildId`
  - [ ] explicit `threadId`
  - [ ] route-only fallback
- [ ] Query the existing records needed for anchors in one contained resolver. Start with the fields required by `WorkCapsuleAnchor`, `FeatureBuildAnchor`, `WorkBacklogAnchor`, `WorkEpicAnchor`, `TaskRunAnchor`, `AgentThreadAnchor`, and `GitBranchAnchor`.
- [ ] If a build has no linked capsule, emit `capsule_not_linked` with an action href to Work Control/create-link when the existing action surface supports it.
- [ ] If a capsule lease is expired or stale, emit `lease_expired` or `build_stalled` as appropriate.
- [ ] Create `apps/web/lib/portal-context/evidence-resolver.ts`.
- [ ] Summarize existing evidence from Work Capsule activity, backlog evidence activity, tool execution receipts, task artifacts, external evidence, and FeatureBuild evidence fields.
- [ ] Deduplicate equivalent records by source and canonical record ID.
- [ ] On source failure, return partial evidence plus `source_unavailable` instead of failing page render.
- [ ] Create `apps/web/lib/portal-context/hive-mind-resolver.ts`.
- [ ] Produce deterministic candidates from route domain, current work object, evidence gaps, stalled/build-risk signals, and grants.
- [ ] Filter activation controls by the current user's capabilities and agent tool grants; unavailable candidates may render as explanation-only rows.
- [ ] Add tests for build route resolution, capsule route resolution, missing capsule, evidence dedupe, and hive candidate ranking.

Expected test command:

```powershell
pnpm --filter web exec vitest run apps/web/lib/portal-context/portal-context.test.ts
```

---

## Phase 3 - Public Entry Point and Prompt Digest

- [ ] Create `apps/web/lib/portal-context/prompt-digest.ts`.
- [ ] Generate a compact digest with stable IDs and concise labels only. Exclude raw `ToolExecution.parameters`, raw `ToolExecution.result`, secrets, environment values, and bearer tokens.

```ts
export function createPortalContextPromptDigest(envelope: Omit<PortalContextEnvelope, "promptDigest">): string {
  return [
    `Route: ${envelope.route.routeContext}`,
    envelope.work.featureBuild ? `Build: ${envelope.work.featureBuild.buildId} (${envelope.work.featureBuild.phase})` : null,
    envelope.work.capsule ? `Capsule: ${envelope.work.capsule.capsuleId} (${envelope.work.capsule.status})` : null,
    envelope.work.backlogItem ? `Backlog: ${envelope.work.backlogItem.backlogItemId} (${envelope.work.backlogItem.status})` : null,
    envelope.attention.length ? `Attention: ${envelope.attention.map((item) => item.kind).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
```

- [ ] Create `apps/web/lib/portal-context/index.ts` with the public server-only function:

```ts
export async function resolvePortalContextEnvelope(
  input: PortalContextInput,
  userId: string
): Promise<PortalContextEnvelope> {
  // Implementation composes route, work, evidence, authority, coworkers, and promptDigest.
}
```

- [ ] Wrap the uncached resolver with `unstable_cache` at the public entry point. Use a 30-second revalidate value and the tags from `portalContextCacheTags`.
- [ ] Enforce a soft timeout around sub-resolvers. Timeout returns partial route/user context plus `source_unavailable` and `envelope_timeout` attention signals.
- [ ] Add `revalidatePortalContext(input, userId)` or entity-specific helpers that call `revalidateTag("portal-context")` first, with entity tags ready for narrower invalidation later.
- [ ] Add tests proving prompt digest includes stable IDs and excludes raw tool payload fields.

Expected test command:

```powershell
pnpm --filter web exec vitest run apps/web/lib/portal-context/prompt-digest.test.ts
```

---

## Phase 4 - Build Studio Integration

- [ ] Modify `apps/web/app/(shell)/build/page.tsx` to resolve a portal context envelope after session lookup and before rendering `BuildStudio`.
- [ ] Pass `pathname: "/build"`, `routeContext: "/build"`, `buildId` from search params, and search params into `resolvePortalContextEnvelope`.
- [ ] Add `portalContext?: PortalContextEnvelope | null` to `BuildStudio` props.
- [ ] Render `PortalContextStrip` near the Build Studio header where it is visible but does not replace existing phase controls.
- [ ] Add a drawer open control in the strip. The drawer must be controlled by local client state and receive only the serialized envelope.
- [ ] For the no-explicit-build state, render a route-only strip with "No active work object" as state, not as explanatory instructional copy.
- [ ] Keep existing `build-studio-active-build` behavior intact. Do not try to server-resolve the client-selected build until the active build is URL-backed.

Refactoring budget in this phase:

- [ ] Extract a small presenter helper for Build Studio context labels so raw Prisma/build rows are not formatted directly in the new UI.
- [ ] If URL hash compatibility is still needed, create a named helper for `/build#<buildId>` vs `/build?buildId=...` handling and use it from both the existing build list and the overlay links.

Expected focused tests:

```powershell
pnpm --filter web exec vitest run apps/web/components/build/BuildStudioHeaderLayout.test.tsx apps/web/components/portal-context/PortalContextStrip.test.tsx
```

---

## Phase 5 - Work Control and Capsule Detail Integration

- [ ] Modify `apps/web/app/(shell)/build/work/page.tsx` to resolve a route-level Work Control envelope.
- [ ] Pass the envelope into `WorkControlPanel`.
- [ ] Render `PortalContextStrip` above the Work Control table/action area.
- [ ] Modify `apps/web/app/(shell)/build/work/[capsuleId]/page.tsx` to resolve a capsule-specific envelope with `capsuleId` from params.
- [ ] Render the same strip/drawer on capsule detail.
- [ ] Ensure capsule detail links preserve canonical `/build/work/[capsuleId]` hrefs.

Refactoring budget in this phase:

- [ ] Extract a Work Capsule presenter that maps capsule status, executor, lease, branch, scope claims, and evidence health into display rows.
- [ ] Keep the presenter pure and unit tested so the drawer and strip do not duplicate formatting logic.

Expected focused tests:

```powershell
pnpm --filter web exec vitest run apps/web/components/build/work-control/WorkControlPanel.test.tsx apps/web/components/portal-context/PortalContextOverlayDrawer.test.tsx
```

---

## Phase 6 - Overlay UI Components

- [ ] Create `PortalContextStrip.tsx` as a compact client component.
- [ ] Create `PortalContextOverlayDrawer.tsx` as a right-side drawer using existing portal styling, not a new dependency.
- [ ] Create `PortalContextTabs.tsx` using local tab markup:
  - [ ] `role="tablist"` on the tab container
  - [ ] `role="tab"` on each tab button
  - [ ] `aria-selected`
  - [ ] `aria-controls`
  - [ ] visible focus states
  - [ ] keyboard arrow navigation if focus movement is not already supplied by a local helper
- [ ] Create dense row/list components:
  - [ ] `PortalContextSummaryRows`
  - [ ] `HiveMindCandidateList`
  - [ ] `EvidenceSummaryList`
- [ ] Use lucide icons where they clarify status or actions.
- [ ] Use only DPF theme variables:
  - [ ] `text-[var(--dpf-text)]`
  - [ ] `text-[var(--dpf-muted)]`
  - [ ] `bg-[var(--dpf-surface-1)]`
  - [ ] `bg-[var(--dpf-surface-2)]`
  - [ ] `border-[var(--dpf-border)]`
  - [ ] `text-[var(--dpf-accent)]`
  - [ ] `bg-[var(--dpf-bg)]`
- [ ] Avoid nested cards. Use full-width bands, rows, and compact panels.
- [ ] Add component tests for tabs, missing grants, empty hive state, evidence gaps, and attention signals.
- [ ] Add a static test or assertion that component source does not introduce hardcoded Tailwind color classes or inline hex colors.

Expected focused tests:

```powershell
pnpm --filter web exec vitest run apps/web/components/portal-context/PortalContextOverlayDrawer.test.tsx apps/web/components/portal-context/PortalContextStrip.test.tsx
```

---

## Phase 7 - Coworker Runtime Integration

- [ ] Update `apps/web/lib/actions/agent-coworker.ts` so supported route sends resolve a `PortalContextEnvelope` server-side.
- [ ] Include `promptDigest` and stable anchor IDs in coworker prompt assembly alongside the current route/build context.
- [ ] Do not include full envelope JSON by default.
- [ ] Preserve existing agent routing, grant checks, proposal controls, and `ToolExecution` audit writes.
- [ ] For explicit hive invocation, create or reuse a child `TaskRun` with:
  - [ ] same `contextId`
  - [ ] `parentTaskRunId`
  - [ ] current Work Capsule and Build Studio anchors in typed metadata
  - [ ] `source = "coworker"`
  - [ ] `a2aMetadata.hiveMindContextId`
  - [ ] `a2aMetadata.hiveMindRole`
- [ ] Persist meaningful coworker outputs as `TaskArtifact`, and when delivery state changes, record Work Capsule or backlog evidence through existing actions.
- [ ] Add tests proving prompt digest appears for supported Build Studio/Work Control routes and raw tool payloads do not.

Expected focused tests:

```powershell
pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker-server.test.ts apps/web/lib/actions/agent-coworker-external.test.ts
```

---

## Phase 8 - Invalidation Hooks

- [ ] Identify existing mutation points for:
  - [ ] `WorkCapsuleActivity` creation
  - [ ] `TaskRun.status` changes
  - [ ] `FeatureBuild.phase` changes
- [ ] Call the portal-context invalidation helper from those mutation points.
- [ ] Start with broad `revalidateTag("portal-context")` to satisfy the spec safely.
- [ ] Add entity-specific tags at the helper boundary so a later slice can narrow invalidation without changing call sites.
- [ ] Add unit tests or spy tests around mutation helpers where they are testable without a full Next runtime.

Expected focused tests:

```powershell
pnpm --filter web exec vitest run apps/web/lib/actions/work-capsules.test.ts apps/web/lib/actions/build-read.test.ts
```

---

## Phase 9 - UX Verification

- [ ] Start or rebuild the Docker-served portal using the repo-approved process for this worktree.
- [ ] Read `ADMIN_PASSWORD` from repo-root `.env`.
- [ ] Log in as `admin@dpf.local`.
- [ ] Open `/build`.
- [ ] Verify the context strip renders without overlap at desktop and mobile widths.
- [ ] Open `/build?buildId=<known-build-id>`.
- [ ] Verify build, capsule/backlog if linked, evidence, and attention signals are correct.
- [ ] Open the overlay drawer.
- [ ] Verify `Context`, `Work`, `Hive`, and `Evidence` tabs are keyboard reachable and visually stable.
- [ ] Open `/build/work`.
- [ ] Verify route-level Work Control context.
- [ ] Open `/build/work/[capsuleId]`.
- [ ] Verify capsule, branch, lease, evidence, and linked build state.
- [ ] Send a coworker message from a supported route and verify the prompt/runtime path receives the digest server-side.
- [ ] Capture evidence with screenshots or execution notes in the active backlog item.

---

## Phase 10 - Final Verification and Handoff

- [ ] Run focused portal-context tests.

```powershell
pnpm --filter web exec vitest run apps/web/lib/portal-context/portal-context.test.ts apps/web/lib/portal-context/prompt-digest.test.ts apps/web/components/portal-context/PortalContextOverlayDrawer.test.tsx apps/web/components/portal-context/PortalContextStrip.test.tsx
```

- [ ] Run affected existing tests.

```powershell
pnpm --filter web exec vitest run apps/web/components/build/BuildStudioHeaderLayout.test.tsx apps/web/components/build/work-control/WorkControlPanel.test.tsx apps/web/lib/actions/agent-coworker-server.test.ts apps/web/lib/actions/agent-coworker-external.test.ts
```

- [ ] Run typecheck.

```powershell
pnpm --filter web typecheck
```

- [ ] Run production build.

```powershell
pnpm --filter web build
```

- [ ] Run `git diff --check`.
- [ ] Update this plan with implementation notes if any task changes materially during execution.
- [ ] Record execution evidence against the active backlog item.
- [ ] Commit with DCO sign-off.
- [ ] Push the branch.
- [ ] Open a PR only after the branch passes the build gate and UX evidence is recorded.

---

## Acceptance Checklist

- [ ] `/build` shows active context without relying on chat history.
- [ ] `/build/work` and `/build/work/[capsuleId]` show capsule context and evidence health.
- [ ] Coworker prompts for supported routes receive the same stable work anchors shown in the UI.
- [ ] Hive-mind recommendations are explainable, grant-aware, and tied to the current work object.
- [ ] Coworker participation writes to `TaskRun`/`TaskArtifact` and relevant Work Capsule/backlog evidence, not only chat.
- [ ] UI uses DPF theme tokens and remains dense, calm, and scan-friendly.
- [ ] No new durable context table exists in V1.
- [ ] No new component-library dependency is added in V1.
- [ ] At least 20 percent of implementation time is spent on the approved refactoring seams.

## Self-Review Notes

- The plan keeps the `PortalContextEnvelope` as a projection and leaves durable truth in existing models.
- The first UI integration targets Build Studio and Work Control only, matching the reviewed spec.
- The plan explicitly accounts for the landed Work Capsule attach implementation and the still in-flight A2A team orchestration dependency.
- The implementation path avoids Radix because the dependency is not present and a local Build Studio tab pattern already exists.
- The refactoring budget is attached to concrete seams: active build context, link compatibility, and presenter extraction.
