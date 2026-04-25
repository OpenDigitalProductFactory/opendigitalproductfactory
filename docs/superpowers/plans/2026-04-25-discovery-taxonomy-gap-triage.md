# Discovery Taxonomy Gap Triage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first slice of the daily discovery taxonomy gap triage loop: decision logging, confidence scoring, scheduled coworker triage, high-confidence auto-attribution, human escalation, and an inventory triage workbench.

**Architecture:** Add a focused discovery-triage domain layer instead of pushing more logic into UI components or generic discovery sync. Persist every triage decision in Postgres, compute confidence from existing `InventoryEntity` / taxonomy candidate evidence, run the process from a scheduled coworker task, and expose the results through the existing inventory review surface. Persistent fingerprint catalogs and hive-mind contribution UX remain blocked on the sibling fingerprint-contribution thread.

**Tech Stack:** Next.js App Router, React server/client components, Prisma/Postgres in `packages/db`, Vitest, scheduled agent tasks, DPF prompt templates, existing inventory/discovery modules.

---

## Scope Boundary

This plan implements only the smallest slice from `docs/superpowers/specs/2026-04-25-discovery-taxonomy-gap-triage-design.md`.

In scope:

- `DiscoveryTriageDecision` schema, migration, and typed helpers
- canonical hyphenated string constants for new triage values
- forward migration from `ai_proposed` to `ai-proposed`
- daily scheduled triage task plus volume-trigger entry point
- confidence scoring and routing
- decision logging
- auto-apply for existing taxonomy-node matches only
- human review rows/cards for ambiguous or taxonomy-gap cases
- daily metrics summary payload
- docs/tests/QA gates

Out of scope:

- persistent deterministic-rule catalog rows
- external hive-mind contribution UX
- redaction policy beyond `redactionStatus: "unverified"`
- renaming legacy `InventoryEntity.attributionStatus = "needs_review"`
- customer-managed estate tenant queue split

Open implementation blocker:

- The spec marks daily-owner selection as approval-needed. Default to `agentId: "discovery-steward"` in code behind a single constant, but do not seed it into production data until Mark confirms the owner. If execution starts before confirmation, implement the code path and leave the seed guarded by a TODO/backlog note.

---

## File Map

### Database And Package Layer

- Modify: `packages/db/prisma/schema.prisma`
  - Add `DiscoveryTriageDecision`.
  - Add relations only if required by Prisma generation; keep nullable IDs if relation churn is larger than needed for slice 1.
- Create: `packages/db/prisma/migrations/<timestamp>_add_discovery_triage_decisions/migration.sql`
  - Create table and indexes.
  - Forward update `InventoryEntity.attributionMethod` from `ai_proposed` to `ai-proposed`.
- Modify: `packages/db/src/discovery-attribution.ts`
  - Update union types from `"ai_proposed"` to `"ai-proposed"`.
  - Preserve legacy attribution status values.
- Modify: `packages/db/src/discovery-attribution.test.ts`
  - Cover hyphenated `ai-proposed` where relevant.
- Create: `packages/db/src/discovery-triage.ts`
  - Domain logic for evidence packets, scoring, routing, decision payloads, metrics, and auto-apply decision shaping.
- Create: `packages/db/src/discovery-triage.test.ts`
  - Unit tests for threshold routing, ambiguity, evidence completeness, taxonomy gap, proposed rule JSON, and metrics.
- Modify: `packages/db/src/index.ts`
  - Export triage helpers.

### Web Domain And Actions

- Create: `apps/web/lib/discovery-triage.ts`
  - Canonical `as const` enum arrays and web-facing types.
  - Re-export or mirror DB constants if package boundaries allow.
- Create: `apps/web/lib/discovery-triage-runner.ts`
  - Server-side orchestrator for daily/volume-triggered triage.
- Create: `apps/web/lib/discovery-triage-runner.test.ts`
  - Tests with mocked Prisma-like clients.
- Modify: `apps/web/lib/actions/inventory.ts`
  - Add human review outcomes: request evidence, mark taxonomy gap reviewed, accept triage recommendation.
  - Ensure existing accept/reassign/dismiss behavior remains.
- Modify: `apps/web/lib/actions/inventory.test.ts`
  - Cover new actions and unchanged existing actions.
- Modify: `apps/web/lib/consume/discovery-data.ts`
  - Expose grouped triage queue and decision history.
- Modify: `apps/web/lib/mcp-tools.ts`
  - Only if triage fields are exposed through MCP tools; mirror enum arrays exactly.

### Scheduler, Prompt, And Agent Registry

- Create: `prompts/specialist/discovery-taxonomy-gap-triage.prompt.md`
  - Daily coworker prompt.
- Modify: `packages/db/src/seed.ts`
  - Seed prompt template if that is the established prompt source path.
  - Seed `ScheduledAgentTask` only after owner decision is resolved.
- Modify: `packages/db/data/agent_registry.json`
  - Add `discovery-steward` only if owner decision resolves to a new coworker.
  - Otherwise add required grants to the existing selected coworker.
- Modify: `apps/web/lib/actions/agent-task-scheduler.ts` or adjacent scheduler code
  - Add an idempotent volume-trigger entry point if no better event handler exists.

### UI

- Modify: `apps/web/components/inventory/InventoryExceptionQueue.tsx`
  - Evolve into a compact triage workbench using theme-aware CSS variables.
- Modify: `apps/web/components/inventory/InventoryExceptionQueue.test.tsx`
  - Extend server-render tests if existing pattern supports it.
- Modify: `apps/web/app/(shell)/inventory/page.tsx`
  - Wire grouped triage data into the component if not already passed.
- Modify: `apps/web/app/(shell)/inventory/page.test.tsx`
  - Cover grouped queue rendering.

### Docs And QA

- Preserve: `docs/superpowers/specs/2026-04-25-discovery-taxonomy-gap-triage-design.md`
  - User-reviewed source spec; do not overwrite their changes.
- Add QA note to `tests/e2e/platform-qa-plan.md` only if implementation changes user-facing workflow and no suitable inventory case exists.

---

## Chunk 1: Schema, Migration, And Canonical Values

### Task 1: Add canonical triage constants

**Files:**
- Create: `apps/web/lib/discovery-triage.ts`
- Create or modify: `apps/web/lib/discovery-triage.test.ts`

- [ ] **Step 1: Write the constants test**

```ts
import {
  TRIAGE_ACTOR_TYPES,
  TRIAGE_OUTCOMES,
  TRIAGE_QUALITY_ISSUE_TYPES,
} from "@/lib/discovery-triage";

describe("discovery triage constants", () => {
  it("uses canonical hyphenated values", () => {
    expect(TRIAGE_OUTCOMES).toContain("auto-attributed");
    expect(TRIAGE_OUTCOMES).toContain("human-review");
    expect(TRIAGE_OUTCOMES).not.toContain("auto_attributed");
    expect(TRIAGE_ACTOR_TYPES).toEqual(["agent", "human", "system"]);
    expect(TRIAGE_QUALITY_ISSUE_TYPES).toEqual([
      "attribution",
      "stale-identity",
      "missing-taxonomy",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web vitest run apps/web/lib/discovery-triage.test.ts`

Expected: FAIL because `apps/web/lib/discovery-triage.ts` does not exist.

- [ ] **Step 3: Add constants and union types**

```ts
export const TRIAGE_ACTOR_TYPES = ["agent", "human", "system"] as const;
export type TriageActorType = (typeof TRIAGE_ACTOR_TYPES)[number];

export const TRIAGE_OUTCOMES = [
  "auto-attributed",
  "human-review",
  "needs-more-evidence",
  "taxonomy-gap",
  "dismissed",
] as const;
export type TriageOutcome = (typeof TRIAGE_OUTCOMES)[number];

export const TRIAGE_QUALITY_ISSUE_TYPES = [
  "attribution",
  "stale-identity",
  "missing-taxonomy",
] as const;
export type TriageQualityIssueType = (typeof TRIAGE_QUALITY_ISSUE_TYPES)[number];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web vitest run apps/web/lib/discovery-triage.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add apps/web/lib/discovery-triage.ts apps/web/lib/discovery-triage.test.ts
git commit -s -m "feat(discovery): add triage enum constants"
```

### Task 2: Add `DiscoveryTriageDecision` schema and migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_discovery_triage_decisions/migration.sql`

- [ ] **Step 1: Add schema model**

Add the model from spec section 10.2 with indexes:

```prisma
model DiscoveryTriageDecision {
  id                     String   @id @default(cuid())
  decisionId             String   @unique
  inventoryEntityId      String?
  qualityIssueId         String?
  actorType              String
  actorId                String?
  outcome                String
  identityConfidence     Float?
  taxonomyConfidence     Float?
  evidenceCompleteness   Float?
  reproducibilityScore   Float?
  selectedTaxonomyNodeId String?
  selectedIdentity       Json?
  evidencePacket         Json
  proposedRule           Json?
  appliedRuleId          String?
  requiresHumanReview    Boolean  @default(false)
  humanReviewedAt        DateTime?
  createdAt              DateTime @default(now())

  @@index([outcome])
  @@index([inventoryEntityId])
  @@index([requiresHumanReview, createdAt])
}
```

- [ ] **Step 2: Generate a migration**

Run: `pnpm migrate`

Expected: a new migration directory is created.

- [ ] **Step 3: Add data update SQL inside the migration**

Append a forward-only data update:

```sql
UPDATE "InventoryEntity"
SET "attributionMethod" = 'ai-proposed'
WHERE "attributionMethod" = 'ai_proposed';
```

- [ ] **Step 4: Re-run migration apply**

Run: `pnpm migrate`

Expected: migration applies cleanly without drift.

- [ ] **Step 5: Generate Prisma client if needed**

Run: `pnpm --filter @dpf/db prisma generate`

Expected: generated client updates cleanly.

- [ ] **Step 6: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -s -m "feat(discovery): add triage decision log"
```

### Task 3: Rename `ai_proposed` type usage

**Files:**
- Modify: `packages/db/src/discovery-attribution.ts`
- Modify: `packages/db/src/discovery-attribution.test.ts`
- Search: all `*.ts`, `*.tsx`, `*.json`, `*.md` for `ai_proposed`

- [ ] **Step 1: Search current usage**

Run: `Get-ChildItem -Recurse -File -Include *.ts,*.tsx,*.json,*.md | Select-String -Pattern 'ai_proposed'`

Expected: at least `packages/db/src/discovery-attribution.ts` is found.

- [ ] **Step 2: Update tests to expect `ai-proposed`**

Add or update a test that asserts the new value is accepted anywhere `InventoryQualityEntityInput.attributionMethod` is used.

- [ ] **Step 3: Update implementation types**

Change:

```ts
attributionMethod?: "rule" | "heuristic" | "manual" | "ai_proposed" | null;
```

to:

```ts
attributionMethod?: "rule" | "heuristic" | "manual" | "ai-proposed" | null;
```

- [ ] **Step 4: Run affected DB tests**

Run: `pnpm --filter @dpf/db vitest run packages/db/src/discovery-attribution.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add packages/db/src/discovery-attribution.ts packages/db/src/discovery-attribution.test.ts
git commit -s -m "fix(discovery): use canonical ai-proposed attribution"
```

---

## Chunk 2: Triage Engine

### Task 4: Build evidence packets

**Files:**
- Create: `packages/db/src/discovery-triage.ts`
- Create: `packages/db/src/discovery-triage.test.ts`
- Create: `packages/db/src/__fixtures__/discovery-triage/windows-host.json`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing evidence packet test**

```ts
import { buildDiscoveryEvidencePacket } from "./discovery-triage";

it("builds a replayable evidence packet from an inventory entity", () => {
  const packet = buildDiscoveryEvidencePacket({
    id: "entity-1",
    entityKey: "service:prom:windows-host:windows-host",
    entityType: "service",
    name: "windows-host",
    firstSeenAt: new Date("2026-04-25T00:00:00Z"),
    lastSeenAt: new Date("2026-04-25T01:00:00Z"),
    attributionConfidence: 0.283,
    candidateTaxonomy: [
      { nodeId: "foundational/compute/servers", name: "Servers", score: 0.283 },
    ],
    properties: { job: "windows-host", instance: "windows-host", health: "up" },
  });

  expect(packet.redactionStatus).toBe("unverified");
  expect(packet.candidateTaxonomy[0]?.nodeId).toBe("foundational/compute/servers");
  expect(packet.protocolEvidence.prometheusLabels).toMatchObject({ job: "windows-host" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dpf/db vitest run packages/db/src/discovery-triage.test.ts`

Expected: FAIL because helper is missing.

- [ ] **Step 3: Implement packet builder**

Keep the function pure. Do not import Prisma into this file for the packet builder.

- [ ] **Step 4: Export helper**

Update `packages/db/src/index.ts`.

- [ ] **Step 5: Run test**

Run: `pnpm --filter @dpf/db vitest run packages/db/src/discovery-triage.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add packages/db/src/discovery-triage.ts packages/db/src/discovery-triage.test.ts packages/db/src/__fixtures__/discovery-triage packages/db/src/index.ts
git commit -s -m "feat(discovery): build triage evidence packets"
```

### Task 5: Implement confidence scoring and routing

**Files:**
- Modify: `packages/db/src/discovery-triage.ts`
- Modify: `packages/db/src/discovery-triage.test.ts`

- [ ] **Step 1: Add tests for threshold routing**

Cover:

- deterministic auto-attribution at identity/taxonomy `0.95`
- coworker auto-attribution at identity/taxonomy `0.90`
- taxonomy gap when identity is `0.85` and no suitable node exists
- human review when ambiguity margin is `< 0.05`
- needs-more-evidence when identity is `< 0.60`

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @dpf/db vitest run packages/db/src/discovery-triage.test.ts`

Expected: FAIL for missing scoring functions.

- [ ] **Step 3: Implement pure functions**

Suggested exports:

```ts
export type DiscoveryTriageThresholds = {
  deterministicAutoApply: number;
  coworkerAutoApply: number;
  taxonomyGapIdentity: number;
  humanReviewFloor: number;
  ambiguityMargin: number;
};

export function scoreDiscoveryTriageCandidate(packet, thresholds): DiscoveryTriageScore;
export function resolveDiscoveryTriageOutcome(score, packet, thresholds): TriageOutcome;
export function shouldAutoApplyTriageDecision(score, packet, thresholds): boolean;
```

- [ ] **Step 4: Implement proposed rule JSON synthesis**

For slice 1, return JSON only:

```ts
{
  ruleType: "discovery-fingerprint",
  requiredSignals: [...],
  taxonomyNodeId: "...",
  identity: {...},
  confidenceFloor: 0.9,
  redactionStatus: "unverified"
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @dpf/db vitest run packages/db/src/discovery-triage.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add packages/db/src/discovery-triage.ts packages/db/src/discovery-triage.test.ts
git commit -s -m "feat(discovery): score triage confidence"
```

### Task 6: Persist triage decisions

**Files:**
- Modify: `packages/db/src/discovery-triage.ts`
- Modify: `packages/db/src/discovery-triage.test.ts`

- [ ] **Step 1: Write failing persistence test with mocked client**

Assert that `recordDiscoveryTriageDecision()` calls `discoveryTriageDecision.create` with:

- `decisionId`
- `actorType`
- `outcome`
- four scores
- `evidencePacket`
- `proposedRule`
- `requiresHumanReview`

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @dpf/db vitest run packages/db/src/discovery-triage.test.ts`

- [ ] **Step 3: Implement persistence adapter**

Keep the client type narrow:

```ts
type DiscoveryTriageClient = {
  discoveryTriageDecision: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @dpf/db vitest run packages/db/src/discovery-triage.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add packages/db/src/discovery-triage.ts packages/db/src/discovery-triage.test.ts
git commit -s -m "feat(discovery): persist triage decisions"
```

---

## Chunk 3: Scheduled Coworker Triage

### Task 7: Add server runner for daily and volume-triggered triage

**Files:**
- Create: `apps/web/lib/discovery-triage-runner.ts`
- Create: `apps/web/lib/discovery-triage-runner.test.ts`
- Modify: `apps/web/lib/actions/agent-task-scheduler.ts` only if needed for volume trigger

- [ ] **Step 1: Write failing runner test**

Test that a mocked `needs_review` entity:

- is loaded
- produces a decision
- auto-applies only when thresholds are cleared
- records a decision row

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter web vitest run apps/web/lib/discovery-triage-runner.test.ts`

- [ ] **Step 3: Implement runner**

Suggested exported functions:

```ts
export async function runDiscoveryTriageDaily(options?: {
  actorId?: string;
  trigger?: "cadence" | "volume";
  now?: Date;
}): Promise<DiscoveryTriageRunSummary>;

export async function maybeTriggerDiscoveryTriageForVolume(): Promise<{
  triggered: boolean;
  reason: string;
}>;
```

Important:

- idempotency key: date + agentId + trigger family
- query `InventoryEntity` with `attributionStatus = "needs_review"` first
- include low-confidence attributed records only if query cost is reasonable
- do not auto-contribute externally
- keep `redactionStatus: "unverified"`

- [ ] **Step 4: Implement auto-apply update**

For auto-attributed outcomes only:

```ts
await prisma.inventoryEntity.update({
  where: { id: entity.id },
  data: {
    attributionStatus: "attributed",
    attributionMethod: "ai-proposed",
    attributionConfidence: score.taxonomyConfidence,
  },
});
```

Do not overwrite `taxonomyNodeId` unless the selected candidate node is found and resolved correctly.

- [ ] **Step 5: Update scheduler status payload**

Daily summary should include:

- auto-rate
- escalation queue depth
- repeat-unresolved count
- taxonomy-gap count
- decisions created

- [ ] **Step 6: Run tests**

Run: `pnpm --filter web vitest run apps/web/lib/discovery-triage-runner.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add apps/web/lib/discovery-triage-runner.ts apps/web/lib/discovery-triage-runner.test.ts apps/web/lib/actions/agent-task-scheduler.ts
git commit -s -m "feat(discovery): run scheduled taxonomy triage"
```

### Task 8: Add prompt and seed hook

**Files:**
- Create: `prompts/specialist/discovery-taxonomy-gap-triage.prompt.md`
- Modify: `packages/db/src/seed.ts`
- Modify: `packages/db/data/agent_registry.json` if new coworker is approved

- [ ] **Step 1: Confirm owner decision**

Ask Mark to resolve spec Q1 before seeding:

- new `discovery-steward`
- existing `enterprise-architecture`
- another existing coworker

- [ ] **Step 2: Add prompt**

Prompt requirements:

- identity: "I'm Discovery Steward." or selected role
- capabilities: triage discovery gaps, explain evidence, propose taxonomy/device recognition actions
- skills hint: standard DPF greeting language
- strict rules: no taxonomy invention without review, no external fingerprint contribution, log every decision

- [ ] **Step 3: Seed scheduled task idempotently**

Seed only after owner is resolved:

- `taskId = discovery-taxonomy-gap-triage-daily`
- `schedule = 0 8 * * *`
- `routeContext = enterprise/discovery`
- `timezone = install timezone || UTC`
- `ownerUserId = first superuser`

- [ ] **Step 4: Run seed/migration verification**

Run the repo-standard seed verification command if present. If none is documented, run a targeted TypeScript/unit test around seed helpers and state the limitation.

- [ ] **Step 5: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add prompts/specialist/discovery-taxonomy-gap-triage.prompt.md packages/db/src/seed.ts packages/db/data/agent_registry.json
git commit -s -m "feat(discovery): seed taxonomy triage coworker task"
```

---

## Chunk 4: Inventory Triage Workbench

### Task 9: Expose grouped triage data

**Files:**
- Modify: `apps/web/lib/consume/discovery-data.ts`
- Modify: `apps/web/app/(shell)/inventory/page.test.tsx`

- [ ] **Step 1: Write failing data test**

Test grouping by:

- `auto-attributed`
- `human-review`
- `needs-more-evidence`
- `taxonomy-gap`

- [ ] **Step 2: Implement `getInventoryTriageQueues()`**

Return:

```ts
{
  autoApplied: [],
  humanReview: [],
  needsMoreEvidence: [],
  taxonomyGaps: [],
  metrics: {...}
}
```

Include latest decision history per entity.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter web vitest run apps/web/app/(shell)/inventory/page.test.tsx`

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add apps/web/lib/consume/discovery-data.ts "apps/web/app/(shell)/inventory/page.test.tsx"
git commit -s -m "feat(discovery): expose triage queues"
```

### Task 10: Evolve exception queue UI into workbench

**Files:**
- Modify: `apps/web/components/inventory/InventoryExceptionQueue.tsx`
- Modify: `apps/web/components/inventory/InventoryExceptionQueue.test.tsx`
- Modify: `apps/web/app/(shell)/inventory/page.tsx`

- [ ] **Step 1: Write failing render test**

Verify:

- separate grouped sections
- identity and taxonomy confidence appear separately
- evidence summary appears
- action buttons remain stable
- no hardcoded `text-gray-*`, `bg-white`, `border-gray-*`, or inline hex colors are introduced

- [ ] **Step 2: Implement dense operational layout**

Use theme-aware classes:

- text: `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`
- background: `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]`, `bg-[var(--dpf-bg)]`
- border: `border-[var(--dpf-border)]`
- accent: `text-[var(--dpf-accent)]`, `bg-[var(--dpf-accent)]`

Avoid nested cards. Use compact rows/sections with clear scan paths.

- [ ] **Step 3: Wire actions**

Keep existing:

- accept top match
- reassign taxonomy
- dismiss

Add:

- request more evidence
- mark taxonomy gap reviewed
- accept triage recommendation

- [ ] **Step 4: Run UI tests**

Run: `pnpm --filter web vitest run apps/web/components/inventory/InventoryExceptionQueue.test.tsx apps/web/app/(shell)/inventory/page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add apps/web/components/inventory/InventoryExceptionQueue.tsx apps/web/components/inventory/InventoryExceptionQueue.test.tsx "apps/web/app/(shell)/inventory/page.tsx" "apps/web/app/(shell)/inventory/page.test.tsx"
git commit -s -m "feat(discovery): add inventory triage workbench"
```

### Task 11: Add review actions and decision history

**Files:**
- Modify: `apps/web/lib/actions/inventory.ts`
- Modify: `apps/web/lib/actions/inventory.test.ts`
- Modify: `apps/web/lib/consume/discovery-data.ts`

- [ ] **Step 1: Write failing action tests**

Cover:

- request more evidence creates `DiscoveryTriageDecision` with `outcome = "needs-more-evidence"`
- taxonomy gap creates `outcome = "taxonomy-gap"` and `requiresHumanReview = true`
- accept recommendation preserves decision history and revalidates discovery surfaces

- [ ] **Step 2: Implement server actions**

Add narrow actions rather than one overly broad mutation:

```ts
export async function requestDiscoveryEvidence(entityId: string): Promise<{ ok: boolean; error?: string }>;
export async function markTaxonomyGapForReview(entityId: string): Promise<{ ok: boolean; error?: string }>;
export async function acceptTriageRecommendation(decisionId: string): Promise<{ ok: boolean; error?: string }>;
```

- [ ] **Step 3: Run action tests**

Run: `pnpm --filter web vitest run apps/web/lib/actions/inventory.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add apps/web/lib/actions/inventory.ts apps/web/lib/actions/inventory.test.ts apps/web/lib/consume/discovery-data.ts
git commit -s -m "feat(discovery): record inventory triage review actions"
```

---

## Chunk 5: Metrics, QA, And Production Verification

### Task 12: Compute daily metrics summary

**Files:**
- Modify: `packages/db/src/discovery-triage.ts`
- Modify: `packages/db/src/discovery-triage.test.ts`
- Modify: `apps/web/lib/discovery-triage-runner.ts`

- [ ] **Step 1: Write failing metrics tests**

Cover:

- auto-rate
- escalation queue depth
- repeat-unresolved count
- taxonomy-gap proposals
- pattern reuse rate returns `0` while `appliedRuleId` is null in slice 1

- [ ] **Step 2: Implement metrics helpers**

Keep DB aggregation in the runner or a narrow adapter. Keep pure calculations in `packages/db/src/discovery-triage.ts`.

- [ ] **Step 3: Attach summary to scheduled thread**

Daily summary JSON should be emitted in the scheduled task thread and should not overload `lastError` with large JSON.

If `ScheduledAgentTask` only has `lastStatus` / `lastError`, store a compact status in the task row and the full JSON in `AgentMessage`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @dpf/db vitest run packages/db/src/discovery-triage.test.ts`

Run: `pnpm --filter web vitest run apps/web/lib/discovery-triage-runner.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add packages/db/src/discovery-triage.ts packages/db/src/discovery-triage.test.ts apps/web/lib/discovery-triage-runner.ts apps/web/lib/discovery-triage-runner.test.ts
git commit -s -m "feat(discovery): summarize triage learning metrics"
```

### Task 13: Add QA plan coverage

**Files:**
- Modify: `tests/e2e/platform-qa-plan.md`

- [ ] **Step 1: Find the inventory/platform operations phase**

Run: `Select-String -Path tests/e2e/platform-qa-plan.md -Pattern 'Inventory|Discovery|Operate|AI Coworker' -Context 2,4`

- [ ] **Step 2: Add affected test cases**

Include:

- UI path: review triage queue, inspect evidence, accept/reassign/dismiss
- coworker path: ask the discovery triage coworker why an item needs review
- incomplete information path: verify coworker asks for more evidence instead of guessing

- [ ] **Step 3: Commit**

```powershell
$branch = git branch --show-current
if ($branch -eq "main") { throw "ERROR: on main - abort" }
git add tests/e2e/platform-qa-plan.md
git commit -s -m "test(discovery): add triage QA coverage"
```

### Task 14: Final verification

**Files:**
- All touched files

- [ ] **Step 1: Run focused unit tests**

Run:

```powershell
pnpm --filter @dpf/db vitest run packages/db/src/discovery-attribution.test.ts packages/db/src/discovery-triage.test.ts
pnpm --filter web vitest run apps/web/lib/discovery-triage.test.ts apps/web/lib/discovery-triage-runner.test.ts apps/web/lib/actions/inventory.test.ts apps/web/components/inventory/InventoryExceptionQueue.test.tsx "apps/web/app/(shell)/inventory/page.test.tsx"
```

Expected: PASS or document pre-existing failures with evidence.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `pnpm --filter web exec next build`

Expected: PASS.

- [ ] **Step 4: Run browser QA**

Use the production-served app per AGENTS guidance. Verify:

- `/inventory` loads
- triage queue groups render
- existing accept/dismiss still work
- evidence expansion does not overlap or break at desktop/mobile widths
- AI coworker route context resolves for the selected owner

- [ ] **Step 5: Inspect final diff**

Run:

```powershell
git status --short
git diff --stat main...HEAD
git diff --check
```

Expected: only intended feature files plus docs/QA changes.

- [ ] **Step 6: Prepare PR**

Push branch and open PR against `main` after all gates pass.

---

## Execution Notes

- Do not edit committed migration files after commit.
- Do not use `seed.ts` to represent runtime changes. Only seed bootstrap defaults and the scheduled task definition if owner decision is resolved.
- Keep the sibling fingerprint contribution pipeline out of this PR except for the `proposedRule` JSON placeholder and explicit blocked backlog dependency.
- Preserve legacy `needs_review` until a separate enum hygiene decision is made.
- Avoid hardcoded UI colors in the workbench. The current component already has some `yellow-500` and `green-600` classes; the implementation should clean those up while touching the file.
- If `rg` fails in this Windows environment, use PowerShell `Get-ChildItem` / `Select-String`.
