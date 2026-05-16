# Business OS Readiness Audit Design

| Field | Value |
|-------|-------|
| Status | Draft for review |
| Date | 2026-05-15 |
| Scope | Workspace command-center follow-on slice: score six-C readiness over time, emit governed write actions when gaps recur |
| Primary surface | New panel on `/workspace` (collapsed below the matrix) + Inngest scheduled audit job |
| Parent spec | [Business OS Command Center (2026-05-15)](2026-05-15-business-os-command-center-design.md) — this implements §"Follow-On Slices" item 1 |
| Related specs | [TAK/GAID refresh (2026-04-25)](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md), [A2A-aligned coworker runtime (2026-04-23)](2026-04-23-a2a-aligned-coworker-runtime-design.md) |
| Implementation plan | _Pending — write after spec review_ |
| Backlog alignment | First slice under new `EP-WORKSPACE-*` Business OS epic (epic to be created before plan lands) |

## Contents

1. [Purpose](#purpose)
2. [Scope](#scope)
3. [Current Substrate](#current-substrate)
4. [Audit Model](#audit-model)
5. [Per-Domain Audit Rules](#per-domain-audit-rules)
6. [Recurrence Detection Without New Schema](#recurrence-detection-without-new-schema)
7. [Write Paths](#write-paths)
8. [UI Surface](#ui-surface)
9. [First Implementation Slice](#first-implementation-slice)
10. [Acceptance Criteria](#acceptance-criteria)
11. [Follow-On Slices](#follow-on-slices)
12. [Out Of Scope](#out-of-scope) and [Deferred](#deferred)
13. [Risks](#risks)
14. [Recommended Next Step](#recommended-next-step)
15. [Glossary](#glossary)

## Purpose

The command center renders point-in-time six-C readiness for six domains. An operator scanning `/workspace` can see that "Finance" or "AI workforce" is `attention` or `blocked` right now. What they cannot see is whether a cell has been `attention` for one render or for three weeks. Recurrence is the signal that distinguishes a transient blip from a structural gap the business should invest in fixing.

The Readiness Audit slice closes that loop. It scores the same six-C cells on a schedule, detects recurrence, and emits a governed write action — a `CoworkerCapabilityNeed`, an `AgentActionProposal`, or a `BacklogItem` — when a gap crosses a threshold. The audit is the first surface where the command center moves from passive observation to governed action.

This spec defines what the audit reads, the per-domain rules that promote a cell into a tracked gap, the recurrence-detection discipline (without growing schema in V1), the write paths and their approval gates, and the operator surface.

## Scope

In scope:

- Read-side: a server helper that runs the existing `loadWorkspaceCommandCenter` projection, scores per-domain readiness, and reasons about recurrence over a rolling time window.
- Write-side: governed actions emitted through *existing* substrates — `CoworkerCapabilityNeed` (when the gap is a coworker skill/grant gap), `AgentActionProposal` (when the gap calls for a side-effect action that needs human approval), `BacklogItem` (when the gap is a durable platform investment).
- Operator surface: a new panel on `/workspace` showing tracked gaps, current state per gap, age, last action, and link to the source domain.
- A scheduled audit job (Inngest cron) that runs the audit on a cadence, persists snapshots minimally, and gates the recurrence threshold.

Out of scope:

- A new readiness-history table in V1. Recurrence detection runs against `ToolExecution` audit-rows and the existing `CoworkerCapabilityNeed` history; if a richer history substrate is needed it lands in a later slice with measurement justification.
- Changing the command-center matrix render. The matrix continues to show point-in-time state; the audit panel sits below it.
- New write paths beyond the three named above.
- Public-facing reporting. The audit surface is operator-facing.

## Current Substrate

The audit's read inputs already exist:

| Surface | File | Purpose |
|---------|------|---------|
| Command-center loader | [apps/web/lib/workspace/command-center.ts:236](../../../apps/web/lib/workspace/command-center.ts#L236) | Returns `WorkspaceCommandCenterSummary` with per-domain readiness cells |
| Readiness cell derivation | [apps/web/lib/workspace/command-center.ts:178](../../../apps/web/lib/workspace/command-center.ts#L178) | Pure `deriveReadinessCell(key, input)` for six-C |
| Readiness matrix builder | [apps/web/lib/workspace/command-center.ts:528](../../../apps/web/lib/workspace/command-center.ts#L528) | Six domains, six cells each — the audit reuses this |
| Coworker capability need | [packages/db/prisma/schema.prisma:1748](../../../packages/db/prisma/schema.prisma#L1748) | `CoworkerCapabilityNeed` with `kind`, `severity`, `status`, `linkedBacklogItemId`, `duplicateOfId` |
| Action proposal | [packages/db/prisma/schema.prisma:3234](../../../packages/db/prisma/schema.prisma#L3234) | `AgentActionProposal` with `actionType`, `parameters`, `status`, decision lifecycle |
| MCP tool surface | [apps/web/lib/mcp-tools.ts:2747](../../../apps/web/lib/mcp-tools.ts#L2747) | `submit_coworker_capability_need` already exists with proposal-mode gating |

The audit does not introduce a new read path. It composes existing ones.

## Audit Model

The audit answers three questions per (domain, six-C cell) pair:

1. **Current state.** Reuses `deriveReadinessCell`. No new logic.
2. **Recurrence.** Has this cell been in `attention` or `blocked` for at least N of the last M scheduled audits? Below.
3. **Write decision.** Given the cell, the state, and the recurrence, which write path (if any) is appropriate? Below.

The audit runs on a fixed cadence (default: every 6 hours via Inngest). Each run produces an *audit verdict* per (domain, cell):

| Verdict | Meaning | Write action |
|---------|---------|--------------|
| `clear` | Cell is `good`, or `unknown` with no prior history | None |
| `noted` | Cell is `attention`/`blocked` on this run, no prior streak | None — wait for recurrence |
| `escalate-coworker` | Recurrence threshold met and the gap is a coworker capability gap | `submit_coworker_capability_need` (proposal-mode) |
| `escalate-action` | Recurrence threshold met and the gap calls for a specific side-effect action | `AgentActionProposal` for the action |
| `escalate-platform` | Recurrence threshold met and the gap is a durable platform investment | `BacklogItem` created in `triage` lane |
| `suppressed` | Recurrence threshold met but an open need/proposal/backlog already references this gap | None — link to the existing record |

The `suppressed` verdict is essential. Without it, every scheduled run would emit a fresh write for the same gap, drowning the operator in duplicates.

## Per-Domain Audit Rules

Each domain has its own rule table. The rule names which cell, when in `attention` or `blocked`, classifies into which write path. Cells not listed below produce only `noted` verdicts and never auto-escalate — they require operator judgment first.

**AI workforce** ([command-center.ts:532](../../../apps/web/lib/workspace/command-center.ts#L532))

| Cell | If state is | Classify as | Reason |
|------|-------------|-------------|--------|
| `capabilities` | `blocked` | `escalate-coworker` | No active agent — needs `CoworkerCapabilityNeed { kind: "registry", severity: "high" }` |
| `connections` | `attention`/`blocked` | `escalate-platform` | No active provider or broken provider link — durable platform issue |
| `containment` | `blocked` | `escalate-action` | Side-effect-capable agent with no approval path — emit proposal to set HITL tier |
| `confidence` | `attention` | `noted` only | Stale receipts may resolve naturally; do not auto-escalate |

**Finance** ([command-center.ts:550](../../../apps/web/lib/workspace/command-center.ts#L550))

| Cell | If state is | Classify as | Reason |
|------|-------------|-------------|--------|
| `cadence` | `attention` | `escalate-action` | Overdue invoices/bills exist — emit proposal for collections review |
| `containment` | `blocked` | `escalate-platform` | Overdue threshold breached — backlog item for process review |

**Compliance** ([command-center.ts:557](../../../apps/web/lib/workspace/command-center.ts#L557))

| Cell | If state is | Classify as | Reason |
|------|-------------|-------------|--------|
| `cadence` | `attention` | `escalate-action` | Overdue compliance actions — emit proposal to remediation owner |
| `containment` | `blocked` | `escalate-platform` | Open incident or no implemented controls — durable investment |

**Customers and delivery** ([command-center.ts:543](../../../apps/web/lib/workspace/command-center.ts#L543))

| Cell | If state is | Classify as | Reason |
|------|-------------|-------------|--------|
| `context` | `attention` | `noted` only | No customers or no builds is often a starting-state, not a gap |
| `capabilities` | `blocked` | `escalate-platform` | No active actor — durable hiring/agent-provisioning issue |

**People** ([command-center.ts:564](../../../apps/web/lib/workspace/command-center.ts#L564))

| Cell | If state is | Classify as | Reason |
|------|-------------|-------------|--------|
| `capabilities` | `blocked` | `escalate-platform` | No active employees — durable issue |
| `containment` | `blocked` | `escalate-platform` | No users — durable issue |

**Platform delivery** ([command-center.ts:571](../../../apps/web/lib/workspace/command-center.ts#L571))

| Cell | If state is | Classify as | Reason |
|------|-------------|-------------|--------|
| `containment` | `attention`/`blocked` | `escalate-action` | Recent tool-execution failures — emit proposal for triage |
| `cadence` | `attention` | `noted` only | Backlog ebb and flow; do not escalate |

The rule set is intentionally conservative. **Default to `noted`. Escalation should be the exception, not the norm.** Adding a new escalation rule should require justification that the prior `noted` cycles produced operator action and the audit can safely automate the same step.

## Recurrence Detection Without New Schema

V1 must not add a `WorkspaceReadinessSnapshot` table. The recurrence signal is reconstructable from existing rows:

- **For `escalate-coworker`**: query `CoworkerCapabilityNeed` for any row with `status` ∈ `{submitted, in-review}` whose `evidenceJson.sourceCell` matches the current (domain, cell). If found, recurrence is already tracked downstream — suppress new emission.
- **For `escalate-action`**: query `AgentActionProposal` for `status="proposed"` whose `parameters.sourceCell` matches. Same suppression.
- **For `escalate-platform`**: query `BacklogItem` for `status` ∈ `{triage, open}` whose `metadata.sourceCell` matches. Same suppression.

The audit's own state lives in a minimal table:

```prisma
model WorkspaceReadinessAuditRun {
  id          String   @id @default(cuid())
  runId       String   @unique
  startedAt   DateTime @default(now())
  finishedAt  DateTime?
  verdictJson Json     // Array<{ domain, cell, state, verdict, writeRef? }>
  durationMs  Int?
  errorJson   Json?

  @@index([startedAt])
}
```

One row per scheduled run. `verdictJson` is a small array (≤ 36 entries for 6 domains × 6 cells). With a 6-hour cadence and a 30-day retention, the table holds ≤ 120 rows. This is enough to answer "has this cell been `attention` for 3 of the last 5 runs?" without growing the schema further.

The recurrence threshold is config:

```ts
const RECURRENCE_WINDOW_RUNS = 5;
const RECURRENCE_THRESHOLD = 3;
```

`3 of last 5` (≈ 18 hours of degradation at 6h cadence) is a reasonable default. Tunable as the audit gathers data.

## Write Paths

All three write paths go through governed substrates that already enforce approval and audit:

**`escalate-coworker` → `submit_coworker_capability_need`.** The audit calls the existing MCP tool ([apps/web/lib/mcp-tools.ts:2747](../../../apps/web/lib/mcp-tools.ts#L2747)). The tool's `executionMode` is `proposal` — the need is created in `submitted` status and reviewed by an operator. The `evidenceJson` field carries `{ sourceCell, domain, recurrenceStreak, lastAuditRunId }`.

**`escalate-action` → `AgentActionProposal`.** The audit creates a proposal with `actionType="workspace_readiness_remediation"` and `parameters` describing the suggested side-effect action (e.g., "set HITL tier to 2 on agent X"). The proposal sits in `proposed` status until an operator approves it through the existing proposal UI.

**`escalate-platform` → `BacklogItem`.** A new backlog row is created in the `triage` lane with `kind="readiness-gap"` and `metadata.sourceCell` set. The audit does not assign or prioritize; it surfaces the gap for the normal backlog triage flow.

Three rules govern the write paths:

1. **The audit MUST NOT execute side effects directly.** Every write goes to a proposal/need/backlog row awaiting human decision. The audit is detection, not enforcement.
2. **Every write carries `sourceCell` metadata** so the next audit run can detect the open record and suppress duplicates.
3. **Writes are emitted through the audit agent's own GAID/principal** — not through the operator's session. The audit acts as itself, with a defined HITL tier and grant set. Per [TAK/GAID spec §5.1](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md).

## UI Surface

A new panel on `/workspace`, rendered after the existing six-C readiness matrix:

```
┌──────────────────────────────────────────────────────────────────┐
│ Tracked Readiness Gaps                            Last audit: 2h │
├──────────────────────────────────────────────────────────────────┤
│ AI workforce → capabilities                  attention · 2 of 5  │
│   Open: CoworkerCapabilityNeed CN-...        submitted 18h ago   │
│ Finance → cadence                            blocked · 4 of 5    │
│   Open: AgentActionProposal AP-...           proposed 6h ago     │
│ Platform delivery → containment              attention · 3 of 5  │
│   Open: BacklogItem BI-...                   triage 12h ago      │
└──────────────────────────────────────────────────────────────────┘
```

Each row links to the open record. No new top-level route. The panel is collapsed by default if there are no tracked gaps.

Audit run history is admin-only and lives at `/platform/audit/readiness` — out of scope for this slice.

## First Implementation Slice

**Goal:** ship the scheduled audit, the minimal `WorkspaceReadinessAuditRun` table, the three write paths through existing substrates, and the workspace panel.

Files likely touched:

- `apps/web/lib/workspace/readiness-audit.ts` (new) — audit run logic, pure derivation helpers
- `apps/web/lib/workspace/readiness-audit.test.ts` (new)
- `apps/web/inngest/functions/workspace-readiness-audit.ts` (new) — scheduled trigger
- `apps/web/components/workspace/ReadinessGapPanel.tsx` (new)
- `apps/web/components/workspace/ReadinessGapPanel.test.tsx` (new)
- `apps/web/app/(shell)/workspace/page.tsx` (modify — add panel below matrix)
- `packages/db/prisma/schema.prisma` (modify — add `WorkspaceReadinessAuditRun` model)
- One migration in `packages/db/prisma/migrations/`

Refactoring budget:

- The recurrence-detection helpers MUST be pure (testable without Inngest or Prisma).
- The write-path emitters MUST use existing MCP tools / proposal helpers, not raw DB writes.
- The audit run itself can be invoked from CLI for first-run testing (`pnpm --filter web run audit:readiness`) before the Inngest schedule lands.

## Acceptance Criteria

Each criterion is a falsifiable check at landing time.

- [ ] `WorkspaceReadinessAuditRun` model and migration land cleanly; rollback documented
- [ ] Audit job runs on a 6-hour Inngest schedule and persists exactly one row per run
- [ ] Recurrence detection passes a test that simulates 5 prior runs and asserts the correct verdict for `3 of last 5`, `2 of last 5`, and `0 of last 5` cases
- [ ] All three write paths land:
  - [ ] `submit_coworker_capability_need` invocation observed in `ToolExecution` audit; `CoworkerCapabilityNeed` row created with `evidenceJson.sourceCell` populated
  - [ ] `AgentActionProposal` row created with `actionType="workspace_readiness_remediation"` and `parameters.sourceCell` populated
  - [ ] `BacklogItem` row created with `kind="readiness-gap"` and `metadata.sourceCell` populated
- [ ] Suppression test: a second run with the same gap and an open downstream record creates **zero** new writes
- [ ] `ReadinessGapPanel` renders on `/workspace` with at least one open gap; renders empty-state cleanly with zero gaps
- [ ] All audit writes carry the audit agent's GAID/principal — not the session user's — verifiable via `ToolExecution.actingPrincipalId`
- [ ] Audit never executes side-effect actions directly; every write goes to a proposal/need/backlog row
- [ ] Only `var(--dpf-*)` styling tokens are used in the new component
- [ ] Unit tests cover every per-domain rule table entry (verdict per cell × state combination)

## Follow-On Slices

1. **Operator triage view at `/platform/audit/readiness`.** Audit run history, filterable by domain/cell/verdict, with run-by-run drill-down.
2. **Tunable recurrence policy per domain.** Finance might justify a tighter threshold (2 of 3) while customers-delivery might want looser (4 of 7).
3. **Auto-close suppression.** When a downstream record closes (capability need resolved, proposal denied, backlog item shipped), re-evaluate the cell on the next run and emit a "gap closed" audit event.
4. **Confidence-weighted escalation.** Combine the audit verdict with TAK/GAID confidence signals — a `blocked` cell with high-confidence evidence escalates faster than one with low-confidence evidence.

## Out Of Scope

These are permanent boundaries for the audit as a surface — not deferred V1 omissions.

- The audit MUST NOT execute side-effect actions. It only emits proposals/needs/backlog items.
- The audit MUST NOT redefine readiness. The same `deriveReadinessCell` function the command center uses is the single source of readiness truth.
- The audit MUST NOT bypass `CoworkerCapabilityNeed.duplicateOfId` linking. If a near-duplicate need exists, link rather than create.
- The audit panel is not a top-level route. It belongs on `/workspace` as a section.

## Deferred

These are intentional V1 omissions that will revisit in follow-on slices.

- A dedicated `WorkspaceReadinessSnapshot` history table. V1 reconstructs from `WorkspaceReadinessAuditRun.verdictJson`; if query patterns demand it, a normalized table lands in slice 2 with measurement evidence.
- Per-domain recurrence thresholds. V1 uses a single global `3 of last 5`.
- Confidence-weighted escalation. Requires TAK/GAID receipt material to be in place first.
- Auto-resolution detection. V1 surfaces gaps; closing them is operator-driven.

## Risks

| Risk | Mitigation |
|------|------------|
| Audit emits duplicate proposals/needs across runs | Suppression check against open downstream records, keyed by `sourceCell` metadata; suppression has its own test |
| Audit becomes the source of truth for readiness, drifting from the command center | The audit imports and calls `deriveReadinessCell` directly — it cannot drift because there is no duplicate derivation |
| Recurrence threshold (3 of 5) is too eager or too lax | Threshold is config; gather 30 days of run data before tuning; the audit run history is queryable |
| Write paths flood the operator with low-value gaps | The per-domain rule tables default to `noted only` for soft signals; escalation requires explicit rule-table entries |
| Audit fails silently if `loadWorkspaceCommandCenter` throws | Audit run wraps the call in a try/catch and writes the error to `WorkspaceReadinessAuditRun.errorJson`; the operator surface shows audit-failure state |
| Inngest cadence drifts under load | The audit is idempotent; a late run still produces a valid verdict; missing a run lowers recurrence count by one slot, biasing toward `noted` (safer side) |

## Recommended Next Step

Approve this spec, then feed it to `writing-plans` for the implementation plan. The plan should:

1. Land the `WorkspaceReadinessAuditRun` model + migration in chunk 1
2. Land the pure audit helpers + tests in chunk 2
3. Land the Inngest schedule + CLI invocation in chunk 3
4. Land the `ReadinessGapPanel` UI in chunk 4
5. Run the audit once on a populated install before merging to verify no false escalations against current production data

The `EP-WORKSPACE-*` epic should be created before the plan lands so this slice and its three follow-on slices have a coherent home.

## Glossary

| Term | Expansion / meaning |
|------|---------------------|
| **Audit verdict** | The per-(domain, cell) classification produced by an audit run: `clear`, `noted`, `escalate-coworker`, `escalate-action`, `escalate-platform`, `suppressed` |
| **`AgentActionProposal`** | DPF's proposal-mode action substrate; proposals are emitted, decided by an operator, then executed (or denied) |
| **`CoworkerCapabilityNeed`** | DPF's coworker capability-gap substrate; needs are submitted by coworkers (or, here, by the audit) and reviewed for prioritization |
| **`deriveReadinessCell`** | The pure function in [command-center.ts:178](../../../apps/web/lib/workspace/command-center.ts#L178) that maps signal inputs to a six-C `ReadinessState` |
| **GAID / Principal** | See [TAK/GAID spec glossary](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md). The audit acts as itself with a defined principal, not as the session user |
| **HITL** | Human-in-the-Loop — oversight tiers per `TAK §9` |
| **Recurrence threshold** | The "N of last M runs" rule that promotes a `noted` cell into an escalation |
| **Six-C** | Context, Connections, Capabilities, Cadence, Confidence, Containment — see [parent spec](2026-05-15-business-os-command-center-design.md) |
| **`sourceCell`** | Metadata field carried on every audit-emitted write linking it back to the `(domain, cell)` that triggered emission — the suppression key |
| **Suppression** | The rule that prevents duplicate emissions when an open downstream record (need/proposal/backlog) already references the same gap |
