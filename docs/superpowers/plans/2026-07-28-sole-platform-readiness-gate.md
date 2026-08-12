# Sole-Platform Operational Readiness Evidence Gate

Date: 2026-07-28

Backlog item: `BI-903F5A94`

Work Capsule: `WC-02A375EA`

Branch: `feat/sole-platform-readiness-gate`

## Outcome

Create the first reusable gate that decides whether an install has enough operational evidence to be treated as a primary business operating system. The gate must aggregate the existing DR, backup, restore, self-upgrade, migration, rollback, continuity, health, and alerting evidence streams without replacing those owners.

## Standards Grounding

- NIST SP 800-34 Rev. 1 frames contingency planning as the process for recovery strategies, plan development, testing, training, and maintenance for information systems: https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final
- NIST Cybersecurity Framework 2.0 treats recovery as executed and maintained restoration processes, governed alongside other cyber functions: https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf
- CISA Cyber Resilience Review evaluates operational resilience and cybersecurity practices, which supports using evidence-backed readiness rather than self-attestation: https://www.cisa.gov/resources-tools/services/cyber-resilience-review-crr

## Existing Substrate Verified

- Backup readiness and Postgres trial restore live in `apps/web/lib/operate/backups/readiness.ts`.
- Backup/restore audit models live in `BackupRun` and `BackupRestore`.
- Self-upgrade run, recovery point, rollback, and owner summary evidence live under `apps/web/lib/self-upgrade/`.
- DB revert detection lives in `apps/web/lib/operate/db-continuity.ts`.
- Platform health aggregation lives in `apps/web/lib/operate/platform-health.ts`.
- Runtime verification evidence can already be recorded through `RuntimeTarget` and `RuntimeVerification`.

## Deliverables

1. Add a pure sole-platform readiness policy/evaluator module under `apps/web/lib/operate/`.
2. Encode the required evidence dimensions and freshness windows as typed constants.
3. Produce a verdict with status, blocker/degradation findings, owner-readable next actions, and evidence references.
4. Add tests proving the gate blocks missing or failed recovery-critical evidence and degrades stale or unknown posture.
5. Export the module from the operate barrel and update the platform adequacy roadmap map to point future agents at the implementation.

## Non-Goals

- No schema migration in this slice.
- No new UI surface in this slice.
- No attempt to synthesize live database evidence yet; callers inject evidence from existing repositories until the next adapter slice lands.

## Backlog Coverage Decision

Decomposed to one deliverable mapped directly to `BI-903F5A94`. The evaluator, matrix, tests, and doc pointer are the one independently meaningful slice in this branch: splitting them further would create either unusable constants without behavior or behavior without governed traceability. Later live-data adapters or UI cards can be filed as child BIs if this slice exposes integration gaps.

## Verification Plan

- `git diff --check`
- Targeted Vitest for `apps/web/lib/operate/sole-platform-readiness.test.ts` when dependencies are available.
- Direct TypeScript compile of the pure module from the root cached TypeScript installation if this source-only worktree lacks `node_modules`.
- Shared `local-integration-ci` pregate before opening a PR.
