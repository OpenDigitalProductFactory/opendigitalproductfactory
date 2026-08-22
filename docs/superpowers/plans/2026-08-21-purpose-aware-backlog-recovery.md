---
status: active
---

# Purpose-Aware Backlog Recovery — Implementation Plan

- **Date:** 2026-08-21
- **Status:** implemented; verification and promotion in progress
- **Backlog item:** `BI-4A833B6D`
- **Program:** `EP-1FABA22D` / `BI-34667080`
- **Decision:** `DI-78024D57939D` (`explicit-recovery-bundle`, high confidence, autonomy eligible)
- **Source design:** `docs/superpowers/specs/2026-08-21-purpose-aware-backlog-recovery-design.md`
- **Source program design:** `docs/superpowers/specs/2026-08-08-purpose-aware-installation-ecosystem-productivity-design.md`
- **Source plan:** `docs/superpowers/plans/2026-08-08-purpose-aware-installation-ecosystem-productivity.md`

> **For agentic workers:** execute this plan as one independently reviewable backlog item, one branch, and one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus this plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## 1. Outcome

Preserve the purpose-aware installation program as a version-controlled, validated recovery bundle that a platform-development operator can reconcile into a replacement install without placing DPF's internal product backlog into every customer install.

The bundle restores:

- epic `EP-1FABA22D`;
- umbrella `BI-34667080`;
- P0 `BI-A9F60372` as done with PR #4334 provenance;
- P1, R1, P2, P3, P4, and P5 as open;
- stable identifiers, definitions, scope, dependency references, lifecycle state, and completion evidence activities.

Normal runtime authority remains PostgreSQL. The repository artifact is an explicit recovery input, not a second current-state backlog.

## 2. Architecture decision

`DI-78024D57939D` compared four options:

1. automatic customer seed;
2. explicit recovery bundle;
3. GitHub/Markdown ledger only;
4. full database restore.

The kernel selected the explicit bundle. It has the smallest governed blast radius that still restores machine-readable records. Automatic seeding would leak platform-development work into customer installations; a prose ledger would retain cognitive/manual re-entry load; full restore would overwrite unrelated state.

## 3. Existing substrate and boundaries

### Reuse

- canonical `Epic`, `BacklogItem`, and `BacklogItemActivity` models;
- `packages/db/scripts/export-backlog.ts` as evidence that repository-owned backlog portability already exists;
- idempotent reconciliation precedent in `packages/db/scripts/seed-backlog-reconciliation.ts`;
- the live MCP backlog lifecycle for normal work;
- the existing purpose-aware design, plan, and merged P0 PR as the definitions to preserve.

### Do not add

- a new database model or migration;
- an automatic import from `packages/db/src/seed.ts`;
- a second live backlog or status authority in Git;
- a customer-visible UI, route, or control;
- overwrite/update behavior for an already-present epic, item, or activity;
- a full-database restore step.

## Backlog coverage

- Parent: `BI-4A833B6D`
- Decision: atomic
- Plan: `docs/superpowers/plans/2026-08-21-purpose-aware-backlog-recovery.md`
- Receipt: pending — the live resolver predates the human-authored external Workroom fix on current `main` and rejects the DCO author unless an unrelated AI-agent alias exists
- Dependencies: none
- Rationale: The manifest, validator, reconciler, tests, and operator runbook form one usable preservation capability; no part independently restores the governed graph safely.

The manifest, validator, reconciler, tests, and operator runbook form one atomic deliverable: the manifest without a validated importer is not recoverable, and an importer without this governed bundle does not preserve the requested work.

## 5. TDD implementation sequence

### Red 1 — validate the portable contract

Add failing tests in `packages/db/test/backlog-recovery-bundle.test.ts` for:

- supported schema version and closed lifecycle values;
- unique `EP-*`, `BI-*`, and activity identifiers;
- every item resolving an epic in the same bundle;
- every internal dependency resolving to a bundled item;
- explicit external dependencies remaining allowed but labeled;
- done items requiring completion timestamp, resolution, and evidence activities;
- unknown keys and relational/internal database identifiers being rejected;
- the purpose-aware bundle carrying exactly one epic and eight original items.

### Green 1 — shared parser and planner

Add `packages/db/src/backlog-recovery-bundle.ts` with:

- the versioned manifest contract and strict parser;
- a pure reconciliation planner that classifies each record as `create` or `skip`;
- a small store adapter contract so behavior is unit-testable without a database;
- an atomic apply function that creates the epic first, items second, and activities last;
- dry-run support and a structured summary.

Existing records are skipped wholesale. No title, body, status, evidence, claim, or activity is updated by recovery.

### Red 2 — prove recovery and idempotence

Add failing in-memory store tests proving:

- first apply creates one epic, eight items, and the preserved P0 activities;
- second apply creates nothing and reports every record skipped;
- dry run performs no writes;
- an existing item with newer progress is never regressed;
- a transaction failure leaves no partial bundle.

### Green 2 — bundle and operator command

Add:

- `packages/db/recovery/backlog/purpose-aware-installation-ecosystem-productivity.json`;
- `packages/db/scripts/reconcile-backlog-bundle.ts`;
- package command `pnpm --filter @dpf/db backlog:reconcile -- <bundle> [--apply]`.

Dry-run is the default. `--apply` is required for writes. The script prints counts and stable IDs, never secrets or raw credentials.

### Refactor

Keep file parsing and CLI presentation at the script edge; validation, ordering, idempotence, and persistence policy remain in the shared module. Reuse one record-to-create mapping for dry-run and apply so the two modes cannot drift.

### Documentation

Update `docs/architecture/backlog-and-planning-runbook.md` with the replacement-install recovery procedure and the distinction between live authority, automatic seeds, full backups, and explicit recovery bundles.

## 6. Verification

- targeted Vitest run for `packages/db/test/backlog-recovery-bundle.test.ts`;
- TypeScript check for `@dpf/db` when a compile-ready environment is available;
- CLI dry run against the committed bundle;
- source invariant: `packages/db/src/seed.ts` does not reference the recovery bundle or reconciler;
- live restore exercise only in the governed shared nonproduction environment, using a transaction and an empty target fixture;
- no migration and no UI verification required;
- source-local docs/seed-fit guards and cloud build gate.

The worktree is compile-ready. The focused suite and package typecheck run locally. The broad DB suite requires a test database: its database-backed files fail when the worktree cannot reach the Compose-only `postgres` hostname, while 253 files pass. A live CLI preview likewise requires execution inside the Compose network; the pure reconciliation suite covers the same create/skip plan without database writes.

## 7. Scale, security, and data architecture

- **Authority:** PostgreSQL remains the only current-state backlog. The bundle is immutable recovery input with source references.
- **Normal form:** no denormalized runtime table or parallel model is added.
- **Scale ceiling:** the initial bundle is nine coordination records plus three P0 activities. The generic algorithm is linear in epics, items, and activities and rejects duplicate identifiers before database work. Operator recovery bundles are intentionally bounded; full fleet backup remains the path for whole-install state.
- **Security:** strict closed keys exclude credential, internal CUID relation, claim, actor, and customer-context fields; recursive payload-key validation rejects common secret and identity keys. Repository review remains responsible for free-text content.
- **Privacy:** this bundle contains platform roadmap text already public in the repository and no organization/customer data.

## 8. Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Bundle becomes a second backlog authority | Explicit recovery-only semantics; skip existing rows; normal work stays MCP/PostgreSQL | Remove the bundle and command; existing DB rows remain |
| Customer installs receive DPF roadmap | No seed integration; explicit operator command only | No customer data cleanup is needed |
| Restore regresses newer progress | Create-missing/skip-existing invariant and tests | Re-run is a no-op |
| Partial restore | One transaction and dependency-safe ordering | Transaction rolls back |
| Invalid or secret-bearing artifact | Strict closed keys, identifiers, and value validation | Parser refuses before writes |
| Bundle grows into a full backup format | Bounded program recovery scope; full backup tooling remains authoritative for whole-install recovery | Split or retire bundle rather than widening silently |

## 9. Completion gate

The BI is complete only when:

1. the exact original initiative IDs are committed in the validated bundle;
2. P0 provenance and done state survive a first restore;
3. a second restore is proven idempotent;
4. an existing progressed row is proven untouched;
5. dry-run is the default and `--apply` is explicit;
6. automatic seed files remain unchanged;
7. operator recovery documentation is current;
8. semantic review, DCO, PR readiness, and required CI gates pass.
