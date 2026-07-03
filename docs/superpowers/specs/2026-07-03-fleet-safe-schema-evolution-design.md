# Fleet-Safe Schema Evolution — a consistent way to handle tightening migrations

**Date:** 2026-07-03
**Status:** Design + first slice shipped (Layer 2 guard)
**Epic:** BI-5B3FA415 (Governed platform upgrade lifecycle) — extends, does not duplicate
**Triggered by:** BI-0CC492A8 (PR #2554 shipped a tightening migration with no remediation → latent fleet-wedge hazard)
**Related design:** [2026-05-23-governed-platform-upgrade-lifecycle-design.md](2026-05-23-governed-platform-upgrade-lifecycle-design.md) §4.5, §5.2.2 (BI-UPGRADE-006 classifier, BI-UPGRADE-008 shadow-DB dry-run)

## The recurring problem class

A **tightening** DDL change — `ADD CONSTRAINT` (UNIQUE / EXCLUDE / CHECK / FOREIGN KEY / PRIMARY KEY), `CREATE UNIQUE INDEX`, `SET NOT NULL`, `ADD COLUMN … NOT NULL` without a `DEFAULT` — is valid against a clean schema but **fails at creation time against real data** that already violates it. Because DPF migrations are forward-only and the self-upgrade promoter is fail-closed (`scripts/promote.sh` runs `prisma migrate deploy` pre-swap under `set -e`), such a failure does **not** brick the install — it **wedges** the forward-only chain: the install aborts the upgrade and freezes on the old version, missing *all* future updates. The installs most likely to hold violating rows are the busiest ones, and a later corrective migration cannot help because the flawed migration runs first in the chain. This will recur every time an author reasons from the clean dev schema instead of fleet data (it already did: PR #2554 / BI-0CC492A8).

## Decision (WWMD / `principle_decide`, 2026-07-03)

Primary mechanism, `callingPopulation: in_platform_coworker`, no commandment conflict, strong coverage:

| Option | Composite |
|---|---|
| **layered — classifier gate now, shadow-DB preflight next** | **8.861 (chosen, high)** |
| shadow-DB preflight first | 7.912 |
| static classifier gate first (only) | 7.190 |
| discipline + runbook only | 3.395 |

Discipline-only ranked **last** — this must be an *enforced* gate, not a written rule (the DPF pattern: convert disciplines to gates, cf. the Spec/Plan/Doc gate, the decision-routing hook). Defense-in-depth, classifier first for immediate coverage, shadow-DB as the durable real-data backstop.

## The layers (defense-in-depth)

**L1 — Author standard (AGENTS.md §11, shipped).** A migration must apply cleanly against *any* data state. For a tightening change, do one of: remediate-in-migration (quarantine > destroy, kernel D5), expand→contract across two releases, `NOT VALID` + later `VALIDATE`, or an in-file `-- @migration-safety:` attestation with a reason.

**L2 — Merge gate (shipped this PR).** `packages/db/scripts/migration-safety-guard.mjs` parses every *new* `migration.sql`, flags tightening DDL that lacks in-file remediation / a fresh-table context / `NOT VALID` / an attestation, and fails the commit + PR. Wired as `.githooks/pre-commit` Guard 7 and `.github/workflows/migration-safety-guard.yml`, tested (`migration-safety-guard.test.ts`, 11 cases incl. the real #2554 regression). The attestation escape hatch (`-- @migration-safety: data-safe: <reason>`) is the pressure valve: the guard never hard-blocks a genuinely-safe migration, it forces a conscious, audited assertion. This is the layer that would have stopped #2554. **Heuristic/structural — it cannot see data-shape conflicts it does not encode; hence L3.**

**L3 — Pre-swap shadow-DB preflight (planned — BI-UPGRADE-008, "the load-bearing piece").** Before the swap, apply pending migrations against a copy of the live data; a failure becomes a precise "migration X would fail on N rows" signal with the offending rows, instead of a silent wedge. Catches *all* real-data conflicts, not just the heuristics L2 encodes. Pairs with the migration-kind classifier (BI-UPGRADE-006) and `PreflightRun` evidence model already designed in the 2026-05-23 spec.

**L4 — Recovery (runbook — to author).** When an install wedges anyway: detect it (`SelfUpgradeRun` failed at the migrate step), identify the offending migration + violating rows, apply the kernel-blessed quarantine remediation, resume. A consistent operator runbook + a "which installs are wedged" surface on `/ops/self-upgrade` (BI-UPGRADE-009).

## Scope shipped in this PR (L1 + L2)

- `packages/db/scripts/migration-safety-guard.mjs` + `.test.ts` (11 cases)
- `.github/workflows/migration-safety-guard.yml`
- `.githooks/pre-commit` Guard 7
- AGENTS.md §11 data-safety discipline

## Follow-ups (filed)

- **L3 shadow-DB preflight** — prioritize BI-UPGRADE-008 + BI-UPGRADE-006 under BI-5B3FA415.
- **L4 recovery runbook + wedged-install surface.**
- **BI-0CC492A8** — the specific #2554 remediation still awaits the operator's fleet-application-status call (edit-in-place vs revert).
