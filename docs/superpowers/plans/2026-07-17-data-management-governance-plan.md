# Data Management Governance — Implementation Plan

> **For agentic workers:** REQUIRED: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR (Delivery rule 1). Use the DPF-native skills: `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the per-BI completion gate before any success claim, and `dpf-pr-with-dco` for handoff, with a code review pass before requesting merge. The upstream `superpowers:*` skill names are retired in this repo and must not be invoked (see `docs/superpowers/specs/2026-05-30-dpf-native-skill-equivalents-design.md`).

**Goal:** Build an embedded, enforceable data-governance control plane in which every persistent asset, MDM domain, lifecycle action, derived copy, AI exposure, and policy decision has an accountable owner, machine-checkable contract, enforcement point, and evidence.

**Architecture:** A source-controlled logical data-asset inventory composes typed classification, lifecycle, MDM, processing-purpose, derived-copy, protection, and executable-policy modules. Organization-specific processing activities, exceptions, holds, conflicts, and evidence are persisted. One pure in-process PDP feeds many PEPs. The `/admin/data` workspace exposes the same contracts in plain language.

**Tech stack:** Next.js 16, TypeScript, Prisma 7/Postgres 16, Neo4j 5, Qdrant, Inngest queue functions, Vitest, report-kit, DPF MCP, and the shared local-integration CI lease.

**Spec:** `docs/superpowers/specs/2026-07-17-data-management-governance-design.md`

**Live work:** EP-DATA-GOVERNANCE (`BI-DG-001` through `BI-DG-016`), EP-DATA-RETENTION (`BI-DR-101` through `BI-DR-107`), and EP-MDM (`BI-MDM-201` through `BI-MDM-203`). Existing BI IDs are retained; do not invent replacements. Assigned on 2026-07-17 backlog reconciliation: durable operation journal = `BI-DG-014` (Task 4B), first legacy classification wave = `BI-DG-015` (Task 4A; each subsequent wave is filed as its predecessor closes), workspace consolidation = `BI-DG-016` (Task 21), MDM readiness/crosswalks = `BI-MDM-201` (Task 5A), MDM survivorship/provenance = `BI-MDM-202` (Task 5B), MDM autonomy/publish/retraction = `BI-MDM-203` (Task 5C). Still deliberately deferred to their in-plan gates: one BI per approved protected-field family (after `BI-DG-007` core), one BI per approved DR-107 partition stream (after measured approval), and one BI per subject-request copy adapter plus the activation BI (after `BI-DG-008` core).

---

## Delivery rules

1. One BI, one topic branch, one worktree, one ready-for-review PR. Start each from current `origin/main`; do not stack all phases on one branch.
2. Query the live backlog and current schema at the start of every BI. This plan's research baseline was 495 Prisma models at `origin/main` `5834e7548`; it is not a permanent count.
3. Tests fail before production code changes. Every new executable policy includes allow, deny, review/obligation, unknown-context, and expiry/precedence vectors.
4. No new generic registry, policy table, log, receipt, or admin page until the implementer re-checks current overlap. Reuse and adapt the substrate named in the spec.
5. Runtime-bound build, migration, queue, cross-store, and UX evidence comes from the canonical install or a lease on `local-integration-ci`, never a worktree-only runtime claim.
6. Each migration is immutable after commit, includes any data backfill, and uses `pnpm --filter @dpf/db exec prisma ...`, never `npx`.
7. Any new route, UI, agent, or workflow gets UX-fit evidence. Use report-kit, theme tokens, accessible text alternatives, and in-app dialogs.
8. Every PR updates its live BI through MCP and records execution evidence. A local-only green check is not completion.

### Per-BI completion gate (applies to every implementation task)

No later task supplies missing evidence for an earlier PR. Before marking any BI task complete, its agent must:

- [ ] Run the task's targeted red/green tests and affected-package typecheck with zero failures.
- [ ] Claim `local-integration-ci` through MCP, recording the BI, branch, and SHA.
- [ ] Run `pnpm --filter web build` in the leased canonical verification workspace with zero errors.
- [ ] If the BI owns a migration, run `pnpm --filter @dpf/db exec prisma migrate deploy` there and record the applied migration name; otherwise record “no migration.”
- [ ] Exercise that BI's affected runtime/queue/cross-store/UX path, including its stated failure and permission states.
- [ ] Record commands, output, SHA, migration verdict, and UX/runtime result through `record_execution_evidence` against that BI.
- [ ] Release the environment lease in a `finally` path.
- [ ] Run the in-scope secret scan and `pnpm pr:health`, create a DCO-signed commit (`git commit -s`), push the branch, and open a regular ready-for-review PR only when every gate is green.

Unless a task says that measured deferral is its intended result, every verification block below expects all listed tests to pass and typecheck to exit zero. A failing test for an unrelated baseline defect is recorded and handled under the project blocker rule; it is never reported as a pass.

### Migration checklist (applies to every migration-owning task)

- [ ] Run the named creation command from the task, inspect the generated `packages/db/prisma/migrations/<timestamp>_<name>/migration.sql`, and replace the placeholder path in the BI evidence with the immutable generated path.
- [ ] Put any data backfill in that same migration. If no backfill is required, add an explicit SQL comment and state why in the BI evidence.
- [ ] Add an invariant query/test that distinguishes complete, partial, and duplicate backfill results.
- [ ] Run schema validation before creation, targeted tests after creation, and `prisma migrate deploy` under the per-BI leased completion gate.

## Refactoring budget — 20% of delivery capacity

This allocation is a delivery constraint, not optional cleanup:

| Refactoring outcome | Capacity |
|---|---:|
| Split the governance spine into focused typed modules and remove duplicated classifications | 5% |
| Consolidate PDP/PEP evaluation used by MCP, UI, MDM, AI context, projection, and lifecycle | 5% |
| Adapt existing MDM domain/crosswalk/trust/receipt services instead of parallel models | 3% |
| Generalize derived-copy cleanup, reconciliation, and staleness adapters | 3% |
| Consolidate data UI under `/admin/data` and replace hand-built status widgets with report-kit | 4% |
| **Total** | **20%** |

If schedule pressure appears, reduce feature breadth or move a whole BI; do not collapse these boundaries into a monolith.

---

## Chunk 0 — Reconcile the live baseline and delivery backlog

### Task 0: Rebase the facts before implementation

**Files:**

- Read: `AGENTS.md`
- Read: `packages/db/prisma/schema.prisma`
- Read: `docs/superpowers/specs/2026-05-31-master-data-management-alignment-design.md`
- Read: `docs/superpowers/specs/2026-07-04-mdm-write-time-dedup-and-lifecycle-design.md`
- Read: `docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md`
- Modify only if facts changed: this spec and plan

**Steps:**

- [ ] Confirm the worktree is on a non-main topic branch with `git status --short --branch` and `git branch --show-current`.
- [ ] Fetch `origin` and start the implementation branch/worktree from current `origin/main` using the repository's worktree procedure and bootstrap script.
- [ ] Query `EP-DATA-GOVERNANCE`, `EP-DATA-RETENTION`, and `EP-MDM` through DPF MCP; record current statuses, acceptance criteria, dependencies, and ownership.
- [ ] Count and inventory current Prisma models from `packages/db/prisma/schema.prisma`; compare the result with the logical asset registry if it already exists.
- [ ] Re-audit current routes, MDM files, retention registries, projection stores, compliance policy models, and receipt models. Treat unexpected new overlap as a design input, not something to work around.
- [ ] Through MCP, update the affected existing BI acceptance criteria to reference the revised spec.
- [ ] Through MCP, create or link non-overlapping items only where no live item already covers the scope:
  - one legacy classification/lifecycle wave per bounded data domain;
  - one durable data-control operation journal item under EP-DATA-GOVERNANCE;
  - separate EP-MDM items for readiness/crosswalks, survivorship/provenance, and autonomy/publish/retraction;
  - one protection rollout item per approved field family after the key-service core;
  - one final `/admin/data` consolidation/redirect/usability item after capability-owning pages land.
- [ ] Update this plan's work-package headings with the assigned real BI IDs before an agent executes them. A heading that still says “assigned in Task 0” is a planning template, not an executable work claim.
- [ ] Replace every “discovered in Task 0,” `<family>`, `<model>`, and “exact ... recorded in the BI” placeholder with the rebased exact create/modify/test paths before claiming that BI. Do not execute a template with unresolved files.
- [ ] Do not place supplier-pilot work into the new MDM governance item; the existing supplier pilot remains its own domain rollout.
- [ ] Record a Work Capsule decision note with the new baseline SHA, model count, and chosen BI mapping.

**Verification:**

```powershell
git status --short --branch
git rev-parse origin/main
(git show origin/main:packages/db/prisma/schema.prisma | Select-String '^model ').Count
```

Expected: topic branch, current fetched SHA, and a fresh model count recorded in the capsule. No source edits occur until backlog ownership and overlap are resolved.

---

## Chunk 1 — Stop the exposure and establish the control spine

### Task 1: BI-DG-001 — Gate and clean up semantic memory

**Files:**

- Modify: `apps/web/lib/inference/semantic-memory.ts`
- Modify: `apps/web/lib/inference/semantic-memory.test.ts`
- Create: `apps/web/lib/inference/semantic-memory-cleanup.ts`
- Create: `apps/web/lib/inference/semantic-memory-cleanup.test.ts`
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Modify: `apps/web/lib/operate/retention/policies.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`

**Steps:**

- [ ] Write a failing test proving a `restricted` turn cannot write raw content or a raw preview to Qdrant.
- [ ] Write a failing test proving a `confidential` turn passes through a deterministic masking seam before vector storage.
- [ ] Write a failing test proving message/thread purge requests vector deletion by stable source identifiers and is idempotent.
- [ ] Write a failing reconciliation test that reports and removes a vector whose source message no longer exists.
- [ ] Run the targeted tests and confirm the failures are for missing policy/cleanup behavior.
- [ ] Pass route sensitivity and declared purpose into the semantic-memory write input; do not recompute a competing sensitivity.
- [ ] Implement fail-closed storage behavior: restricted skips content storage; confidential uses the interim deterministic mask; public/internal preserve current behavior until field policy lands.
- [ ] Store source identifiers required for deletion without adding sensitive values to Qdrant payload metadata.
- [ ] Implement idempotent batch cleanup and connect message/thread retention deletion to it.
- [ ] Emit bounded cleanup evidence: collection, source kind, candidate/removed/failed counts, and error codes — never raw content.
- [ ] Run targeted tests, web typecheck, and secret scan.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/inference/semantic-memory.test.ts lib/inference/semantic-memory-cleanup.test.ts
pnpm --filter web typecheck
pnpm security:secrets
```

Expected: restricted raw-write test, masked confidential-write test, idempotent deletion test, and orphan-reconciliation test all pass.

### Task 2: BI-DG-002 — Create the composed logical data-control spine

**Files:**

- Create: `apps/web/lib/govern/data/taxonomy.ts`
- Create: `apps/web/lib/govern/data/assets.ts`
- Create: `apps/web/lib/govern/data/legacy-coverage-baseline.ts`
- Create: `apps/web/lib/govern/data/processing-activities.ts`
- Create: `apps/web/lib/govern/data/lifecycle-classes.ts`
- Create: `apps/web/lib/govern/data/derived-data-contracts.ts`
- Create: `apps/web/lib/govern/data/executable-policies.ts`
- Create: `apps/web/lib/govern/data/policy-decision.ts`
- Create: `apps/web/lib/govern/data/policy-enforcement.ts`
- Create: `apps/web/lib/govern/data/coverage.ts`
- Create: matching `*.test.ts` files for each module
- Modify: `apps/web/lib/ea/data-model-mirror-apply.ts`

**Steps:**

- [ ] Write the closed unions and normative types from spec §§6.1, 6.5, and 6.7. Keep sensitivity, category, criticality, quality, residency, MDM domain, lifecycle, and purpose independent.
- [ ] Write failing tests for stable `DataAssetId`/`DataFieldId`, plural executable subject locators, field resolution/provenance, label state/source, and field-level protection metadata.
- [ ] Reuse `parsePrismaSchema` from `apps/web/lib/integrate/code-graph/extractors/prisma-schema-adapter.ts` to write a failing total-coverage test against the current schema.
- [ ] Generate denominators independently from Prisma, projection producers, PEP entry points, destructive handlers, and MDM domains.
- [ ] Seed stable model-level asset identities and valid inherited defaults where a reviewed domain rule exists. Put every pre-existing unresolved model/field/contract into the immutable legacy baseline with owner, risk, remediation BI, and deadline; never invent a blanket “internal/standard” classification to make coverage green.
- [ ] Make new/changed models and fields fail immediately when unresolved; prove legacy entries cannot grow, transfer to a new object, or hide a changed object.
- [ ] Write failing cross-registry tests: every asset has a lifecycle; every MDM domain maps to an asset; every content projection maps to field policy; prohibited fields cannot be persisted/projected; stable IDs are unique.
- [ ] Implement pure lookup and composition functions. No database calls are allowed in these modules.
- [ ] Add logical asset/classification properties to the existing EA mirror output; do not create another ERD or lineage graph.
- [ ] Add a generated inventory summary used by UI and gates without exposing live values.
- [ ] Confirm no focused module exceeds 500 lines without an explicit decomposition note.
- [ ] Run registry tests and typecheck.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/govern/data
pnpm --filter web exec vitest run lib/ea/data-model-mirror-apply.test.ts
pnpm --filter web typecheck
```

Expected: current Prisma facts are fully accounted for as governed/inherited/not-applicable or as named immutable legacy gaps; new/changed coverage is 100%, the baseline cannot grow, and every invariant violation names the exact asset/field.

### Task 3: BI-DG-003 — Add the content-based Data-Impact Gate

**Files:**

- Create: `scripts/check-data-impact.mjs`
- Create: `scripts/check-data-impact.test.mjs`
- Create: `docs/testing/fixtures/data-impact/`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `apps/web/lib/integrate/build-agent-prompts.ts`
- Modify: `AGENTS.md`

**Steps:**

- [ ] Create red fixtures for an unregistered model, sensitive field without field policy, uncontracted projection, MDM domain without publish/lifecycle contract, and destructive executor without a hold check.
- [ ] Create green fixtures for a complete `DataImpactManifest` and a structured, unexpired exception.
- [ ] Write a failing gate test that inspects changed schema/migration/projection/context/MDM/lifecycle surfaces, not merely whether one registry file changed.
- [ ] Define the manifest schema with asset IDs, change kinds, policy decisions, accountable owner, affected copies, migration/backfill, and tests.
- [ ] Define exception fields: scope, approver, rationale, compensating control, expiry, and remediation BI. Reject exceptions for asset/lifecycle coverage and prohibited storage.
- [ ] Implement deterministic errors suitable for CI and Build Studio. Do not print data values or provenance noise in tool descriptions.
- [ ] Add the gate to local/CI scripts and the Build Studio prompt contract.
- [ ] Add a concise `AGENTS.md` pointer to the design; keep detailed doctrine here.
- [ ] Run gate tests against every red/green fixture.

**Verification:**

```powershell
node --test scripts/check-data-impact.test.mjs
node scripts/check-data-impact.mjs
pnpm --filter web typecheck
```

Expected: every red fixture fails for its intended reason; complete current source passes.

### Task 4: BI-DG-004 — Detect governance drift at runtime

**Files:**

- Modify: `apps/web/lib/ea/data-architecture-steward.ts`
- Modify: `apps/web/lib/ea/data-architecture-steward-apply.ts`
- Modify: `apps/web/lib/ea/data-architecture-steward.test.ts`
- Modify: `apps/web/lib/ea/data-architecture-steward-apply.test.ts`

**Steps:**

- [ ] Write failing tests for `unclassified-asset`, `unowned-domain`, `unenrolled-growth`, `mdm-contract-gap`, `projection-policy-conflict`, and `expired-data-exception` findings.
- [ ] Implement pure detectors using the control-spine inventory and measured runtime metadata.
- [ ] Use stable conformance-issue keys so repeat runs refresh rather than duplicate findings.
- [ ] Auto-resolve findings only after the underlying conformance check passes.
- [ ] Make missing runtime measurement an “unknown” finding rather than a false green.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/ea/data-architecture-steward.test.ts lib/ea/data-architecture-steward-apply.test.ts
pnpm --filter web typecheck
```

Expected: each drift class opens one stable finding, repeated runs refresh it, unknown evidence is not green, and remediation auto-resolves it.

### Task 4A: BI-DG-015 — Data-domain coverage wave 1

Repeat this task on one bounded data domain per BI/branch until the immutable baseline reaches zero. `BI-DG-015` is wave 1; file each subsequent wave as its predecessor closes.

**Files:**

- Modify: `apps/web/lib/govern/data/assets.ts`
- Modify: `apps/web/lib/govern/data/lifecycle-classes.ts`
- Modify: `apps/web/lib/govern/data/legacy-coverage-baseline.ts`
- Modify: matching focused tests under `apps/web/lib/govern/data/`

**Steps:**

- [ ] Select only the baseline entries owned by the BI's domain; confirm owner/steward and source fields against the rebased schema.
- [ ] Write failing cases for the domain's sensitive/subject/prohibited/projected fields and lifecycle rules, then run them and observe the intended coverage failures.
- [ ] Classify each field as governed, inherited, or not-applicable with reason/provenance; add executable subject locators and protection/purpose metadata where required.
- [ ] Remove only resolved baseline entries and prove the denominator is unchanged.
- [ ] Run control-spine tests, Data-Impact Gate fixtures, and the per-BI completion gate.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/govern/data
pnpm --filter web typecheck
node scripts/check-data-impact.mjs
```

Expected: the selected domain has no unresolved entries, the baseline decreases by the exact resolved set, and no other domain changes.

### Task 4B: BI-DG-014 — Durable data-control operation journal

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/<timestamp>_add_data_control_operation/migration.sql`
- Create: `packages/db/src/data-control-operation-schema.test.ts`
- Create: `apps/web/lib/govern/data/control-operation.ts`
- Create: `apps/web/lib/govern/data/control-operation.test.ts`
- Create: `apps/web/lib/queue/functions/data-control-operation.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`

**Steps:**

- [ ] Write failing schema and service tests for durable intent before mutation, exact input/policy/hold/authority snapshot, unique idempotency key, operation states, per-target checkpoints, and retry time.
- [ ] Write crash-point tests before/after intent, source mutation, outbox enqueue, external effect, verification, compensation, and terminal evidence; assert no false `reconciled` state or double effect.
- [ ] Run the tests and confirm they fail because the journal/outbox contract does not exist.
- [ ] Add `DataControlOperation` and `DataControlOperationStep` models plus indexes for status/retry, organization/action, and operation/target. No data backfill is required because no legacy operation can be reconstructed truthfully.
- [ ] Run `pnpm --filter @dpf/db exec prisma migrate dev --name add_data_control_operation`; inspect the generated immutable SQL and retain its explicit no-backfill comment.
- [ ] Implement transactional intent/outbox creation, single-use authorization binding, idempotent step claims, verification, retry, compensation, and terminal state rules from spec §6.3.
- [ ] Prove a non-compensable target remains `partially-complete`, files a governed case, and cannot emit terminal-success evidence.
- [ ] Register the queue function and run the per-BI migration/completion gates.

**Verification:**

```powershell
pnpm --filter @dpf/db exec vitest run src/data-control-operation-schema.test.ts
pnpm --filter web exec vitest run lib/govern/data/control-operation.test.ts
pnpm --filter web typecheck
```

Expected: every injected crash resumes idempotently or reaches a visible failed/partial/compensated state; only fully verified targets reach `reconciled`.

---

## Chunk 2 — Govern MDM and establish the product shell

### Task 5A: BI-MDM-201 — MDM readiness and crosswalk hardening

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/<timestamp>_add_mdm_identity_observation/migration.sql`
- Create: `apps/web/lib/mdm/governance-contract.ts`
- Create: `apps/web/lib/mdm/governance-contract.test.ts`
- Modify: `apps/web/lib/mdm/domain-registry.ts`
- Modify: `apps/web/lib/mdm/domain-registry.test.ts`
- Modify: `apps/web/lib/mdm/crosswalk.ts`
- Modify: `apps/web/lib/mdm/match-candidate.ts`
- Modify: `apps/web/lib/mdm/match-candidate.test.ts`

**Steps:**

- [ ] Write failing tests for the per-domain `absent | pilot | supported | enforced` capability matrix and `none | source-only | full` reversibility class.
- [ ] Write failing identity tests proving `PrincipalAlias` resolves identity while a protected source-observation record separately carries issuer, observed/last-seen time, evidence/trust, status, and lifecycle.
- [ ] Run the tests and observe missing readiness/observation behavior.
- [ ] Add `MasterIdentitySourceObservation`; run `pnpm --filter @dpf/db exec prisma migrate dev --name add_mdm_identity_observation`. No legacy observation backfill is allowed because missing provenance cannot be reconstructed.
- [ ] Require every domain to link logical asset, owner/steward, dedup gate, quality SLO, lifecycle, and declared capability status.
- [ ] Invalidate/rescore candidate sets when source, canonical version, normalization, or match configuration changes; bind previews to exact versions.
- [ ] Keep `MasterDataSourceRef` for non-identity sources and enroll both source-reference types in lifecycle/protection policy.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/mdm/governance-contract.test.ts lib/mdm/domain-registry.test.ts lib/mdm/match-candidate.test.ts
pnpm --filter web typecheck
```

Expected: readiness is evidence-derived, stale candidates fail, and identity continuity no longer conflates alias resolution with source observation.

### Task 5B: BI-MDM-202 — Survivorship and protected provenance

**Files:**

- Modify: `apps/web/lib/mdm/match-config.ts`
- Modify: `apps/web/lib/mdm/match-config.test.ts`
- Modify: `apps/web/lib/mdm/history.ts`
- Modify: `apps/web/lib/mdm/merge.ts`
- Modify: `apps/web/lib/mdm/merge.test.ts`
- Modify: `apps/web/lib/mdm/unmerge.test.ts`
- Modify: `apps/web/lib/mdm/governance-contract.ts`

**Steps:**

- [ ] Write failing tests that separate candidate, match, merge, survivorship, and publish decisions and reject a stale/concurrently changed preview.
- [ ] Add versioned strategies `pinned-human`, `source-priority`, `verified-value`, `most-recent`, `most-complete`, and `keep-survivor`, with explicit missing/null/cleared/invalid semantics.
- [ ] Write failing provenance tests for minimized candidates, source refs, winning rule/version, actor, confidence, and time; prove a lower-authority run cannot replace a pinned value.
- [ ] Route merge/unmerge/survivorship through the durable operation journal and typed `AuthorizationDecisionLog` rationale.
- [ ] Apply field policy to new history/snapshot writes so sensitive values are omitted, redacted, tokenized, or separately encrypted; assign legacy plaintext history to a protected-field rollout BI rather than silently copying it.
- [ ] Prove limited reversibility remains visible and prevents autonomous merge.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/mdm/match-config.test.ts lib/mdm/merge.test.ts lib/mdm/unmerge.test.ts
pnpm --filter web typecheck
```

Expected: survivorship is independent, versioned, concurrency-safe, pinned-value safe, and its evidence cannot leak governed plaintext.

### Task 5C: BI-MDM-203 — Graduated autonomy and publish/retraction

**Files:**

- Modify: `apps/web/lib/mdm/autonomous-steward.ts`
- Modify: `apps/web/lib/mdm/autonomous-steward.test.ts`
- Modify: `apps/web/lib/mdm/publish.ts`
- Modify: `apps/web/lib/mdm/merge.ts`
- Modify: `apps/web/app/(shell)/admin/data/stewardship/page.tsx`

**Steps:**

- [ ] Write failing risk-tier tests covering match kind, reversibility, identity/regulation, value/impact, conflict, cross-domain, stale preview, and per-run cap.
- [ ] Write failing publish tests for contract compatibility, consumer acknowledgment, stale critical data, correction/retraction, and partial downstream reconciliation.
- [ ] Permit autonomous exact low-risk actions only for domains whose capability/reversibility matrix and operation evidence are enforced; route all other cases to steward review.
- [ ] Extend published data with contract/domain version, canonical ID, `asOf`, protected provenance summary, TrustAssessment, asset/classification, permitted purposes, and obligations.
- [ ] Keep publish/retract operations partial until consumers acknowledge or a governed failure remains visible.
- [ ] Expose readiness, risk, preview, publish status, and undo/retraction in the Stewardship route.
- [ ] Run the supplier pilot against the contracts in its existing BI; customer-domain success cannot close supplier readiness.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/mdm/autonomous-steward.test.ts lib/mdm/merge.test.ts
pnpm --filter web typecheck
```

Expected: risky autonomy is denied/reviewed, publish rollout/retraction is reconcilable, and pilot capabilities are never shown as enforced.

### Task 6: BI-DR-101 — Add growth observability and the `/admin/data` shell

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/<timestamp>_add_data_growth_sample/migration.sql`
- Create: `apps/web/lib/operate/retention/growth.ts`
- Create: `apps/web/lib/operate/retention/growth.test.ts`
- Create: `apps/web/lib/queue/functions/data-growth-snapshot.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`
- Create: `apps/web/app/(shell)/admin/data/layout.tsx`
- Create: `apps/web/app/(shell)/admin/data/page.tsx`
- Create: `apps/web/app/(shell)/admin/data/catalog/page.tsx`
- Create: `apps/web/app/(shell)/admin/data/stewardship/page.tsx`
- Create: `apps/web/app/(shell)/admin/data/lifecycle/page.tsx`
- Create: `apps/web/app/(shell)/admin/data/policy-privacy/page.tsx`
- Modify: `apps/web/components/admin/admin-nav.ts`

**Steps:**

- [ ] Write tests for bounded `pg_total_relation_size`/row-estimate sampling, interval rollups, pruning, growth-rate calculation, unknown measurement, and threshold state.
- [ ] Add a purge-enrolled `DataGrowthSample` model with indexes for asset/time and a migration containing its retention setup.
- [ ] Run `pnpm --filter @dpf/db exec prisma migrate dev --name add_data_growth_sample`; the generated migration states “no backfill” because rates begin only after two observed samples.
- [ ] Implement a read-only collector with an explicit model allowlist derived from the logical asset registry; never interpolate an unvalidated identifier.
- [ ] Export aggregate control metrics without table contents or sensitive values.
- [ ] File/refresh/resolve `PlatformIssueReport` entries for critical growth, unknown measurement, and accepted-unbounded assets above threshold.
- [ ] Add the stable top-level Admin → Data Management destination and five peer routes: Overview, Catalog, Stewardship, Lifecycle, Policy & Privacy. Every tab resolves locally in this BI; Stewardship and Policy & Privacy may render honest transitional content/deep links until their owning capabilities land, but cannot navigate to a nonexistent peer.
- [ ] Build the first viewport with no more than five report-kit `StatCard`s plus an attention table, filters, status badges, and export.
- [ ] Populate Catalog from the source-controlled inventory and link each asset to `/ea/data-model` rather than embedding another ERD.
- [ ] Populate Lifecycle with disposition, measured size/growth, last sweep, next action, and dry-run entry point.
- [ ] Test loading, empty, error, permission, long-label, dark/light theme, keyboard, and mobile-width states.

**Verification:**

```powershell
pnpm --filter @dpf/db exec prisma validate
pnpm --filter web exec vitest run lib/operate/retention/growth.test.ts
pnpm --filter web typecheck
```

Runtime evidence: migration applies; two snapshots produce a rate; retention prunes samples; `/admin/data`, `/catalog`, and `/lifecycle` pass UX verification.

Expected: growth is measured without data values, all five peer routes resolve with honest states, and alerts/rollups/pruning behave deterministically.

---

## Chunk 3 — Complete lifecycle governance

### Task 7: BI-DR-102 — Enroll ranked unbounded datasets

**Files:**

- Modify: `apps/web/lib/operate/retention/policies.ts`
- Modify: `apps/web/lib/operate/retention/retention.test.ts`
- Modify: `packages/db/prisma/schema.prisma` only for required purge indexes
- Add: `packages/db/prisma/migrations/<timestamp>_add_retention_purge_indexes/migration.sql`

**Steps:**

- [ ] Use `DataGrowthSample` evidence to rank unenrolled assets; do not copy the research-baseline ranking blindly.
- [ ] Write a failing policy test for every family, including active/current/regulated exclusions.
- [ ] Run the tests and observe the intended unenrolled/missing-strategy failures.
- [ ] For each ranked asset, document owner, trigger, minimum, maximum, terminal-state rule, hold scope, action, batch cap, and evidence class in `lifecycle-classes.ts` before adding an executor policy.
- [ ] Cover at minimum the currently verified families: memory facts, quality findings, backlog/admin activities, tool/integration receipts, route outcomes, coworker envelopes, edge/federation events, discovery observations, MDM evidence/tasks/history, staged imports, and message streams.
- [ ] Add only query-supported indexes shown necessary by `EXPLAIN` on representative volume.
- [ ] Run `pnpm --filter @dpf/db exec prisma migrate dev --name add_retention_purge_indexes`; the generated migration contains only reviewed indexes and an explicit no-backfill comment.
- [ ] Run dry-run and bounded delete/anonymize tests; prove the candidate set equals the executed set absent concurrent writes.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/operate/retention/retention.test.ts
pnpm --filter @dpf/db exec prisma validate
pnpm --filter web typecheck
```

Expected: every selected family has a tested lifecycle decision, active/current/regulated rows remain excluded, and any index migration is evidence-backed.

### Task 8: BI-DR-103 — Add the revision-cap strategy

**Files:**

- Modify: `apps/web/lib/operate/retention/execute.ts`
- Modify: `apps/web/lib/operate/retention/policies.ts`
- Modify: `apps/web/lib/operate/retention/retention.test.ts`

**Steps:**

- [ ] Write failing tests for `keepLast`, `maxAgeDays`, ties, current/published protection, active parent protection, empty history, and idempotent rerun.
- [ ] Implement one `revision-cap` strategy used by all revision/snapshot families; do not add per-model loops.
- [ ] Enumerate current revision/snapshot models from the rebased schema and enroll each explicitly.
- [ ] Prove regulated and active objects remain excluded.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/operate/retention/retention.test.ts
pnpm --filter web typecheck
```

Expected: the shared executor keeps the configured current/published/recent revisions and removes only the deterministic excess set.

### Task 9: BI-DR-104 — Add status-aware lifecycle strategies

**Files:**

- Modify: `apps/web/lib/operate/retention/execute.ts`
- Modify: `apps/web/lib/operate/retention/policies.ts`
- Modify: `apps/web/lib/operate/retention/retention.test.ts`
- Modify: `apps/web/lib/govern/data/lifecycle-classes.ts`

**Steps:**

- [ ] Write failing status-aware tests for task runs/messages/artifacts/nodes, decision interactions, escalation/deferral captures, and any new terminal-state families found in Task 0.
- [ ] Add terminal-state predicates as data in lifecycle classes, with common executor logic.
- [ ] Prove parent/child eligibility is deterministic when terminal timestamps differ.
- [ ] Prove active, retryable, held, and regulated objects remain excluded.
- [ ] Run dry-run and execution against the same fixture and assert identical eligible IDs absent concurrent writes.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/operate/retention/retention.test.ts
pnpm --filter web typecheck
```

Expected: terminal-state eligibility is deterministic and dry-run/execution agree while active, retryable, held, and regulated records remain untouched.

### Task 10: BI-DR-105 — Add holds, policy conflicts, and disposition evidence

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/<timestamp>_add_data_lifecycle_evidence/migration.sql`
- Create: `apps/web/lib/operate/retention/holds.ts`
- Create: `apps/web/lib/operate/retention/lifecycle-decision.ts`
- Create: `apps/web/lib/operate/retention/disposition-evidence.ts`
- Create: `apps/web/lib/operate/retention/holds.test.ts`
- Create: `apps/web/lib/operate/retention/lifecycle-decision.test.ts`
- Create: `apps/web/lib/operate/retention/disposition-evidence.test.ts`
- Modify: `apps/web/lib/operate/retention/execute.ts`
- Create: `apps/web/lib/actions/data-lifecycle.ts`

**Steps:**

- [ ] Write failing pure-decision tests for multiple minima, multiple maxima, no minimum, no maximum, urgent issued hold, scope revision, late-arriving match, overlapping release, failed destination acknowledgment, restore reapplication, erasure exception, and `retainUntil > deleteNoLaterThan` conflict.
- [ ] Run the tests and confirm they fail because append-only hold scope/delivery state and lifecycle conflict records do not exist.
- [ ] Add dedicated `LegalHold`, `LegalHoldRevision`, `LegalHoldDelivery`, `DataPolicyConflict`, and `DispositionRecord` models. Store stable asset/subject/domain scope and policy versions; do not store mutable SQL as authority.
- [ ] Run `pnpm --filter @dpf/db exec prisma migrate dev --name add_data_lifecycle_evidence`; no legacy hold backfill is possible, while any disposition backfill must remain empty rather than invent evidence.
- [ ] Implement the lifecycle decision algebra from spec §6.6. A conflict returns no destructive action.
- [ ] Make authorized urgent issuance effective atomically before asynchronous propagation; continuously resolve new aliases/data/contracts, record per-store acknowledgments, and prove a missing/failed check fails closed.
- [ ] Re-evaluate every overlapping hold before release and replay active holds/disposition tombstones before restored data becomes available.
- [ ] Write disposition receipts with identifier digests and counts, not copied row values.
- [ ] Add operator-gated create/review/release actions with preview and separate release authority where configured.
- [ ] Add property-based or table-driven tests showing policy input order cannot change the outcome.

**Verification:**

```powershell
pnpm --filter @dpf/db exec prisma validate
pnpm --filter web exec vitest run lib/operate/retention/holds.test.ts lib/operate/retention/lifecycle-decision.test.ts lib/operate/retention/disposition-evidence.test.ts
pnpm --filter web typecheck
```

Runtime evidence: migration applies, held rows remain untouched, conflicts create cases, and an eligible capped batch writes a reconciled disposition receipt.

Expected: urgent/revised/overlapping holds propagate and survive restore, conflicts never mutate, and disposition is complete only after target reconciliation.

### Task 11: BI-DR-106 — Archive before destructive disposition

**Files:**

- Create: `apps/web/lib/operate/retention/archive.ts`
- Create: `apps/web/lib/operate/retention/archive.test.ts`
- Modify: `apps/web/lib/operate/retention/execute.ts`
- Create: `docs/operations/data-archive-restore.md`

**Steps:**

- [ ] Write failing tests for export failure, checksum failure, evidence-write failure, repeated request, partial batch, and restore validation.
- [ ] Implement stream-to-compressed-artifact with manifest, schema/asset/policy version, count, checksum, destination, and encryption metadata.
- [ ] Require verified archive and receipt before source deletion.
- [ ] Make reruns idempotent by disposition operation ID.
- [ ] Add a restore rehearsal that writes to an isolated verification target and compares count/digest before promotion.
- [ ] Document recovery, key requirements, scope, and evidence lookup.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/operate/retention/archive.test.ts
pnpm --filter web typecheck
```

Expected: deletion cannot start before a verified archive/receipt, retries are idempotent, and isolated restore reproduces the recorded count/digest.

### Task 12: BI-DR-107 — Decide and decompose measured partition candidates

**Files:**

- Modify: `apps/web/lib/govern/data/lifecycle-classes.ts`
- Add per approved stream BI: `packages/db/prisma/migrations/<timestamp>_partition_<model>_by_<key>/migration.sql`
- Create: `apps/web/lib/operate/retention/partition-maintenance.ts`
- Create: `apps/web/lib/operate/retention/partition-maintenance.test.ts`
- Modify if needed: `docs/install/platform-support-watchlist.md`

**Steps:**

- [ ] Use growth evidence to produce a decision record for each candidate: size/rate, retention-aligned key, FK constraints, downtime/rewrite, restore, and expected benefit.
- [ ] Defer any candidate that lacks sufficient evidence. Deferral is a successful outcome, not pressure to partition.
- [ ] For each approved candidate, create a separate live BI and branch before implementation; one physical table/partition key per PR. DR-107 owns the measured decision/decomposition, not a multi-table migration sweep.
- [ ] Require DR-105 hold delivery and DR-106 archive/restore evidence before any partition implementation BI starts.
- [ ] Rehearse the migration against production-like volume in the leased sandbox, including rollback/restore.
- [ ] In each implementation BI, run `pnpm --filter @dpf/db exec prisma migrate dev --name partition_<model>_by_<key>` and keep any row movement/backfill in that generated migration.
- [ ] Add future-partition creation, missing-partition alert, retention-boundary drop, hold exclusion, archive-before-drop, and disposition evidence.
- [ ] Prove a held partition cannot be dropped and a failed archive cannot advance.

**Verification:** migration apply and rehearsal evidence from the shared local-integration CI environment; no direct rebuild of the main portal.

Expected: unsupported candidates are explicitly deferred; each approved stream has its own BI and only rehearsed hold/archive-safe migrations proceed.

---

## Chunk 4 — Govern lineage and every derived copy

### Task 13: BI-DG-005 — Complete derived-data contracts and scope enforcement

**Files:**

- Modify: `apps/web/lib/govern/data/derived-data-contracts.ts`
- Modify: `apps/web/lib/govern/data/derived-data-contracts.test.ts`
- Modify: `packages/db/src/projection-egress.ts`
- Modify: `packages/db/src/projection-egress.test.ts`
- Modify: each projection registration adapter discovered in Task 0

**Steps:**

- [ ] Inventory Neo4j, Qdrant, EA, discovery, SysML, code-graph, cache, export, backup, and federation copy families on rebased source.
- [ ] Write a failing total-coverage test requiring every copy producer to reference one stable `DerivedDataContractId`.
- [ ] Write failing tests that content payloads cannot exceed field policy, projections cannot self-declassify, and unsupported purpose/destination fails closed.
- [ ] Run both suites and observe missing-contract/policy failures.
- [ ] Add purpose, owner, sources/fields, destination, payload class, transform, classification propagation, residency, SLO, lifecycle, delete locator, reconciliation, and evidence to every contract.
- [ ] Adapt the existing federation `ProjectionContract` to the shared contract; do not rename or repurpose its persisted boundary.
- [ ] Declare the required `DataPepKind` and parameterized obligations for every contract, and make conformance fail when no registered PEP capability can satisfy them. Runtime activation waits for BI-DG-012.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/govern/data/derived-data-contracts.test.ts
pnpm --filter @dpf/db exec vitest run src/projection-egress.test.ts
pnpm --filter web typecheck
```

Expected: every discovered producer has one contract, invalid payload/purpose/destination combinations fail, and required obligations map to a declared PEP capability.

### Task 14: BI-DG-006 — Generalize cleanup, reconciliation, and staleness

**Files:**

- Create: `apps/web/lib/govern/data/derived-copy-health.ts`
- Create: `apps/web/lib/govern/data/derived-copy-health.test.ts`
- Create: `apps/web/lib/queue/functions/derived-copy-reconcile.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`
- Modify: `apps/web/lib/ea/data-model-mirror-apply.ts`
- Modify: `apps/web/lib/ea/data-model-mirror-apply.test.ts`
- Modify: `apps/web/lib/actions/ea.ts`
- Modify: `apps/web/lib/actions/ea.test.ts`
- Modify: `apps/web/lib/inference/semantic-memory-cleanup.ts`
- Modify: `apps/web/lib/operate/scheduled-jobs/staleness-escalation.ts`
- Modify: `apps/web/lib/operate/scheduled-jobs/staleness-escalation.test.ts`
- Modify: `apps/web/lib/queue/functions/code-graph-reconcile.ts`

**Steps:**

- [ ] Write failing contract tests for `deleteBySource`, `findOrphans`, `lastSuccessfulProjection`, `healthEvidence`, idempotent replay, bounded cursor, and partial operation state.
- [ ] Run the tests and observe the missing shared adapter behavior.
- [ ] Implement the small adapter contract for Neo4j and Qdrant first; add other stores only when an actual contract needs them.
- [ ] Make EA tombstones drive Neo4j deletion and prove repeat delivery is safe.
- [ ] Generalize the code-graph dark-projection escalation without regressing its current behavior.
- [ ] Reconcile in bounded pages with a dry-run and per-contract cap.
- [ ] File/refresh/resolve one stable issue per contract and error class.
- [ ] Feed stale/orphan/cleanup metrics to `/admin/data` Overview and asset detail.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/govern/data/derived-copy-health.test.ts lib/inference/semantic-memory-cleanup.test.ts lib/integrate/code-graph
pnpm --filter web typecheck
```

Runtime evidence: delete a sandbox source fixture, observe contracted cleanup in Neo4j/Qdrant, simulate a missed event, reconcile the orphan, and verify issue open/recovery.

Expected: cleanup is idempotent and checkpointed, missed events reconcile, and stale/partial contracts remain visible until verified recovery.

---

## Chunk 5 — Purpose, policy, protection, and subject rights

### Task 15: BI-DG-011 — Replace compliance string matching with governed processing activities

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/<timestamp>_add_data_processing_governance/migration.sql`
- Create: `packages/db/src/data-processing-governance-schema.test.ts`
- Create: `apps/web/lib/govern/data/processing-activity-service.ts`
- Create: `apps/web/lib/govern/data/processing-activity-service.test.ts`
- Modify: `apps/web/lib/compliance-library.ts`
- Modify: `packages/db/src/regulation-applicability.ts`
- Modify: `apps/web/lib/operate/retention/industry-floors.ts`
- Modify: `packages/storefront-templates/src/archetypes/index.ts`
- Modify: `packages/storefront-templates/src/archetypes/archetypes.test.ts`

**Steps:**

- [ ] Write failing schema/service/applicability tests for required fields, policy links, exception expiry, unknown applicability, and string matching no longer being authoritative.
- [ ] Run the targeted tests and observe failures for the missing persisted governance model/service.
- [ ] Add `DataProcessingActivity` and `DataPolicyException` models with stable IDs, owner, purpose, asset/subject scope, authority links, recipients/destinations, transfer/residency, lifecycle, risk/review, status/effective dates, and approval/expiry controls.
- [ ] Run `pnpm --filter @dpf/db exec prisma migrate dev --name add_data_processing_governance`. Its inline SQL backfill creates provenance-linked inactive/review records for known existing settings; it never infers and activates a legal basis.
- [ ] Seed archetype templates in `packages/storefront-templates/src/archetypes/index.ts`; do not create organization-specific active records silently.
- [ ] Connect human `Policy`/`PolicyRequirement` records to executable policy IDs instead of merging their schemas.
- [ ] Implement exception validation: scope, approver, rationale, compensating control, expiry, and remediation item are mandatory.
- [ ] Migrate existing applicable settings with provenance and require confirmation where legal basis cannot be safely inferred.

**Verification:**

```powershell
pnpm --filter @dpf/db exec prisma validate
pnpm --filter @dpf/db exec vitest run src/data-processing-governance-schema.test.ts src/regulation-applicability.test.ts
pnpm --filter web exec vitest run lib/govern/data/processing-activity-service.test.ts lib/compliance-library.test.ts lib/operate/retention/retention.test.ts
pnpm --filter @dpf/storefront-templates exec vitest run src/archetypes/archetypes.test.ts
pnpm --filter web typecheck
```

Expected: applicability comes from confirmed processing activities/executable policy, unknown stays review, and exceptions cannot activate without complete approval/expiry data.

### Task 16: BI-DG-012 — Implement one PDP, PEP adapters, and explanation tools

**Files:**

- Modify: `apps/web/lib/govern/data/executable-policies.ts`
- Modify: `apps/web/lib/govern/data/policy-decision.ts`
- Modify: `apps/web/lib/govern/data/policy-enforcement.ts`
- Modify: `apps/web/lib/govern/data/executable-policies.test.ts`
- Modify: `apps/web/lib/govern/data/policy-decision.test.ts`
- Modify: `apps/web/lib/govern/data/policy-enforcement.test.ts`
- Create: `apps/web/lib/mcp/packs/data-governance-pack.ts`
- Create: `apps/web/lib/mcp/packs/data-governance-pack.test.ts`
- Modify: `apps/web/lib/mcp/pack-registry.ts`
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/app/(shell)/admin/data/policy-privacy/page.tsx`
- Modify: `packages/dpf-skill-pack/skills/dpf-data-architecture-steward/SKILL.md`

**Steps:**

- [ ] Write failing type/decision vectors for parameterized obligations, allow, allow-with-obligations, review, deny, unsupported PEP obligation, unknown context, strict-source propagation, expired exception, hard-constraint conflict, version/authority/hold invalidation, cache-key mismatch, and single-use replay.
- [ ] Run the targeted tests and observe failures for the missing typed contract/capability/invalidations.
- [ ] Implement the exact input/output contract from spec §6.5 as a pure deterministic evaluator.
- [ ] Define explicit policy ordering by hard constraint, confirmed authority, consent/contract, organization policy, approved exception, effect, specificity, and effective version. Do not depend on array order.
- [ ] Add a PEP capability matrix and fail conformance when a required obligation/profile is unsupported.
- [ ] Implement reusable PEP adapters for server action, MDM action, context/memory, derived copy, and lifecycle action.
- [ ] Bind side effects to one-time durable-operation authorizations and revalidate current authority, hold, classification, and policy immediately before mutation; restrict cacheable decisions to exact versioned read keys.
- [ ] Persist high-risk decisions in `AuthorizationDecisionLog` with typed rationale and no raw data values.
- [ ] Expose concise `get_data_policy` and `check_data_action` explanation/simulation tools around the same evaluator. Keep descriptions provenance-free and results capped.
- [ ] Add the Policy & Privacy simulator view with explicit principal/action/asset/field/purpose/destination input and obligation/capability explanation.
- [ ] Prove direct calls to protected executors without a PEP token/decision fail closed.
- [ ] Extend the steward skill to propose classification and explain decisions; it cannot approve its own exception or high-risk action.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/govern/data/policy-decision.test.ts lib/govern/data/policy-enforcement.test.ts
pnpm --filter web typecheck
```

Expected: policy ordering is deterministic, unsupported obligations and stale/replayed side effects fail closed, and MCP/UI explain the same evaluator result.

### Task 17: BI-DG-009 — Enforce mask-before-context

**Files:**

- Create: `apps/web/lib/govern/data/mask-for-context.ts`
- Create: `apps/web/lib/govern/data/mask-for-context.test.ts`
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Modify: `apps/web/lib/inference/semantic-memory.ts`
- Modify: `apps/web/lib/tak/tool-result-budget.ts`
- Modify: `apps/web/lib/tak/tool-result-budget.test.ts`

**Steps:**

- [ ] Write failing tests for omit/redact/partial/tokenize/aggregate/pass-through, nested objects, arrays, nulls, unknown fields, mixed asset payloads, purpose/destination change, and output classification inheritance.
- [ ] Run the tests and observe the missing masking service failure.
- [ ] Implement the typed transforms and default sensitive unknown fields to omit.
- [ ] Apply masking before prompt serialization, vector storage, preview/log construction, and tool-result return.
- [ ] Require a PDP decision and field metadata; never accept an arbitrary caller-supplied mask list as authority.
- [ ] Add a plaintext canary test proving a restricted fixture never reaches captured context, vector payload, receipt, or log.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/govern/data/mask-for-context.test.ts lib/inference/semantic-memory.test.ts
pnpm --filter web typecheck
```

Expected: the plaintext canary is absent from prompts, memory, previews, tool results, logs, and receipts under every restricted/confidential fixture.

### Task 18: BI-DG-007 — Add the key-service and protected-field core

**Files:**

- Refactor: `apps/web/lib/govern/credential-crypto.ts`
- Create: `apps/web/lib/govern/data/key-service.ts`
- Create: `apps/web/lib/govern/data/protected-field.ts`
- Create: `apps/web/lib/govern/data/key-service.test.ts`
- Create: `apps/web/lib/govern/data/protected-field.test.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/<timestamp>_add_protected_data_key/migration.sql`
- Create: `packages/db/src/protected-data-key-schema.test.ts`
- Create: `docs/operations/data-key-rotation-and-recovery.md`

**Steps:**

- [ ] Write key-service tests for tenant/domain/record/subject scope, rotation, wrong key, missing key, corrupted ciphertext, old format, restore, and fail-loud outside development.
- [ ] Write failing schema tests for tenant-isolated wrapped-key identity, key/profile/version/status, recovery authority, rotation, compromise/revocation, and destruction evidence.
- [ ] Run the tests and observe the missing core service/schema failures.
- [ ] Add only wrapped-key/protection-profile metadata; run `pnpm --filter @dpf/db exec prisma migrate dev --name add_protected_data_key`. There is no legacy key backfill because no protected field is activated in this BI.
- [ ] Keep KEK material outside Postgres and protected backups; store only wrapped DEK metadata and versioned ciphertext.
- [ ] Implement one versioned ciphertext envelope and model-access helper. Do not add ad hoc encryption calls to routes.
- [ ] Add keyed lookup tokens only for approved exact-match needs; never log raw values or tokens.
- [ ] Rehearse rotation, KEK unavailability, lost/revoked/compromised key, cross-tenant denial, backup restore, and rollback before enabling any field family.
- [ ] Document that key destruction is defense in depth and requires copy/exception evidence.

**Verification:**

```powershell
pnpm --filter @dpf/db exec prisma validate
pnpm --filter @dpf/db exec vitest run src/protected-data-key-schema.test.ts
pnpm --filter web exec vitest run lib/govern/credential-crypto.test.ts lib/govern/data/key-service.test.ts lib/govern/data/protected-field.test.ts
pnpm --filter web typecheck
```

Expected: the key lifecycle is tenant-isolated, versioned, recoverable, rotatable, revocable, and fail-loud; no business field changes storage format in this PR.

### Task 18A: Protected-field family rollout — three real BI IDs per family assigned in Task 0

Task 0 replaces `<family>` and the service paths below with the exact approved field family. One family is delivered as three independently green PRs so application-key encryption never pretends to be a SQL backfill.

**Files:**

- Modify: `apps/web/lib/govern/data/assets.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/<timestamp>_prepare_<family>_protection/migration.sql`
- Modify: the exact canonical model-access service recorded in the BI
- Create: a focused `<family>-protection.test.ts` beside that service
- Add later: `packages/db/prisma/migrations/<timestamp>_enforce_<family>_protection/migration.sql`

**Steps:**

- [ ] **Prepare BI:** document field threat/search/cardinality/backup analysis and choose minimize, mask, tokenize, encrypt, or access-only. Write failing dual-read/write tests, add shadow protected columns with `prisma migrate dev --name prepare_<family>_protection`, and enable versioned dual-write. Its SQL explicitly performs no backfill.
- [ ] **Backfill-operation BI:** use `DataControlOperation` checkpoints to encrypt/tokenize existing rows through the key service in capped idempotent pages. Keep plaintext authoritative during failure; record counts/digests and prove retry/rotation/restore. This BI owns no schema migration.
- [ ] **Enforce BI:** after the backfill invariant proves zero missing/invalid rows, switch reads to protected values, stop plaintext writes, and run `prisma migrate dev --name enforce_<family>_protection` to enforce/drop or null legacy storage. The migration contains an invariant guard, not a hidden backfill.
- [ ] Apply field policy to associated history, snapshot, receipt, log, export, and lookup-token paths in the same family; raw values cannot escape into evidence.
- [ ] Run the per-BI completion gate after each of the three branches. Do not start a family until its exact BIs and files are in the live backlog.

Expected: no PR mixes schema preparation, application-key backfill, and destructive cutover; rollback remains possible until the separately verified enforce BI.

### Task 19: BI-DG-008 — Implement the subject-request case and Postgres discovery core

**Files:**

- Create: `apps/web/lib/govern/data/subject-locator.ts`
- Create: `apps/web/lib/govern/data/subject-request.ts`
- Create: `apps/web/lib/govern/data/subject-request.test.ts`
- Create: `apps/web/lib/actions/data-subject-requests.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/<timestamp>_add_data_subject_request/migration.sql`
- Create: `packages/db/src/data-subject-request-schema.test.ts`
- Modify: `apps/web/app/(shell)/admin/data/policy-privacy/page.tsx`

**Steps:**

- [ ] Write failing identity/authority tests across `Principal`, `PrincipalAlias`, identity source observations, and MDM crosswalks, with ambiguity routed to review.
- [ ] Write failing case/discovery tests for multiple locators, shared records, frozen scope revision, active hold, exception, missing adapter, and incomplete target.
- [ ] Run the tests and observe the missing case/target state failures.
- [ ] Add `DataSubjectRequest` and `DataSubjectRequestTarget`; run `pnpm --filter @dpf/db exec prisma migrate dev --name add_data_subject_request`. No backfill is allowed because historical requests cannot be reconstructed.
- [ ] Build the durable workflow: verify identity/authority, discover, freeze scope revision, review exceptions, preview, authorize, execute through `DataControlOperation`, reconcile, and issue completeness evidence.
- [ ] Implement only the Postgres authoritative-row adapter in this BI; choose export/delete/anonymize/detach/restrict/key-destroy/conflict per asset policy.
- [ ] Keep exports encrypted, time-limited, access-audited, and separated from unrelated subjects.
- [ ] Keep the execute action feature-disabled until every required copy adapter reports supported; surface unsupported/incomplete rather than a success control.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/govern/data/subject-request.test.ts lib/operate/retention/lifecycle-decision.test.ts lib/mdm
pnpm --filter @dpf/db exec vitest run src/data-subject-request-schema.test.ts
pnpm --filter web typecheck
```

Expected: subject cases are authorized, durable, scope-versioned, and honest about unsupported copies; only Postgres execution is enabled in this PR.

### Task 19A: Subject-request copy adapters and activation — real BI IDs assigned in Task 0

Create one BI/PR per actual adapter discovered from `DerivedDataContract`: Neo4j, Qdrant, MDM aliases/source observations, archives/exports, backups/tombstones, and any additional store. Each BI names exact files before work starts.

- [ ] Write a failing contract test for discover, export, delete/anonymize/restrict where supported, idempotency, hold/exception, checkpoint, and reconciliation.
- [ ] Implement that one adapter through `DataControlOperation`; a non-compensable failure remains partial and blocks case completion.
- [ ] Add a mutation test that removes the adapter and proves the independently generated coverage denominator fails.
- [ ] After all required adapters land, use a separate activation BI to enable execution in Policy & Privacy and run one access plus one erase/anonymize fixture across every contracted store.
- [ ] Run the per-BI completion gate for each adapter and activation branch.

Expected: no adapter PR claims end-to-end DSAR completion; the activation PR is the first point at which cross-store completeness may be reported.

### Task 20: BI-DG-010 — Add tamper-evidence verification without compliance overclaim

**Files:**

- Create: `apps/web/lib/govern/data/audit-integrity.ts`
- Create: `apps/web/lib/govern/data/audit-integrity.test.ts`
- Create: `apps/web/lib/queue/functions/audit-integrity-check.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`
- Create: `docs/operations/audit-integrity.md`

**Steps:**

- [ ] Write failing tests for canonicalization, mutation, deletion, insertion, reordering, batch boundary, algorithm/key upgrade, duplicate/late event, field-policy redaction, and partial failure.
- [ ] Run the tests and observe the missing integrity implementation.
- [ ] Implement canonical serialization, domain separation, chain/batch boundaries, algorithm/version, late-arrival handling, and key/root storage.
- [ ] Hash-link or Merkle-batch high-value decision/disposition receipts without copying sensitive payload values.
- [ ] Apply source field policy to every included receipt and use canonicalized keyed digests where identifiers are required.
- [ ] Write signed/hashed roots to an independent evidence location and store only the non-sensitive reference in the primary database.
- [ ] Schedule verification and file/resolve a conformance issue on break/recovery.
- [ ] Document supported integrity guarantees and explicitly exclude a claim of SEC 17a-4 certification without separate WORM/audit-trail assessment.

**Verification:**

```powershell
pnpm --filter web exec vitest run lib/govern/data/audit-integrity.test.ts
pnpm --filter web typecheck
```

Expected: every integrity mutation fixture is detected, protected fields remain protected in evidence, and independent-root verification opens/resolves one stable issue.

---

## Chunk 6 — Consolidate the product experience and finish the control loop

### Task 21: BI-DG-016 — Workspace consolidation and usability acceptance

**Files:**

- Modify: `apps/web/app/(shell)/admin/data/layout.tsx`
- Modify: `apps/web/app/(shell)/admin/data/page.tsx`
- Modify: `apps/web/app/(shell)/admin/data/catalog/page.tsx`
- Modify: `apps/web/app/(shell)/admin/data/stewardship/page.tsx`
- Modify: `apps/web/app/(shell)/admin/data/lifecycle/page.tsx`
- Modify: `apps/web/app/(shell)/admin/data/policy-privacy/page.tsx`
- Refactor: `apps/web/app/(shell)/admin/data-stewardship/page.tsx` to redirect after parity
- Refactor: `apps/web/app/(shell)/admin/reference-data/page.tsx` to redirect or deep-link after parity
- Modify: `apps/web/components/admin/admin-nav.ts`
- Create: `apps/web/components/data-management/DataManagementShell.tsx`
- Create: `apps/web/components/data-management/DataManagementShell.test.tsx`
- Create: `apps/web/components/data-management/DataAttentionTable.tsx`
- Create: `apps/web/components/data-management/DataAttentionTable.test.tsx`
- Create: `apps/web/components/data-management/MdmResolutionPanel.tsx`
- Create: `apps/web/components/data-management/MdmResolutionPanel.test.tsx`
- Create: `apps/web/components/data-management/PolicySimulator.tsx`
- Create: `apps/web/components/data-management/PolicySimulator.test.tsx`
- Create: `apps/web/app/(shell)/admin/data/data-management-routes.test.ts`

**Steps:**

- [ ] Write route/permission tests for the five stable tabs and legacy redirects.
- [ ] Verify capability-owning PRs already provide stewardship, lifecycle, policy simulation, processing activities, subject requests, and operation evidence; this PR does not reimplement their services.
- [ ] Confirm parity for legacy stewardship behavior before enabling redirects: scorecards, review queue, match rules, merge/unmerge, crosswalks, history, autonomous controls, and supplier pilot status.
- [ ] Replace page-local KPI/filter/table implementations with report-kit `StatCard`, `StatusBadge`, `FilterBar`, `DataTable`, `Chart`, and `ExportButton` where the component semantics fit.
- [ ] Consolidate survivorship compare/preview presentation with source trust, winning rule/version, pinned state, confidence/risk, downstream impact, and actual reversibility class.
- [ ] Consolidate Policy & Privacy local subviews without creating another rule engine or evidence store.
- [ ] Keep `/ea/data-model` authoritative for ERD/technical lineage and `/compliance` authoritative for obligation/control assurance; use deep links and shared IDs.
- [ ] Use plain first-level labels and progressive disclosure for policy IDs/JSON.
- [ ] Add role-filtered attention queues and an “Ask Data Steward” preview that shows scope, tools/actions, authority, and confirmation boundary before launch.
- [ ] Add loading, empty, partial-data, permission, policy-unknown, stale, error, and successful-action states.
- [ ] Use in-app dialogs for merge, unmerge, hold release, lifecycle execution, erasure, exception approval, and other consequential actions.
- [ ] Verify keyboard, focus, screen-reader labels, status text, chart alternatives, responsive behavior, and theme tokens.
- [ ] Run the fixed six-task safe fixture from spec §7 with at least three schema-unfamiliar representative operators at 1280×720 and 390×844; require ≥90% unaided completion, zero critical wrong/destructive actions, median ≤3 minutes, and WCAG 2.2 AA/keyboard evidence.

**Verification:**

```powershell
pnpm --filter web exec vitest run 'app/(shell)/admin/data' components/data-management
pnpm --filter web typecheck
```

Expected: legacy redirects preserve parity, role-filtered/degraded states are honest, and the measured usability/accessibility thresholds pass.

### Task 22: BI-DG-013 — Publish operator and user guidance

**Files:**

- Create: `docs/operations/data-management.md`
- Create: `docs/operations/data-policy-and-exceptions.md`
- Create: `docs/operations/data-subject-requests.md`
- Create: `docs/operations/mdm-stewardship.md`
- Create: `docs/user-guide/admin/data-management.md`
- Modify: `docs/operations/install.md` only if deployment/worker prerequisites changed
- Modify: `docs/user-guide/admin/index.md`

**Steps:**

- [ ] Document roles and decision rights, using the accountability map from the spec.
- [ ] Document how to interpret Overview, Catalog, Stewardship, Lifecycle, and Policy & Privacy in plain language.
- [ ] Document policy simulation, exception expiry, hold create/release, dry-run/disposition, MDM resolution/unmerge, subject requests, archive restore, key recovery, and integrity alerts.
- [ ] Separate legal facts, platform behavior, organization-configurable defaults, and examples.
- [ ] Link to the governing spec rather than duplicating architecture rules.
- [ ] Validate every local link and screenshot/route against the served product.

**Verification:**

```powershell
pnpm check:doc-links
```

Expected: documentation index generation, internal-link tests, and diagram checks exit zero; every documented route matches the served portal.

### Task 23: Integrated program verification and handoff

This is a cross-program regression/exit review. It cannot retroactively satisfy a missing per-BI build, migration, runtime, UX, evidence, push, or PR gate.

**Files:**

- Modify: this plan only to record final evidence links if project convention requires it
- Modify: live BIs, Work Capsules, and execution-evidence records through MCP

**Steps:**

- [ ] Run all affected unit suites and full web typecheck.
- [ ] Claim `local-integration-ci`, run the production build, apply migrations to the verification database, and record exact command/output evidence.
- [ ] Run schema/registry/gate mutation fixtures.
- [ ] Run semantic-memory storage/delete/reconcile, MDM match/merge/survivorship/publish/unmerge, lifecycle/hold/conflict/archive, policy/PDP/PEP, masking/encryption, subject request, and integrity-break scenarios.
- [ ] Verify `/admin/data` end to end, including permissions, accessibility, theme, narrow viewport, empty/error states, exports, dialogs, redirects, and deep links.
- [ ] Run `pnpm pr:health` and fix every in-scope failure.
- [ ] Record canonical-runtime evidence for each BI, release the environment lease, update live statuses, push signed commits, and open regular ready-for-review PRs only when each branch is independently green.

**Canonical commands:**

```powershell
pnpm --filter web exec vitest run
pnpm --filter web typecheck
pnpm security:secrets
pnpm pr:health
```

The production build, migration apply, and UX/cross-store scenarios run under the leased shared environment or governed canonical install as required by `AGENTS.md`; their evidence records must name the source SHA.

Expected: every program exit criterion is backed by current-SHA canonical-runtime evidence; this regression pass finds no gap hidden by earlier per-BI evidence.

---

## Dependency and PR sequence

```text
DG-001                         immediate and independent
DG-002 -> DG-003, DG-004, domain coverage waves, DR-101, MDM-5A, DG-005, DG-011, DG-007-core
operation-journal + DG-011 -> DG-012
MDM-5A + operation-journal + DG-012 -> MDM-5B; MDM-5B + DR-101 -> MDM-5C
DR-101 -> DR-102 -> DR-103 and DR-104 -> DR-105 -> DR-106 -> DR-107 decision/decomposition
DR-105 + DR-106 + measured approval -> each DR-107 stream implementation BI
DG-001 + DG-005 + operation-journal + DG-012 -> DG-006
DG-001 + DG-002 + DG-012 -> DG-009
DG-002 -> DG-007-core -> each three-PR protected-field rollout
DR-105 + DG-005/DG-006 + operation-journal + DG-012 + DG-007-core -> DG-008 core -> per-store adapters -> activation
stable protected decision/disposition receipts -> DG-010
DR-101 shell + capability-owning UI PRs -> workspace consolidation -> DG-013 -> integrated verification
```

No dependency authorizes a multi-concern PR. If an interface is needed early, land the smallest typed interface and tests in its owning BI; consumers follow in separate branches.

## Program exit criteria

- Current Prisma schema has 100% logical asset and lifecycle coverage.
- Every MDM domain has governed ownership, dedup, survivorship, quality, lifecycle, autonomy, and publish contracts.
- Every content-bearing derived copy has a policy decision, cleanup path, reconciliation, staleness SLO, and evidence.
- Every destructive executor checks holds and emits disposition evidence; policy conflicts do not delete.
- Every protected AI/context path masks before serialization or storage.
- High-risk fields have an approved protection choice and tested key/recovery path.
- Subject access/erasure completes across canonical and derived stores or remains visibly incomplete with a governed reason.
- Gate mutation tests prove missing assets, PEPs, MDM contracts, cleanup handlers, hold checks, and exception expiry fail.
- `/admin/data` passes the non-specialist usability and accessibility script.
- All affected PRs have canonical-runtime evidence, signed commits, pushed branches, green CI, and updated live backlog state.
