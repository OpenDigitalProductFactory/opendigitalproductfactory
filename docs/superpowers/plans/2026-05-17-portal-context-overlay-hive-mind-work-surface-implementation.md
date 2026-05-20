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
- Phase 2 additions (now canonical): `apps/web/lib/actions/portal-context-hive.ts`, `apps/web/lib/portal-context/invalidation.ts`, `apps/web/lib/portal-context/evidence-recording.ts`, `apps/web/lib/portal-context/db-types.ts`, `apps/web/lib/actions/portal-context-hive.test.ts`, `apps/web/lib/portal-context/invalidation.test.ts`

## Current Repo Constraints

- `@radix-ui/react-tabs` is not present in `package.json`, `apps/web/package.json`, or `pnpm-lock.yaml`; use the existing local tab pattern and improve accessibility where the overlay owns the code.
- `BuildStudio.tsx` currently owns active build selection and emits `build-studio-active-build` from client state. The server-side envelope can only be exact for explicit `buildId` until active-build state is reflected through URL/search params or a server action.
- Build Studio Work Capsule attachment has landed on main through PR #724. The resolver should use the landed `WorkCapsule.featureBuildId`, `backlogItemId`, `epicId`, and `workspaceState` linkage, while still tolerating historical or unlinked builds with a typed `capsule_not_linked` attention signal.
- The A2A team orchestration item is still in progress. Hive-mind child work must use existing `TaskRun` parentage and typed metadata without changing task-state vocabulary.
- This slice must not add a new durable context model, rewrite Build Studio phases, replace Work Control, or change the main coworker loop.

## Implementation Status - 2026-05-17

Implemented in branch `feat/portal-context-overlay-hive-mind`:

- Added the projection foundation under `apps/web/lib/portal-context/`: typed envelopes, cache keys/tags, route/work/evidence/authority resolvers, registry-backed hive-mind recommendations, prompt digest generation, and broad cache invalidation.
- Integrated server-resolved envelopes into `/build`, `/build/work`, and `/build/work/[capsuleId]`.
- Added the portal context strip and overlay drawer with accessible `Context`, `Work`, `Hive`, and `Evidence` tabs, DPF theme-token styling, empty states, and desktop/mobile smoke screenshots in `output/playwright/`.
- Injected the portal context digest and stable anchor IDs into coworker prompts for supported Build/Work routes without passing full envelope JSON or raw tool payloads.
- Revalidated the broad `portal-context` cache tag after Work Capsule activity writes so evidence/capsule updates do not stay stale.

Verified:

- `pnpm --filter web exec vitest run lib/portal-context/portal-context.test.ts lib/portal-context/prompt-digest.test.ts components/portal-context/PortalContextOverlayDrawer.test.tsx components/portal-context/PortalContextStrip.test.tsx components/build/BuildStudioHeaderLayout.test.tsx components/build/work-control/WorkControlPanel.test.tsx lib/actions/agent-coworker-external.test.ts lib/work-capsules/work-capsule-store.test.ts` - 8 files, 41 tests passed.
- `pnpm --filter web typecheck` - passed.
- `pnpm --filter web build` - passed. Existing Turbopack/NFT broad-trace warnings remain in backlog/spec search and discovery catalog import traces.
- Playwright production smoke against the worktree server on `localhost:3101` passed for `/build`, drawer tabs, `/build/work`, and mobile strip width. Screenshots: `output/playwright/portal-context-build-desktop.png`, `output/playwright/portal-context-drawer-desktop.png`, `output/playwright/portal-context-work-control-desktop.png`, `output/playwright/portal-context-build-mobile.png`.

Deferred from this slice:

- Explicit hive invocation UI and child `TaskRun` dedupe/persistence.
- Full `source_unavailable` and `envelope_timeout` partial-envelope fallback around every sub-resolver.
- Narrower entity-specific invalidation for `TaskRun.status` and `FeatureBuild.phase` mutation points.
- URL-backed active-build selection to replace the current client-only `build-studio-active-build` event limitation.

These are now tracked as `BI-3FCA9CB0` under `EP-CAPSULE`.

## Implementation Status - 2026-05-20 Phase 2

Implemented in branch `feat/portal-context-overlay-phase-2`:

- Added explicit Hive tab invocation from the Portal Context overlay. Candidate rows are now grant-aware action rows that either queue/ask the recommended coworker, show `Needs task`, show `Missing grant`, or show the empty state.
- Added `invokePortalContextHiveCandidate`, a server action that authenticates the caller, verifies parent `TaskRun` ownership, reuses an existing non-terminal child task for the same parent/context/hive role, or creates a new child `TaskRun` with hive metadata, request artifact, anchored build/capsule/backlog/epic IDs, and child thread linkage.
- Added backlog and Work Capsule evidence recording for hive invocation requests. The action writes a `hive_invocation_request` `TaskArtifact`, Work Capsule evidence when a capsule anchor exists, and `BacklogItemActivity` when a backlog anchor exists.
- Persisted substantive coworker responses as `TaskArtifact` records and mirrored them to Work Capsule and backlog evidence when the active portal context has those anchors. Short acknowledgements remain chat-only to avoid noisy evidence.
- Added partial-envelope fallback around user, principal, organization, route-data, work, evidence, and hive candidate sources. Resolver failures now yield a degraded envelope plus `source_unavailable`; soft timeouts also add `envelope_timeout`.
- Replaced broad-only invalidation with scoped helpers for build, capsule, thread, user, and task-run tags. Generic callers can still invalidate the broad `portal-context` tag, but build/task mutation points now use entity tags.
- URL-backed default Build Studio selection now replaces `/build` with `/build?buildId=<active>` after hydration, so the server envelope and coworker runtime can anchor the same active build.
- Added a small shared `recordPortalContextBacklogEvidence` helper so portal-context evidence writes use the same backlog activity shape from hive and coworker paths.

Verified:

- `pnpm --filter web exec vitest run lib/portal-context/portal-context.test.ts lib/portal-context/prompt-digest.test.ts lib/portal-context/invalidation.test.ts components/portal-context/PortalContextOverlayDrawer.test.tsx components/portal-context/PortalContextStrip.test.tsx components/build/BuildStudioHeaderLayout.test.tsx components/build/work-control/WorkControlPanel.test.tsx lib/actions/portal-context-hive.test.ts lib/actions/agent-coworker-external.test.ts lib/work-capsules/work-capsule-store.test.ts lib/actions/build-governed.test.ts` - 11 files, 69 tests passed.
- `pnpm --filter web typecheck` - passed.
- `pnpm --filter web build` - passed. Existing Turbopack/NFT broad-trace warnings remain in backlog/spec search and discovery catalog import traces.
- Disposable Docker UX verification against the phase-2 image on `localhost:3101` passed for `/build`, URL-backed active build selection, Portal Context strip, overlay drawer, Hive tab, and mobile drawer width. Screenshots: `apps/web/output/playwright/phase2-build-overlay-hive.png`, `apps/web/output/playwright/phase2-build-overlay-hive-mobile.png`.

Remaining dependency:

- The hive action calls the existing `dispatchAgentThread` seam after creating or reusing the child task. That dispatcher is still a placeholder in current mainline code, so this slice makes hive participation durable and visible in `TaskRun`/artifact/evidence records, but full autonomous child-thread execution still depends on the A2A/team-orchestration runtime landing behind that seam.

## Known Gaps From Architectural Review — 2026-05-20

The following implementation-vs-spec gaps were identified after Phase 2 landed and must be addressed before this slice is marked complete (or explicitly deferred to a follow-up backlog item with an open governance trail):

- [x] **Authority resolver — capsule executor and promotion grant.** Implemented in `apps/web/lib/portal-context/authority-resolver.ts`: `canActOnCapsule` now resolves against the current user's principal/user refs on capsule executor, lease holder, and structured scope claims; `canReviewPromotion` no longer treats `manage_backlog` as sufficient and accepts the build-scoped `release_gate_create` reviewer grant resolved from active authority bindings.
- [x] **Authority resolver — `proposalModeActive`.** Implemented from the resolved task-run authority scope (`authorityScope === "proposal"`), not from the mere presence of a build or capsule anchor.
- [x] **Hive-mind role inference.** Transitional path implemented: typed `agent.role` is honored when present in resolver input; otherwise the keyword fallback logs a one-time warning per agent. Follow-up debt item filed as `BI-REFACTOR-B6A61421` to add durable typed role metadata and remove the heuristic.
- [x] **`requiredGrantKeys` field semantics.** Implemented in `hive-mind-resolver.ts`; `requiredGrantKeys` now lists only `Agent.toolGrants[].grantKey`. Regression coverage asserts a declared skill capability without a tool grant yields `requiredGrantKeys: []`.
- [x] **`build_stalled` emission.** Implemented in `work-resolver.ts`; build-phase `FeatureBuild` rows with stale `updatedAt` emit `build_stalled` using the configured work-capsule stall window.
- [x] **Digest sanitization.** Implemented in `prompt-digest.ts`; `safeDigestText()` strips newlines/control characters, caps digest text, and removes prompt-injection markers before user-shaped branch text enters the digest.

Each item above is small and can be commit-scoped. Suggested ordering: authority resolver fixes first (security-adjacent), then hive-mind cleanup, then digest sanitization, then the emission/dead-code cleanup last.

Follow-up verification added:

- `pnpm --filter web exec vitest run lib/portal-context/authority-resolver.test.ts lib/portal-context/hive-mind-resolver.test.ts lib/portal-context/prompt-digest.test.ts lib/portal-context/portal-context.test.ts components/build/BuildStudioHeaderLayout.test.tsx components/portal-context/PortalContextOverlayDrawer.test.tsx` - 6 files, 34 tests passed.
- `pnpm --filter web typecheck` - passed.
- `pnpm --filter web build` - passed. Existing broad Turbopack/NFT trace warnings remain in the same spec-plan search and discovery catalog import paths noted by the Phase 2 verification.

## Phase Checklist Status

> **Reading note.** The phase checkboxes below (Phase 1 through Phase 10) describe the original implementation slice. Phases 1–9 are landed on `feat/portal-context-overlay-phase-2` per the two **Implementation Status** sections above; the boxes are left as `[ ]` for the historical record. The actionable checklist for the next implementer lives in **Known Gaps From Architectural Review** above. Do not re-execute Phases 1–9; close the gaps, then run Phase 10's final verification.

## File Structure

Create:

```text
apps/web/lib/portal-context/types.ts
apps/web/lib/portal-context/cache.ts
apps/web/lib/portal-context/route-resolver.ts
apps/web/lib/portal-context/work-resolver.ts
apps/web/lib/portal-context/evidence-resolver.ts
apps/web/lib/portal-context/authority-resolver.ts                   # resolves AuthoritySummary from platform role, capsule ownership, and grants
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
apps/web/components/portal-context/EvidenceSummaryList.tsx          # named *List to avoid collision with existing build/EvidenceSummary.tsx
apps/web/components/portal-context/PortalContextOverlayDrawer.test.tsx
apps/web/components/portal-context/PortalContextStrip.test.tsx
apps/web/components/build/BuildStudioHeaderLayout.tsx               # extracted by Phase 4 refactoring budget; test scaffold already exists
apps/web/lib/actions/build-read.test.ts                             # does not exist yet; create alongside Phase 8 invalidation wiring
```

> **Naming note:** `EvidenceSummaryList.tsx` deliberately differs from the existing `apps/web/components/build/EvidenceSummary.tsx`. `EvidenceSummary.tsx` is Build Studio phase-specific; `EvidenceSummaryList.tsx` is the overlay's cross-surface evidence projection. Do not merge them.

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
  - [ ] explicit `capsuleId` — load `WorkCapsule` and follow `featureBuildId`, `backlogItemId`, `epicId`
  - [ ] explicit `buildId` — load `FeatureBuild` and follow `WorkCapsule.featureBuildId` in reverse (find capsule where `featureBuildId = buildId`)
  - [ ] explicit `threadId` — load `AgentThread` by `threadId`; if the thread has a linked `TaskRun`, follow its `contextId` and `buildId` to produce `TaskRunAnchor` and `AgentThreadAnchor` only; do not attempt capsule or backlog resolution from thread alone
  - [ ] route-only fallback — emit `no_active_build` and return empty work anchors
- [ ] Query the existing records needed for anchors in one contained resolver. Start with the fields required by `WorkCapsuleAnchor`, `FeatureBuildAnchor`, `WorkBacklogAnchor`, `WorkEpicAnchor`, `TaskRunAnchor`, `AgentThreadAnchor`, and `GitBranchAnchor`. For capsule-to-build linking, read the PR #724 fields already on `WorkCapsule`: `featureBuildId`, `backlogItemId`, `epicId`, and `workspaceState`; do not re-derive these from the build record.
- [ ] If a build has no linked capsule, emit `capsule_not_linked` with an action href to Work Control/create-link when the existing action surface supports it.
- [ ] If a capsule lease is expired or stale, emit `lease_expired` or `build_stalled` as appropriate.
- [ ] Create `apps/web/lib/portal-context/evidence-resolver.ts`.
- [ ] Summarize existing evidence from Work Capsule activity, backlog evidence activity, tool execution receipts, task artifacts, external evidence, and FeatureBuild evidence fields.
- [ ] Deduplicate equivalent records by source and canonical record ID.
- [ ] On source failure, return partial evidence plus `source_unavailable` instead of failing page render.
- [ ] Create `apps/web/lib/portal-context/authority-resolver.ts`.
- [ ] Resolve `AuthoritySummary` from: (a) the user's `platformRole`, (b) whether the user is the current capsule executor or has an active scope claim, (c) whether the user holds the promotion reviewer grant for the active build, and (d) the `proposalModeActive` flag from the current route's agent context. Do not duplicate permission checks — read existing role and grant models; do not add new ones.
- [ ] Create `apps/web/lib/portal-context/hive-mind-resolver.ts`.
- [ ] Produce deterministic candidates by querying the `Agent` registry for agents whose declared capability tags overlap with the current route domain. Rank by: (1) required-before-promotion agents first, (2) agents matching evidence gap types, (3) agents matching stall/failure signals. Do not use a hardcoded role-to-agent map; read the registry.
- [ ] Filter activation controls by the current user's capabilities and agent tool grants; unavailable candidates may render as explanation-only rows.
- [ ] Add tests for build route resolution, capsule route resolution, missing capsule, evidence dedupe, hive candidate ranking, unknown route returning `unknown_route` attention signal without throwing, and authority resolver correctly reflecting platform role and capsule executor status.

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
    envelope.work.featureBuild
      ? `Build: ${envelope.work.featureBuild.buildId} phase=${envelope.work.featureBuild.phase} status=${envelope.work.featureBuild.status}`
      : null,
    envelope.work.capsule
      ? `Capsule: ${envelope.work.capsule.capsuleId} status=${envelope.work.capsule.status} executor=${envelope.work.capsule.executorKind}`
      : null,
    envelope.work.epic ? `Epic: ${envelope.work.epic.epicId}` : null,
    envelope.work.backlogItem
      ? `Backlog: ${envelope.work.backlogItem.backlogItemId} status=${envelope.work.backlogItem.status}`
      : null,
    envelope.work.branch ? `Branch: ${envelope.work.branch.branchName}` : null,
    envelope.attention.length
      ? `Attention: ${envelope.attention.map((s) => `${s.kind}(${s.severity})`).join(", ")}`
      : null,
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

- [ ] Wrap the uncached resolver with Next.js server caching at the public entry point using a 30-second revalidation window and the tags from `portalContextCacheTags`.

  > **Caching API check (Next.js 16):** The codebase currently uses neither `unstable_cache` nor the `"use cache"` directive. Before implementing, check `next.config.js` for `dynamicIO` or `cacheHandlers` flags. If `dynamicIO: true` is set, use the `"use cache"` directive with `cacheTag()`/`cacheLife()` from `next/cache`. If not set, use `unstable_cache` from `next/cache`. Both provide the same tag invalidation API (`revalidateTag`). Do not mix both patterns in the same file.

- [ ] Enforce a soft timeout around sub-resolvers using `Promise.race` with a `setTimeout`-based rejection. Timeout returns partial route/user context plus `source_unavailable` and `envelope_timeout` attention signals. Set the timeout to 3 seconds; do not make it configurable in V1.
- [ ] Add `revalidatePortalContext(input, userId)` or entity-specific helpers that call `revalidateTag("portal-context")` first, with entity tags ready for narrower invalidation later.
- [ ] Add tests proving prompt digest includes stable IDs and excludes raw tool payload fields.

Expected test command:

```powershell
pnpm --filter web exec vitest run apps/web/lib/portal-context/prompt-digest.test.ts
```

- [ ] Create component stubs required by Phase 4 and Phase 5 before those phases begin:
  - [ ] `apps/web/components/portal-context/PortalContextStrip.tsx` — stub: accepts `envelope: PortalContextEnvelope | null`, renders `null`
  - [ ] `apps/web/components/portal-context/PortalContextOverlayDrawer.tsx` — stub: accepts `envelope`, `open`, `onClose`, renders `null`
  - [ ] Mark both with `// TODO: implement in Phase 6` so they are easy to locate

---

## Phase 4 - Build Studio Integration

- [ ] Modify `apps/web/app/(shell)/build/page.tsx` to resolve a portal context envelope after session lookup and before rendering `BuildStudio`.
- [ ] Pass `pathname: "/build"`, `routeContext: "/build"`, `buildId` from search params, and search params into `resolvePortalContextEnvelope`.
- [ ] Add `portalContext?: PortalContextEnvelope | null` to `BuildStudio` props.
- [ ] Render `PortalContextStrip` near the Build Studio header where it is visible but does not replace existing phase controls.
- [ ] Add a drawer open control in the strip. The drawer must be controlled by local client state and receive only the serialized envelope.
- [ ] For the no-explicit-build state (`no_active_build` signal), render a route-only strip showing the signal with a link to select a build. Use a compact status label, not explanatory instructional prose.
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

- [ ] Replace the stubs from Phase 3 with full implementations: `PortalContextStrip.tsx` as a compact client component, `PortalContextOverlayDrawer.tsx` as a right-side drawer using existing portal styling.
- [ ] Create `PortalContextTabs.tsx` with correct ARIA tab pattern — do not copy `ArtifactTabs.tsx` verbatim as it uses `aria-pressed` instead of the proper tab role:
  - [ ] `role="tablist"` on the container
  - [ ] `role="tab"` + `aria-selected` on each tab button (not `aria-pressed`)
  - [ ] `id` on each tab panel; `aria-controls` on each button pointing to its panel id
  - [ ] `tabIndex={selected ? 0 : -1}` so only the active tab is in the tab order
  - [ ] Arrow key navigation: left/right arrows move focus between tabs, Home/End jump to first/last
  - [ ] Visible focus ring using `focus-visible` styles
- [ ] Create dense row/list components:
  - [ ] `PortalContextSummaryRows`
  - [ ] `HiveMindCandidateList`
  - [ ] `EvidenceSummaryList`
- [ ] Use lucide icons where they clarify status or actions.
- [ ] Use only DPF theme variables. All exist in `apps/web/app/globals.css`:
  - [ ] `text-[var(--dpf-text)]` — primary text
  - [ ] `text-[var(--dpf-text-secondary)]` — inactive tabs, secondary labels
  - [ ] `text-[var(--dpf-muted)]` — placeholder / faint text
  - [ ] `bg-[var(--dpf-surface-1)]` — elevated surface (selected tab, cards)
  - [ ] `bg-[var(--dpf-surface-2)]` — base surface (tab bar background)
  - [ ] `bg-[var(--dpf-surface-3)]` — recessed surface where needed
  - [ ] `border-[var(--dpf-border)]` — standard border
  - [ ] `border-[var(--dpf-border-strong)]` — emphasis border
  - [ ] `text-[var(--dpf-accent)]` — primary action / link colour
  - [ ] `bg-[var(--dpf-bg)]` — page background
  - [ ] For `AttentionSignal.severity` colouring: `--dpf-error` (error), `--dpf-warning` (warning), `--dpf-info` (info), `--dpf-success` (success). Use `--dpf-state-error` and `--dpf-state-warning` for background chips.
- [ ] Avoid nested cards. Use full-width bands, rows, and compact panels.
- [ ] Add component tests for tabs (correct ARIA attributes, keyboard navigation), missing grants, empty hive state, evidence gaps, and all three attention signal severity levels.
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
- [ ] For explicit hive invocation, apply the dedup rule before creating a child `TaskRun`:
  - [ ] Query for an existing child where `parentTaskRunId` matches, `a2aMetadata.hiveMindRole` matches, and `status` is not in `["completed", "failed", "cancelled"]`
  - [ ] If a matching non-terminal child exists, reuse it; do not create a duplicate
  - [ ] If no match, create a new child `TaskRun` with:
    - [ ] same `contextId`
    - [ ] `parentTaskRunId`
    - [ ] current Work Capsule and Build Studio anchors in `a2aMetadata`
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

> **Ordering note:** Wiring invalidation at Phase 8 means the cache may be stale during Phases 4–7 testing. That is acceptable for CI test runs. For live UX verification in Phase 9, wire at least the broad `revalidateTag("portal-context")` call into `WorkCapsuleActivity` creation before running the Phase 9 steps.

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
- [ ] Open `/build` (no `buildId` in URL).
- [ ] Verify the context strip renders the `no_active_build` attention signal and a link to select a build — not a blank strip or an error.
- [ ] Verify the strip renders without layout overlap at desktop and mobile widths.
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
pnpm --filter web exec vitest run apps/web/components/build/BuildStudioHeaderLayout.test.tsx apps/web/components/build/work-control/WorkControlPanel.test.tsx apps/web/lib/actions/agent-coworker-server.test.ts apps/web/lib/actions/agent-coworker-external.test.ts apps/web/lib/actions/work-capsules.test.ts apps/web/lib/actions/build-read.test.ts
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

- [ ] `/build` without a `buildId` shows `no_active_build` attention signal and a select-build link, not a blank or error state.
- [ ] `/build?buildId=...` shows active context without relying on chat history.
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
