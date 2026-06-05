# Fix Flow Through Build Studio Design

| Field | Value |
| ----- | ----- |
| Status | Draft — chief-architect review applied |
| Date | 2026-05-29 |
| Backlog item | To be filed on approval. Live MCP check on 2026-05-29 (`search_specs_and_plans`, `search_knowledge`) found no exact indexed spec or backlog item for an issue→Build-Studio fix flow or a Build-Studio work kind before drafting. |
| Epic recommendation | Extend the Build Studio lifecycle epic if one is open; create `EP-FIX-FLOW-BUILD-STUDIO` only if the scope grows beyond the work-kind discriminator and intake carry-through described here. Do not file a new epic for the Phase-0 enum-canonicalization slice — it belongs under existing backlog hygiene. |
| Related substrate | [`apps/web/lib/explore/feature-build-types.ts`](../../../apps/web/lib/explore/feature-build-types.ts); [`apps/web/lib/explore/backlog.ts`](../../../apps/web/lib/explore/backlog.ts); [`apps/web/lib/integrate/build-agent-prompts.ts`](../../../apps/web/lib/integrate/build-agent-prompts.ts); [`apps/web/lib/integrate/specialist-prompts.ts`](../../../apps/web/lib/integrate/specialist-prompts.ts); [`apps/web/lib/governed-backlog-tee-up.ts`](../../../apps/web/lib/governed-backlog-tee-up.ts); [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts); [`apps/web/lib/quality/platform-issue-reports.ts`](../../../apps/web/lib/quality/platform-issue-reports.ts); [`apps/web/lib/operate/issue-report-triage.ts`](../../../apps/web/lib/operate/issue-report-triage.ts); [`apps/web/lib/queue/functions/issue-report-triage.ts`](../../../apps/web/lib/queue/functions/issue-report-triage.ts); [`apps/web/app/(shell)/admin/issue-reports/page.tsx`](../../../apps/web/app/(shell)/admin/issue-reports/page.tsx); `FeatureBuild`; `BacklogItem`; `PlatformIssueReport` |
| Related specs | [Capacity-aware feedback escalation (2026-05-24)](2026-05-24-capacity-aware-feedback-escalation-design.md); [Feedback resolution closure contract (2026-05-26)](2026-05-26-feedback-resolution-closure-design.md); [Pseudonymous identity and backlog issue bridge (2026-04-18)](2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md); [Quality feedback (2026-03-14)](2026-03-14-quality-feedback-design.md) |
| Scope | A first-class **work kind** (`feature` \| `fix`) carried from intake into `FeatureBuild`, the intake carry-through that preserves a reported issue's diagnostic context, the prompt/gate branching that runs a fix as a targeted defect repair rather than a new-capability design, and a manual "Send to Build Studio as a fix" intake affordance on the Admin issue-reports page. |
| Out of scope | Replacing the issue-report triage cron or the capacity-aware feedback router; building the full capacity-aware `local_build` decision logic (this spec supplies the Build Studio *destination* that path will target); upstream GitHub escalation; auto-closing `PlatformIssueReport`s on ship (named as Phase 2); a parallel bug-tracker abstraction; per-severity SLA/scheduling. |

---

## Architect Verdict

The product instinct is correct and overdue: Build Studio is DPF's build substrate, but today
it can only **add capability**. A non-technical operator who reports "the submit button 500s"
has no governed path to a fix — only to a feature-shaped build that fights its own prompts.

The good news from the code is that the **plumbing already exists end to end** and the gap is
narrow and semantic, not structural:

1. The "issue log" (`PlatformIssueReport`) already captures severity, error stack, route, and
   trigger kind, and a cron already turns open reports into `BacklogItem`s.
2. `promote_to_build_studio` already turns a `triageOutcome=build` backlog item into a
   `FeatureBuild`.
3. The `build`-phase prompt already contains a "WORKFLOW FOR BUG FIXES AND MODIFICATIONS"
   section ([`build-agent-prompts.ts:263`](../../../apps/web/lib/integrate/build-agent-prompts.ts)).

So this design does **not** introduce a parallel pipeline. It introduces one discriminator —
`kind` — and branches the three phases that are still feature-only (ideate, plan, review),
preserves the issue's context across the promote boundary, and adds the manual intake button.

Four guardrails the implementation must honor:

1. **Additive, not a new type.** `FeatureBrief` is consumed structurally across the orchestrator,
   gates, panels, and the `update_feature_brief` tool. A discriminated `FeatureBrief | FixBrief`
   union would force `kind`-narrowing at every read site and break existing casts. Carry fix
   context as an **optional `fixContext` field** on the one canonical brief.
2. **`kind` is the discriminator, `source` is the input.** `BacklogItem.source` already
   distinguishes `bug`. Map `source → kind` once, at promote time. Do not add `kind` to
   `BacklogItem`.
3. **Back-compat by construction.** `kind` defaults to `feature` in the schema and in every new
   parameter; existing in-flight and historical builds are byte-identical.
4. **Fix the latent enum drift first.** The issue-report triage writers use
   `source:"issue_report"`, which is not in the canonical source enum. Canonicalize to `bug`
   (Phase 0) before the mapping, or issue-sourced builds will not classify as fixes.

This is advisory architecture review folded into the design. It sharpens the plan; it does not
gate the build.

## 1. Problem

Build Studio's pipeline is feature-shaped at every layer:

- **Ideate prompt** opens *"You are helping a user design a new feature."*
  ([`build-agent-prompts.ts:105`](../../../apps/web/lib/integrate/build-agent-prompts.ts)).
- **Brief / design-doc types** (`FeatureBrief`, `BuildDesignDoc`, `ReusabilityAnalysis` in
  [`feature-build-types.ts`](../../../apps/web/lib/explore/feature-build-types.ts)) center on new
  capability: `inputs`, `dataNeeds`, `reusePlan`, scope of generalization. None of these describe
  a defect.
- **The `ideate→plan` gate** (`checkPhaseGate`, [`feature-build-types.ts`](../../../apps/web/lib/explore/feature-build-types.ts) ~709-806)
  requires a design doc + design review + taxonomy placement + epic. A one-line regression fix
  does not belong in the feature taxonomy and is not an epic.
- **Promotion drops the diagnosis.** [`governed-backlog-tee-up.ts`](../../../apps/web/lib/governed-backlog-tee-up.ts)
  copies only `title` and `body` into the new `FeatureBuild`. Severity, error stack, route, repro
  steps, and the originating `PlatformIssueReport` link are all lost.

Meanwhile the operator-facing intake is already there. The "issue log" the operator uses is the
`PlatformIssueReport` table (manual reports via the `report_quality_issue` MCP tool / Feedback
button, plus auto-captured runtime errors from the crash boundary), surfaced at
[`/admin/issue-reports`](../../../apps/web/app/(shell)/admin/issue-reports/page.tsx). A 15-minute
cron ([`queue/functions/issue-report-triage.ts`](../../../apps/web/lib/queue/functions/issue-report-triage.ts))
converts open reports into `BacklogItem`s.

The result: an operator can *report* an issue, and the system can *file* it as backlog, but there
is no governed path that turns it into a **fix** without shoehorning it through the new-feature
playbook — and even then the build runs blind to the diagnostic context that made the report
actionable.

### 1.1 Relationship to the capacity-aware feedback spec

The [capacity-aware feedback escalation design](2026-05-24-capacity-aware-feedback-escalation-design.md)
defines `assessFeedbackRouting()`, whose `expectedClosurePath` includes a **`local_build`** value
— routing an issue into Build Studio for a local fix. That spec explicitly **defers** designing
the Build Studio side of `local_build` (Build Studio integration is out of scope there). **This
spec supplies that missing destination:** the work-kind discriminator and fix intake that the
`local_build` path will target. The two are complementary — capacity-aware feedback decides
*whether* an issue should become a local build; this spec defines *what happens* when it does.

## 2. Current Repo Truth

| Area | Verified current behavior | Design implication |
| ---- | ------------------------- | ------------------ |
| Work kind | `FeatureBuild` has no `kind`/`intent` field ([`schema.prisma`](../../../packages/db/prisma/schema.prisma)). Everything is implicitly a feature. | Add `kind String @default("feature")`. The default makes the change invisible to existing builds. |
| Backlog source | `BACKLOG_SOURCE_VALUES` = `feature-gap, bug, tool-gap, skill-gap, doc-gap, user-request, automated-detection` ([`backlog.ts:122`](../../../apps/web/lib/explore/backlog.ts)). `BacklogItem.source` is `String?` ([`schema.prisma:963`](../../../packages/db/prisma/schema.prisma)). | `bug` already exists. Map `source → kind` at promote time; do not add a parallel field. |
| Triage source drift | [`operate/issue-report-triage.ts:52,254`](../../../apps/web/lib/operate/issue-report-triage.ts) writes `source:"issue_report"`. [`queue/functions/issue-report-triage.ts`](../../../apps/web/lib/queue/functions/issue-report-triage.ts) also writes and queries `source:"issue_report"`. The value is **not** a member of `BACKLOG_SOURCE_VALUES`. | Latent enum drift that reaches the DB and queue dedupe logic. Canonicalize writers and queries to `bug` with a backfill (Phase 0). |
| Brief consumption | `FeatureBrief` is read structurally (`getBuildContextSection`, `build-pipeline.ts` `as FeatureBrief` cast, `validateFeatureBrief`, brief panels, `update_feature_brief`). | Additive optional `fixContext` field; no union, no cast breakage, no brief migration (`brief` is `Json?`). |
| Promotion carry-through | [`governed-backlog-tee-up.ts`](../../../apps/web/lib/governed-backlog-tee-up.ts) `create` block copies only `title`, `description`(=body), `digitalProductId`, `originatingBacklogItemId`. | Add `kind` derivation + `fixContext` population + existing `PlatformIssueReport.featureBuildId` back-link, all inside the existing `prisma.$transaction`. |
| Phase prompt selector | `getBuildPhasePrompt(phase)` → `loadPrompt("build-phase", phase, hardcoded)` ([`build-agent-prompts.ts:497`](../../../apps/web/lib/integrate/build-agent-prompts.ts)); DB-overridable via Admin > Prompts. Terminal phases currently return `""`. | Thread `kind`; select `<phase>-fix` slug for fixes; guard active-phase fallback so a missing override never yields the empty string while terminal phases keep today's empty prompt. |
| Build prompt | Already has "WORKFLOW FOR BUG FIXES AND MODIFICATIONS TO EXISTING FILES" ([`build-agent-prompts.ts:263`](../../../apps/web/lib/integrate/build-agent-prompts.ts)) alongside the new-features workflow. | The `build` phase needs **no** Phase-1 prompt change; only ideate/plan/review branch. |
| Gate | `checkPhaseGate` `ideate→plan` requires `designDoc`, `designReview`, `taxonomyNodeId`, `backlogItemId`, `epicId`, `constrainedGoal`. The `reviewDesignDoc` MCP path ([`mcp-tools.ts` ~7263-7611](../../../apps/web/lib/mcp-tools.ts)) requires `designDoc` and calls the gate. | Branch both on `kind`: for `fix`, a populated `fixContext` substitutes for `designDoc`; taxonomy/epic optional. |
| Issue log lifecycle | `PlatformIssueReport` statuses in [`issue-report-status.ts`](../../../apps/web/lib/quality/issue-report-status.ts), including `triaged_local`; canonical writer `createPlatformIssueReport()`; admin UI has status/suppress/triaged actions only — no "send to build" affordance. `PlatformIssueReport.featureBuildId` field **already exists**. | The back-link field and status vocabulary exist; add the manual "Send to Build Studio as a fix" action, make it idempotent, populate the link at promote, and transition the report to `triaged_local`. |

## 3. Research & Benchmarking

How established trackers model the feature-vs-fix distinction and intake. The point is the data
model and routing semantics, not feature lists.

| System | Model (verified from product docs) | Adopt | Reject |
| ------ | ---------------------------------- | ----- | ------ |
| **GitHub Issue Types / Issue Forms** | Org-level **issue types** (Bug, Feature, Task) are a first-class field on the issue, distinct from labels; issue forms collect structured fields (repro, expected/actual) per type. Sources: [GitHub issue types](https://docs.github.com/en/issues/tracking-your-work-with-issues/configuring-issues/managing-issue-types-in-an-organization), [issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository). | A small **closed** kind enum as a first-class field (not a label) is the right primitive; structured fix fields (repro/expected/actual) mirror issue forms. | Do not model kind as a free-text label or let it proliferate (Bug/Defect/Regression/Hotfix…). Two values now: `feature`, `fix`. |
| **Jira issue-type schemes + Service Management request types** | Issue types (Bug/Story/Task) drive workflow and field configuration; Service Desk *request types* present a friendly intake face over those issue types so reporters never pick a raw type. Sources: [Jira issue types](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types/), [JSM request types](https://support.atlassian.com/jira-service-management-cloud/docs/what-are-request-types/). | Kind drives different prompts/gates (the DPF analogue of type-driven workflow); the operator never picks "kind" — the platform derives it from `source`. | Do not expose kind selection or workflow config to the non-technical operator. |
| **Linear Bug vs Feature + Customer Requests** | Bug vs Feature is a lightweight attribute; customer requests link source feedback to the issue while preserving the source link. Source: [Linear customer requests](https://linear.app/docs/customer-requests). | Preserve the **source link** from the issue report to the build (`PlatformIssueReport.featureBuildId` back-link) so closure can be projected later. | Do not require heavyweight classification before work can start. |
| **ServiceNow incident / problem / change** | Sharp separation: incident restores service, problem management investigates root cause, and change implements controlled remediation with linkage. Source: [ServiceNow problem management process](https://www.servicenow.com/docs/r/it-service-management/problem-management/c_ProblemManagementProcess.html). | The conceptual split maps cleanly: `PlatformIssueReport` approximates incident evidence, the fix `FeatureBuild` approximates the controlled change, and `fixContext.rootCause` captures the lightweight problem analysis. | Do not adopt three separate DPF tables; DPF already has report + build. Capture root cause as a field, not a new entity. |
| **Sentry issue → fix linkage** | Runtime events group into issues with stack/context and links to resolution activity. Source: [Sentry issue details](https://docs.sentry.dev/product/issues/issue-details/). | Carry stack/severity/route from `PlatformIssueReport` into the build's `fixContext` so the fixer starts with the diagnosis, not a blank brief. | Do not ship raw stacks/PII upstream; that is governed by the existing privacy spec, out of scope here. |

**Patterns adopted:** first-class closed kind enum; platform-derived (not operator-chosen) classification; structured fix fields mirroring issue forms; preserved source link for later closure projection. **Anti-patterns rejected:** kind-as-label proliferation; a parallel bug-tracker table; forcing classification/workflow choices onto the operator; a discriminated-union brief that fragments every reader.

## 4. Design

### 4.1 Work kind enum

Declare in [`apps/web/lib/explore/feature-build-types.ts`](../../../apps/web/lib/explore/feature-build-types.ts),
the canonical home for `FeatureBuild` contracts:

```ts
export const FEATURE_BUILD_KIND_VALUES = ["feature", "fix"] as const;
export type FeatureBuildKind = (typeof FEATURE_BUILD_KIND_VALUES)[number];
```

Single hyphen-free words per AGENTS.md §3. `BacklogItem.source` remains owned by
[`apps/web/lib/explore/backlog.ts`](../../../apps/web/lib/explore/backlog.ts); `FeatureBuild.kind`
is owned by `feature-build-types.ts`. Mirror or import the enum in relevant `FeatureBuild`-facing
MCP tool definitions in [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts) only
where a tool accepts or returns `kind`, and add a parity test if the tool schema mirrors the list.
Adding a third value later (e.g. `chore`) requires updating the canonical enum and any mirror in
one commit, before any data uses it.

### 4.2 Schema

Add to `FeatureBuild` ([`schema.prisma:4404`](../../../packages/db/prisma/schema.prisma)):

```prisma
kind String @default("feature")  // feature | fix - see FEATURE_BUILD_KIND_VALUES
```

Migration `feature_build_kind`. The default backfills all existing rows to `feature`; no manual
backfill needed. `kind` is **not** added to `BacklogItem` — `source` is the input, `kind` is the
derived discriminator on the build.

### 4.3 Fix context on the brief (additive)

Extend `FeatureBrief` in [`feature-build-types.ts`](../../../apps/web/lib/explore/feature-build-types.ts):

```ts
type FixContext = {
  reproSteps?: string;
  expected?: string;
  actual?: string;
  rootCause?: string;
  fixApproach?: string;
  severity?: "critical" | "high" | "medium" | "low";
  originatingIssueReportId?: string;
  originatingIssueReportPublicId?: string;
  routeContext?: string;
  errorStackExcerpt?: string;
};

type FeatureBrief = {
  // ...existing fields unchanged...
  fixContext?: FixContext;  // present iff the build's kind === "fix"
};
```

Optional, so every existing reader (`getBuildContextSection`, the `as FeatureBrief` cast in
`build-pipeline.ts`, `validateFeatureBrief`, `FeatureBriefPanel`, `update_feature_brief`) compiles
and behaves unchanged. `brief` is a `Json?` column, so no migration for this. `getBuildContextSection`
gains a small block that renders `fixContext` when present.

The fields are optional because promotion can seed only observed report facts (`severity`,
`routeContext`, stack excerpt, and public/internal report ids). The fix gate, not the type, is
responsible for requiring reproduction evidence, root cause, and fix approach before a fix build
advances from ideate to plan.

### 4.4 Intake carry-through (promote)

In [`governed-backlog-tee-up.ts`](../../../apps/web/lib/governed-backlog-tee-up.ts), inside the
existing `prisma.$transaction`:

1. **Derive `kind`:** `item.source === "bug" ? "fix" : "feature"` — set on the new `FeatureBuild`.
2. **Resolve source report when available.**
   - Manual admin action: pass the concrete `PlatformIssueReport.id` into the promotion helper; no
     body parsing is needed.
   - Cron-created BI path: parse only the stable `Source report: <reportId>` line produced by the
     triage writer as a Phase-1 compatibility bridge. If parsing fails or the report is missing,
     still create the fix build and write a `BuildActivity` note that no source report was linked.
3. **Populate `fixContext`** when `kind === "fix"`: seed `severity`, route, stack excerpt, and
   report identifiers from the originating `PlatformIssueReport` when known, leaving
   `rootCause`/`fixApproach` for the ideate phase to fill. When there is no linked report (a
   manually-filed `source=bug` BI), seed `fixContext` from the BI `body`. Write it into the
   build's `brief`.
4. **Back-link:** set the existing `PlatformIssueReport.featureBuildId = <new FeatureBuild.id>`
   for the originating report. This write lives **inside the same transaction** so a rollback
   cannot orphan the link.

Do not add a direct `BacklogItem -> PlatformIssueReport` relation in Phase 1. Revisit it in Phase
2 only if the cron-created BI compatibility bridge proves lossy in real use.

### 4.5 Prompt branching

`getBuildPhasePrompt(phase)` → `getBuildPhasePrompt(phase, kind)`
([`build-agent-prompts.ts:497`](../../../apps/web/lib/integrate/build-agent-prompts.ts)). For
`kind === "fix"`, select the `<phase>-fix` `loadPrompt` slug (still DB-overridable via Admin >
Prompts) with a hardcoded fix-prompt fallback for active phases. Preserve today's terminal-phase
behavior: `complete` and `failed` still return the empty string.

Phase-1 fix prompts (hardcoded defaults, three phases only):

- **ideate-fix** — *"You are diagnosing a reported defect."* Reproduce the issue, identify the
  root cause, scope the **smallest correct fix**. No reusability/generalization questions, no
  taxonomy interrogation. Fill `fixContext.rootCause` and `fixContext.fixApproach`.
- **plan-fix** — Plan the **targeted change plus a regression test** that fails before and passes
  after. Prefer modifying existing files over adding new capability.
- **review-fix** — Verify the defect **no longer reproduces** and that a regression test was added.
  Acceptance is "the reported behavior is gone," not "a new capability works."

The `build` phase reuses the existing "WORKFLOW FOR BUG FIXES AND MODIFICATIONS" section
([`build-agent-prompts.ts:263`](../../../apps/web/lib/integrate/build-agent-prompts.ts)) and is
unchanged in Phase 1.

### 4.6 Gate relaxation

`checkPhaseGate` ([`feature-build-types.ts`](../../../apps/web/lib/explore/feature-build-types.ts)
~709-806) is threaded `kind`. For the `ideate→plan` transition when `kind === "fix"`:

- a populated `fixContext` (reproduction evidence or explicit repro steps + root cause + fix
  approach) **substitutes for** the feature `designDoc` requirement;
- a review result in the existing `ReviewResult` shape confirms the fix diagnosis/approach;
- `taxonomyNodeId` and `epicId` are **optional**.

The `reviewDesignDoc` MCP auto-advance path ([`mcp-tools.ts` ~7263-7611](../../../apps/web/lib/mcp-tools.ts)),
which today requires `designDoc` and then calls the gate, branches on `kind` to review and require
a complete `fixContext` instead. `BuildContext` and the context loader
([`feature-build-data.ts`](../../../apps/web/lib/explore/feature-build-data.ts) select,
[`build-pipeline.ts`](../../../apps/web/lib/integrate/build-pipeline.ts)) thread `kind` so prompts
and gate see it. The coworker-chat path flows through `getFeatureBuildForContext`, so it inherits
`kind` once `BuildContext` carries it — no separate edit.

### 4.7 Manual intake affordance

Add a **"Send to Build Studio as a fix"** action to the Admin issue-reports UI
([`app/(shell)/admin/issue-reports/page.tsx`](../../../apps/web/app/(shell)/admin/issue-reports/page.tsx),
[`components/admin/IssueReportPanel.tsx`](../../../apps/web/components/admin/IssueReportPanel.tsx))
backed by a server action in
[`lib/actions/quality.ts`](../../../apps/web/lib/actions/quality.ts). The action:

1. if `PlatformIssueReport.featureBuildId` is already populated, links to that build instead of
   creating another;
2. reuses an existing open bug `BacklogItem` for the report when one can be resolved;
3. otherwise creates a `BacklogItem` with `source="bug"`, `triageOutcome="build"`, an `effortSize`
   (default `small`, operator-adjustable), seeded from the report's title/description/severity;
4. promotes it via the existing promote path, which derives `kind="fix"` and carries `fixContext`
   + the back-link per §4.4;
5. transitions the report to the existing `triaged_local` status.

This is the explicit manual "I reported an issue → fix it" path. The 15-minute triage cron remains
the automatic path; both converge on the same `source=bug → kind=fix` promotion, so behavior is
consistent regardless of entry point.

### 4.8 Phase 0 — canonicalize the source enum

Before any `source → kind` mapping, fix the drift: issue-report triage code writes and queries
`source:"issue_report"`, absent from `BACKLOG_SOURCE_VALUES`. Change both
[`operate/issue-report-triage.ts`](../../../apps/web/lib/operate/issue-report-triage.ts) and
[`queue/functions/issue-report-triage.ts`](../../../apps/web/lib/queue/functions/issue-report-triage.ts)
to use the canonical `"bug"`, with an inline backfill in the migration:

```sql
UPDATE "BacklogItem" SET source = 'bug' WHERE source = 'issue_report';
```

`bug` is already canonical and semantically correct, so this both removes the drift and makes every
issue-sourced backlog item eligible to classify as a fix. This slice is standalone and can land
ahead of the rest.

## 5. Implementation Phasing

| Phase | Scope | Standalone? |
| ----- | ----- | ----------- |
| **0** | Canonicalize `issue_report → bug` in both issue-report triage writers/queries + backfill SQL. | Yes — small, no dependency on the rest. |
| **1** | `FEATURE_BUILD_KIND_VALUES` enum (+ any MCP mirror); `FeatureBuild.kind` column/migration; additive `fixContext` on `FeatureBrief`; promote `source→kind` mapping + `fixContext` population + PIR back-link (in-tx); ideate/plan/review fix prompts + selector threading; gate + `reviewDesignDoc` fix branch; `BuildContext`/loader/pipeline threading; minimal UI (kind badge + `fixContext` render, degrading when absent); Admin "Send to Build Studio as a fix" action with idempotency. | Delivers the full end-to-end fix path. |
| **2** (deferred) | First-class PIR↔build round-trip + auto-resolve the `PlatformIssueReport` on ship; fix-aware **specialist** prompts ([`specialist-prompts.ts`](../../../apps/web/lib/integrate/specialist-prompts.ts)) + a regression-test-required review gate; wire the capacity-aware spec's `local_build` decision to this destination; an `update_fix_brief` MCP tool; optional `BacklogItem → PlatformIssueReport` FK if body-parsing `fixContext` proves lossy. | Hardening + integration. |

## 6. Verification Gates

Implementation (Phase 0 + 1) must meet the AGENTS.md §5 build gate:

| Layer | What to run / show |
| ----- | ------------------ |
| Unit tests | `pnpm --filter web exec vitest run` for: gate fix-path (fix advances on `fixContext`, feature still requires `designDoc`); promote mapping (`source=bug → kind=fix`, `fixContext` populated, PIR `featureBuildId` set); both triage paths emit/query `source=bug`; prompt selector returns a non-empty fix prompt for each branched active phase and preserves empty prompts for terminal phases; admin action is idempotent when `featureBuildId` already exists. |
| Typecheck / build | `pnpm --filter web typecheck`; `cd apps/web && pnpm exec next build` with zero errors (TS errors only surface in `next build`). |
| Migration | `feature_build_kind` (+ Phase-0 backfill) applies cleanly via `prisma migrate dev`. |
| UX | Against the Docker-served portal: file a `runtime_error` (or manual issue) → Admin issue-reports → "Send to Build Studio as a fix" → confirm the build opens in the **fix-branched** ideate phase, `fixContext` is visible, and the kind badge shows `fix`. Use the `build-studio-operator` lens for the lifecycle gates. |

This spec's own quality gate (pre-implementation): `dpf-architecture-review` lens applied; live
MCP duplicate-spec check done (empty); every code reference ground-truthed against the current tree.

## 7. Risks & Open Decisions

| Item | Resolution |
| ---- | ---------- |
| Back-compat for in-flight feature builds | `@default("feature")` + every new `kind` parameter defaults to `feature` ⇒ existing behavior byte-identical. Low risk. |
| `issue_report` vs `bug` drift | Phase 0 must land first, or issue-sourced builds never classify as fixes. |
| Concurrency / orphaned link | The `PlatformIssueReport.featureBuildId` write must be inside the promote `prisma.$transaction`. |
| Empty-prompt regression | Guard the `<phase>-fix` slug for active phases: a missing DB override falls back to the hardcoded fix prompt. Terminal phases continue to return the empty string. |
| Brief shape | **Decision:** additive optional `fixContext`, not a discriminated union — preserves all structural readers. Revisit a `BacklogItem→PlatformIssueReport` FK only if body-parsing `fixContext` proves lossy (Phase 2). |
| Kind proliferation | **Decision:** closed enum, two values (`feature`, `fix`) now. New values require the §3 enum-update discipline in the canonical enum and any MCP mirror. |
| Effort sizing for fixes | Manual affordance defaults `effortSize="small"`, operator-adjustable. The promote eligibility check (`effortSize != null`) is satisfied without forcing the operator to size a defect blind. |

## 8. Next Step After Sign-Off

On approval, file the backlog item(s), then implement **Phase 0 + Phase 1 directly in this repo**
— the "Build Studio for ALL development" rule is intentionally overridden here because Build Studio
is not yet fully working — on a topic branch, via a DCO-signed PR, meeting the full build gate.
Phase 2 is filed as follow-up backlog and not started until Phase 1 has landed and accrued
evidence.
