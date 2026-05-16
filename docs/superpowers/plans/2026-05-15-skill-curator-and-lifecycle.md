# Skill Curator and Lifecycle Implementation Plan (Slice 4)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slice 4 of the governed Hermes-style coworker learning loop. Add `SkillDefinition.lifecycleState` as a separate operational-health axis from the existing adoption-stage `status`; introduce a governed curator that classifies skills into `active | stale | pinned | quarantined | archived`, emits `ImprovementSignal` rows and a `TaskArtifact(metadata.kind="curator-report")` per run, and **never mutates `SkillDefinition.skillMdContent`**. Pin/quarantine controls live on `/platform/ai/skills?skill=<id>`; a pinned skill cannot be archived by the curator (invariant test).

**Architecture decisions.**

- `lifecycleState` is a new column, not a repurposing of `status`. The current `status` enum (`discovered | evaluated | approved | installed | active | deprecated`) describes adoption stage. Lifecycle describes operational health. Both axes are typed enums; the curator only writes `lifecycleState`.
- The curator emits `ImprovementSignal` rows (Slice 1+2 substrate) and a `TaskArtifact` summary; it does not auto-create `ImprovementProposal` rows. Content proposals come from coworker self-reflection (Slice 2) or operator action (Slice 3). This keeps the curator's job clear: identify candidates, surface them, let humans act.
- Pin protection is enforced inside the curator: `pinned` skills cannot transition to `archived` regardless of metrics. A dedicated vitest case asserts this.
- The curator never mutates `skillMdContent` and never deletes a `SkillDefinition`. The strongest action it can take on its own is flipping `lifecycleState` to `archived` (which is reversible) — and even that respects the pin guard.

**Tech Stack:** TypeScript, Next.js 16 App Router, React, Prisma 7, PostgreSQL, Vitest, Inngest crons, pnpm workspaces.

---

## Scope

Implements Slice 4 from `docs/superpowers/specs/2026-05-15-governed-hermes-learning-loop-design.md`.

In scope:

- `SkillDefinition.lifecycleState` column (default `active`) + typed enum + DB-level CHECK constraint via Prisma enum.
- `apps/web/lib/skills/lifecycle.ts` — typed enum constants and `classifySkillLifecycle(skill, metrics, usage)` helper.
- `apps/web/lib/skills/curator.ts` — `runSkillCurator()` that iterates every skill, classifies, emits one `ImprovementSignal` per non-trivial finding, persists a `TaskArtifact(metadata.kind="curator-report")` summary, and updates `lifecycleState` (with pin protection).
- Inngest cron `0 7 * * *` UTC (after the metrics aggregator at 0 5) so the curator sees fresh metrics.
- Server actions `pinSkillAction(skillId)`, `quarantineSkillAction(skillId)`, `unpinSkillAction(skillId)`, `runSkillCuratorAction()` for the admin UI.
- UI on `/platform/ai/skills`: lifecycle badge on each row in the executions/skills views; a Curator tab in the Observatory panel showing the latest report and recent findings; pin/quarantine/run-curator controls in the skill detail panel.
- Vitest covers: classification, pin protection invariant, no content mutation, signal emission, report shape, end-to-end curator run.

Out of scope:

- Evidence / session search — Slice 5.
- Evolution lab — Slice 6.
- External skill import — Slice 7.
- UX consolidation across surfaces — Slice 8.
- Auto-creating `ImprovementProposal` from curator findings — defer until Slice 3 lands and human review proves needed; for now the curator emits signals only.

## Preconditions

- Worktree base: `feat/skill-curator-and-lifecycle` off `origin/main` after the most-recent merge.
- `SkillDefinition` already has the Slice 1+2 surface (`skillMdContent`, `usageEvents` relation, `metrics` relation).
- `ImprovementSignal` already lands via the Slice 1 schema and the curator just calls `createOrTouchImprovementSignal` to emit findings.
- `TaskArtifact` model already supports `metadata` Json bag.

## File Structure

### New files

| File | Responsibility |
| --- | --- |
| `packages/db/prisma/migrations/<timestamp>_skill_lifecycle_state/migration.sql` | Add `lifecycleState` column with default `'active'`. |
| `apps/web/lib/skills/lifecycle.ts` | `SKILL_LIFECYCLE_STATES` enum, type, classify helper. |
| `apps/web/lib/skills/lifecycle.test.ts` | Classifier tests. |
| `apps/web/lib/skills/curator.ts` | `runSkillCurator()` + private helpers. |
| `apps/web/lib/skills/curator.test.ts` | Curator tests including pin invariant. |
| `apps/web/lib/queue/functions/skill-curator.ts` | Inngest cron. |
| `apps/web/lib/actions/skill-curator-actions.ts` | Server-action surface for pin/quarantine/unpin/run-now. |
| `apps/web/components/platform/SkillCuratorReportPanel.tsx` | Latest curator report viewer. |
| `apps/web/components/platform/SkillCuratorReportPanel.test.tsx` | UI render tests. |
| `apps/web/components/platform/SkillLifecycleControls.tsx` | Pin / quarantine / unpin buttons in the skill detail panel. |
| `apps/web/components/platform/SkillLifecycleControls.test.tsx` | UI render tests. |

### Modified files

| File | Change |
| --- | --- |
| `packages/db/prisma/schema.prisma` | Add `lifecycleState` column on `SkillDefinition`. |
| `apps/web/lib/queue/functions/index.ts` | Register the curator cron. |
| `apps/web/lib/actions/skills-observatory.ts` | Surface `lifecycleState` on `SkillEntry`-like shapes; new `getLatestCuratorReport()` fetcher. |
| `apps/web/components/platform/SkillsObservatoryPanel.tsx` | Add Curator tab + lifecycle badge column on executions. |
| `apps/web/app/(shell)/platform/ai/skills/page.tsx` | Mount the curator panel + lifecycle controls in the per-skill review section. |
| `apps/web/lib/mcp-tools.ts` | (Optional) only if the curator surface needs an MCP action — skip if not. |

## Chunk 1: Schema + types

### Task 1: lifecycleState column + typed enum

- [ ] `SkillDefinition.lifecycleState`: `String @default("active")` (Postgres TEXT, application-layer typed enum).
- [ ] Index `@@index([lifecycleState])` for the "show me all stale" query.
- [ ] Migration ADD COLUMN ... DEFAULT 'active' NOT NULL.
- [ ] `apps/web/lib/skills/lifecycle.ts`:

```typescript
export const SKILL_LIFECYCLE_STATES = ["active", "stale", "pinned", "quarantined", "archived"] as const;
export type SkillLifecycleState = (typeof SKILL_LIFECYCLE_STATES)[number];
```

- [ ] Classify helper:

```typescript
export type ClassifyInput = {
  current: SkillLifecycleState;       // never overridden if pinned/quarantined (caller decides)
  usage30d: { invoked: number; failed: number };
  assignmentCount: number;
  lastUsedAt: Date | null;
  hasContent: boolean;
};

export function classifySkillLifecycle(input: ClassifyInput): {
  next: SkillLifecycleState;
  reason: string;
} {
  // pinned / quarantined are sticky — curator never moves a skill out of them
  if (input.current === "pinned" || input.current === "quarantined") {
    return { next: input.current, reason: "operator-set state preserved" };
  }
  if (!input.hasContent || input.assignmentCount === 0 && input.usage30d.invoked === 0) {
    return { next: "archived", reason: "unused with no assignments" };
  }
  // 0 invocations in 30d but assignments exist → stale, not archived (recoverable)
  if (input.usage30d.invoked === 0) return { next: "stale", reason: "no use in 30 days" };
  // Otherwise active
  return { next: "active", reason: "in use" };
}
```

- [ ] Commit.

## Chunk 2: Curator service

### Task 2: runSkillCurator

- [ ] Reads every `SkillDefinition`, gathers metrics from `SkillMetric` (current period) + `SkillUsageEvent` (last 30 days), gathers assignment counts.
- [ ] Per skill: call `classifySkillLifecycle`, compute desired `lifecycleState`.
- [ ] **Pin protection**: if `current === "pinned"`, the result never becomes `archived` or anything else — curator never moves a pinned skill. Same for `quarantined`. The classifier already returns the current state for these inputs; the test asserts the invariant end-to-end (cannot bypass).
- [ ] **No content mutation**: curator updates `lifecycleState` only. Never touches `skillMdContent`, `description`, etc. Verified by test (mock prisma rejects any update outside the whitelisted fields).
- [ ] For each non-`active` skill, emit one `ImprovementSignal(sourceType="curator-finding", sourceId=<skillId>:<reason-slug>)` so dedupe means re-runs don't multiply signals.
- [ ] Persist a single `TaskArtifact` for the run with `metadata.kind="curator-report"`, body containing `{ scannedAt, totals: { active, stale, pinned, quarantined, archived }, findings: [{ skillId, fromState, toState, reason }] }`.
- [ ] Return the report.

### Task 3: Inngest cron

- [ ] `apps/web/lib/queue/functions/skill-curator.ts`: cron `0 7 * * *` UTC.
- [ ] Register in `apps/web/lib/queue/functions/index.ts`.
- [ ] Log `[skill-curator]` prefix.

### Task 4: Server actions

- [ ] `runSkillCuratorAction()` — admin-only (`manage_capabilities`); wraps `runSkillCurator()`.
- [ ] `pinSkillAction(skillId)`, `unpinSkillAction(skillId)`, `quarantineSkillAction(skillId)` — admin-only; update `lifecycleState` directly. These are explicit operator actions, not curator output.

## Chunk 3: UI

### Task 5: SkillCuratorReportPanel

- [ ] Fetch latest `TaskArtifact(metadata.kind="curator-report")`.
- [ ] Show: scan time, totals row, findings table (skillId · fromState → toState · reason).
- [ ] Empty state when no curator has ever run.

### Task 6: SkillLifecycleControls

- [ ] In the existing per-skill review section: pin / unpin / quarantine buttons.
- [ ] "Run curator now" button → `runSkillCuratorAction()`.

### Task 7: Lifecycle badge

- [ ] In `SkillsObservatoryPanel`'s executions tab, render a small badge per row (only when `lifecycleState !== "active"`). Theme tokens only.

## Chunk 4: Verification + delivery

### Task 8: Verification

- [ ] Focused vitest sweep: `lib/skills/lifecycle.test.ts`, `lib/skills/curator.test.ts`, two new UI tests.
- [ ] Full vitest stays green.
- [ ] `pnpm --filter web typecheck` clean.
- [ ] `pnpm --filter web exec next build` clean.

### Task 9: PR

- [ ] Overlap sweep on `apps/web/lib/skills/*`, `apps/web/lib/actions/skills-observatory.ts`, `apps/web/components/platform/*`, `apps/web/lib/queue/functions/index.ts`, `packages/db/prisma/schema.prisma`.
- [ ] Push + draft PR with summary, test plan, migration note, DCO note.

## Rollback Plan

If the curator mis-classifies or signal volume spikes:

1. Remove the cron entry from `apps/web/lib/queue/functions/index.ts` and redeploy — the function won't run.
2. To revert a skill that was archived, the operator clicks "Pin" or directly toggles `lifecycleState` back to `active` via the admin action.
3. The `lifecycleState` column is additive; no schema rollback needed.

## Definition Of Done

- `SkillDefinition.lifecycleState` column lives with a default value and a typed enum at the application layer; existing rows default to `active`.
- `runSkillCurator()` emits `ImprovementSignal` rows for non-`active` skills and writes one `TaskArtifact(metadata.kind="curator-report")` per run.
- A pinned skill cannot be archived by the curator (vitest invariant).
- The curator never mutates `skillMdContent` (vitest asserts the prisma update payload is restricted).
- `/platform/ai/skills` shows the latest curator report and per-skill lifecycle controls.
- Full vitest stays green; typecheck and `next build` clean.
- PR has no overlap with concurrent open PRs; DCO green before flipping out of draft.
