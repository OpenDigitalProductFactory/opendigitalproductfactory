# Build Studio Stall Detection + Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make every `TaskRun` in `working` state observably alive (or detectably dead) by adding heartbeat emission, a watchdog cron, a new `stalled` status, and operator-visible Retry/Abandon/Escalate flow across all Build Studio phases.

**Architecture:** A `lastHeartbeatAt` column on `TaskRun` is written cooperatively by every long-running loop via a thin `lib/observability/heartbeat.ts` helper. A new minute-cadence Inngest cron (`ops/taskrun-watchdog`) reads per-phase thresholds from a dedicated `BuildStudioStallThreshold` table and transitions silent rows to `status = "stalled"`, writing a `StallEvent` audit row and an operator `Notification`. Recovery is operator-initiated: Retry spawns a sibling `TaskRun` (via `parentTaskRunId`), Abandon cancels with one-level cascade to live children, Escalate parks the row in `stalled`.

**Tech Stack:** Next.js 16, Prisma 7.x on Postgres 16, Inngest cron functions, TypeScript strict mode, vitest for unit tests, existing `AgentEvent` bus for live UI updates.

**Source spec:** [docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md](../specs/2026-05-19-build-studio-stall-detection.md)

---

## ID Convention (read this before any task that touches TaskRun)

`TaskRun` has TWO ids:

- `TaskRun.id` — cuid, the Prisma primary key. Foreign-key columns in related tables (e.g. `DeliberationRun.taskRunId`) store this value despite the column being *named* `taskRunId`. Project convention: relations reference `id`.
- `TaskRun.taskRunId` — business identifier, `String @unique`. Used in messages, threads, A2A envelopes, and anywhere a stable human-readable id is required.

**Rule for this work:** all helpers in `lib/observability/` accept the **business `taskRunId` string** (because that's what every existing caller already has in scope). When writing a `StallEvent` row, the watchdog / recovery actions do ONE lookup to convert `taskRunId → id` per batch, then reuse the cuid for every row in that batch. Never per-row lookups.

`StallEvent.taskRunId` (FK column) stores the cuid `TaskRun.id`, matching the convention of `DeliberationRun.taskRunId` in the existing schema (verified 2026-05-19 at `schema.prisma:7994`). Spec §7.3 schema fragment is preserved as-is.

---

## Prerequisites

- [ ] Worktree on branch `claude/focused-dirac-f043ce` (or a fresh worktree off `origin/main`).
- [ ] Local platform builds clean: `cd apps/web && npx next build` succeeds before starting.
- [ ] DCO sign-off configured: `git config user.email` matches your GitHub-verified email; use `git commit -s` on every commit.
- [ ] Read the spec §3 (scope), §5.2 (status semantics), §5.5 (per-phase recovery), §7 (data model), §10 (slice ordering). The plan refers to these sections by number.

---

## Implementation Order

Tasks are grouped by phase. Within a phase, tasks are mostly sequential. Across phases:

- **Phase A** (Schema) must land first — blocks everything else.
- **Phase B** (Helper) must land before Phase D (Instrumentation).
- **Phase C** (Watchdog) must land before Phase E (Enable).
- **Phase D** (Instrumentation) must land before Phase E (Enable).
- **Phase F** (UI), **Phase G** (Admin editor), **Phase H** (Recovery dispatcher) can start in parallel with D once A and B are in.
- Each task commits independently. Each phase ships as a small PR if dispatched serially.

---

## Phase A — Schema Foundation

### Task A1: Add `BuildStudioStallThreshold` model + seed

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append after the existing `OrgSettings` model around line 7170)
- Modify: `packages/db/src/seed.ts` (locate the seed entry point; add a `seedStallThresholds()` function and call it)
- Create: `packages/db/src/seed-stall-thresholds.ts` (extracted seed module for testability)
- Test: `packages/db/src/seed-stall-thresholds.test.ts`
- Migration: `packages/db/prisma/migrations/<timestamp>_add_build_studio_stall_threshold/`

**Schema fragment to add:**

```prisma
model BuildStudioStallThreshold {
  id                       String   @id @default(cuid())
  scope                    String   @unique // "phase.ideate" | "phase.plan" | "phase.build" | "phase.review" | "phase.ship" | "default"
  heartbeatTimeoutSeconds  Int
  totalPhaseTimeoutSeconds Int
  updatedAt                DateTime @updatedAt
  updatedBy                String?  // User.id of last operator edit; null if seeded

  @@index([scope])
}
```

**Seed rows (spec §7.2):**

| scope | heartbeatTimeoutSeconds | totalPhaseTimeoutSeconds |
| --- | --- | --- |
| `phase.ideate` | 90 | 900 |
| `phase.plan` | 120 | 1800 |
| `phase.build` | 180 | 3600 |
| `phase.review` | 120 | 1800 |
| `phase.ship` | 120 | 1800 |
| `default` | 120 | 1800 |

- [ ] **Step 1:** Read the existing seed entry in `packages/db/src/seed.ts` to find the right insertion point (look for a list of `await seedX()` calls).
- [ ] **Step 2:** Create `seed-stall-thresholds.ts` exporting `seedStallThresholds(prisma)` that upserts the six rows by `scope`. Include an invariant: after upsert, count rows with `scope` matching `^phase\\.(ideate|plan|build|review|ship)$|^default$`; throw if count !== 6 (per spec §7.2 seed invariant).
- [ ] **Step 3:** Write `seed-stall-thresholds.test.ts` with vitest. Test cases: (a) idempotent — running twice yields six rows, (b) invariant throws if a row is missing after upsert (mock with `prisma.buildStudioStallThreshold.count` returning 5), (c) updates `updatedAt` on re-run but leaves `updatedBy` null.
- [ ] **Step 4:** Run `pnpm --filter @dpf/db exec vitest run seed-stall-thresholds.test.ts`. Confirm all three tests fail (the seed module doesn't exist yet).
- [ ] **Step 5:** Implement the schema addition in `schema.prisma`.
- [ ] **Step 6:** Generate migration: `pnpm --filter @dpf/db exec prisma migrate dev --name add_build_studio_stall_threshold`. Verify the generated SQL creates the table + unique index on `scope`.
- [ ] **Step 7:** Implement `seedStallThresholds()`.
- [ ] **Step 8:** Wire it into `seed.ts` so a fresh install seeds the rows.
- [ ] **Step 9:** Re-run the test: `pnpm --filter @dpf/db exec vitest run seed-stall-thresholds.test.ts`. All three tests pass.
- [ ] **Step 10:** Run the full DB build check: `pnpm --filter @dpf/db exec prisma validate` and `pnpm --filter @dpf/db typecheck`. Zero errors.
- [ ] **Step 11:** Commit: `git commit -s -m "feat(db): add BuildStudioStallThreshold model + seed"`.

---

### Task A2: Add `lastHeartbeatAt` to `TaskRun` + index

**Files:**
- Modify: `packages/db/prisma/schema.prisma:4416-4455` (the `TaskRun` model)
- Migration: `packages/db/prisma/migrations/<timestamp>_add_taskrun_heartbeat/`

**Change:** Add `lastHeartbeatAt DateTime?` between `completedAt` and `archivedAt`. Add `@@index([status, lastHeartbeatAt])` to the model's index block.

- [ ] **Step 1:** Read `schema.prisma:4416-4455` to confirm current shape.
- [ ] **Step 2:** Insert the new field. The status enum comment already exists at line 4430; leave it for now (Task A3 updates it).
- [ ] **Step 3:** Add the new index after the existing `@@index([userId, status])`.
- [ ] **Step 4:** Generate migration: `pnpm --filter @dpf/db exec prisma migrate dev --name add_taskrun_heartbeat`. Verify SQL: `ALTER TABLE "TaskRun" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3)` and a `CREATE INDEX` on `(status, lastHeartbeatAt)`.
- [ ] **Step 5:** Run `pnpm --filter @dpf/db exec prisma validate` — zero errors.
- [ ] **Step 6:** Commit: `git commit -s -m "feat(db): add TaskRun.lastHeartbeatAt + watchdog index"`.

---

### Task A3a: Add `stalled` to `TASK_STATES` + capture diagnostic list

**Files:**
- Modify: `apps/web/lib/tak/task-states.ts`
- Modify: `packages/db/prisma/schema.prisma:4430` (update the status comment to point at the canonical TS source)
- Create: `docs/superpowers/plans/2026-05-19-stall-detection-typecheck-baseline.txt` (capture file — gitignored from final commit; serves as the implementer's worklist for A3b/A3c)

**Why split:** the type sweep is genuinely multi-hour work because the union is consumed in 10+ places (severity, capacity, project-events, fixtures, etc.). A3a does the enum addition and captures the worklist; A3b–A3c work the consumer fixes in small batches.

**Spec reference:** §5.2, §7.1.

- [ ] **Step 1:** Append `"stalled"` to `TASK_STATES` in `apps/web/lib/tak/task-states.ts`. Leave `TASK_IN_FLIGHT_STATES` unchanged.
- [ ] **Step 2:** Update the status comment at `schema.prisma:4430` to `// See TASK_STATES in apps/web/lib/tak/task-states.ts for canonical values.`
- [ ] **Step 3:** Run `pnpm --filter web typecheck > /tmp/typecheck-stalled.log 2>&1`. Capture the count: `grep -c "error TS" /tmp/typecheck-stalled.log`.
- [ ] **Step 4:** Save the diagnostic list to the capture file (one error path per line). This becomes the worklist for A3b.
- [ ] **Step 5:** Commit JUST the two source changes (NOT the capture file): `git commit -s -m "feat(types): add stalled to TASK_STATES (consumer sweep follows)"`. The repo is now in a known-broken-build state; A3b/A3c restore it.

### Task A3b: Sweep severity + display consumers

**Files (from A3a worklist; spot-checked 2026-05-19):**
- Modify: `apps/web/lib/ai-operations-map/project-events.ts:422` (`severityForTaskRunStatus`) — return `"warning"` for `stalled`.
- Modify: any other display-layer status mapping the A3a worklist surfaces (file paths come from `/tmp/typecheck-stalled.log`).

- [ ] **Step 1:** Open `/tmp/typecheck-stalled.log` and identify diagnostics in `apps/web/lib/ai-operations-map/` and `apps/web/components/`.
- [ ] **Step 2:** For each: add the `stalled` arm. Display rule (spec §9.1): warning severity, NOT error.
- [ ] **Step 3:** `pnpm --filter web typecheck` — confirm display-layer errors are gone (other layers may still report).
- [ ] **Step 4:** Commit: `git commit -s -m "feat(types): handle stalled in severity/display consumers"`.

### Task A3c: Sweep capacity / scheduling / fixture consumers

**Files (from A3a worklist):**
- Modify: `apps/web/lib/capacity-continuity/backlog-selector.ts:135` and similar — do NOT add `stalled` to in-flight lists.
- Modify: any test fixtures (`*.test.ts`) the worklist surfaces — add `stalled` only where exhaustive-coverage is asserted.

- [ ] **Step 1:** Walk remaining entries on the A3a worklist.
- [ ] **Step 2:** For scheduling filters: leave `stalled` out of the live-work `status: { in: [...] }` lists. For fixtures: add coverage only where the test exhaustively asserts every status.
- [ ] **Step 3:** `pnpm --filter web typecheck` — zero errors.
- [ ] **Step 4:** Run touched vitest files.
- [ ] **Step 5:** Commit: `git commit -s -m "feat(types): handle stalled in scheduling and fixture consumers"`.

---

### Task A4: Add `StallEvent` model + `TaskRun` relation

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add `StallEvent` model + back-relation on `TaskRun`)
- Migration: `packages/db/prisma/migrations/<timestamp>_add_stall_event/`

**Schema fragment (spec §7.3):**

```prisma
model StallEvent {
  id                   String    @id @default(cuid())
  taskRunId            String
  buildId              String?
  phase                String?
  reason               String    // "heartbeat_timeout" | "total_timeout" | "never_started" | "parent_stalled" | "parent_abandoned"
  detectedAt           DateTime  @default(now())
  lastHeartbeatAt      DateTime?
  startedAt            DateTime
  thresholdHeartbeatS  Int
  thresholdTotalS      Int
  outcome              String?   // null | "retry" | "abandoned" | "escalated" | "auto-recovered"
  outcomeAt            DateTime?
  outcomeBy            String?
  notes                String?   @db.Text
  createdAt            DateTime  @default(now())

  taskRun              TaskRun   @relation(fields: [taskRunId], references: [id], onDelete: Cascade)

  @@index([taskRunId])
  @@index([buildId])
  @@index([phase, reason])
  @@index([outcome])
}
```

Add the back-relation to `TaskRun` (it's listed in the schema snippet in spec §7.1).

- [ ] **Step 1:** Add the `StallEvent` model after `TaskRun` in `schema.prisma`.
- [ ] **Step 2:** Add `stallEvents StallEvent[]` to the `TaskRun` model's relations block.
- [ ] **Step 3:** Generate migration: `pnpm --filter @dpf/db exec prisma migrate dev --name add_stall_event`. Verify SQL creates the table, FK to `TaskRun.id` with `ON DELETE CASCADE`, and all four indices.
- [ ] **Step 4:** `pnpm --filter @dpf/db exec prisma validate` — zero errors.
- [ ] **Step 5:** `pnpm --filter web typecheck` — zero errors (the new generated types should compile cleanly without consumer changes).
- [ ] **Step 6:** Commit: `git commit -s -m "feat(db): add StallEvent audit model"`.

---

## Phase B — Heartbeat Helper Library

### Task B1: `heartbeat()` and `markTaskRunWorking()` helpers

**Files:**
- Create: `apps/web/lib/observability/heartbeat.ts`
- Test: `apps/web/lib/observability/heartbeat.test.ts`

**Spec reference:** §5.6, §6.1, §11.

**Contract:**

```ts
// apps/web/lib/observability/heartbeat.ts
import { prisma } from "@dpf/db";

/**
 * Cooperative heartbeat. Writes lastHeartbeatAt = now() only if the row is
 * still in "working" status. Returns false if the row is no longer working,
 * which the caller can treat as a cooperative-cancellation signal.
 */
export async function heartbeat(taskRunId: string): Promise<boolean> {
  const result = await prisma.taskRun.updateMany({
    where: { taskRunId, status: "working" },
    data: { lastHeartbeatAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Canonical entry point for transitioning a TaskRun into "working" from new
 * code. Sets status, startedAt (if null), and an initial lastHeartbeatAt so
 * the watchdog's "never_started" branch doesn't false-positive on the gap
 * between transition and first work.
 */
export async function markTaskRunWorking(taskRunId: string): Promise<void> {
  const now = new Date();
  await prisma.taskRun.update({
    where: { taskRunId },
    data: { status: "working", lastHeartbeatAt: now },
  });
}
```

- [ ] **Step 1:** Create the directory: ensure `apps/web/lib/observability/` exists.
- [ ] **Step 2:** Write `heartbeat.test.ts` with these cases (mock `prisma.taskRun.updateMany` and `prisma.taskRun.update`):
  - `heartbeat(id)` returns `true` when `updateMany` returns `{ count: 1 }`.
  - `heartbeat(id)` returns `false` when `updateMany` returns `{ count: 0 }` (row not in `working` anymore).
  - `heartbeat(id)` passes the exact `where: { taskRunId, status: "working" }` clause.
  - `markTaskRunWorking(id)` writes both `status: "working"` and a `lastHeartbeatAt` Date.
- [ ] **Step 3:** Run `npx vitest run apps/web/lib/observability/heartbeat.test.ts`. All four tests fail.
- [ ] **Step 4:** Implement `heartbeat.ts` per the contract above.
- [ ] **Step 5:** Run vitest. All four tests pass.
- [ ] **Step 6:** Run `pnpm --filter web typecheck`. Zero errors.
- [ ] **Step 7:** Commit: `git commit -s -m "feat(observability): add heartbeat() and markTaskRunWorking() helpers"`.

---

### Task B2: `withHeartbeatTicker()` wrapper

**Files:**
- Modify: `apps/web/lib/observability/heartbeat.ts` (add the wrapper)
- Modify: `apps/web/lib/observability/heartbeat.test.ts` (add wrapper tests)
- Create: `apps/web/lib/observability/threshold-lookup.ts` (helper to resolve `heartbeatTimeoutSeconds` for a given taskRunId)
- Test: `apps/web/lib/observability/threshold-lookup.test.ts`

**Spec reference:** §5.3 (cadence), §6.1 (interval derivation: `heartbeatTimeoutSeconds / 3`).

**Contract:**

```ts
// apps/web/lib/observability/threshold-lookup.ts
import { prisma } from "@dpf/db";

export interface ResolvedThreshold {
  scope: string;
  heartbeatTimeoutSeconds: number;
  totalPhaseTimeoutSeconds: number;
}

/**
 * Resolves the stall threshold for a TaskRun by joining to FeatureBuild.phase
 * if buildId is present, else falling back to the "default" row.
 */
export async function resolveThresholdForTaskRun(taskRunId: string): Promise<ResolvedThreshold> {
  const tr = await prisma.taskRun.findUnique({
    where: { taskRunId },
    select: { buildId: true },
  });
  let scope = "default";
  if (tr?.buildId) {
    const fb = await prisma.featureBuild.findUnique({
      where: { buildId: tr.buildId },
      select: { phase: true },
    });
    if (fb?.phase) scope = `phase.${fb.phase}`;
  }
  const row = await prisma.buildStudioStallThreshold.findUnique({ where: { scope } });
  if (!row) {
    // Fall back to "default" — should always exist per the seed invariant in A1.
    const def = await prisma.buildStudioStallThreshold.findUnique({ where: { scope: "default" } });
    if (!def) throw new Error("BuildStudioStallThreshold seed is missing the 'default' row");
    return { scope: "default", heartbeatTimeoutSeconds: def.heartbeatTimeoutSeconds, totalPhaseTimeoutSeconds: def.totalPhaseTimeoutSeconds };
  }
  return { scope, heartbeatTimeoutSeconds: row.heartbeatTimeoutSeconds, totalPhaseTimeoutSeconds: row.totalPhaseTimeoutSeconds };
}
```

```ts
// addition to heartbeat.ts
import { resolveThresholdForTaskRun } from "./threshold-lookup";

/**
 * Runs `fn` while emitting heartbeats at heartbeatTimeoutSeconds / 3 cadence.
 * For opaque long calls without a natural emission boundary.
 *
 * The interval is NOT exposed as a public parameter — the test-only override
 * is the second arg `_intervalMsForTests`.
 */
export async function withHeartbeatTicker<T>(
  taskRunId: string,
  fn: () => Promise<T>,
  _intervalMsForTests?: number,
): Promise<T> {
  const intervalMs = _intervalMsForTests ?? (await resolveThresholdForTaskRun(taskRunId)).heartbeatTimeoutSeconds * 1000 / 3;
  const handle = setInterval(() => { void heartbeat(taskRunId); }, intervalMs);
  try {
    return await fn();
  } finally {
    clearInterval(handle);
  }
}
```

- [ ] **Step 1:** Write `threshold-lookup.test.ts` with these cases (mock `prisma`):
  - Returns `phase.build` row when `TaskRun.buildId` resolves to a `FeatureBuild` with `phase = "build"`.
  - Returns `default` row when `TaskRun.buildId` is null.
  - Returns `default` row when `FeatureBuild.phase` doesn't match any `phase.*` scope.
  - Throws when neither the resolved row nor `default` exist (seed misconfiguration).
- [ ] **Step 2:** Run the test. All four fail.
- [ ] **Step 3:** Implement `threshold-lookup.ts` per the contract.
- [ ] **Step 4:** Run the test. All four pass.
- [ ] **Step 5:** Add `withHeartbeatTicker` tests in `heartbeat.test.ts`:
  - Calls `fn` exactly once and returns its result.
  - Emits a heartbeat at the test-override interval (use `vi.useFakeTimers()`; advance time; assert `heartbeat` was called the expected number of times).
  - Clears the interval if `fn` throws.
- [ ] **Step 6:** Run vitest. New tests fail.
- [ ] **Step 7:** Implement `withHeartbeatTicker` per the contract.
- [ ] **Step 8:** Run vitest. All tests pass.
- [ ] **Step 9:** `pnpm --filter web typecheck`. Zero errors.
- [ ] **Step 10:** Commit: `git commit -s -m "feat(observability): add withHeartbeatTicker + threshold lookup"`.

---

## Phase C — Watchdog Cron (Behind Feature Flag)

### Task C1: Feature flag plumbing (DB-backed via `PlatformConfig`)

**Files:**
- Modify: `apps/web/lib/shared/feature-flags.ts` (canonical location, verified 2026-05-19 — existing `isUnifiedCoworkerEnabled` pattern is the model)
- Test: `apps/web/lib/shared/feature-flags.test.ts` (create if missing)
- Modify: `packages/db/src/seed.ts` (add a default `PlatformConfig` row for the flag)

**Pattern (matches existing `isUnifiedCoworkerEnabled`):**

```ts
export async function isStallWatchdogEnabled(): Promise<boolean> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "STALL_WATCHDOG_ENABLED" },
  });
  const val = config?.value as { enabled?: boolean } | null;
  return val?.enabled === true;
}
```

**Seed default:** insert a `PlatformConfig` row with `key = "STALL_WATCHDOG_ENABLED"`, `value = { enabled: false }` so a fresh install starts with the watchdog off. Operator flips it via the existing Platform Development admin surface (or directly in DB during dev).

- [ ] **Step 1:** Read `apps/web/lib/shared/feature-flags.ts` to confirm the existing `isUnifiedCoworkerEnabled` pattern.
- [ ] **Step 2:** Write `isStallWatchdogEnabled.test.ts` cases: returns `true` when `PlatformConfig` row has `value.enabled === true`; returns `false` when the row is missing; returns `false` when `value.enabled` is anything other than literal `true`.
- [ ] **Step 3:** Run test — fail.
- [ ] **Step 4:** Implement `isStallWatchdogEnabled` exactly like `isUnifiedCoworkerEnabled`.
- [ ] **Step 5:** Add the default seed row in `seed.ts` (search for an existing `seedPlatformConfig` function or similar; if not present, add a `seedFeatureFlags` block alongside the other seed calls listed at lines 2341-2350).
- [ ] **Step 6:** Test passes. Typecheck.
- [ ] **Step 7:** Commit: `git commit -s -m "feat(flags): add STALL_WATCHDOG_ENABLED via PlatformConfig"`.

---

### Task C2: Watchdog detection logic (pure function)

**Files:**
- Create: `apps/web/lib/observability/watchdog-detect.ts`
- Test: `apps/web/lib/observability/watchdog-detect.test.ts`

**Spec reference:** §5.7 (detection logic).

**Contract:**

```ts
// apps/web/lib/observability/watchdog-detect.ts
import type { ResolvedThreshold } from "./threshold-lookup";

export interface WatchdogCandidate {
  taskRunId: string;
  buildId: string | null;
  phase: string | null;
  startedAt: Date;
  lastHeartbeatAt: Date | null;
}

export type StallReason =
  | "heartbeat_timeout"
  | "total_timeout"
  | "never_started"
  | "parent_stalled"   // emitted by cascade in §6.5 — not by the watchdog itself
  | "parent_abandoned"; // emitted by taskrunAbandon's child cascade (Task F2)

export interface StallDecision {
  candidate: WatchdogCandidate;
  threshold: ResolvedThreshold;
  reason: StallReason;
}

/**
 * Pure function — given a candidate row, the resolved threshold, and the
 * current time, decide whether it has stalled and why. Returns null if the
 * candidate is still within bounds.
 */
export function decideStall(
  candidate: WatchdogCandidate,
  threshold: ResolvedThreshold,
  now: Date,
): StallDecision | null {
  const ageMs = now.getTime() - candidate.startedAt.getTime();
  if (ageMs > threshold.totalPhaseTimeoutSeconds * 1000) {
    return { candidate, threshold, reason: "total_timeout" };
  }
  if (candidate.lastHeartbeatAt === null) {
    if (ageMs > threshold.heartbeatTimeoutSeconds * 1000) {
      return { candidate, threshold, reason: "never_started" };
    }
    return null;
  }
  const silenceMs = now.getTime() - candidate.lastHeartbeatAt.getTime();
  if (silenceMs > threshold.heartbeatTimeoutSeconds * 1000) {
    return { candidate, threshold, reason: "heartbeat_timeout" };
  }
  return null;
}
```

- [ ] **Step 1:** Write `watchdog-detect.test.ts`. Cases:
  - Returns null when `lastHeartbeatAt` is recent and `startedAt` is within the wall-clock cap.
  - Returns `heartbeat_timeout` when silence exceeds `heartbeatTimeoutSeconds`.
  - Returns `total_timeout` when `startedAt` age exceeds `totalPhaseTimeoutSeconds`, regardless of heartbeats.
  - Returns `never_started` when `lastHeartbeatAt` is null and `startedAt` age exceeds `heartbeatTimeoutSeconds`.
  - `total_timeout` wins over `heartbeat_timeout` if both would trip (check the order in `decideStall`).
- [ ] **Step 2:** Run the test. All five fail.
- [ ] **Step 3:** Implement `watchdog-detect.ts`.
- [ ] **Step 4:** Run the test. All five pass.
- [ ] **Step 5:** Commit: `git commit -s -m "feat(observability): pure stall-detection logic"`.

---

### Task C3: Watchdog Inngest cron function

**Files:**
- Create: `apps/web/lib/queue/functions/taskrun-watchdog.ts`
- Test: `apps/web/lib/queue/functions/taskrun-watchdog.test.ts`
- Modify: the inngest function registry (grep `apps/web/lib/queue` for the index/manifest file that wires functions; typically `index.ts` or `client.ts`).

**Spec reference:** §5.7 (cron cadence, transaction).

**Skeleton:**

```ts
// apps/web/lib/queue/functions/taskrun-watchdog.ts
import { inngest } from "../inngest-client"; // path varies — confirm with grep
import { cron } from "inngest";
import { prisma } from "@dpf/db";
import { decideStall, type WatchdogCandidate } from "@/lib/observability/watchdog-detect";
import { isStallWatchdogEnabled } from "@/lib/shared/feature-flags";

export const taskrunWatchdog = inngest.createFunction(
  { id: "ops/taskrun-watchdog", retries: 0, triggers: [cron("* * * * *")] },
  async ({ step }) => {
    if (!(await isStallWatchdogEnabled())) return { skipped: true, reason: "flag-off" };

    const thresholds = await prisma.buildStudioStallThreshold.findMany();
    if (thresholds.length === 0) return { skipped: true, reason: "no-thresholds-seeded" };

    const minHeartbeatS = Math.min(...thresholds.map(t => t.heartbeatTimeoutSeconds));
    const minTotalS = Math.min(...thresholds.map(t => t.totalPhaseTimeoutSeconds));

    // Coarse SQL fetch (spec §5.7): "might have stalled" using min thresholds.
    const candidates = await prisma.$queryRaw<WatchdogCandidate[]>`
      SELECT tr."taskRunId", tr."buildId", fb.phase, tr."startedAt", tr."lastHeartbeatAt"
      FROM "TaskRun" tr
      LEFT JOIN "FeatureBuild" fb ON tr."buildId" = fb."buildId"
      WHERE tr.status = 'working'
        AND (
          tr."lastHeartbeatAt" IS NULL
          OR now() - tr."lastHeartbeatAt" > make_interval(secs => ${minHeartbeatS})
          OR now() - tr."startedAt" > make_interval(secs => ${minTotalS})
        )
    `;

    const now = new Date();
    const decisions = candidates
      .map(c => {
        const scope = c.phase ? `phase.${c.phase}` : "default";
        const threshold = thresholds.find(t => t.scope === scope) ?? thresholds.find(t => t.scope === "default");
        if (!threshold) return null;
        return decideStall(c, threshold, now);
      })
      .filter(<T,>(x: T | null): x is T => x !== null);

    // Batch ID resolution per the ID Convention at the top of this plan:
    // one lookup converts business taskRunId -> cuid id for FK writes.
    const idMap = new Map<string, string>();
    if (decisions.length > 0) {
      const rows = await prisma.taskRun.findMany({
        where: { taskRunId: { in: decisions.map(d => d.candidate.taskRunId) } },
        select: { id: true, taskRunId: true },
      });
      rows.forEach(r => idMap.set(r.taskRunId, r.id));
    }

    for (const d of decisions) {
      const cuid = idMap.get(d.candidate.taskRunId);
      if (!cuid) continue; // row deleted between fetch and tx — safe to skip
      await prisma.$transaction(async (tx) => {
        // 1. Transition TaskRun.
        await tx.taskRun.update({
          where: { taskRunId: d.candidate.taskRunId },
          data: { status: "stalled", completedAt: now },
        });
        // 2. Write StallEvent audit row (FK = cuid).
        await tx.stallEvent.create({
          data: {
            taskRunId: cuid,
            buildId: d.candidate.buildId,
            phase: d.candidate.phase,
            reason: d.reason,
            lastHeartbeatAt: d.candidate.lastHeartbeatAt,
            startedAt: d.candidate.startedAt,
            thresholdHeartbeatS: d.threshold.heartbeatTimeoutSeconds,
            thresholdTotalS: d.threshold.totalPhaseTimeoutSeconds,
          },
        });
        // 3. BuildActivity row (spec §6.2 step 4) so the Build Studio activity
        //    stream reflects the stall. Only when buildId is present.
        if (d.candidate.buildId) {
          await tx.buildActivity.create({
            data: {
              buildId: d.candidate.buildId,
              tool: "watchdog:stall",
              summary: `Watchdog detected stall (${d.reason}) in phase ${d.candidate.phase ?? "—"}`,
            },
          });
        }
        // 4. Notification — see Task C4 for the owner-resolution logic.
      });
    }

    return { processed: decisions.length };
  },
);
```

- [ ] **Step 1:** Find the inngest function registry. `grep -rn "createFunction\|export.*function.*Inngest" apps/web/lib/queue/ | head` to locate where existing crons are aggregated. Also confirm the inngest-client import path (look at `apps/web/lib/queue/functions/agent-task-dispatch.ts` for the established pattern — copy its imports verbatim).
- [ ] **Step 2:** Write `taskrun-watchdog.test.ts`. Cases (mock `prisma`, mock `isStallWatchdogEnabled`):
  - Returns `{ skipped: "flag-off" }` when flag is false.
  - Returns `{ skipped: "no-thresholds-seeded" }` when thresholds table is empty.
  - Calls `prisma.$transaction` once per detected stall.
  - Sets `TaskRun.status = "stalled"` and `completedAt` in the transaction.
  - Creates a `StallEvent` row with the correct `reason` and `taskRunId = <cuid id>` (asserting the batch-resolution path, not the business id).
  - Creates a `BuildActivity` row when `buildId` is present, skips it when null.
  - Performs a single batched `taskRun.findMany` for ID resolution, not one lookup per candidate.
- [ ] **Step 3:** Run vitest. All seven fail.
- [ ] **Step 4:** Implement the watchdog per the skeleton. Read the ID Convention block at the top of this plan before writing — the FK is `cuid`, not the business id.
- [ ] **Step 5:** Run vitest. All seven pass.
- [ ] **Step 6:** Wire `taskrunWatchdog` into the inngest function registry.
- [ ] **Step 7:** Typecheck. Commit: `git commit -s -m "feat(observability): taskrun-watchdog inngest cron (behind flag)"`.

---

### Task C4: Operator notification on stall detection

**Files:**
- Modify: `apps/web/lib/queue/functions/taskrun-watchdog.ts` (fill in the TODO from C3)
- Modify: `apps/web/lib/queue/functions/taskrun-watchdog.test.ts` (add notification assertions)

**Spec reference:** §6.2 step 4, §12.3 (notification fatigue).

**Behavior:** Inside the same transaction, insert a `Notification` row with `type = "taskrun.stalled"`, `userId =` build owner if `buildId` resolves to a `FeatureBuild.createdById`, else fall back to the first user with `platformRole = "admin"`. `deepLink` = `/build-studio/${buildId}` if buildId, else `/admin/ai-operations`. Grouping is UI-side (§9.4) — back end emits one row per stall.

- [ ] **Step 1:** Add a test case: when a stall is detected with a `buildId`, a `Notification` is created with `userId = featureBuild.createdById` and `type = "taskrun.stalled"`.
- [ ] **Step 2:** Add a test case: when no `buildId`, the notification falls back to an admin user.
- [ ] **Step 3:** Run vitest. Both new tests fail.
- [ ] **Step 4:** Implement the notification logic inside the existing `$transaction`.
- [ ] **Step 5:** Run vitest. All tests pass.
- [ ] **Step 6:** Commit: `git commit -s -m "feat(observability): notify build owner on stall detection"`.

---

### Task C5: Emit `taskrun:stalled` AgentEvent for live UI

**Files:**
- Modify: `apps/web/lib/queue/functions/taskrun-watchdog.ts`
- Modify: `apps/web/lib/agent-event-bus.ts` or `apps/web/lib/tak/agent-event-bus.ts` — confirm the canonical bus file via `grep -rn "AgentEvent\|emit.*phase:change" apps/web/lib --include="*.ts" -l | head`.

**Behavior:** After each successful transaction, emit `{ type: "taskrun:stalled", taskRunId, buildId, phase, reason }`. UI subscribers (Phase F) consume this without polling.

- [ ] **Step 1:** Add `"taskrun:stalled"` to the `AgentEvent` discriminated union with fields `taskRunId`, `buildId | null`, `phase | null`, `reason`.
- [ ] **Step 2:** In the watchdog, call `emit(...)` after each transaction commits.
- [ ] **Step 3:** Test: assert `emit` is called once per stall.
- [ ] **Step 4:** Run vitest, typecheck.
- [ ] **Step 5:** Commit: `git commit -s -m "feat(observability): emit taskrun:stalled AgentEvent"`.

---

## Phase D — Instrument the Four Hot Loops

> **Parallelizable across sub-tasks.** Each touches a different file and can be done independently. All depend on Phase B helpers.

### Task D1: Agent runtime tool-call boundary

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts` (find the tool-call return / next-inference boundary — search for `tool_calls`, `toolResult`, or `inferenceComplete`)
- Test: `apps/web/lib/actions/agent-coworker.test.ts` (add a heartbeat-emission assertion)

**Spec reference:** §5.3 row 1, §10 step 4.

- [ ] **Step 1:** Read `agent-coworker.ts` to find the inner inference loop. Identify the point where a tool response has been received and the next inference call is about to start. This is the heartbeat emission site.
- [ ] **Step 2:** Add a test: in the agent loop, after a tool call completes, `heartbeat(taskRunId)` is called before the next inference dispatch. Mock `heartbeat` and assert call count.
- [ ] **Step 3:** Run the test. It fails (no heartbeat yet).
- [ ] **Step 4:** Add `import { heartbeat } from "@/lib/observability/heartbeat"` and call `await heartbeat(taskRunId)` at the boundary. If `heartbeat` returns false, treat as cooperative-cancel: break out of the loop with `status = "canceled"` already written by whoever transitioned the row.
- [ ] **Step 5:** Run the test. Passes.
- [ ] **Step 6:** Typecheck. Commit: `git commit -s -m "feat(observability): emit heartbeat at agent-coworker tool-call boundary"`.

---

### Task D2: Deliberation round boundary

**Files:**
- Modify: `apps/web/lib/deliberation/orchestrator.ts` (the `orchestrateDeliberation` function holds the round loop, verified 2026-05-19) — NOT `apps/web/lib/actions/deliberation.ts` which is just the action wrapper.
- Test: `apps/web/lib/deliberation/orchestrator.test.ts` (or the closest existing test)

- [ ] **Step 1:** Read `orchestrator.ts` to locate the per-round loop. Identify the business `taskRunId` available in scope — `DeliberationRun.taskRunId` (which stores the cuid `TaskRun.id` per project convention) needs to be converted to the business id for the helper. Look up once at orchestrator entry and pass down.
- [ ] **Step 2:** Add a test asserting `heartbeat(taskRunId)` is called at each round boundary.
- [ ] **Step 3:** Test fails.
- [ ] **Step 4:** Add the heartbeat call.
- [ ] **Step 5:** Test passes. Typecheck.
- [ ] **Step 6:** Commit: `git commit -s -m "feat(observability): heartbeat at deliberation round boundary"`.

---

### Task D3: Sandbox build pipeline step boundary

**Files:**
- Modify: `apps/web/lib/integrate/build-pipeline.ts` (the `runBuildPipeline` loop)
- Test: `apps/web/lib/integrate/build-pipeline.test.ts`

**Site:** The `updateState(state)` call inside the step loop is the natural boundary — each `STEP_ORDER` transition writes checkpoint state; emit a heartbeat at the same point.

The pipeline currently uses `buildId`, not `taskRunId`. Thread `taskRunId` in via the `runBuildPipeline` params (it's already in scope at the caller in `build-orchestrator.ts` — confirm). If threading is non-trivial, look up `taskRunId` from `FeatureBuild` once at pipeline start and pass it down.

- [ ] **Step 1:** Read `build-pipeline.ts` to find `runBuildPipeline` and the step loop.
- [ ] **Step 2:** Thread `taskRunId` into the function params (or look it up from buildId at the top).
- [ ] **Step 3:** Add a test: pipeline emits a heartbeat after each step's `updateState`.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Test passes. Typecheck.
- [ ] **Step 6:** Commit: `git commit -s -m "feat(observability): heartbeat at sandbox pipeline step boundary"`.

---

### Task D4: Brand-extract queue function

**Files:**
- Modify: `apps/web/lib/queue/functions/brand-extract.ts` (at line 59-62 it already writes `status: "working"` — instrument the surrounding loop)
- Test: `apps/web/lib/queue/functions/brand-extract.test.ts`

**Rationale:** I1's CI guard requires every existing `status: "working"` writer to import from `lib/observability/heartbeat`. Brand-extract is the surviving pre-existing writer outside the agent/deliberation/sandbox/codex set; instrumenting it now prevents the I1 allowlist from growing un-policed.

- [ ] **Step 1:** Read `brand-extract.ts:50-100` to find the working-state write and surrounding loop.
- [ ] **Step 2:** Replace the bare `data: { status: "working", startedAt: new Date() }` write with `await markTaskRunWorking(taskRunId)` followed by a `heartbeat(taskRunId)` call inside the extraction loop's natural boundary.
- [ ] **Step 3:** Add tests asserting both calls happen.
- [ ] **Step 4:** Run vitest. Typecheck.
- [ ] **Step 5:** Commit: `git commit -s -m "feat(observability): heartbeat in brand-extract queue function"`.

---

### Task D5: Codex CLI adapter tool-call boundary

**Files:**
- Modify: `apps/web/lib/routing/cli-adapter.ts` (the `[tool-trace]` logging site — that's the natural emission point per spec §10)
- Test: `apps/web/lib/routing/cli-adapter.test.ts` if it exists, else add one.

- [ ] **Step 1:** Read `cli-adapter.ts`. Find the `[tool-trace]` logging line(s). That's where each tool response is processed.
- [ ] **Step 2:** Ensure `taskRunId` is in scope. If not, thread it in.
- [ ] **Step 3:** Add a test: after each tool response is processed, `heartbeat(taskRunId)` is called.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Test passes. Typecheck.
- [ ] **Step 6:** Commit: `git commit -s -m "feat(observability): heartbeat at Codex CLI adapter tool-call boundary"`.

---

## Phase E — Enable Watchdog End-to-End

### Task E1: Integration test — full stall + recovery loop

**Files:**
- Create: `apps/web/lib/observability/watchdog-integration.test.ts`

**Scenario (spec §11):** Use a real test DB (or `prisma` mocked at a coarse level — match the project's existing integration-test pattern; check `apps/web/lib/queue/functions/brand-extract.test.ts` for the established style).

- [ ] **Step 1:** Read an existing integration-style test for the pattern.
- [ ] **Step 2:** Write a test that:
  1. Inserts a `BuildStudioStallThreshold` row with `heartbeatTimeoutSeconds = 1`.
  2. Inserts a `TaskRun` with `status = "working"`, `startedAt = 5 seconds ago`, `lastHeartbeatAt = null`.
  3. Calls the watchdog handler directly (not via inngest dispatch).
  4. Asserts `TaskRun.status === "stalled"`, exactly one `StallEvent` row exists with `reason = "never_started"`, exactly one `Notification` row exists.
- [ ] **Step 3:** Run. It should pass if Phase C is complete; debug otherwise.
- [ ] **Step 4:** Commit: `git commit -s -m "test(observability): full stall-detection integration test"`.

---

### Task E2: Flip the seed default to enabled

**Files:**
- Modify: `packages/db/src/seed.ts` (the seed block added in C1)

**Why:** C1 seeded the flag as `{ enabled: false }` so the watchdog stayed dormant during instrumentation rollout (D1–D5). After E1's integration test passes end-to-end, the seed default flips to `{ enabled: true }` so fresh installs ship with the watchdog active. Existing installs keep their operator-set value (the seed is `upsert`-only on missing rows; existing rows are not overwritten — confirm this when implementing).

- [ ] **Step 1:** Change the seed default for `STALL_WATCHDOG_ENABLED` to `{ enabled: true }`. Confirm the seed function uses `upsert` with the `create` branch holding the default and an empty `update` block — so existing rows on existing installs are not touched.
- [ ] **Step 2:** Add a seed test asserting fresh-seed produces `enabled: true` and that the upsert doesn't overwrite an existing `enabled: false` row.
- [ ] **Step 3:** Run vitest + typecheck.
- [ ] **Step 4:** Commit: `git commit -s -m "feat(observability): enable stall watchdog by default for fresh installs"`.

---

## Phase F — Operator UI

### Task F1: AI Operations Map — stalled badge + actions

**Files:**
- Modify: `apps/web/components/platform/AiOperationsMap.tsx`
- Test: `apps/web/components/platform/AiOperationsMap.test.tsx` if exists

**Spec reference:** §9.1.

- [ ] **Step 1:** Read `AiOperationsMap.tsx` around line 2184–2205 (the existing status-to-color logic) to find where to add the `stalled` case.
- [ ] **Step 2:** Add `stalled` rendering: warning color (suggest `var(--dpf-warning)`), label "Stalled", subtitle "Stalled Xm" derived from the latest `StallEvent.detectedAt`.
- [ ] **Step 3:** Add three inline action buttons (Retry / Abandon / Escalate) visible when the slot is expanded. Wire to new server actions `taskrunRetry(taskRunId)`, `taskrunAbandon(taskRunId)`, `taskrunEscalate(taskRunId)` — implement these in Task F2.
- [ ] **Step 4:** For the ship phase, disable the Retry button with a tooltip; surface a confirm-dialog when the operator overrides (per spec §5.5).
- [ ] **Step 5:** Subscribe to `taskrun:stalled` AgentEvents to auto-refresh the slot without polling.
- [ ] **Step 6:** Typecheck. Visual check: `cd apps/web && npx next build` zero errors. Commit: `git commit -s -m "feat(ui): stalled state + recovery actions in AI Operations Map"`.

---

### Task F2: Server actions — Retry / Abandon / Escalate

**Files:**
- Create: `apps/web/lib/actions/taskrun-recovery.ts`
- Test: `apps/web/lib/actions/taskrun-recovery.test.ts`

**Spec reference:** §6.3, §6.5 (cancel cascade), §6.6 (Retry sibling).

**Three exports:**

```ts
export async function taskrunRetry(taskRunId: string, operatorUserId: string, opts?: { force?: boolean }): Promise<{ newTaskRunId: string }>;
export async function taskrunAbandon(taskRunId: string, operatorUserId: string): Promise<void>;
export async function taskrunEscalate(taskRunId: string, operatorUserId: string, notes?: string): Promise<void>;
```

For v1, `taskrunRetry` falls back to a uniform "re-dispatch from scratch" path (per spec §10 step 6). **This dispatch branch is intentionally throwaway code — Task H1 rips it out and replaces it with the per-phase strategy table.** Do not invest in making the v1 branch elegant; just keep it correct.

Sibling spawn semantics ARE non-negotiable from day one (spec §6.6): the new row carries `parentTaskRunId = <stalled row's cuid id>` (the schema column stores `id`, not the business `taskRunId` — see ID Convention at the top of this plan). Updating the StallEvent's `outcome = "retry"` and `outcomeBy = operatorUserId` happens in the same transaction.

For `taskrunAbandon`, implement the one-level cascade in §6.5: walk children with `parentTaskRunId = <stalled row's id>` and status in the in-flight set, transition each to `canceled` with a `StallEvent` row `reason = "parent_abandoned"`. Do this in the same transaction.

For `taskrunEscalate`: write `StallEvent.outcome = "escalated"`, `outcomeBy`, optional `notes`. Send a `Notification` to the accountable human (build owner; for v1 same logic as C4).

- [ ] **Step 1:** Write tests for each of the three actions:
  - `taskrunRetry` rejects when called on a TaskRun that isn't `stalled`.
  - `taskrunRetry` rejects for `phase = "ship"` without `force: true` (per §5.5).
  - `taskrunRetry` with `force: true` on ship-phase succeeds.
  - `taskrunRetry` creates a sibling TaskRun with `parentTaskRunId` set and updates the StallEvent.
  - `taskrunAbandon` cancels live children with `reason = "parent_abandoned"`.
  - `taskrunAbandon` does NOT touch terminal children.
  - `taskrunEscalate` writes the StallEvent outcome and notification.
- [ ] **Step 2:** Run vitest. All fail.
- [ ] **Step 3:** Implement each action.
- [ ] **Step 4:** Run vitest. All pass.
- [ ] **Step 5:** Wire the F1 buttons to these actions.
- [ ] **Step 6:** Typecheck. Commit: `git commit -s -m "feat(actions): taskrun retry / abandon / escalate"`.

---

### Task F3: Build Studio phase panel — stalled state + history strip

**Files:**
- Modify: the Build Studio phase panel component. Find via `grep -rn "PHASE_LABELS\|phase.*panel" apps/web/components --include="*.tsx" | head`. Likely `apps/web/components/build-studio/PhasePanel.tsx` or similar — confirm by inspection.
- Test: the corresponding test if any.

**Spec reference:** §9.2.

- [ ] **Step 1:** Locate the phase panel component.
- [ ] **Step 2:** Add stalled-state rendering: badge, reason copy from `StallEvent.reason` ("No heartbeat for Xm" / "Exceeded Ym phase budget" / "Never started"), the three action buttons.
- [ ] **Step 3:** Add a stacked history strip showing prior `StallEvent`s for the same `buildId` (spec §6.6 — "Retry #N").
- [ ] **Step 4:** Subscribe to `taskrun:stalled` AgentEvent.
- [ ] **Step 5:** Typecheck. Commit: `git commit -s -m "feat(ui): stalled state + history strip in Build Studio phase panel"`.

---

## Phase G — Admin Threshold Editor

### Task G1: Admin page — `/admin/build-studio/stall-thresholds`

**Files:**
- Create: `apps/web/app/admin/build-studio/stall-thresholds/page.tsx`
- Create: `apps/web/lib/actions/stall-thresholds.ts`
- Test: `apps/web/lib/actions/stall-thresholds.test.ts`

**Behavior:** Renders the six rows from `BuildStudioStallThreshold`, inline numeric editors, save action that updates the row and sets `updatedBy = currentUserId`. No restart needed — Task B2's `resolveThresholdForTaskRun` re-reads on each call.

- [ ] **Step 1:** Write the server action `updateStallThreshold(scope, heartbeatTimeoutSeconds, totalPhaseTimeoutSeconds, userId)`. Validate inputs (positive integers, heartbeat < total).
- [ ] **Step 2:** Write tests for the action. Cases: rejects negative, rejects heartbeat ≥ total, updates the row, sets `updatedBy`.
- [ ] **Step 3:** Run vitest. Fail.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Tests pass.
- [ ] **Step 6:** Build the page UI — table of rows, inline editors, save buttons.
- [ ] **Step 7:** Typecheck + `npx next build`. Commit: `git commit -s -m "feat(admin): Build Studio stall threshold editor"`.

---

## Phase H — Per-Phase Recovery Dispatcher

### Task H1: Per-phase Retry strategy

**Files:**
- Modify: `apps/web/lib/actions/taskrun-recovery.ts` (replace the v1 "re-dispatch from scratch" branch in `taskrunRetry`)
- Test: `apps/web/lib/actions/taskrun-recovery.test.ts`

**Spec reference:** §5.5 table.

**Behavior:** Look up the row's phase via `buildId → FeatureBuild.phase`. Dispatch:

| Phase | Strategy |
| --- | --- |
| `ideate` | Re-dispatch from scratch (same as v1 fallback) |
| `plan` | If a `DeliberationRun` exists with `taskRunId = <stalled>` and `completedAt != null`, dispatch a new TaskRun pre-seeded with that outcome bundle. Else re-dispatch from scratch. |
| `build` | Call `runBuildPipeline(...)` with `existingState =` the stalled row's last persisted `BuildExecutionState` so it resumes from the last `BuildExecStep`. |
| `review` | Re-dispatch the current reviewer pass only — do not re-run upstream. |
| `ship` | Disabled by default; `force: true` does a fresh re-dispatch with a `notes` field on the StallEvent describing the override. |

- [ ] **Step 1:** Add test cases per the table — one test per phase asserting the correct strategy is invoked.
- [ ] **Step 2:** Run vitest. Fail.
- [ ] **Step 3:** Implement the dispatch switch in `taskrunRetry`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Typecheck. Commit: `git commit -s -m "feat(recovery): per-phase Retry dispatcher"`.

---

## Phase I — Coverage Enforcement

### Task I1: Typed-write enforcement helper + CI grep

**Files:**
- Modify: `apps/web/lib/observability/heartbeat.ts` (already has `markTaskRunWorking` from B1 — this is the sanctioned entry point)
- Create: a CI check script. Place under `scripts/check-no-bare-working-write.mjs`.
- Modify: `.github/workflows/<the typecheck/lint workflow>.yml` to invoke the script.

**Spec reference:** §5.6, §11.

**Script behavior:** find every non-test source file in `apps/web/lib` that writes `status: "working"` to a `TaskRun` and assert it imports from `lib/observability/heartbeat`. Files that do not are surfaced and fail CI. The allowlist starts with the five files instrumented in D1–D5 (agent-coworker, deliberation orchestrator, build-pipeline, brand-extract, cli-adapter) plus any other pre-existing writer the typecheck sweep in A3 surfaced — populate the allowlist by running the script before the first commit and including every legitimate writer that's now heart-beating.

- [ ] **Step 1:** Write the script. Maintain an allow-list inline in the script (existing instrumented files) — keep the list short and require new entries to be reviewed.
- [ ] **Step 2:** Run it locally. Confirm it exits 0 with the current allow-list and exits 1 if you introduce a deliberate violation.
- [ ] **Step 3:** Wire into CI workflow.
- [ ] **Step 4:** Commit: `git commit -s -m "ci: enforce sanctioned TaskRun working-state writes"`.

---

## Final Verification

Before opening the final PR (or merging the running PR if the work landed in stages):

- [ ] `pnpm --filter web typecheck` — zero errors.
- [ ] `cd apps/web && npx next build` — zero errors.
- [ ] `npx vitest run` — full suite passes (or pre-existing failures noted and unchanged).
- [ ] Migrations apply cleanly on a fresh DB. Use the project's existing seed entrypoint — search for `db:seed` in root `package.json` and the `packages/db` `package.json`. Confirm seed produces six `BuildStudioStallThreshold` rows (count: `SELECT COUNT(*) FROM "BuildStudioStallThreshold"` should return 6).
- [ ] UX smoke: trigger a stall by setting the build threshold to 5s, starting a Build Studio run, and watching the AI Operations Map show the stalled badge within one watchdog tick (≤60s). Then click Retry and confirm a sibling TaskRun is created.
- [ ] Open the PR with the spec link in the description and the smoke-test evidence (screenshot of stalled badge + recovery).

---

## What Is Explicitly NOT in This Plan

Per spec §3.2 (out of scope for v1):

- Predictive stall detection.
- Auto-retry without operator approval.
- Cost-tier-aware timeouts.
- Anomaly detection beyond heartbeat absence.

Per spec §12 (open questions / v2 candidates):

- Heartbeat batching for hive-mind scale.
- WWMD-gated ship-phase Retry.
- `source`-dimensioned default thresholds.
- Watchdog self-stall meta-watchdog.

If during execution you discover that any of these is actually needed for v1 to be useful, surface it — do not silently expand scope.
