# Unified Backlog + BacklogItem WorkType Design

| Field | Value |
| ----- | ----- |
| Status | Draft |
| Date | 2026-05-30 |
| Backlog item | To be filed against EP-INTAKE-UNIFY (or current backlog-hygiene epic). Live MCP check on 2026-05-30 (`search_specs_and_plans`, `search_knowledge`) found one adjacent spec — the 2026-05-29 fix-flow design — but **no** indexed spec or backlog item for unifying `PlatformIssueReport` with `BacklogItem` or for a first-class `workType` attribute on `BacklogItem`. |
| Epic recommendation | Extend the existing backlog-hygiene / governed-intake epic if one is open; create `EP-INTAKE-UNIFY` only if scope grows beyond what is described here. Do **not** file a new epic for the Phase 0 enum-canonicalization slice — it belongs under existing hygiene. |
| Related substrate | [`apps/web/lib/explore/backlog.ts`](../../../apps/web/lib/explore/backlog.ts); [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts); [`apps/web/lib/governed-backlog-tee-up.ts`](../../../apps/web/lib/governed-backlog-tee-up.ts); [`apps/web/lib/quality/platform-issue-reports.ts`](../../../apps/web/lib/quality/platform-issue-reports.ts); [`apps/web/lib/quality/issue-report-status.ts`](../../../apps/web/lib/quality/issue-report-status.ts); [`apps/web/lib/operate/issue-report-triage.ts`](../../../apps/web/lib/operate/issue-report-triage.ts); [`apps/web/lib/queue/functions/issue-report-triage.ts`](../../../apps/web/lib/queue/functions/issue-report-triage.ts); [`apps/web/lib/operate/process-observer-triage.ts`](../../../apps/web/lib/operate/process-observer-triage.ts); [`apps/web/lib/actions/quality.ts`](../../../apps/web/lib/actions/quality.ts); [`apps/web/app/(shell)/admin/issue-reports/page.tsx`](../../../apps/web/app/(shell)/admin/issue-reports/page.tsx); [`apps/web/components/admin/IssueReportPanel.tsx`](../../../apps/web/components/admin/IssueReportPanel.tsx); [`apps/web/app/(shell)/ops/page.tsx`](../../../apps/web/app/(shell)/ops/page.tsx); [`apps/web/components/ops/BacklogPanel.tsx`](../../../apps/web/components/ops/BacklogPanel.tsx); [`apps/web/components/ops/BacklogItemRow.tsx`](../../../apps/web/components/ops/BacklogItemRow.tsx); `BacklogItem`; `PlatformIssueReport`; `FeatureBuild` |
| Related specs | [Fix flow through Build Studio (2026-05-29)](2026-05-29-fix-flow-through-build-studio-design.md); [Capacity-aware feedback escalation (2026-05-24)](2026-05-24-capacity-aware-feedback-escalation-design.md); [Feedback resolution closure (2026-05-26)](2026-05-26-feedback-resolution-closure-design.md); [Quality feedback (2026-03-14)](2026-03-14-quality-feedback-design.md) |
| Scope | Add a first-class `workType` attribute to `BacklogItem` as a closed enum (`bug | feature | chore | doc | tool | skill | refactor`); split today's overloaded `source` into pure intake-origin values; canonicalize the already-leaking source values (`issue_report`, `process_observer`); backfill `workType` from current `source`; surface `workType` in the `/ops` backlog UI as a badge + filter and in `list_backlog_items` MCP; map `FeatureBuild.kind` from `workType` (cleaner than reading `source`); explicitly demote `PlatformIssueReport` from "parallel issue log" to "runtime evidence sidecar" for `workType=bug` BIs, with the Admin issue-reports page reframed accordingly. Phase 2 (synchronous PIR→BI projection on intake; fold `/admin/issue-reports` into a `workType=bug` filtered backlog view) is named and deferred. |
| Out of scope | Replacing the 15-minute issue-report triage cron (Phase 2); building a new audit/incident surface on top of `PortfolioQualityIssue`/`EaConformanceIssue`/`TaxIssue` (those remain audit-only domains); a parallel `BacklogItemEvidence` table to absorb PIR's runtime-only columns (Phase 2 decision); per-`workType` SLA/scheduling; auto-closing PIRs on ship (carried over from fix-flow Phase 2); upstream GitHub escalation. |

---

## Architect Verdict

The user's framing is correct and the gap is real. Today `BacklogItem.source` carries two
independent axes muddled into one column:

- **WORK-TYPE / CATEGORY** of the gap: `bug, feature-gap, tool-gap, skill-gap, doc-gap`
- **ORIGIN / INTAKE CHANNEL**: `user-request, automated-detection`

Plus two values that already leak through in production without ever being in the canonical
enum (verified at [`backlog.ts:122-130`](../../../apps/web/lib/explore/backlog.ts)):
[`queue/functions/issue-report-triage.ts`](../../../apps/web/lib/queue/functions/issue-report-triage.ts)
queries `source: { in: ["bug", "process_observer"] }`, and the process-observer triage path
writes `source: "process_observer"`. The issue-report triage path historically wrote
`source: "issue_report"` (canonicalized to `"bug"` by fix-flow Phase 0, but the same
underlying defect — the enum doesn't constrain the column). This is exactly the failure mode
[`strongly-typed-string-enums`](../../professions/data-architect/wiki/strongly-typed-string-enums.md)
and [`schema-honesty-over-aspirational-naming`](../../founder-kernel/wiki/principles/schema-honesty-over-aspirational-naming.md)
warn against.

Two consequences flow from the muddle:

1. **Operators cannot filter the backlog by what kind of work it is.** `/ops` filters on
   `status` and `type` (portfolio vs product, the ownership axis), never on `source`. There
   is no `workType` badge on a row, and `list_backlog_items` MCP has no `source`/`workType`
   filter. So "show me all open bugs" is not a query the backlog can answer.
2. **`FeatureBuild.kind` derivation reads the muddled column.** The fix-flow spec mapped
   `source === "bug" ? "fix" : "feature"` at promote time as a Phase-1 pragmatism, with the
   explicit assumption that the source enum would not drift further. A clean `workType`
   gives that mapping a stable, single-axis input.

On `PlatformIssueReport` specifically: it is **not** a parallel backlog and should not be
treated as one. It is a runtime-evidence record — `errorStack, userAgent, threadId,
taskRunId, triggerKind, supportSessionId`, etc. — that today is also dressed up as a
queue (statuses, an Admin queue UI, a 15-minute triage cron). The honest target state is:
PIR is the diagnostic-evidence sidecar for `workType=bug` BIs; the backlog (the work) lives
in one place (`BacklogItem`). This spec moves us toward that target without rewriting the
cron in the same PR.

Five guardrails for the implementation:

1. **`workType` is additive and closed.** New column on `BacklogItem`; closed enum
   `bug | feature | chore | doc | tool | skill | refactor`; new MCP enum mirrored in
   `mcp-tools.ts` in the **same commit** per AGENTS.md §3. Required on new items.
2. **Source becomes pure origin.** Closed enum `user-request | automated-detection`
   (extensible later — `runtime-error`, `feedback`, `governance-rule`, `manual-triage`,
   `coworker-detection` are anticipated but only added when something writes them; do not
   pre-add unused values per [`single-source-of-truth`](../../founder-kernel/wiki/principles/single-source-of-truth.md)
   and YAGNI). Deterministic backfill from today's `source` values; canonicalize the two
   leaked values (`issue_report → automated-detection`, `process_observer → automated-detection`)
   inline in the migration.
3. **`kind` derivation moves to `workType`.** `governed-backlog-tee-up.ts` reads
   `item.workType === "bug" ? "fix" : "feature"`. The behavior is byte-identical (every
   `source="bug"` BI is mapped to `workType="bug"` in the backfill), but the input is now
   a stable single-axis field. The fix-flow spec's PIR carry-through logic is unchanged.
4. **PIR is demoted in narrative, not yet in schema.** The Admin issue-reports page header
   and route description say "runtime evidence feed for `workType=bug` backlog items," not
   "issue log." A "See backlog item" link is added on each report row when a BI projection
   exists. The 15-minute cron and the `triaged_local` lifecycle remain unchanged in this
   PR; their replacement (synchronous projection) is a follow-up BI.
5. **Back-compat by construction.** `workType` defaults `null` in the schema for the
   transitional window the migration occupies; the migration's inline backfill populates
   every existing row before the new readers go live. `source` keeps its current `String?`
   type; the runtime validators on the new enum are introduced in writers and the MCP tool
   schema, not the DB column, so a future enum-tightening migration (Phase 2) is safe.

This is the chief-architect lens applied to the user's framing. It composes with — and
does not contradict — the 2026-05-29 fix-flow spec. The fix-flow spec said "don't add `kind`
to `BacklogItem` because `source` already distinguishes `bug`." That was correct against the
muddled `source`; this spec gives `BacklogItem` the clean axis the fix-flow spec assumed.

## 1. Problem

### 1.1 The muddled `source`

Verified from [`apps/web/lib/explore/backlog.ts:122-130`](../../../apps/web/lib/explore/backlog.ts):

```ts
export const BACKLOG_SOURCE_VALUES = [
  "feature-gap", "bug", "tool-gap", "skill-gap", "doc-gap",   // ← WORK-TYPE / CATEGORY
  "user-request", "automated-detection",                       // ← INTAKE ORIGIN
] as const;
```

Mixing axes in one closed enum has three concrete consequences:

- **`feature-gap` and `user-request` are not alternatives.** A user-requested feature gap
  is *both* — the muddled enum forces a writer to pick one and lose the other.
- **`bug` and `automated-detection` are not alternatives either.** A runtime-detected bug
  is both. Today the issue-report triage writer commits to `bug` and the automated-detection
  signal is lost.
- **Operators can't filter on either axis cleanly.** `list_backlog_items` doesn't expose
  `source` as a filter; the `/ops` row doesn't render it. Even if it did, filtering by
  `bug` excludes user-requested bug reports tagged otherwise, and filtering by
  `automated-detection` mixes bugs with auto-detected non-bug gaps.

### 1.2 Enum drift already in production

[`apps/web/lib/queue/functions/issue-report-triage.ts:61`](../../../apps/web/lib/queue/functions/issue-report-triage.ts)
queries `where: { source: { in: ["bug", "process_observer"] } }`, but `process_observer`
is **not** in `BACKLOG_SOURCE_VALUES`. The process-observer triage path
([`apps/web/lib/operate/process-observer-triage.ts`](../../../apps/web/lib/operate/process-observer-triage.ts))
writes that value. The DB column is `String?`, so nothing rejects it. The 2026-05-29
fix-flow spec landed Phase 0 to canonicalize one drift case (`issue_report → bug`); this
spec must canonicalize the rest before adding readers that depend on the enum being closed.

### 1.3 Two surfaces for one concept

[`/admin/issue-reports`](../../../apps/web/app/(shell)/admin/issue-reports/page.tsx) renders
`PlatformIssueReport` rows with their own status vocabulary, severity badges, and queue
posture cards ([`apps/web/components/admin/IssueReportPanel.tsx`](../../../apps/web/components/admin/IssueReportPanel.tsx)).
[`/ops`](../../../apps/web/app/(shell)/ops/page.tsx) renders `BacklogItem` rows with their
own status vocabulary and (currently no) source/work-type badges. The cron projects open
PIRs into BIs every 15 minutes, so an operator looking at the two surfaces sees the same
underlying issue twice — once as a PIR with a stack trace, once as a BI with `source=bug`
and a back-reference body line `Source report: PIR-XXXXX` parsed by the promote path
([`governed-backlog-tee-up.ts:230`](../../../apps/web/lib/governed-backlog-tee-up.ts)).

The honest single source of truth is the `BacklogItem`. The `PlatformIssueReport` is the
runtime-evidence record for the bug-class BI (statuses, severity, stack, route). The
Admin issue-reports surface should be a view of the evidence, not a parallel queue.

### 1.4 What this spec does *not* try to fix in one PR

- It does **not** rewrite the triage cron to project synchronously. That is a behavioral
  change to a 15-minute-tick path that other features (capacity-aware feedback,
  reflection triggers) read; it is staged as Phase 2 with its own BI.
- It does **not** merge the `/admin/issue-reports` page into `/ops` in this PR. It reframes
  the page header and adds the "See backlog item" cross-link so the conceptual unification
  is visible to the operator. The route-level merge is Phase 2.
- It does **not** retire any PIR columns. They are runtime evidence that BIs do not (and
  should not) carry. The `BacklogItemEvidence` sidecar question is Phase 2.

## 2. Current Repo Truth

| Area | Verified current behavior | Design implication |
| ---- | ------------------------- | ------------------ |
| Source enum | `BACKLOG_SOURCE_VALUES` at [`backlog.ts:122-130`](../../../apps/web/lib/explore/backlog.ts) mixes work-type with origin. Column at [`schema.prisma:963`](../../../packages/db/prisma/schema.prisma) is `String?` with no DB-level constraint. | Add `workType` (closed enum, separate column). Split today's values: category values backfill into `workType`; origin values stay in (or backfill into) a refined `source`. |
| Drift in writers | `process_observer` written by [`operate/process-observer-triage.ts`](../../../apps/web/lib/operate/process-observer-triage.ts) and queried by [`queue/functions/issue-report-triage.ts:61`](../../../apps/web/lib/queue/functions/issue-report-triage.ts) is **not** in the canonical enum. `issue_report` was canonicalized to `bug` in fix-flow Phase 0 already. | Canonicalize `process_observer` to `automated-detection` in the same migration as the workType backfill (inline SQL per AGENTS.md §2). Update the writer + the query in the same commit. |
| Workers that write `source` | [`mcp-tools.ts:409`](../../../apps/web/lib/mcp-tools.ts) (`create_backlog_item` enum), [`mcp-tools.ts:577`](../../../apps/web/lib/mcp-tools.ts) (`update_backlog_item` reclassify), [`operate/issue-report-triage.ts:54,256`](../../../apps/web/lib/operate/issue-report-triage.ts) (`source: "bug"`), [`actions/quality.ts:191`](../../../apps/web/lib/actions/quality.ts) (`sendIssueReportToBuildStudioAsFix` writes `source: "bug"`), `operate/process-observer-triage.ts` (`source: "process_observer"`). | Every writer learns to set `workType` alongside `source`. The MCP `create_backlog_item` makes `workType` required (parallel to today's required `source`); `source` becomes optional input that defaults to the writer's intake channel; both enums mirrored in the tool schema. |
| Workers that read `source` | [`governed-backlog-tee-up.ts:217`](../../../apps/web/lib/governed-backlog-tee-up.ts) (`source === "bug" ? "fix" : "feature"`), [`queue/functions/issue-report-triage.ts:61,130`](../../../apps/web/lib/queue/functions/issue-report-triage.ts) (dedup queries), [`actions/quality.ts:154`](../../../apps/web/lib/actions/quality.ts) (idempotency check). | Move the `kind` derivation to read `workType`; behavior byte-identical because every `source="bug"` BI is mapped to `workType="bug"` in the backfill. Dedup queries stay on `source` (origin) — finding "all bug-class items from the runtime-error origin" is the natural shape. |
| `BacklogItem.type` | `String` non-null; values `"portfolio" | "product"` ([`backlog.ts:78`](../../../apps/web/lib/explore/backlog.ts) input type, [`mcp-tools.ts:406`](../../../apps/web/lib/mcp-tools.ts) enum). | Distinct axis (organizational ownership), not a work-type. Untouched. |
| `FeatureBuild.kind` | `String @default("feature")` ([`schema.prisma:4413`](../../../packages/db/prisma/schema.prisma)); enum `FEATURE_BUILD_KIND_VALUES` at [`feature-build-types.ts`](../../../apps/web/lib/explore/feature-build-types.ts). Derived at promote time from `BacklogItem.source`. | Switch the derivation input from `source` to `workType`. No change to `kind` semantics or enum. |
| PlatformIssueReport | 19 columns of runtime evidence ([`schema.prisma:4284-4319`](../../../packages/db/prisma/schema.prisma)). Single writer `createPlatformIssueReport()` ([`platform-issue-reports.ts:99`](../../../apps/web/lib/quality/platform-issue-reports.ts)). Surfaced at [`/admin/issue-reports`](../../../apps/web/app/(shell)/admin/issue-reports/page.tsx) with its own status vocab ([`issue-report-status.ts`](../../../apps/web/lib/quality/issue-report-status.ts)). 15-min triage cron at [`queue/functions/issue-report-triage.ts`](../../../apps/web/lib/queue/functions/issue-report-triage.ts) projects open reports into BIs with `source="bug"`. Manual "Send to Build Studio as a fix" affordance shipped in PR #1285 — [`actions/quality.ts:110-227`](../../../apps/web/lib/actions/quality.ts). | Reframe — not rewrite — the surface in this PR. Page header says "runtime evidence feed for bug-class backlog items"; each row gets a "See backlog item" link when the projected BI is resolvable (by `featureBuildId`/PIR-public-id body match). Cron stays. Status vocab stays. Phase 2 plans the synchronous projection + route merge. |
| Other "issue-shaped" models | `TaxIssue`, `LicenseReadinessIssue`, `PortfolioQualityIssue`, `EaConformanceIssue`, `DeliberationIssueSet`, `FeedbackNote` are all audit/governance surfaces, not runtime intake. `ImprovementSignal` ([`schema.prisma:4322`](../../../packages/db/prisma/schema.prisma)) feeds the improvement flywheel separately. | Out of scope. None compete with the unified backlog as intake. If any audit surface later wants to file a BI, it goes through `create_backlog_item` like every other writer. |
| Admin queue posture | [`IssueReportPanel.tsx`](../../../apps/web/components/admin/IssueReportPanel.tsx) shows actionable / process-guard / warmup-noise / triaged / resolved counts derived from PIR status + source classification. | Untouched — these counts are PIR diagnostic posture, not backlog state. The page header text changes (§4.6). |
| Ops backlog UI | [`BacklogPanel.tsx:78-79`](../../../apps/web/components/ops/BacklogPanel.tsx) filters on `type` and `status` only. [`BacklogItemRow.tsx`](../../../apps/web/components/ops/BacklogItemRow.tsx) renders priority badge, status badge, taxonomy, product, agent, submitter — no source/work-type. | Add `workType` filter + per-row badge. Origin is secondary metadata — exposed as text in the row's metadata line, not a primary filter, because filtering by origin is rarely the operator's question. |

## 3. Research & Benchmarking

How established issue/work trackers and dev-tool product backlogs model the
work-type-vs-origin axis. Reading the data models, not feature lists.

| System | Model (verified from product docs) | Adopt | Reject |
| ------ | ---------------------------------- | ----- | ------ |
| **GitHub Issues — issue types vs issue forms** | Org-level **issue types** (Bug, Feature, Task) are a first-class typed field, separate from labels; **issue forms** capture structured intake fields per type. Sources: [GitHub issue types](https://docs.github.com/en/issues/tracking-your-work-with-issues/configuring-issues/managing-issue-types-in-an-organization), [issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository). | First-class typed field for what-kind-of-work; structured intake separate. | Free-form labels for work-type (label proliferation: Bug/Defect/Regression/Hotfix/…). |
| **Linear — Issue type + Source** | Issue type (Bug/Feature/Improvement) is a closed primitive; [Customer requests](https://linear.app/docs/customer-requests) preserve the source link (customer feedback → linked issues) as a distinct concept. | Two-axis model: type ⊥ source. Source is a *link to the originating signal*, not a value crammed into type. | Encoding source into type ("customer-bug" vs "internal-bug"). |
| **Jira — issue type schemes + Service Management request types** | Issue types (Bug/Story/Task) drive workflow & field schemes; in [Service Management](https://support.atlassian.com/jira-service-management-cloud/docs/what-are-request-types/), *request types* present a friendly intake face *over* the typed issue. Sources: [Jira issue types](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types/). | Typed work-kind drives workflow/prompts (DPF analogue: `workType` drives Build Studio prompt branching via `FeatureBuild.kind`); operator never picks a raw type — the platform derives it. | Exposing scheme/workflow configuration to non-technical operators. |
| **ServiceNow — incident / problem / change** | Sharp separation: incident records the signal, problem investigates root cause, change implements the remediation; all linked. Source: [ServiceNow problem management](https://www.servicenow.com/docs/r/it-service-management/problem-management/c_ProblemManagementProcess.html). | Conceptual mapping: `PlatformIssueReport` ≈ incident evidence; `BacklogItem` (workType=bug) ≈ problem/work record; `FeatureBuild` (kind=fix) ≈ controlled change. Keep them linked, separate, and queryable. | Three parallel tables for one DPF concept. DPF already has PIR + BI + FeatureBuild; do not add a fourth. |
| **Sentry — event / issue / resolution** | Runtime events group into issues with stack/context; issues link to resolution activity. Source: [Sentry issue details](https://docs.sentry.dev/product/issues/issue-details/). | PIR rows ≈ events; a `workType=bug` BI ≈ the grouped issue; the FeatureBuild=fix ≈ resolution. Cross-link the BI from the PIR row. | Surfacing raw stacks/PII upstream (governed by existing privacy spec, out of scope here). |
| **Conventional Commits + Karma-style commit types** | Closed lowercase set `feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert`. Source: [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), [Angular commit conventions](https://github.com/angular/angular/blob/main/CONTRIBUTING.md#-commit-message-format). | Names — `bug` (== `fix` shipped), `feature` (== `feat`), `chore`, `doc` (singular for DPF: matches today's `doc-gap`), `refactor`. Aligns DPF backlog vocabulary with the same vocabulary engineers use in commit messages. | The full 11-value set is too many up front. Start with the seven that map to today's BI consumers + the work the user named (Phase 1 = 7 values). `perf`, `test`, `ci`, `style`, `revert` are deferred. |

**Patterns adopted:** first-class closed `workType` enum as a typed field; orthogonal
intake `source` field as origin-only; lightweight commit-style vocabulary; preserved
source link (`PlatformIssueReport.featureBuildId` already exists from fix-flow Phase 1).

**Anti-patterns rejected:** work-type as a label; mixing origin into work-type; a
parallel work-item table; forcing classification onto the operator (the platform derives
`workType` from the intake path); discriminated-union BIs that fragment readers.

## 4. Design

### 4.1 The `workType` enum

Declared in [`apps/web/lib/explore/backlog.ts`](../../../apps/web/lib/explore/backlog.ts),
the canonical home for `BacklogItem` contracts:

```ts
export const BACKLOG_WORK_TYPE_VALUES = [
  "bug",       // a defect — broken behavior in shipped substrate
  "feature",   // a new user-visible capability
  "chore",     // operational / housekeeping work (no user-visible behavior change)
  "doc",       // documentation gap or update
  "tool",      // tooling/DX gap — missing or broken developer tool
  "skill",     // coworker/agent capability gap
  "refactor",  // structural cleanup with no behavior change
] as const;
export type BacklogWorkType = (typeof BACKLOG_WORK_TYPE_VALUES)[number];
```

Single-word lowercase per AGENTS.md §3 (note: `doc` singular, matching today's `doc-gap`
ergonomics). Mirrored in [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts)
in the **same commit** for `create_backlog_item`, `update_backlog_item`, and
`list_backlog_items` (new filter). A vitest parity test asserts the MCP tool definition
matches the canonical enum (mirror of the AGENTS.md §3 contract for `BACKLOG_STATUS_VALUES`
already in use).

Adding an eighth value later (e.g. `perf`, `test`, `security`) requires updating the
canonical enum + every MCP mirror in one commit, before any data uses it.

### 4.2 Refined `source` (origin) enum

Same file, redefined:

```ts
export const BACKLOG_SOURCE_VALUES = [
  "user-request",          // operator/employee/customer asked for it
  "automated-detection",   // platform observation (process observer, runtime error triage, drift detection)
] as const;
export type BacklogSource = (typeof BACKLOG_SOURCE_VALUES)[number];
```

Two values now. The previously-mixed category values (`feature-gap, bug, tool-gap,
skill-gap, doc-gap`) move into `workType`. Anticipated future origin values
(`feedback`, `governance-rule`, `coworker-detection`, `external-import`) are *not* added
until a writer needs them — see [`single-source-of-truth`](../../founder-kernel/wiki/principles/single-source-of-truth.md)
and the YAGNI guidance in the AGENTS.md First Principles. The leaked value
`process_observer` collapses into `automated-detection` (the process observer **is** an
automated detector).

### 4.3 Schema change

Add to `BacklogItem` ([`schema.prisma:950-1000`](../../../packages/db/prisma/schema.prisma)):

```prisma
workType String?  // BACKLOG_WORK_TYPE_VALUES - see apps/web/lib/explore/backlog.ts
```

Nullable for the transitional window the migration occupies; the migration's inline
backfill (§4.4) populates every existing row before any new reader fires. A follow-up
Phase 2 migration tightens to `String` non-null once the writers are all required to set
it (this PR makes the MCP tool require it; the DB constraint follows separately to keep
the migration small).

No new index — `workType` is a low-cardinality enum and existing queries filter primarily
on `status`/`epicId`. If a `workType + status` composite query becomes hot in Phase 2,
add the index then.

### 4.4 Migration: `backlog_item_work_type` (with inline backfill)

Single migration. Sections:

```sql
-- 1. Schema
ALTER TABLE "BacklogItem" ADD COLUMN "workType" TEXT;

-- 2. Backfill workType from today's overloaded source
UPDATE "BacklogItem" SET "workType" = 'bug'      WHERE "source" = 'bug';
UPDATE "BacklogItem" SET "workType" = 'feature'  WHERE "source" = 'feature-gap';
UPDATE "BacklogItem" SET "workType" = 'tool'     WHERE "source" = 'tool-gap';
UPDATE "BacklogItem" SET "workType" = 'skill'    WHERE "source" = 'skill-gap';
UPDATE "BacklogItem" SET "workType" = 'doc'      WHERE "source" = 'doc-gap';

-- 3. Backfill: items whose source was pure origin keep null workType. They land
--    in a triage queue ("workType unknown") that the ops backlog shows as a
--    badge so an operator can classify them. New writers must supply workType.
--    Rows with NULL source also stay NULL — they predate the enum entirely.

-- 4. Canonicalize source drift to the refined origin vocabulary.
UPDATE "BacklogItem" SET "source" = 'automated-detection'
  WHERE "source" IN ('feature-gap', 'bug', 'tool-gap', 'skill-gap', 'doc-gap', 'process_observer', 'issue_report');
--    Rationale: the category-shaped values entered the column via writers in
--    paths that all qualify as automated-detection or system-triage — runtime
--    triage, process observer, gap-detection. The classification is now in
--    workType where it belongs. Hand-filed BIs from a human operator are
--    already source='user-request'; those rows are untouched.
```

The migration is reversible by `prisma migrate reset` in development; in production it is
forward-only (the original `source` text is reconstructible from `workType` for backfilled
rows). The backfill matrix is recorded in the migration comment for audit.

### 4.5 Writers and MCP

All BI-creating call sites are updated in the same PR to set `workType` explicitly. The
mapping per writer:

| Writer | New behavior |
| ------ | ------------ |
| [`mcp-tools.ts:create_backlog_item`](../../../apps/web/lib/mcp-tools.ts) | `workType` becomes a **required** input field (enum mirror of `BACKLOG_WORK_TYPE_VALUES`); `source` becomes optional with default `user-request` (consistent with the only non-automated writers being humans calling the MCP tool). |
| [`mcp-tools.ts:update_backlog_item`](../../../apps/web/lib/mcp-tools.ts) | Adds optional `workType` reclassify field; existing `source` field continues to allow reclassify but with the new closed enum. |
| [`mcp-tools.ts:list_backlog_items`](../../../apps/web/lib/mcp-tools.ts) | Adds optional `workType` filter (single value or array); also adds optional `source` filter for completeness. |
| [`operate/issue-report-triage.ts:buildIssueBacklogItem`](../../../apps/web/lib/operate/issue-report-triage.ts) | Writes `workType: "bug", source: "automated-detection"`. |
| [`operate/issue-report-triage.ts:checkForSpike`](../../../apps/web/lib/operate/issue-report-triage.ts) | Same — spike alerts are bug-class auto-detection items. |
| [`actions/quality.ts:sendIssueReportToBuildStudioAsFix`](../../../apps/web/lib/actions/quality.ts) | Writes `workType: "bug", source: "user-request"` (the operator clicked the action — that is a human request acting on automated evidence; the originating PIR's evidence is already linked via `featureBuildId`). |
| [`operate/process-observer-triage.ts`](../../../apps/web/lib/operate/process-observer-triage.ts) | Writes `workType: "bug", source: "automated-detection"`. The previous `source: "process_observer"` value is removed; the queue dedup query at [`queue/functions/issue-report-triage.ts:61`](../../../apps/web/lib/queue/functions/issue-report-triage.ts) is updated to read `workType: "bug"` (the correct shape — "have we already filed a bug for this signal?"). |

Server actions and admin UI forms that create BIs pass `workType` through from the
operator's choice in the form (or a sensible default for the surface — e.g., the
"submit a bug" action defaults to `bug`).

### 4.6 PIR is demoted in narrative (this PR)

[`/admin/issue-reports`](../../../apps/web/app/(shell)/admin/issue-reports/page.tsx)
stays where it is. The page header subtitle changes from the current framing to:

> Runtime evidence feed. Each open report projects to a `workType=bug` backlog item on
> the 15-minute triage tick; see the backlog at `/ops`.

Each report row gains a "See backlog item" affordance when a projection can be resolved.
Resolution uses the same lookup the promote path already performs: `featureBuildId`
back-link → originator BI; otherwise PIR-public-id body match against open `workType=bug`
BIs ([`actions/quality.ts:154`](../../../apps/web/lib/actions/quality.ts) pattern). When
no projection is resolved, the affordance shows "Awaiting triage cron (next tick at …)"
with the next scheduled run time read from the queue function's schedule.

The PIR status vocabulary, the triage cron, and the "Send to Build Studio as a fix"
action all remain. The narrative shift is honest about what PIR is — runtime evidence —
without rewriting cron behavior in the same PR.

### 4.7 Ops backlog UI

[`BacklogPanel.tsx:78-79`](../../../apps/web/components/ops/BacklogPanel.tsx) gains a
`workType` filter chip next to the existing `type` and `status` filters. The filter is
multi-select with the seven enum values.

[`BacklogItemRow.tsx`](../../../apps/web/components/ops/BacklogItemRow.tsx) gains a small
work-type badge to the left of the title (mirror of the existing priority badge styling),
using the canonical CSS vars per AGENTS.md §12:

| workType | Badge color (CSS var) | Glyph |
| -------- | --------------------- | ----- |
| `bug`      | `--dpf-danger`     | "Bug" |
| `feature`  | `--dpf-accent`     | "Feature" |
| `chore`    | `--dpf-muted`      | "Chore" |
| `doc`      | `--dpf-info`       | "Doc" |
| `tool`     | `--dpf-info`       | "Tool" |
| `skill`    | `--dpf-info`       | "Skill" |
| `refactor` | `--dpf-muted`      | "Refactor" |

The metadata line gains the `source` value as plain text after the existing taxonomy
node, in the form `via user-request` or `via automated-detection`. Origin is secondary —
text, not a primary filter — because the operator's question is almost always "what
work-type is this" not "how did it arrive."

The row keeps existing behavior for "Start in Build Studio" / "Edit" / "Delete" actions.

### 4.8 `FeatureBuild.kind` derivation moves to `workType`

[`governed-backlog-tee-up.ts:217`](../../../apps/web/lib/governed-backlog-tee-up.ts):

```ts
// Before
const kind: "feature" | "fix" = item.source === "bug" ? "fix" : "feature";

// After
const kind: "feature" | "fix" = item.workType === "bug" ? "fix" : "feature";
```

Byte-identical behavior for every existing path (because every `source="bug"` row is
backfilled to `workType="bug"`). The input is now a stable single-axis closed enum. The
PIR carry-through, `fixContext` population, and PIR `featureBuildId` back-link logic in
the same function are unchanged.

The fix-flow spec's chief-architect verdict ("kind is the discriminator; source is the
input; map once at promote") still holds, with one refinement: the **input** is now
`workType`, not `source`. The fix-flow spec wrote "source already distinguishes `bug`" as
a pragmatism against the muddled enum; with this spec, the input is a clean closed enum
whose name says what it means.

When workType grows past `bug | feature` (e.g. `chore`, `doc`, `tool`, `skill`,
`refactor`), the mapping stays binary at promote time: only `workType === "bug"` produces
`kind="fix"`; everything else produces `kind="feature"`. The `chore | doc | tool | skill |
refactor` types are still feature-shaped *builds* — they design, plan, and ship a change.
They differ from defects only in the kind of substrate they add. A future spec can split
`kind` further if a chore/doc/refactor build needs different prompts; this spec does not
prejudge that.

### 4.9 Phase 0 (this PR) — single-PR scope summary

1. `BACKLOG_WORK_TYPE_VALUES` enum + `BACKLOG_SOURCE_VALUES` redefinition in
   [`backlog.ts`](../../../apps/web/lib/explore/backlog.ts).
2. `workType` column + migration + inline backfill.
3. MCP tool schema updates in [`mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts) for
   `create_backlog_item`, `update_backlog_item`, `list_backlog_items` (same commit).
4. Writers updated: issue-report triage, process-observer triage,
   `sendIssueReportToBuildStudioAsFix`, every server action that creates BIs.
5. `governed-backlog-tee-up.ts` reads `workType` for `kind` derivation.
6. Queue dedup queries updated from `source: { in: ["bug", "process_observer"] }` to
   `workType: "bug"`.
7. Ops backlog UI: filter chip + row badge + source-as-text in metadata.
8. Admin issue-reports page: header reframe + "See backlog item" cross-link.
9. Vitest: enum/MCP parity test, gate behavior unchanged, intake writers emit correct
   `(workType, source)` pair, kind derivation byte-identical.
10. AGENTS.md §3 enum table updated to include `BacklogItem.workType`.

### 4.10 Phase 2 — deferred (filed as follow-up BI)

| Item | Why deferred |
| ---- | ------------ |
| Synchronous PIR→BI projection on intake (replace the 15-min cron) | Behavior change to a tick path other features read (capacity-aware feedback, reflection triggers, the Hermes thread-linking). Needs its own design + migration of in-flight queue state. |
| Tighten `BacklogItem.workType` to `String` non-null | Requires every writer in the tree to have been migrated; cleaner as a second small migration after Phase 0 lands and accrues evidence. |
| Tighten `BacklogItem.source` to enum-constrained at DB level | Same reasoning. |
| Fold `/admin/issue-reports` into a `workType=bug` filtered view of `/ops` with a PIR evidence drawer | A real product call (the runtime-evidence posture cards are useful as-is). Decide after operators use the cross-link affordance for a week. |
| Sidecar `BacklogItemEvidence` model to absorb PIR's runtime-only columns from a unified intake | Only if Phase 2's synchronous projection makes the sidecar pattern cleaner than the existing back-link. |
| Per-`workType` SLA/scheduling | Out of scope; coupled with capacity-aware feedback. |
| Auto-close PIR on FeatureBuild ship | Inherited from fix-flow Phase 2. |

## 5. Implementation Phasing

| Phase | Scope | Standalone? |
| ----- | ----- | ----------- |
| **0 (this PR)** | Items 1-10 in §4.9. Schema-additive + closed-enum + writers + MCP + UI badge/filter + UX cross-link + tests + build gate. | Yes. Migration is reversible in dev; production is forward-only with full backfill. |
| **1 (next PR)** | Tighten `workType` to non-null at DB level; tighten `source` to enum-constrained. Two small migrations, no behavior change. | Yes. Depends on Phase 0 having all writers migrated. |
| **2 (filed as follow-up BI)** | Synchronous PIR→BI projection; UX fold of `/admin/issue-reports` into `/ops` filtered view; possible `BacklogItemEvidence` sidecar; cron retired. | Yes. Larger product call; needs its own design slice. |

## 6. Verification Gates

Phase 0 must meet the AGENTS.md §5 build gate:

| Layer | What to run / show |
| ----- | ------------------ |
| Unit tests | `pnpm --filter web exec vitest run` for: enum/MCP parity (`BACKLOG_WORK_TYPE_VALUES` vs `create_backlog_item`/`update_backlog_item`/`list_backlog_items` tool schemas); migration backfill matrix (every legacy `source` value maps to the expected `(workType, source)` pair); `governed-backlog-tee-up.ts` produces byte-identical `kind` for the seven backfill cases; intake writers (`buildIssueBacklogItem`, `checkForSpike`, `sendIssueReportToBuildStudioAsFix`, process-observer triage) emit the right `(workType, source)`; dedup queue query returns the same rows as before for a representative fixture. |
| Typecheck / build | `pnpm --filter web typecheck`; `cd apps/web && pnpm exec next build` with zero errors (TypeScript errors only surface in `next build`). |
| Migration | `backlog_item_work_type` applies cleanly via `prisma migrate dev`. Down direction is `prisma migrate reset` in dev; production migration is forward-only. The backfill is asserted by a unit test that loads representative fixtures into a temporary schema. |
| UX | Against the Docker-served portal: load `/ops`; observe the new work-type badge on every row, the new work-type filter chip, the `via <source>` metadata; load `/admin/issue-reports`; observe the reframed header and the "See backlog item" cross-link on rows where a projection exists. Use the `build-studio-operator` lens for the lifecycle gates. |

This spec's own quality gate (pre-implementation): `dpf-architecture-review` lens applied;
live MCP duplicate-spec check done (only the 2026-05-29 fix-flow spec hit; reconciled in
§Architect Verdict); every code reference ground-truthed against the current tree on
`feat/unify-backlog-worktype` worktree at `~/dpf-worktrees/unify-backlog-worktype`.

## 7. Risks & Open Decisions

| Item | Resolution |
| ---- | ---------- |
| Drift in `source` enum (`process_observer`, historical `issue_report`) | Migration backfill canonicalizes to `automated-detection`. Writers updated in the same PR. The DB-level enum tightening is Phase 1, not Phase 0, to keep the migration small. |
| Back-compat for in-flight builds and queue dedup | The backfill mapping is exhaustive (every legacy `source` value maps to a `(workType, source)` pair). `kind` derivation produces byte-identical output. The dedup query change (`source: { in: ["bug", "process_observer"] }` → `workType: "bug"`) is asserted by a unit test against representative fixtures to confirm row identity. |
| `workType` proliferation | Closed enum, seven values. New values require AGENTS.md §3 discipline (canonical enum + MCP mirrors in one commit, before any data uses it). Concretely deferred: `perf, test, security, ci, style, revert` (from Conventional Commits) — none has a writer today; adding them when one appears. |
| Should `chore`/`refactor` produce a different `kind` than `feature`? | Not in this PR. Both are still feature-shaped builds (design, plan, ship a change). A future spec can split `kind` further if a chore/doc/refactor build proves to need a distinct prompt/gate path. |
| Should `/admin/issue-reports` fold into `/ops` in this PR? | No. The runtime-evidence posture cards are useful as-is. Reframe + cross-link only in this PR; full fold is Phase 2 with operator evidence. |
| Should we add a `BacklogItem → PlatformIssueReport` FK? | Inherited from fix-flow spec; deferred to Phase 2 unless the PIR-public-id body match proves lossy in real use. |
| Should `source` keep more values for non-automated origins (e.g. `feedback`, `governance-rule`)? | Add when a writer needs them, per [`single-source-of-truth`](../../founder-kernel/wiki/principles/single-source-of-truth.md). The two values declared now cover every current writer after the migration. |
| Migration safety on a populated production DB | The backfill is `UPDATE` against a small enum cardinality (the largest legacy bucket is `source='bug'` which is bounded by issue-report triage activity). No table rewrite; no FK changes. Reviewed against the AGENTS.md §11 schema-stewardship checklist. |
| What about `BacklogItem.type` (portfolio | product) | Untouched. It is a different axis (organizational ownership). The risk of operator confusion between `type` and `workType` is real but small; the row badge for `workType` is visually distinct from the existing `type` distinction (which today shows as the product link in the metadata line). A future cleanup might rename `type → ownership` for clarity; not in scope here. |

## 8. Next Step After Sign-Off

On approval, file the backlog item against the backlog-hygiene epic (or
`EP-INTAKE-UNIFY` if scope warrants), then implement **Phase 0 directly in this repo**
— per the standing rule recorded in operator memory (`build-studio-down-route-direct-pr`),
Build Studio is being stabilized as of 2026-05-29 and direct DCO PR is the current
ship path — on the `feat/unify-backlog-worktype` topic branch, via a DCO-signed PR off
`origin/main`, meeting the full build gate. Phase 1 (DB enum tightening) and Phase 2
(synchronous projection + UX fold) are filed as follow-up BIs and not started until
Phase 0 has landed and accrued evidence.
