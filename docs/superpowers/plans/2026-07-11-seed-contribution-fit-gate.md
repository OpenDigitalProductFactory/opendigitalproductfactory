# Governed Seed Contribution Fit Gate

| Field | Value |
| --- | --- |
| Date | 2026-07-11 |
| Status | In progress |
| Backlog item | `BI-FAF815CE` |
| Work capsule | `WC-94582DB1` |
| Design anchor | `docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md` §§4.2-4.3, 5.2.4, 6.4 |

## Outcome

Turn the governed-upgrade seed-fit design into an enforceable first vertical
slice. A Hive contribution that changes canonical seed sources must carry one
reviewed applicability decision, that decision must be visible to the platform
operator, and PR CI must fail when the evidence is missing or contradictory.

This slice extends the existing `FeaturePack` contribution-review substrate. It
does not add a second review table or attempt the later fleet-wide
`SeedSnapshot`/customization-fingerprint migration.

## Existing Substrate

- `apps/web/lib/integrate/contribution-review.ts` already produces structured
  sanitization, parameterization, vertical-applicability, security, and merge
  readiness evidence.
- `FeaturePack.reviewReport` stores the full structured result; the same model
  already carries `sourceVertical`, `applicableVerticals`, `reusabilityScope`,
  PR identity, and review timestamps.
- `contribute_to_hive` in `apps/web/lib/mcp-tools.ts` already builds the pack
  manifest, opens the PR, and invokes contribution review.
- `/admin/hive` is the operator's canonical contribution-governance home.
- `.github/workflows/ci.yml` already hosts evidence-based PR gates for UX fit
  and process-spine documentation.
- No seed-delta manifest generator exists on `origin/main`; this slice defines
  the first machine-readable contribution-level contract inside the existing
  FeaturePack manifest.

## UX Fit Review

- **Decision:** fits-with-guardrails.
- **Owning area:** Platform, contribution governance.
- **Route family:** existing `/admin/hive`; no new route or navigation item.
- **Primary persona:** platform operator deciding whether community changes are
  safe and broadly applicable.
- **Navigation layer touched:** local page content only.
- **Reuse/convergence:** use report-kit `DataTable`, `StatusBadge`, and
  `EmptyState`; remove the page-local contribution status color map where the
  touched table can use canonical intent semantics.
- **Source truth:** `FeaturePack.reviewReport.seedFit` plus the embedded
  contribution manifest seed delta.
- **Empty/failure behavior:** explain that no seed-changing contribution has
  been reviewed yet; malformed legacy JSON renders as unavailable evidence,
  never as approval.
- **AI boundary:** read-only evidence; no prompt is sent and no merge is
  performed from this page.
- **Guardrails:** show the decision, affected seed paths, scope, and rationale;
  avoid exposing internal phase names or adding another dashboard.
- **Evidence before merge:** pure contract tests, action/view tests, component
  render tests, theme-token scan, desktop/mobile browser exercise of
  `/admin/hive`, and production build.

The design-intelligence lookup returned no more specific pattern than the
existing DPF admin/report-kit conventions, so those repo-native patterns remain
authoritative.

## Phase 1 - Contract and Tests

Create a pure contribution seed-fit module under
`apps/web/lib/integrate/seed-contribution-fit.ts` with:

- one canonical `SeedContributionFitDecision` union;
- centralized canonical seed-path matching;
- deterministic, conservative classification from existing sanitization,
  parameterization, security, and vertical evidence;
- merge-readiness policy for allowed versus remediation/rejection decisions;
- a serializable contribution-level seed-delta manifest.

Write focused Vitest coverage first and observe the expected red state before
implementation.

Verification: targeted Vitest suite passes and decision/path exhaustiveness is
typechecked.

## Phase 2 - Contribution Review Integration

Extend `ContributionReviewResult` with seed-fit evidence. Include the decision
and rationale in the GitHub review report, labels, status description, activity
log, and `FeaturePack.reviewReport`. Merge the generated seed-delta object into
the existing FeaturePack manifest without discarding existing manifest fields.

Compute the same deterministic decision before PR creation so generated Hive
PR bodies carry `Seed-Fit-Decision:` evidence on their first CI run. Decisions
that require parameterization, local-only retention, or rejection prevent a
`ready` merge-readiness result while preserving the reusable code review path.

Verification: targeted contribution-review and MCP contribution tests cover
seed and non-seed changes, including manifest preservation.

## Phase 3 - Universal PR Gate

Add a small pure Node library plus `scripts/check-seed-fit-decision.mjs`. The
gate diffs changed files, reuses the canonical path vocabulary in a
Node-compatible manifest, and accepts exactly one matching decision from PR
body metadata or `seed-fit:<decision>` labels. It fails missing, invalid, or
contradictory evidence.

Wire the gate into `.github/workflows/ci.yml` for pull requests, passing refs,
body, and labels as inert environment values. Non-PR events report a terminal
success because PR review metadata does not exist there.

Verification: `node --test` covers no-seed, missing, valid, duplicate, and
contradictory cases; local CLI execution against the branch behaves as expected.

## Phase 4 - Operator Visibility

Extend `getHiveContributionsView()` with recent reviewed FeaturePacks and add a
small client table composed from report-kit. The `/admin/hive` page shows the
seed-fit decision, source PR, applicable scope, affected path count, rationale,
and review time. Legacy reviews without seed-fit evidence remain visibly
unclassified.

Verification: action mapping test, component render test, typecheck, production
build, and browser checks at desktop and mobile widths with no overlap.

## Risk and Rollback

- **False-positive seed paths:** keep matching centralized and test each path
  family; the CI failure tells the contributor which paths triggered it.
- **Auto-classification too permissive:** global approval requires existing
  evidence to be generic and clean; uncertainty resolves to remediation, not
  approval.
- **Legacy FeaturePacks:** parsing is additive and fail-closed; old JSON remains
  readable and is never rewritten merely by viewing the page.
- **CI deadlock:** the contribution pipeline places metadata in the initial PR
  body; maintainers can also provide an explicit reviewed trailer or label.
- **Rollback:** remove the CI job first if it blocks unrelated delivery, then
  revert UI/integration. All persisted fields are additive JSON, so no schema
  rollback or data migration is required.

## Later Work Kept Explicitly Out of Scope

This PR does not claim the full governed-upgrade design is complete. The
fleet-safe `SeedSnapshot` registry, three-way customization fingerprints,
signed release channel manifest, automatic backup/recovery rehearsal, and
production seed reconciliation remain separate implementation slices under the
same design.
