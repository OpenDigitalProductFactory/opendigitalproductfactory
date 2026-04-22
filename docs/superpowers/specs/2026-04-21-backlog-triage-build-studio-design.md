# Backlog → Triage → Build Studio Integration Design

| Field | Value |
|---|---|
| Date | 2026-04-21 |
| Status | Revised Draft |
| Author | Claude (Software Engineer) + Mark Bodman (CEO) |
| IT4IT Alignment | §5.1 Strategy to Portfolio (Evaluate), §5.2 Request (Explore/Demand), §5.3 Integrate (Build Studio bridge) |
| Depends On | `2026-03-11-phase-5ab-backlog-system-design.md`, `2026-03-14-build-studio-conversation-integration-design.md`, `2026-03-26-build-studio-it4it-value-stream-alignment-design.md`, `2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md` |
| Supersedes | The earlier draft of this same spec written on 2026-04-21 |

## 1. Problem Statement

The backlog and Build Studio are both primary work surfaces, but they still operate as adjacent systems instead of one delivery loop.

Today:

1. `BacklogItem` and `FeatureBuild` are not linked.
2. `/ops` can create and update items, but it cannot formally decide intake outcomes.
3. coworkers can discover gaps mid-task, but the capture path is weak and inconsistent.
4. Build Studio can start work without a durable intake record or a reliable way to round-trip back to triage.
5. tool-grant enforcement is category-based, but the current draft did not specify new grant categories for triage authority and build promotion.
6. the live system can move between zero and one open epic quickly, so a hard "must align to an open Epic" rule is too brittle as a bootstrap assumption.

## 2. Live State Snapshot

This revision is grounded in the live database, not seed defaults.

Live PostgreSQL queries run during review on **April 21, 2026** showed a low-data backlog state:

- early in review: `Epic` returned **0 rows**
- later in the same review window, after `EP-BUILD-9F749C` ("Code Graph Ship Test — Ship Tracking") was created at **2026-04-22 04:56:58 UTC** / **April 21, 2026 11:56:58 PM CDT**, `Epic` returned **1 open row**
- `BacklogItem`: **5 open**, **1 in-progress**
- highest-priority active item: `BI-E4A86393` "Discovery triage sprint: resolve lifecycle_unverified and catalog_match_ambiguous queues"

Design consequence:

- v1 must work when the system has zero or only one open epic.
- the triage gate cannot assume a healthy, already-curated epic structure.
- migration/backfill must preserve existing work without inventing alignment data.

## 3. Goals

- Backlog is the single intake path for new development work.
- Triage becomes a required gate with a decided outcome for every new item.
- Any coworker can file a backlog item with structured source tagging.
- `/ops` gains explicit decision verbs instead of overloading generic update behavior.
- Build Studio promotion is deliberate, capacity-aware, and auditable.
- Shipping a build closes the originating backlog item automatically.
- Abandoning a build returns the originator to triage without losing build history.
- The design matches the repo's real authority model, event model, and theme system.

## 4. Non-Goals

- introducing a new top-level `Goal` or `Objective` model in v1
- adding release bundling or cross-build scheduling
- adding automatic dequeue-and-promote workers in v1
- creating a separate `/ops/triage` route in v1
- changing model/provider routing for the `/ops` coworker
- wiring `escalateToUpstreamIssue` as an MCP tool in this spec

## 5. Research & Benchmarking

### 5.1 Systems Reviewed

Open source:

- [Plane](https://github.com/makeplane/plane)
- [Plane release notes: "Triage state for Intake"](https://github.com/makeplane/plane/releases)
- [OpenProject workflow docs](https://www.openproject.org/docs/system-admin-guide/manage-work-packages/work-package-workflows/)
- [GitHub issue/PR linking docs](https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue)

Commercial:

- [Linear triage docs](https://linear.app/docs/triage)
- [Linear workflow configuration docs](https://linear.app/docs/configuring-workflows)
- [Jira development linking docs](https://support.atlassian.com/jira-cloud-administration/docs/what-development-data-can-i-view-in-jira-software/)
- [Jira work-reference docs](https://support.atlassian.com/jira-software-cloud/docs/reference-issues-in-your-development-work/)

### 5.2 Patterns Adopted

- **Triage as a separate intake inbox** rather than "just another open item".
  Linear and Plane both treat triage/intake as a distinct state before normal workflow admission.
- **Role-aware workflow transitions**.
  OpenProject explicitly models allowed status transitions by role and work type; that maps well to DPF's agent grants.
- **Issue/work-item linked to development artifacts, with auto-close on successful delivery**.
  GitHub and Jira both link work items to branches, pull requests, builds, and deployments without forcing a strict 1:1 lifecycle lock.
- **Human-visible explanation on reject/duplicate/defer decisions**.
  Linear's accept/duplicate/decline model reinforces that triage needs an explicit disposition, not silent parking.

### 5.3 Patterns Rejected

- **Strict 1:1 backlog item ↔ build history**.
  Compared systems link one work item to many dev artifacts over time. DPF should preserve that flexibility.
- **Hard epic requirement for all intake**.
  The live DB reached zero epics during this review window and only later returned to one open epic, so a permanent epic precondition would still be brittle.
- **Capacity rules based only on a config integer**.
  DPF already has `SandboxSlot`; actual executor availability must participate in the gate.
- **A second audit system for triage**.
  DPF already records tool executions in `ToolExecution`; v1 should reuse it instead of inventing a parallel log table.

### 5.4 Anti-Patterns to Avoid

- TOCTOU races around capacity checks
- orphaned build/backlog links after crashes or abandon paths
- bootstrap deadlock in low-data installs
- hardcoded UI colors that ignore DPF theme variables

## 6. Core Design Decisions

### 6.1 Intake Lifecycle

`BacklogItem.status` expands from:

- `open`
- `in-progress`
- `done`
- `deferred`

to:

- `triaging`
- `open`
- `in-progress`
- `done`
- `deferred`

Rules:

- all newly created backlog items default to `triaging`
- every non-`triaging` item must have a non-null `triageOutcome`
- `triaging` is the intake inbox
- `open` means accepted but not yet actively executed
- `in-progress` means actively being executed by either a coworker flow or an active build

`triageOutcome` values:

- `build`
- `runbook`
- `coworker-task`
- `defer`
- `duplicate`
- `discard`

`source` values:

- `feature-gap`
- `bug`
- `tool-gap`
- `skill-gap`
- `doc-gap`
- `user-request`
- `automated-detection`

`effortSize` values:

- `small`
- `medium`
- `large`
- `xlarge`

### 6.2 BacklogItem ↔ FeatureBuild Relationship

The earlier draft proposed a strict bidirectional 1:1 relationship:

- `BacklogItem.featureBuildId @unique`
- `FeatureBuild.backlogItemId @unique`

This revision replaces that with a more durable model:

#### `BacklogItem`

Add:

- `triageOutcome String?`
- `effortSize String?`
- `proposedOutcome String?`
- `activeBuildId String? @unique`
- `duplicateOfId String?`
- `resolution String?`
- `abandonReason String?`
- `stalenessDetectedAt DateTime?`

Relations:

- `activeBuild FeatureBuild? @relation("BacklogItemActiveBuild", fields: [activeBuildId], references: [id])`
- `featureBuilds FeatureBuild[] @relation("BacklogItemOriginator")`
- `duplicateOf BacklogItem? @relation("BacklogItemDuplicates", fields: [duplicateOfId], references: [id])`
- `duplicates BacklogItem[] @relation("BacklogItemDuplicates")`

#### `FeatureBuild`

Add:

- `originatingBacklogItemId String`
- `abandonedAt DateTime?`
- `abandonReason String?`

Relation:

- `originator BacklogItem @relation("BacklogItemOriginator", fields: [originatingBacklogItemId], references: [id])`
- optional back-reference for `BacklogItemActiveBuild` if Prisma requires it

Why this is better:

- one backlog item can preserve build history across retries or abandoned attempts
- one active build can still be enforced per backlog item through `activeBuildId @unique`
- ship/abandon handlers can clear `activeBuildId` without erasing historical origin links
- the model aligns with GitHub/Jira-style "work item linked to dev artifacts" instead of a brittle single-use pointer

### 6.3 Definition of Ready

For `triageOutcome = build`, the promotion gate checks:

1. `effortSize` is set
2. `effortSize != xlarge`
3. the item is aligned to an open epic **if at least one open epic exists**
4. the platform is under capacity

Bootstrap rule:

- if there are **zero open epics**, epic alignment is advisory rather than blocking
- the triage rationale must explicitly mention that the item is entering the bootstrap path without epic alignment
- once epics exist, new manual promotions require epic alignment again

User-request rule:

- Build Studio brief submission may create a backlog item with `triageOutcome = build` immediately
- it still must pass the capacity gate
- it may bypass epic alignment for that initial user-request path

### 6.4 Capacity Gate

Capacity must reflect both policy and actual executors.

`effectiveBuildCapacity = min(PlatformDevConfig.maxConcurrentBuilds, availableSandboxSlots)`

Where:

- `maxConcurrentBuilds` is a human-tuned ceiling
- `availableSandboxSlots` comes from existing `SandboxSlot` availability, not guesswork

The authoritative promotion path must run inside a PostgreSQL transaction guarded by an advisory lock, for example:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('promote-to-build-studio'))`;

  const [config, availableSlots, activeBuilds] = await Promise.all([
    tx.platformDevConfig.findUnique({ where: { id: "singleton" } }),
    tx.sandboxSlot.count({ where: { status: "available" } }),
    tx.featureBuild.count({
      where: {
        abandonedAt: null,
        phase: { notIn: ["ship", "complete"] },
      },
    }),
  ]);

  const effectiveCapacity = Math.min(config?.maxConcurrentBuilds ?? 4, availableSlots);
  if (activeBuilds >= effectiveCapacity) throw new CapacityError();

  const build = await tx.featureBuild.create({
    data: {
      originatingBacklogItemId: item.id,
      // other fields...
    },
  });

  await tx.backlogItem.update({
    where: { id: item.id },
    data: {
      activeBuildId: build.id,
      status: "in-progress",
    },
  });
});
```

### 6.5 Round-Trip Lifecycle

| Build event | Backlog transition | Notes |
|---|---|---|
| Build created from backlog item | `open` → `in-progress` | `activeBuildId` set |
| Build reaches `ship` or `complete` | `in-progress` → `done` | `completedAt` and `resolution` set, `activeBuildId` cleared |
| Build abandoned | `in-progress` → `triaging` | `triageOutcome` cleared, `activeBuildId` cleared, `abandonReason` copied |
| Build stale for >7 days with no phase movement | no status change | `stalenessDetectedAt` set |

Important behavior:

- ship closes the originator and then re-runs epic completion logic so the final item in an epic can close that epic too
- abandon preserves the `FeatureBuild` row for history; it only detaches active execution from the backlog item

### 6.6 Tool Surface

#### New tools

`triage_backlog_item`

- authority-only tool for the Scrum Master path
- validates conditional requirements by outcome
- writes `triageOutcome`, status transition, and any supporting fields

`size_backlog_item`

- sets `effortSize`
- useful when sizing is a follow-up step rather than part of a single triage commit

`promote_to_build_studio`

- authoritative gate for creating a `FeatureBuild` from a backlog item
- performs the transaction + capacity lock
- returns queue/capacity reasons on failure

#### Existing tools to extend

`create_backlog_item`

- require `source`
- allow `proposedOutcome`
- allow explicit `status + triageOutcome` only when both are supplied together
- default to `status = triaging`

`query_backlog`

- allow `status = triaging`
- allow filters for `triageOutcome`, `source`, and `hasActiveBuild`

### 6.7 Grant Model

The earlier draft named who should get tools, but DPF enforces tools through `TOOL_TO_GRANTS` categories in `apps/web/lib/tak/agent-grants.ts`. This spec must therefore add explicit grant categories.

New grant categories:

- `backlog_triage`
- `build_promote`

New mappings:

- `triage_backlog_item` → `backlog_triage`
- `size_backlog_item` → `backlog_triage`
- `promote_to_build_studio` → `build_promote`

Seeded holders:

- `scrum-master`: `backlog_triage`, `build_promote`
- `build-specialist`: `build_promote`

Not granted in v1:

- `coo`
- `customer-advisor`
- generic backlog writers

This preserves the authority boundary instead of accidentally making triage/promotion available to every agent with `backlog_write`.

### 6.8 Coworker Identity

Rename `ops-coordinator` to `scrum-master`.

This must update:

- seeded `Agent.agentId`
- route mapping
- prompt files
- grant seeding
- tests
- any phase handoff logic that still references `ops-coordinator`

### 6.9 UI Changes

#### `/ops`

Add a Triage section at the top of the backlog view when any items are `triaging`.

Each triage row shows:

- title
- source
- priority
- proposed outcome
- outcome buttons
- effort size when `build` is selected
- rationale input
- duplicate target picker when `duplicate`
- reason input when `defer` or `discard`

#### `BacklogItemRow`

Add `Send to Build Studio` when:

- `status = open`
- `triageOutcome = build`
- `activeBuildId IS NULL`

Button states explain failing DoR clauses:

- not sized
- xlarge
- epic required once epics exist
- at capacity
- already has active build

#### `/build`

Build brief submission auto-creates a backlog item when one is not supplied, then attempts promotion immediately.

#### Build abandon action

Add an explicit `Abandon build` action to `/build/[buildId]`.

#### Theme-aware styling

All new UI must follow `AGENTS.md` and `docs/platform-usability-standards.md`:

- no hardcoded colors for text, backgrounds, or borders
- use DPF CSS variables
- `<option>` elements in `<select>` must include explicit theme classes
- do not repeat the current hardcoded badge-color pattern from `apps/web/lib/explore/backlog.ts`

### 6.10 Observability and Audit

Do **not** add a new `TriageDecisionLog` table in v1.

Use existing `ToolExecution` for:

- who triaged an item
- who sized an item
- who promoted a build
- the input parameters used
- the success/failure result

Additional structured logging:

- `[triage] itemId=... outcome=... actor=...`
- `[promote] itemId=... buildId=... capacity=...`
- `[originator-sync] buildId=... event=ship|abandoned`

If a user-facing timeline is needed later, that should be a separate spec that decides whether to materialize domain events from `ToolExecution`.

## 7. Invariants

1. Every new backlog item starts in `triaging` unless an explicit `status + triageOutcome` pair is provided together.
2. Every non-`triaging` backlog item has a non-null `triageOutcome`.
3. `triageOutcome = duplicate` requires `duplicateOfId`.
4. `triageOutcome = discard` requires `resolution`.
5. `xlarge` items cannot be promoted to Build Studio.
6. A backlog item can have at most one active build at a time.
7. Every `FeatureBuild` has a non-null `originatingBacklogItemId`.
8. Shipping clears `activeBuildId` and closes the originator.
9. Abandoning clears `activeBuildId`, returns the originator to `triaging`, and preserves the abandoned build row for history.
10. If ship closes the last active item in an epic, the epic must be marked `done`.

## 8. Migration Plan

### Phase 1: additive schema

- add new nullable fields to `BacklogItem`
- add nullable `originatingBacklogItemId` to `FeatureBuild`
- add `abandonedAt`, `abandonReason` to `FeatureBuild`
- add `maxConcurrentBuilds` to `PlatformDevConfig`

### Phase 2: backfill

- for any existing `FeatureBuild` without an originator, create a synthetic backlog item and set `originatingBacklogItemId`
- move existing `BacklogItem.status = open` rows with no triage metadata to `triaging`
- backfill null `source` values to `user-request` with a migration comment calling out the lossy default

### Phase 3: enforce

- make `FeatureBuild.originatingBacklogItemId` non-null
- make `BacklogItem.source` non-null
- add check constraints for:
  - non-`triaging` requires `triageOutcome`
  - `duplicate` requires `duplicateOfId`
  - `discard` requires `resolution`

### Phase 4: rollout

- ship MCP tools
- ship UI changes
- ship `scrum-master` rename
- ship Build Studio originator sync and abandon flow

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| bootstrap deadlock because the backlog has zero or very few open epics | epic requirement becomes conditional until at least one open epic exists |
| strict 1:1 build linking would block retries and abandon history | use `originatingBacklogItemId` plus `activeBuildId` |
| promotion race creates too many active builds | advisory-lock transaction around capacity check and insert |
| config says capacity exists but sandboxes are actually full | gate uses `min(maxConcurrentBuilds, availableSandboxSlots)` |
| triage authority leaks to all backlog writers | add dedicated `backlog_triage` and `build_promote` grants |
| UI regressions ignore branding/theme | spec explicitly requires DPF theme tokens and usability standards |

## 10. Open Questions

1. Should v1 expose a user-visible "ready queue" badge or is disabled-button messaging sufficient?
2. Should the bootstrap no-epic path create a follow-up backlog item to force epic creation, or is rationale-only sufficient?
3. Should a future spec introduce a domain event timeline for backlog items, or is `ToolExecution` enough for the first release?

## 11. Summary of Revisions in This Draft

Compared to the earlier same-day draft, this revision intentionally changes four things:

1. it adds a mandatory research section with concrete benchmarked patterns
2. it aligns the design with the live DB state observed on **April 21, 2026**, including low-epic bootstrap conditions
3. it replaces the brittle 1:1 backlog/build pointer model with historical origin links plus a single active-build pointer
4. it specifies the new grant categories required by the repo's real authorization pipeline
