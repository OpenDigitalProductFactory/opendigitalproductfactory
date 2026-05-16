# Skill Revisions and Proposals Implementation Plan (Slice 3)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slice 3 of the governed Hermes-style coworker learning loop. Coworkers can propose skill content changes via `ImprovementProposal(category="skill")`; operators can approve, reject, or roll back; approval atomically writes a `SkillRevision` row and updates `SkillDefinition.skillMdContent`; rollback restores from a prior revision without in-place mutation.

**Architecture:** Reuse `ImprovementProposal` as the proposal envelope (no parallel `SkillImprovementProposal` table). Mirror `PromptRevision` shape for `SkillRevision`. Approval and rollback run inside a Prisma transaction so the row and the content move together. A seed-parity helper surfaces drift between the DB and `skills/<category>/<name>.skill.md` so an approved change documents the expectation to patch the seed.

**Tech Stack:** TypeScript, Next.js 16 App Router, React, Prisma 7, PostgreSQL, Vitest, pnpm workspaces.

---

## Scope

This plan implements Slice 3 from `docs/superpowers/specs/2026-05-15-governed-hermes-learning-loop-design.md`.

In scope:

- `SkillRevision` model (mirrors `PromptRevision` shape).
- `ImprovementProposal.targetSkillId` column (nullable) + `skill` value added to the category enum at the application layer.
- Server actions: `submitSkillImprovementProposal`, `approveSkillImprovementProposal`, `rejectSkillImprovementProposal`, `rollbackSkillToRevision`.
- MCP tool `propose_skill_improvement` (coworker-callable) — extends, does not replace, `propose_improvement`.
- Seed-vs-runtime drift helper: `getSkillSeedDrift(skillId)` reads the matching `skills/<category>/<name>.skill.md` and compares its body against the DB row.
- UI on `/platform/ai/skills/[skillId]` detail panel (or skills observatory if no detail route exists yet): pending proposals list, diff preview, approve/reject/rollback controls, revision history. Theme-token compliant per AGENTS.md §12.

Out of scope:

- Curator lifecycle states (`lifecycleState`, pinned/stale/archive/quarantined). That is Slice 4.
- Evidence / session search. Slice 5.
- Evolution Lab. Slice 6.
- External skill import. Slice 7.
- Other proposal categories from the spec (`prompt | memory | tool | convention | code | other`). Slice 3 only adds `skill`; others land when their consumer arrives.

## Preconditions

- Worktree base: `feat/skill-revisions-and-proposals` off `origin/main` after #629 merged.
- `SkillDefinition` already has `skillMdContent` (live since the catalog landed).
- `ImprovementProposal` already carries `category` (free-form String today; constrained at the application layer); we add `skill` to that constraint and add a nullable `targetSkillId` column.
- Seed source files live at `skills/<category>/<name>.skill.md`. The seed loader reads them on fresh install.

## File Structure

### New files

| File | Responsibility |
| --- | --- |
| `packages/db/prisma/migrations/<timestamp>_skill_revisions_and_proposals/migration.sql` | Adds `SkillRevision`, `ImprovementProposal.targetSkillId`. |
| `apps/web/lib/skills/proposals.ts` | submit / approve / reject / rollback server actions. |
| `apps/web/lib/skills/proposals.test.ts` | Unit tests for all four actions including transaction atomicity. |
| `apps/web/lib/skills/seed-parity.ts` | Drift detection between DB and `skills/<category>/<name>.skill.md`. |
| `apps/web/lib/skills/seed-parity.test.ts` | Drift detection tests. |
| `apps/web/components/platform/SkillProposalsPanel.tsx` | List pending proposals for a skill, render diff, approve/reject/rollback controls. |
| `apps/web/components/platform/SkillRevisionHistoryPanel.tsx` | Revision timeline + rollback action. |
| `apps/web/components/platform/SkillProposalsPanel.test.tsx` | UI rendering tests. |
| `apps/web/components/platform/SkillRevisionHistoryPanel.test.tsx` | UI rendering tests. |

### Modified files

| File | Change |
| --- | --- |
| `packages/db/prisma/schema.prisma` | Add `SkillRevision`, `ImprovementProposal.targetSkillId`, `SkillDefinition.revisions` relation. |
| `apps/web/lib/mcp-tools.ts` | Add `propose_skill_improvement` tool + handler. Extend `propose_improvement` category enum so the existing tool also accepts `skill`. |
| `apps/web/lib/skills/runtime.ts` | Read latest revision when needed (read path stays on `SkillDefinition.skillMdContent`; this is for revision history). |
| `apps/web/app/(shell)/platform/ai/skills/page.tsx` | Wire panels into the existing observatory page. |
| `apps/web/lib/actions/skills-observatory.ts` | `getSkillProposalsAndRevisions(skillId)` data fetcher. |

## Chunk 1: Schema

### Task 1: Add SkillRevision + ImprovementProposal.targetSkillId

- [ ] **Step 1: Schema fields**

`SkillRevision`:

```prisma
model SkillRevision {
  id           String   @id @default(cuid())
  revisionId   String   @unique
  skillId      String   // SkillDefinition.skillId (business id)
  version      Int
  content      String   // snapshot of skillMdContent at this version
  metadata     Json?
  changeReason String?
  changedBy    String?
  proposalId   String?  // ImprovementProposal.proposalId when approved via proposal
  createdAt    DateTime @default(now())

  skill SkillDefinition @relation(fields: [skillId], references: [skillId], onDelete: Cascade)

  @@unique([skillId, version])
  @@index([skillId, createdAt(sort: Desc)])
  @@index([proposalId])
}
```

`SkillDefinition`:

```prisma
  revisions SkillRevision[]
```

`ImprovementProposal`:

```prisma
  targetSkillId String?
  @@index([targetSkillId])
```

- [ ] **Step 2: Migration + Prisma generate.**
- [ ] **Step 3: Commit.**

## Chunk 2: Server actions

### Task 2: submitSkillImprovementProposal

- [ ] Accepts `{ skillId, proposedContent, severity, agentId, threadId?, observedFriction?, conversationExcerpt?, evidenceJson? }`.
- [ ] Resolves current `SkillDefinition.skillMdContent` into `description` (via diff summary) or stores proposed content in `conversationExcerpt` until a richer payload is justified.
- [ ] Writes `ImprovementProposal(category="skill", status="proposed", targetSkillId, submittedById=agent user identity, agentId)`.
- [ ] Returns `{ proposalId }`.

### Task 3: approveSkillImprovementProposal (atomic)

- [ ] Prisma transaction:
  1. Load proposal (must be `status="proposed"` and `category="skill"` and `targetSkillId` set).
  2. Load skill, current latest version.
  3. Snapshot current `skillMdContent` into a new `SkillRevision(version=N+1, changeReason="pre-approval snapshot")`.
  4. Apply the proposed content: a second `SkillRevision(version=N+2, proposalId, content=proposedContent, changeReason)` AND `SkillDefinition.skillMdContent` update.
  5. Mark proposal `status="reviewed"`, `reviewedById`, `reviewedAt=now`, `verifiedAt=now`.
- [ ] All five steps in one transaction so partial state cannot persist.

### Task 4: rejectSkillImprovementProposal

- [ ] Mark proposal `status="rejected"`, `reviewedById`, `reviewedAt`, `rejectionReason`. No revision created.

### Task 5: rollbackSkillToRevision

- [ ] Prisma transaction:
  1. Load target revision (`{ skillId, version }`).
  2. Write a new `SkillRevision(version=latest+1, content=target.content, changeReason="rollback to v<target.version>")`.
  3. Update `SkillDefinition.skillMdContent = target.content`.

## Chunk 3: Seed parity + MCP tool

### Task 6: Seed parity helper

- [ ] `getSkillSeedDrift(skillId)` reads `skills/<category>/<name>.skill.md` (path derived from `SkillDefinition.category` + `skillId`), normalizes line endings, and returns `{ inSync: boolean, dbBody: string, seedBody: string | null }`.
- [ ] Test: when DB matches seed → `inSync: true`; when DB drifted → `inSync: false`; when seed missing → `seedBody: null, inSync: false`.

### Task 7: MCP tool propose_skill_improvement

- [ ] Add to `apps/web/lib/mcp-tools.ts` registry next to `propose_improvement`.
- [ ] Input: `{ skillId, proposedContent, severity, observedFriction?, conversationExcerpt? }`.
- [ ] Handler calls `submitSkillImprovementProposal`.
- [ ] `requiredCapability: null` (anyone can submit, mirrors `propose_improvement`).
- [ ] `executionMode: "proposal"` so the human approval path engages.
- [ ] Also extend the `propose_improvement` `category` enum to include `skill` so calls that pick the generic tool with `category=skill` are routed through the same write path.

## Chunk 4: UI

### Task 8: SkillProposalsPanel

- [ ] Fetch pending proposals via `getSkillProposalsAndRevisions(skillId)`.
- [ ] Render: list of pending proposals with diff preview (current vs proposed), evidence, agent, submittedAt.
- [ ] Buttons: approve, reject, link-to-backlog (existing tool).
- [ ] Theme tokens only (AGENTS.md §12).

### Task 9: SkillRevisionHistoryPanel

- [ ] Render: revisions reverse-chronological with `{ version, changedBy, changeReason, createdAt }`.
- [ ] Per row: "Roll back to this version" button → confirm → call `rollbackSkillToRevision`.

### Task 10: Wire into /platform/ai/skills page

- [ ] When a skill is selected (existing observatory has detail expand), show the two panels stacked under the existing skill detail.
- [ ] Show a seed-drift badge on the skill row when `getSkillSeedDrift(skillId).inSync === false`. Caption: "Skill differs from seed — `skills/<category>/<name>.skill.md` needs update to survive fresh install."

## Chunk 5: Verification + delivery

### Task 11: Verification

- [ ] `pnpm --filter web typecheck` clean.
- [ ] Focused vitest sweep: `lib/skills/proposals.test.ts lib/skills/seed-parity.test.ts components/platform/SkillProposalsPanel.test.tsx components/platform/SkillRevisionHistoryPanel.test.tsx`.
- [ ] Full vitest run — must stay green.
- [ ] `pnpm --filter web exec next build` clean.

### Task 12: PR

- [ ] PR-overlap sweep against `apps/web/lib/skills/*`, `apps/web/lib/actions/skills-observatory.ts`, `apps/web/components/platform/*`, `apps/web/lib/mcp-tools.ts`, `packages/db/prisma/schema.prisma`.
- [ ] Push + open draft PR with summary, test plan, migration note, DCO note.

## Rollback Plan

If approve/rollback produces incorrect skill content:

1. Roll back via `rollbackSkillToRevision` to the latest non-affected `SkillRevision`. (The mechanism is self-rollback aware — every action writes a new immutable revision.)
2. Disable the MCP tool by removing it from `getAvailableTools` if a bug allows malformed proposals through.
3. If schema must be reverted, drop `SkillRevision` and remove `targetSkillId` — both are additive, no backfill needed.

## Definition Of Done

- A `propose_skill_improvement` MCP call by an authenticated coworker produces an `ImprovementProposal(category="skill", targetSkillId=…)` row.
- Approve writes a `SkillRevision(version=N+2)`, snapshot `SkillRevision(version=N+1)`, updates `SkillDefinition.skillMdContent`, and marks the proposal reviewed/verified — all in one transaction.
- Reject marks proposal `rejected` with `rejectionReason`; no revision created.
- Rollback writes a new `SkillRevision` with the older content and updates `SkillDefinition.skillMdContent`. The DB never mutates in-place.
- `getSkillSeedDrift` returns `inSync: false` when the DB has diverged from the seed file, surfaced in UI.
- Vitest covers atomicity (failure during approve never leaves partial state), rollback, drift detection, and rejection.
- Full vitest stays green; typecheck and `next build` clean.
- PR has no overlap with concurrent open PRs; DCO green before flipping out of draft.
