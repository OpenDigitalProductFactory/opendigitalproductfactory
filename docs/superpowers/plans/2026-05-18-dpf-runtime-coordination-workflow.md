# DPF Runtime Coordination Workflow Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` when splitting implementation work across independent files, or `superpowers:executing-plans` when executing this plan linearly. Check off tasks as they are completed. For TypeScript changes, run `pnpm --filter web typecheck`. For final acceptance changes, run the production build and the affected UX path against the Docker-served portal.

**Goal:** Make DPF runtime targets first-class, governed platform state so external agent work, Build Studio work, sandbox review, backlog evidence, PR state, and final portal acceptance all answer the same question: what is deployed where, who owns it, what is being tested, and what is safe to merge?

**Architecture:** Keep source isolation in branch/worktree/build capsule, but coordinate runtime verification through DPF-owned runtime targets. Reuse Work Capsule as the work-control spine, add queryable runtime target and verification records for deployed/running state, and make sandbox/Build Studio the default non-prod runtime while `D:\DPF` Docker portal remains the final acceptance runtime.

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL, Docker Compose, Build Studio sandbox provider, Inngest queue functions, MCP JSON-RPC at `/api/mcp/v1`, Vitest, Playwright/browser-use evidence capture, GitHub PR metadata.

---

## Architect Review (2026-05-18)

This review applies the "verify substrate before proposing new substrate" rule. The original draft introduces `RuntimeTarget` as a parallel spine with ~25 columns, several of which duplicate fields that already exist on `WorkCapsule`, `Sandbox`, `SandboxSlot`, `FeatureBuild`, and `GitPromotionCandidate`. The corrected design below is additive, not parallel.

**What already exists and stays authoritative:**

- `WorkCapsule` already carries `repositoryFullName`, `baseBranch`/`headBranch`, `baseSha`/`headSha`, `worktreePath`, `pullRequestUrl`/`pullRequestNumber`, `sandboxProviderId`/`sandboxId`, executor, lease, scope claims, and verification state. Source/PR/branch ownership is solved.
- `Sandbox` already carries `buildId`, `providerId`, `agentId`, `portalInstanceId`, `state`, `previewUrl`, `capabilitiesSnapshot`. Build-sandbox runtime state is solved at the per-instance level.
- `SandboxSlot` already carries `slotIndex`, `containerId`, `port`, `status`, `buildId`. Slot leasing is solved.
- `FeatureBuild` already carries `sandboxId`, `sandboxPort`, `buildBranch`, `gitCommitHashes`, `uxVerificationStatus`, `uxTestResults`. Build-side verification state is solved (though under-populated).
- `GitPromotionCandidate` already carries `verificationStartedAt`/`verificationCompletedAt`/`verificationResult`. Promotion-path verification is solved for one specific lane.

**What is genuinely missing (the real gap):**

1. No first-class record for the **root portal** (`dpf-portal-1`) or the **dev-portal** as a queryable runtime — they exist as Compose services but are invisible to the platform.
2. No record for **ad-hoc / external-preview** runtimes that aren't tied to a `FeatureBuild`.
3. No reconciliation between DB-advertised `SandboxSlot` rows and live Docker services (live check shows 3 DB slots, 1 running container).
4. No typed, queryable **verification timeline** that crosses the boundary between build sandbox, root portal, and external-agent checks. `GitPromotionCandidate.verificationResult` and `FeatureBuild.uxTestResults` are JSON islands.
5. No platform-owned **acceptance gate** that distinguishes "passed in sandbox" from "passed on the customer-zero Docker portal."

**Design correction — collapse, don't parallel:**

- `RuntimeTarget` is added, but slimmed: it represents *runtimes the platform did not previously model* (root portal, dev portal, ad-hoc debug) and *cross-cuts existing runtimes by adding a single normalized record* for build sandboxes and promotion sandboxes. Owner, branch, SHA, and PR data are **read through** `workCapsuleId` / `featureBuildId` / `sandboxId` rather than duplicated.
- `RuntimeVerification` is added as a typed, queryable event log that can attach to either a `RuntimeTarget`, a `FeatureBuild`, a `GitPromotionCandidate`, or a `WorkCapsule`. It is the one new spine; JSON islands stop being the source of truth.
- `acceptanceRole` is **derived** from `kind` via a fixed mapping, not stored (one less drift surface). Stored only for `ad-hoc-debug` where the role isn't implied.

**Standards alignment:**

- OpenTelemetry `service.version` lands on root-portal targets as a real column (`serviceVersion`), so the image version + git SHA are queryable, not metadata-blob.
- GitHub Deployments stays deferred per the draft's recommendation.
- SLSA provenance vocabulary maps cleanly: capsule = work identity, build = builder, runtime target = run metadata.

**Open Questions — decided, not punted:**

| Question | Decision |
| --- | --- |
| Top-level nav vs Build/Work Control? | Inside Build/Work Control. Operational, not promotional. |
| `dev-portal` (3001) allowed for external agents? | Allowed when registered; never satisfies final acceptance. |
| Phantom slots — delete or mark misconfigured? | Mark `misconfigured`. DB rows can represent intended capacity. |
| Emit GitHub Deployments? | Deferred. Mirror later for PR visibility. |

**Process notes baked into the revised slices:**

- Seed + migration must move together (project rule). Slice 1 adds the migration and seeds the root-portal target on install/upgrade.
- Backfill is explicit: existing `Sandbox`/`SandboxSlot`/active `FeatureBuild` rows get `RuntimeTarget` mirror rows before the UI ships, so day-one is not empty.
- Guardrails (Slice 5) ship before the UI (Slice 6) so the UI surfaces real violations.

---

## Grounding

This plan is based on repo inspection, DPF MCP backlog/spec queries, live Docker state, and live Postgres fallback.

### Repo documents and implementation inspected

- `AGENTS.md`
- `docs/operations/dpf-production-runtime.md`
- `docs/user-guide/development-workspace.md`
- `docs/user-guide/build-studio/sandbox.md`
- `docs/superpowers/specs/2026-05-14-portal-work-capsule-control-harness-design.md`
- `docs/superpowers/plans/2026-05-17-portal-work-capsule-control-harness-phase-3.md`
- `docs/superpowers/plans/2026-05-17-runtime-data-safety-guards.md`
- `docs/superpowers/plans/2026-05-11-git-triggered-sandbox-promotion-slice-2.md`
- `docs/superpowers/plans/2026-05-11-ai-routing-ux-verification-test-architecture.md`
- `docs/superpowers/drafts/2026-05-12-agent-workspace-pattern.md`
- `docker-compose.yml`
- `apps/web/lib/platform-dev-policy.ts`
- `apps/web/lib/mcp-tools.ts`
- `apps/web/lib/work-capsules.ts`
- `apps/web/lib/work-capsules/**`
- `apps/web/lib/integrate/**`
- `apps/web/lib/integrate/sandbox/**`
- `apps/web/lib/queue/functions/build-review-verification.ts`
- `packages/db/prisma/schema.prisma`

### Live backlog and runtime checks

DPF MCP was available for backlog/spec search:

- `search_specs_and_plans` returned no exact existing plan for "runtime coordination" or "external agent runtime coordination".
- Open/in-progress Build Studio and Work Capsule work exists:
  - `EP-BUILD-STUDIO` has active/open Build Studio work.
  - `EP-WORKTREE-HYGIENE` is open.
  - `EP-CAPSULE` has in-progress capsule surface work, including `BI-D52D4E25` and `BI-3DE485DE`.
- Active build-linked backlog items returned by `list_backlog_items(hasActiveBuild=true)`:
  - `BI-57ED34F7` specialist subtask thread spawning.
  - `BI-AF29825A` formal deliberation.
  - `BI-4E54A1AA` Ollama as primary local AI backend.

Live DB fallback was used because this session could not call the Work Capsule MCP tools even though `apps/web/lib/mcp-tools.ts` defines them and live `ToolExecution` history shows prior `list_work_capsules` attempts.

DB fallback showed:

- `WorkCapsule`: 0 rows.
- `FeatureBuild`: 3 rows, all without sandbox assignment metadata.
- `SandboxSlot`: 3 rows: `dpf-sandbox-1` on 3035, `dpf-sandbox-2` on 3037, `dpf-sandbox-3` on 3038, all marked `available`.
- Docker runtime only showed `dpf-sandbox-1` running on 3035, so the database advertises more slots than the current Compose runtime actually has.
- `GitPromotionCandidate`: 0 rows.
- Evidence exists in `BacklogItemActivity`, `BuildActivity`, and `ToolExecution`, but runtime target ownership is not a first-class queryable contract.

Live Docker/Git checks showed:

- Root portal: `dpf-portal-1`, `localhost:3000`, healthy, image version/head SHA `07133d5e139c3dff7e23156b05e7a7be7ab0bc21`, branch `main`.
- Sandbox: `dpf-sandbox-1`, `localhost:3035`, workspace branch `my-changes`, head `0bfda3e`, no confirmed app health response during inspection.
- No unmanaged Node/Next listener was observed on ports 3000-3110 during the check.
- One open PR existed: #747 `fix/voice: surface STT errors inline + strip shell commands from operator copy`.
- Many worktrees exist, reinforcing that source isolation is working better than runtime coordination.

### Standards anchors

The target design follows project rules first, and uses these external standards as vocabulary rather than replacement governance:

- Docker Compose project names isolate environments from one another, and Docker documents `COMPOSE_PROJECT_NAME` as a supported mechanism for that isolation: https://docs.docker.com/compose/how-tos/project-name/
- GitHub Deployments model runtime deployment as a specific ref plus statuses such as `pending`, `in_progress`, `failure`, and `success`: https://docs.github.com/en/rest/deployments/deployments
- SLSA provenance separates build inputs, resolved dependencies, builder identity, and run metadata. DPF should apply the same separation to Build Studio/sandbox provenance: https://slsa.dev/spec/v1.0/provenance
- OpenTelemetry resource conventions treat `service.version` as the exact artifact version, including a git hash. DPF runtime targets should record this explicitly for root portal and sandbox runtimes: https://opentelemetry.io/docs/specs/semconv/resource/

## Current-State Map

| Surface | Verified current state | Current gap |
| --- | --- | --- |
| Root portal | `dpf-portal-1` serves `localhost:3000` and is the real customer-zero acceptance runtime. | It can be inspected manually, but portal acceptance is not yet tied to a runtime target record with owner, backlog item, PR, SHA, evidence, and verification status. |
| Dev portal | Compose has a `dev-portal` profile on `localhost:3001`. | It is documented as an approved development surface, but external agents are not guided or gated into it through platform state. |
| Build Studio sandbox | Compose has `sandbox` on `localhost:3035`; sandbox docs define isolation and promotion. | Build records currently lack sandbox metadata, and DB slot rows advertise slots not backed by running Compose services. |
| Build Studio builds | `FeatureBuild` carries `buildId`, phase, backlog linkage, `sandboxId`, `sandboxPort`, `buildBranch`, `gitCommitHashes`, `uxTestResults`, and `uxVerificationStatus`. | The live active builds have no sandbox metadata, and the attachment from Build Studio to Work Capsule is not reflected in live rows. |
| Work Capsule | Schema and service layer exist for capsule status, executor kind, branch/worktree/PR/sandbox/evidence, leases, scope claims, and activities. | Live DB has zero capsules. External agent and Build Studio work are therefore not represented by the intended durable work-control object. |
| External agents | `.mcp.json` and worktree seed scripts exist; MCP backlog tools work; worktree isolation works. | The agent does not have a required registration handshake for runtime target, commit SHA, backlog item, PR, evidence destination, and verification status before runtime testing. |
| Worktrees | Worktree rules and Compose project isolation are documented; seed script writes `COMPOSE_PROJECT_NAME=dpf-<topic>`. | Worktrees are still psychologically treated as permission to start a local app server, even when runtime verification should target sandbox or root portal. |
| PRs | GitHub PR state is visible. | PR readiness is not coupled to DPF runtime target verification state. |
| Evidence | Build evidence, backlog evidence, browser-use screenshots, and tool execution logs exist. | Evidence is scattered across tables and URLs. There is no single runtime target timeline that links the running surface, commit, owner, backlog item, build, PR, and screenshot. |

## Design Decision

The missing object is not another source workspace. It is a governed runtime target.

DPF already has the right source-control primitives:

- Branches and worktrees for source isolation.
- Build Studio feature builds for AI-assisted implementation.
- Work Capsules for cross-executor work ownership and scope claims.
- Sandbox provider and sandbox slots for non-prod execution.
- Root Docker portal for production-path acceptance.
- MCP tools and evidence tables for external tool integration.

The new workflow should make runtime target assignment and verification a platform-owned contract:

1. A Work Capsule owns the work thread.
2. A Runtime Target owns "where this code is running or being verified".
3. Runtime Verification records prove what was checked against that target.
4. Evidence attaches to the runtime target and is mirrored to the relevant backlog item/build/capsule timeline.
5. Ad-hoc local servers are not valid verification targets unless explicitly registered as temporary debug exceptions.

## Target Architecture

### Core Concepts

**Work Capsule**

The durable unit of work ownership. It links backlog item, epic, feature build, branch, worktree, PR, executor, scope claims, evidence, verification state, and promotion policy.

Existing implementation already supports most of this and should remain the workflow spine.

**Runtime Target**

A queryable record for a running or deployable surface. It answers:

- What kind of runtime is this?
- Which commit/branch/build/capsule/backlog item does it represent?
- Who owns it?
- What URL/container/port/service should be used?
- Is it assigned, running, verifying, verified, failed, released, expired, or blocked?
- Is it acceptable for non-prod verification, final acceptance, or debug only?

**Runtime Verification**

A queryable record for a check against a runtime target. It answers:

- What was verified?
- Which command, browser path, health check, screenshot, or manual review produced the result?
- Which tool execution/build activity/backlog activity contains the evidence?
- Does this verification count for merge/promotion readiness?

### Proposed Data Model

Two slim tables. Owner/branch/SHA/PR are **read through** existing FKs, not duplicated. The runtime-specific columns are what the platform did not previously model.

```prisma
model RuntimeTarget {
  id                 String    @id @default(cuid())
  targetId           String    @unique
  kind               String    // see enum list below
  status             String    // see enum list below

  // Source-of-truth FKs. Ownership/branch/SHA/PR are read through these.
  workCapsuleId      String?
  featureBuildId     String?
  sandboxId          String?   // -> existing Sandbox.id when applicable
  slotId             String?   // -> existing SandboxSlot.id when applicable

  // Runtime locator (the part NOT covered by existing models)
  composeProjectName String?
  serviceName        String?
  containerName      String?
  hostUrl            String?
  internalUrl        String?
  port               Int?

  // Acceptance / debug surface (root-portal + ad-hoc only need these)
  serviceVersion     String?   // OpenTelemetry service.version: image tag + git SHA
  acceptanceRoleOverride String? // null = derive from kind; set only for ad-hoc-debug overrides
  debugReason        String?   // required when kind = ad-hoc-debug
  expiresAt          DateTime?
  lastHeartbeatAt    DateTime?

  metadata           Json?     // free-form snapshots; never the source of truth
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  verifications      RuntimeVerification[]

  @@index([kind, status])
  @@index([workCapsuleId])
  @@index([featureBuildId])
  @@index([sandboxId])
  @@index([slotId])
}

model RuntimeVerification {
  id                 String    @id @default(cuid())
  verificationId     String    @unique
  kind               String
  status             String

  // Exactly one of these should be set as the primary attach point.
  // Verifications can pre-exist a RuntimeTarget (e.g. typecheck before deploy).
  runtimeTargetId    String?
  workCapsuleId      String?
  featureBuildId     String?
  gitPromotionCandidateId String?

  command            String?
  url                String?
  evidenceUrl        String?
  screenshotUrl      String?

  // Cross-links into existing evidence tables (mirrors, not source of truth)
  toolExecutionId    String?
  buildActivityId    String?
  backlogActivityId  String?
  capsuleActivityId  String?

  startedAt          DateTime?
  completedAt        DateTime?
  result             Json?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  runtimeTarget      RuntimeTarget? @relation(fields: [runtimeTargetId], references: [id], onDelete: Cascade)

  @@index([runtimeTargetId, createdAt(sort: Desc)])
  @@index([featureBuildId, kind, status])
  @@index([workCapsuleId, kind, status])
  @@index([kind, status])
}
```

**Field rationale (what was removed and why):**

- `ownerUserId` / `ownerAgentId` — removed. Ownership is on `WorkCapsule` (`createdByPrincipalId`, `leaseHolderPrincipalId`) or `FeatureBuild` (`createdById`, `claimedByAgentId`). Joining is cheaper than duplicating.
- `repositoryFullName`, `baseBranch`, `headBranch`, `baseSha`, `headSha`, `worktreePath`, `pullRequestUrl`, `pullRequestNumber` — removed. All exist on `WorkCapsule`. A `RuntimeTarget` without a capsule (rare; only debug exceptions) records these in `metadata`.
- `backlogItemId`, `epicId`, `gitPromotionCandidateId` (on `RuntimeTarget`) — removed. Read through `WorkCapsule` and `FeatureBuild`. `RuntimeVerification.gitPromotionCandidateId` is kept because promotion verification is a verification primary attachment point, not a target attribute.
- `environment` — removed. Collapsed into `kind`. Each `kind` implies its environment.
- `acceptanceRole` — derived from `kind` (see mapping below). Stored only when an override is needed (`acceptanceRoleOverride`).
- `sandboxProviderId` — removed. Read through `sandboxId -> Sandbox.providerId`.

**`acceptanceRole` derivation (code, not column):**

| `kind` | derived `acceptanceRole` |
| --- | --- |
| `root-portal` | `final-acceptance` |
| `dev-portal` | `non-prod-verification` |
| `build-sandbox` | `non-prod-verification` |
| `git-promotion-sandbox` | `non-prod-verification` |
| `external-preview` | `non-prod-verification` |
| `ad-hoc-debug` | `debug-only` |

Strongly typed string arrays in TypeScript and MCP tool schemas, matching existing DPF enum practice:

- `RuntimeTarget.kind`: `root-portal`, `dev-portal`, `build-sandbox`, `git-promotion-sandbox`, `external-preview`, `ad-hoc-debug`.
- `RuntimeTarget.status`: `planned`, `assigned`, `starting`, `running`, `verifying`, `verified`, `failed`, `released`, `expired`, `blocked`, `misconfigured`.
- `RuntimeTarget.acceptanceRoleOverride` (rare; null in nearly all rows): `debug-only`.
- `RuntimeVerification.kind`: `health`, `typecheck`, `production-build`, `unit-test`, `ux`, `migration`, `manual-review`, `ci`, `final-acceptance`.
- `RuntimeVerification.status`: `pending`, `running`, `passed`, `failed`, `skipped`, `superseded`, `waived`.

`misconfigured` is added so phantom `SandboxSlot` rows (DB-advertised, no Compose service) surface as a real state rather than silent `available`. `waived` is added so the acceptance waiver path is queryable, not buried in a comment.

### Runtime Rules

#### Worktree Use

- Worktrees remain mandatory for source isolation.
- Root clone `D:\DPF` remains the merge/release worktree and customer-zero runtime source.
- A worktree does not imply permission to start a local portal runtime.
- Every external agent must register or adopt a Work Capsule before runtime verification.
- Every external agent must record:
  - branch and head SHA,
  - worktree path,
  - `COMPOSE_PROJECT_NAME`,
  - executor kind,
  - backlog item or explicit no-backlog reason,
  - intended runtime target,
  - verification evidence destination.
- Worktree-scoped Compose project names remain valid for harnesses and disposable checks, but customer-zero acceptance never happens there.

#### Sandbox Use

- Default non-prod verification target is Build Studio/sandbox, not `next dev` or `next start`.
- Sandbox assignment must be a lease with a Work Capsule or Feature Build owner.
- A sandbox slot is available only if both DB state and Docker/Compose runtime state agree.
- `FeatureBuild.sandboxId`, `sandboxPort`, `buildBranch`, and `gitCommitHashes` must be populated when a build enters implementation/review.
- Sandbox verification records must include:
  - runtime target id,
  - sandbox id/slot id,
  - container/service name,
  - host URL and internal URL,
  - source branch and commit SHA,
  - Build Studio build id and Work Capsule id when present.
- Browser-use screenshots captured during sandbox UX verification must attach to the runtime target and mirror into Build Activity/Backlog Activity/Work Capsule Activity.

#### Main Portal Acceptance

- Final acceptance happens only on the Docker-served portal path from root `D:\DPF`.
- Approved acceptance targets:
  - `AUTH_URL` / `APP_URL` from root `.env`.
  - `localhost:3000` when inspecting the local Docker portal.
  - `dpf-portal-1` internal health/version endpoints.
- Final acceptance must record:
  - root portal image version,
  - root portal git SHA,
  - container name,
  - health check result,
  - UX route(s) verified,
  - screenshots or evidence URLs,
  - PR number or branch,
  - backlog item/build/capsule linkage.
- A Build Studio or external-agent PR is not ready-for-promotion until final acceptance is attached to the capsule or explicit exception approval is recorded.

#### External Agent Registration

The durable principle (one rule, not seven steps):

> **Before any runtime verification action, an external agent must hold a Work Capsule and have registered a Runtime Target. Evidence references both.**

That principle implies a minimum 3-call handshake — `create_work_capsule` (or `adopt_worktree`), `register_runtime_target`, and `record_runtime_verification` — plus `heartbeat_capsule` while working. `claim_capsule_scope`, `record_capsule_evidence`, and PR linkage remain available but are no longer enumerated as gates; their absence is detected and reported by the existing capsule contract.

If no backlog item exists, the capsule carries an explicit `noBacklogReason` (e.g. `doc-only`, `incident-investigation`, `pre-backlog-discovery`). This keeps legitimate exploratory work visible without forcing false backlog links.

#### Concurrent Threads

- Work Capsule scope claims prevent file/module collision.
- Runtime target leases prevent sandbox collision.
- Sandbox pool reconciliation prevents DB-only phantom slots.
- PR readiness reads from Work Capsule + Runtime Target + Runtime Verification, not from local chat claims.
- A single sandbox can be reassigned only after the previous runtime target is `released`, `expired`, or explicitly `superseded`.
- A target whose owner has not heartbeated within its TTL is shown as stale and cannot count toward merge safety.

#### Ad-Hoc Local Servers

- `next dev`, `next start`, and arbitrary local ports are not valid DPF verification surfaces by default.
- Port 3000 is reserved for `dpf-portal-1`; any non-Docker process binding it is a policy violation.
- Ad-hoc servers are allowed only for explicit runtime-harness debugging or framework-level investigation.
- An ad-hoc server must be registered as `RuntimeTarget.kind=ad-hoc-debug`, `acceptanceRole=debug-only`, with:
  - owner,
  - reason,
  - port,
  - branch/SHA,
  - TTL,
  - evidence note explaining why sandbox/dev-portal was insufficient.
- `ad-hoc-debug` targets cannot satisfy final acceptance or PR readiness.

#### Backlog Evidence and Screenshots

- Evidence has one primary event and mirrored links:
  - primary runtime evidence lives on `RuntimeVerification`;
  - Work Capsule receives an activity pointer;
  - Build Studio receives a Build Activity pointer when a build is involved;
  - backlog receives `BacklogItemActivity` or `record_execution_evidence` when a backlog item is involved.
- Screenshots from browser-use should keep the existing `/api/build/<buildId>/evidence/<file>` path for build evidence, while runtime target records store the canonical URL and metadata.
- Manual review evidence should never be a free-floating comment. It must reference capsule/build/backlog/target identifiers.

## Implementation Plan

### Slice 1: Runtime Coordination Types, Schema, Seed, and Backfill

- [ ] Add `RuntimeTarget` and `RuntimeVerification` models to `packages/db/prisma/schema.prisma`.
- [ ] Add a migration with `pnpm --filter @dpf/db exec prisma migrate dev --name runtime_coordination_targets`.
- [ ] Update `packages/db/seed/**` so a fresh install seeds the root-portal `RuntimeTarget` (`kind=root-portal`, `serviceName=portal`, `containerName=dpf-portal-1`, `hostUrl=APP_URL`, `port=3000`) and a single dev-portal target (`kind=dev-portal`, `port=3001`). Seed and migration ship together (project rule: DB fix = seed + migration).
- [ ] Add a migration-time backfill (or one-shot script gated by an invariant guard) that mirrors existing rows into `RuntimeTarget`:
  - one row per live `Sandbox` (kind=`build-sandbox`, populate `sandboxId`/`featureBuildId`/`hostUrl=previewUrl`/`containerName`),
  - one row per `SandboxSlot` whose Compose service is absent → status `misconfigured`,
  - one row per `GitPromotionCandidate` currently mid-verification (kind=`git-promotion-sandbox`).
  Backfill is idempotent: re-running produces no duplicates.
- [ ] Add TypeScript enum arrays and union types in a new module:
  - `apps/web/lib/runtime-coordination/types.ts`
  - `apps/web/lib/runtime-coordination/runtime-targets.ts`
- [ ] Add the `acceptanceRole` derivation function and its inverse (`canSatisfyFinalAcceptance(kind)`).
- [ ] Add query helpers:
  - `createRuntimeTarget`
  - `registerRuntimeTarget`
  - `heartbeatRuntimeTarget`
  - `releaseRuntimeTarget`
  - `recordRuntimeVerification`
  - `getRuntimeCoordinationMap`
  - `resolveOwnership(target)` — joins through capsule/build to return owner principal and PR metadata without storing them on the target.
- [ ] Add tests for type guards, status transitions, idempotent backfill, derivation function, and ownership resolution:
  - `apps/web/lib/runtime-coordination/runtime-targets.test.ts`
  - `apps/web/lib/runtime-coordination/backfill.test.ts`

Acceptance:

- Fresh `pnpm db:seed` produces a `root-portal` `RuntimeTarget` and a `dev-portal` row.
- Backfill is idempotent and reflects the live Sandbox/SandboxSlot/GitPromotionCandidate state without manual intervention (addresses fresh-install pain rule).
- Invalid enum values fail before reaching the database.
- Querying a target returns owner/branch/SHA/PR via FK joins; the target row itself does not duplicate those columns.

### Slice 2: Work Capsule and MCP Runtime Registration

- [ ] Extend Work Capsule activity kinds with `runtime-target-registered`, `runtime-target-released`, `runtime-verification-passed`, and `runtime-verification-failed`.
- [ ] Add MCP tool definitions and handlers:
  - `register_runtime_target`
  - `heartbeat_runtime_target`
  - `release_runtime_target`
  - `record_runtime_verification`
  - `get_runtime_coordination_map`
- [ ] Ensure external coding-agent tokens can discover these tools through `/api/mcp/v1`.
- [ ] Add capability/grant mappings beside existing Work Capsule grants.
- [ ] Update `record_capsule_evidence` so it can link to a `runtimeTargetId` and `verificationId`.
- [ ] Add focused MCP handler tests.

Acceptance:

- A Codex/Claude external session can create/adopt a Work Capsule, register the worktree branch/SHA, register a sandbox target, and record evidence through MCP without DB fallback.
- Tool output returns the target id, accepted URL(s), expected verification role, and whether the target can count for final acceptance.

### Slice 3: Build Studio and Sandbox Attachment

- [ ] Update Build Studio creation/phase transition paths so every `FeatureBuild` gets or attaches to a Work Capsule.
- [ ] Backfill active `FeatureBuild` rows without capsules by idempotently calling `attachBuildStudioWorkCapsule`.
- [ ] Update `apps/web/lib/integrate/build-orchestrator.ts` to register a `build-sandbox` runtime target when implementation starts.
- [ ] Update `apps/web/lib/queue/functions/build-review-verification.ts` to record `RuntimeVerification` rows for UX checks and screenshot evidence.
- [ ] Update `apps/web/lib/integrate/sandbox/sandbox-pool.ts` to reconcile DB slots against actual Compose services before declaring a slot available.
- [ ] Update local Docker provider metadata so target records use one source of truth for `sandboxId`, `slotId`, `containerName`, `hostUrl`, and `internalUrl`.

Acceptance:

- Active Build Studio work has a capsule and a sandbox runtime target.
- Phantom sandbox slots are shown as unavailable/misconfigured until Compose runtime exists.
- UX verification writes both existing Build Activity and new Runtime Verification evidence.

### Slice 4: External Agent Workflow

- [ ] Add a small helper module:
  - `apps/web/lib/runtime-coordination/external-agent-registration.ts`
- [ ] Add a script for local agent introspection and registration:
  - `scripts/register-runtime-target.mjs`
- [ ] Update worktree seed scripts to print the required MCP registration step after copying `.mcp.json` and writing `COMPOSE_PROJECT_NAME`.
- [ ] Update `AGENTS.md` with runtime coordination rules:
  - worktrees isolate source only;
  - sandbox/Build Studio is default non-prod runtime;
  - root portal is final acceptance;
  - ad-hoc servers require registered debug target;
  - external agents must record capsule, branch, SHA, runtime target, and evidence.
- [ ] Update `docs/operations/dpf-production-runtime.md` and `docs/user-guide/development-workspace.md` to point to the governed workflow.

Acceptance:

- A new worktree setup ends with an explicit runtime target registration path.
- The registration helper refuses root `main` feature work and explains the approved target choices.
- The docs no longer leave room for "random local server" interpretation.

### Slice 5: Guardrails Against Runtime Drift

- [ ] Add detection for unmanaged Node/Next listeners on reserved DPF ports:
  - 3000: root portal only.
  - 3001: Compose `dev-portal` only.
  - 3035/3037/3038: registered sandbox slots only.
- [ ] Add a policy helper:
  - `apps/web/lib/runtime-coordination/runtime-policy.ts`
- [ ] Add a script:
  - `scripts/check-runtime-targets.mjs`
- [ ] Integrate the check into pre-acceptance workflow docs and Build Studio review gates.
- [ ] Add an MCP-visible warning event when an ad-hoc process is detected without a registered debug target.
- [ ] Keep the guard warning-first for non-reserved ports, but hard-block final acceptance on unregistered runtimes.

Acceptance:

- An unmanaged process on port 3000 is reported as a violation.
- A registered `ad-hoc-debug` runtime target is allowed for debugging but cannot satisfy acceptance.
- Final readiness checks fail if the only UX evidence points to a debug-only target.

### Slice 6: Runtime Coordination UI

- [ ] Add a runtime coordination surface under the existing platform/build control area rather than a marketing-style page.
- [ ] Candidate route:
  - `/build/runtime`
  - or a "Runtime" tab inside the Work Capsule/Build Studio control surface if existing navigation already owns that space.
- [ ] Show four compact bands:
  - Root portal acceptance target.
  - Sandbox pool and slot health.
  - Active Work Capsules and external agents.
  - PR/readiness/evidence status.
- [ ] Use dense operational layout:
  - status chips,
  - sortable tables,
  - tabs for `Active`, `Stale`, `Verified`, `Debug`,
  - icon buttons with tooltips,
  - no nested cards,
  - no hardcoded colors,
  - `text-[var(--dpf-text)]`, `bg-[var(--dpf-surface-1)]`, `border-[var(--dpf-border)]`, and related theme tokens only.
- [ ] Provide a detail panel for each runtime target with:
  - owner,
  - branch/SHA,
  - worktree path,
  - build/capsule/backlog/PR links,
  - URL(s),
  - verification timeline,
  - evidence screenshots/logs.
- [ ] Add UI tests for empty, active, stale, failed, and ready states.

Acceptance:

- An operator can answer from the UI: "what is deployed where, who owns it, what is being tested, and what is safe to merge?"
- The UI works in light/dark/brand modes without hardcoded colors.
- Text does not overflow compact panels or buttons at desktop/mobile widths.

### Slice 7: Final Portal Acceptance Gate

- [ ] Add a root portal acceptance helper:
  - `apps/web/lib/runtime-coordination/root-portal-acceptance.ts`
- [ ] Record:
  - `dpf-portal-1` image version,
  - git SHA,
  - health endpoint result,
  - root `.env` `APP_URL`/`AUTH_URL`,
  - checked routes,
  - screenshots,
  - PR/backlog/build/capsule links.
- [ ] Update PR readiness/status projection so `ready-for-promotion` requires a passing `final-acceptance` verification unless explicitly waived.
- [ ] Add a waiver path that requires reason, owner, and evidence, and is visible in the runtime UI.
- [ ] Update git-promotion verification so sandbox success does not masquerade as production-path acceptance.

Acceptance:

- Sandbox verification can mark a change ready for review.
- Root portal verification is required for final acceptance.
- A waiver is visible and cannot be confused with a passing production-path check.

### Slice 8: Evidence Normalization

- [ ] Add an evidence linking helper:
  - `apps/web/lib/runtime-coordination/evidence-links.ts`
- [ ] Normalize relationships across:
  - `RuntimeVerification`
  - `WorkCapsuleActivity`
  - `BuildActivity`
  - `BacklogItemActivity`
  - `ToolExecution`
  - `TaskArtifact`
  - `ExternalEvidenceRecord`
- [ ] Ensure `record_execution_evidence`, `record_capsule_evidence`, `saveBuildEvidence`, and browser-use screenshot capture can all link back to a runtime target.
- [ ] Add tests for evidence mirroring and idempotent duplicate handling.

Acceptance:

- A screenshot from sandbox UX verification is visible from build, backlog item, work capsule, and runtime target.
- Duplicate evidence submissions update or no-op instead of creating misleading parallel truth.

### Slice 9: Verification

- [ ] Focused unit tests:
  - `pnpm --filter web exec vitest run apps/web/lib/runtime-coordination/runtime-targets.test.ts`
  - `pnpm --filter web exec vitest run apps/web/lib/runtime-coordination/reconciler.test.ts`
  - `pnpm --filter web exec vitest run apps/web/lib/work-capsules/*.test.ts`
- [ ] MCP handler tests for runtime tools.
- [ ] UI tests for runtime coordination surface.
- [ ] Typecheck:
  - `pnpm --filter web typecheck`
- [ ] Production build:
  - `cd apps/web && pnpm exec next build`
- [ ] Docker-served portal acceptance:
  - `docker compose build --no-cache portal portal-init sandbox`
  - `docker compose up -d portal-init sandbox`
  - `docker compose up -d portal`
  - verify `dpf-portal-1` health/version,
  - verify `/build/runtime` or chosen runtime UI route in the browser,
  - attach screenshots/evidence to the right runtime target/capsule/backlog item.

Acceptance:

- Tests and build pass.
- The live root portal shows the runtime coordination state.
- Evidence records show the root portal target, sandbox target, branch/SHA, owner, backlog item, build/capsule, PR, and verification status.

## Implementation Order

Re-ordered so guardrails and evidence normalization land before the UI surfaces them, and acceptance gating lands after the evidence model is normalized (not before).

1. **Slice 1** — Schema, types, seed, backfill, helpers, tests.
2. **Slice 2** — MCP runtime target registration + evidence tools.
3. **Slice 3** — Build Studio + sandbox flow attaches to runtime targets.
4. **Slice 4** — External agent registration helper + docs.
5. **Slice 5** — Guardrails for unmanaged local servers.
6. **Slice 8** — Evidence normalization (run before UI and acceptance gate).
7. **Slice 7** — Final portal acceptance gate (depends on normalized evidence + guardrails).
8. **Slice 6** — Runtime coordination UI (surfaces real state, including guardrail violations and waivers).
9. **Slice 9** — Full verification with Docker portal acceptance evidence captured against the new spine.

## Refactoring Budget

Spend implementation effort on these refactors instead of piling behavior into existing large modules:

- Extract runtime target and verification logic out of `mcp-tools.ts` handlers into `apps/web/lib/runtime-coordination/*`.
- Keep `apps/web/lib/integrate/build-orchestrator.ts` focused on orchestration; move runtime registration to a helper.
- Keep `apps/web/lib/integrate/sandbox/sandbox-pool.ts` focused on pool state; move DB/Docker reconciliation into a small `runtime-coordination/reconciler.ts`.
- Keep evidence mirroring in `runtime-coordination/evidence-links.ts`, not duplicated across Build Studio, backlog, and capsule handlers.
- Keep UI state derivation in a server-side query helper so the React surface stays mostly presentational.

## Decisions (formerly Open Questions)

Resolved in the Architect Review (2026-05-18) so implementation does not branch:

- **Navigation:** Inside Build/Work Control. Operational, not promotional.
- **`dev-portal` (3001) for external agents:** Allowed when registered; never satisfies final acceptance.
- **Phantom sandbox slots:** Mark `misconfigured`, do not delete. Reconciler reuses the slot when Compose service returns.
- **GitHub Deployments:** Deferred. Mirror later for PR visibility once the local spine is stable.

## Remaining Risks

- **Migration scope.** Two new tables + backfill + seed touch a hot schema. Mitigation: backfill is idempotent and gated by an invariant guard; seed is additive; migration runs `migrate dev` locally and `migrate deploy` against Docker portal in Slice 9.
- **Capsule absence.** Live DB has 0 `WorkCapsule` rows. Slice 3's backfill of active `FeatureBuild`s into capsules is the riskiest sub-step. Mitigation: `attachBuildStudioWorkCapsule` already exists and is idempotent; call it for each active build in a single transaction with logging.
- **Reconciler thrash.** Sandbox pool reconciliation runs against live Docker; transient Docker errors must not flip slots to `misconfigured`. Mitigation: require N consecutive misses before flipping status; surface the count in metadata.
- **External agent adoption.** Existing agents must change their handshake. Mitigation: the worktree seed script prints the required calls; the helper's "refuse" path returns the approved options instead of erroring opaquely.

## Immediate Next Slice

Start with Slice 1 + Slice 2 together — they share the same Prisma migration window and the same MCP grant additions:

- Add `RuntimeTarget` / `RuntimeVerification` (slim shape; no duplicated owner/branch/SHA/PR columns).
- Seed the root-portal target and dev-portal target as part of the migration window.
- Run idempotent backfill from `Sandbox` / `SandboxSlot` / `GitPromotionCandidate`.
- Add service helpers, enum validation, and `acceptanceRole` derivation.
- Expose MCP registration tools: `register_runtime_target`, `heartbeat_runtime_target`, `release_runtime_target`, `record_runtime_verification`, `get_runtime_coordination_map`.
- Add one end-to-end test where a Work Capsule registers a sandbox runtime target and records a passing UX verification that mirrors into `BuildActivity` and `WorkCapsuleActivity`.

This is the smallest slice that flips the platform from "agents write evidence after the fact" to "the platform knows where the work is being tested before evidence is accepted," and it leaves the schema in a shape that does not need a follow-up migration to remove duplicated columns later.
