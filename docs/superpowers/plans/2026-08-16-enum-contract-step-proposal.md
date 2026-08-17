# Enum contract step — ordered proposal (OPERATOR REVIEW REQUIRED)

**Status: proposal only — nothing in this document is executed by the W4 PR.**
BI-817ED2D4 · Simplify & Strengthen W4 · architecture pass 2026-08-16 §3.2-a ·
expand step shipped as migrations `20260816110000` + `20260816111000`.

## Where the expand step left the schema

- 37 Postgres enum types exist (all declared in `schema.prisma`).
- 10 columns were **directly converted** to their enum (payroll precedent
  20260815200100; per-column data-safety arguments in `20260816110000`).
- 30 long-lived columns remain `String` behind a named
  `"<Table>_<column>_closed_set"` CHECK constraint, added `NOT VALID`:
  new writes are enforced; legacy rows were not validated at apply time.
- `scripts/check-no-new-closed-set-strings.mjs` ratchets the residual 697
  closed-set String columns (shrink-only baseline).

**Load-bearing Postgres semantics the contract step must respect:** a
`NOT VALID` CHECK is still evaluated for every INSERT **and every UPDATE**.
The expand step therefore included observed legacy vocabulary (e.g.
`BacklogItem.status = 'blocked'`, `FeatureBuild.phase = 'panicked'`) *inside*
the CHECK sets so updates to old rows cannot start failing. The contract step
is what removes those tolerances — in this order, per column:

## Ordered contract plan (per column-cohort)

Each wave is: **(1) normalize** legacy values with an explicit, operator-approved
mapping → **(2) `VALIDATE CONSTRAINT`** (proves zero residual drift, cheap
SHARE UPDATE EXCLUSIVE lock) → **(3) flip** `ALTER COLUMN … TYPE … USING`
+ drop the CHECK + change the Prisma field to the enum → **(4) retighten** the
ratchet baseline. A wave that cannot pass step 2 on any fleet install stops and
reports rather than forcing the flip.

### Wave 1 — no known drift (validate should already pass)

`BacklogItem.type`, `BacklogItem.workType`, `BacklogItem.scopeKind`,
`BacklogItem.claimStatus`, `Epic.status`, `Epic.scopeKind`, `Workroom.status`,
`Workroom.source`, `FeatureBuild.claimStatus`, `CustomerAccount.status`,
`CustomerSite.status`, `StaffingDemand.*` (3), `TaskNode.*` (5),
`TaskNodeEdge.edgeType`, `KnowledgeArticle.*` (3), `WikiPage.pageKind`,
`WikiPage.status`.

No normalization expected; run VALIDATE directly. Any surprise violation on a
fleet install downgrades that column to Wave 2 with an explicit mapping.

### Wave 2 — operator decisions required before normalization

| Column | Legacy value(s) observed | Decision needed |
| --- | --- | --- |
| `BacklogItem.status` | `blocked` (4 rows on reference install) | Map to `deferred` (semantically closest: paused, review-triggered) or resurrect `blocked` as a canonical status. Recommended: map to `deferred` with a `deferReason` backfill. |
| `BacklogItem.effortSize` | `xs`, `XS` | Map to `small` or extend the canonical set with `xsmall`. Recommended: map to `small` (RICE jobSize seeds already treat sub-small as small). |
| `BacklogItem.source` | `build-failure`, `hive-scout`, `self-upgrade-failure` — **live writer vocabulary**, not just legacy rows | These writers bypassed `BACKLOG_SOURCE_VALUES` ("new values are added only when a writer needs them" — the writers needed them). Recommended: promote all three into `BacklogSource` (+ TS union + MCP mirrors, same commit per AGENTS.md §3) rather than rewriting history. |
| `FeatureBuild.phase` | `panicked` (retired writer vocabulary, readable in `operator-triage.ts`) | Map to `failed`, keep triage read-compat until the mapping lands. |

### Wave 3 — deliberately out of the W4 cohort (needs upstream work first)

- `Workroom.contributionMode` — no TS union exists for the *capsule-level*
  mode (the PlatformDevConfig two-state collapse is a different column).
  Define the vocabulary first.
- `WikiPage.principleTier` — live drift beyond the documented set
  (`heuristic`, `rule`, `standard` vs documented `commandment|core|contextual`).
  The tier taxonomy needs an owner decision before any constraint.
- `LeaveRequest.status`, `TimesheetPeriod.status` — no documented closed set
  anywhere; document the vocabulary, then CHECK-expand, then contract.
- `BacklogItem.triageOutcome` `runbook` — in the TS union but zero live rows
  ever written; confirm the value is real before it survives the flip.

## Mechanical notes for the executor

- Hyphenated labels (`in-progress`, `ready-for-review`, …) are `@map`-ed in
  the Prisma enums; the generated TS literal is the underscored identifier
  (e.g. `in_progress`). The flip therefore changes TS call-site literals for
  those columns — budget the apps/web sweep per column-cohort, and keep the
  MCP tool-schema mirrors (`backlog-enums.test.ts` parity suite) in the same
  commit.
- Every wave's migration needs its own `-- @migration-safety:` attestation and
  a scratch-Postgres full-chain `migrate deploy` proof (W2/W4 pattern).
- After each flip, run `node scripts/check-no-new-closed-set-strings.mjs
  --update` in the same PR (shrink-only retighten).
- `VALIDATE CONSTRAINT` on a fleet install runs inside the self-upgrade
  migration path; it does not rewrite the table and cannot wedge the chain on
  success-path installs, but a failure aborts the upgrade — hence the
  stop-and-report rule above (L3 shadow-DB preflight, BI-UPGRADE-008, is the
  eventual systematic answer).
