# Batch 8 — Self-Upgrade Corrective-Incident Recovery Evidence

## Goal

Close the lifecycle gap between automatic self-upgrade failure capture and later successful recovery. A successful canonical self-upgrade must leave reviewable recovery evidence on every still-active self-upgrade corrective BacklogItem without silently changing its status. Governed completion remains a separate evidence-based action.

This is the eighth ten-item campaign batch and the second batch in the current 50-item campaign. It serves install and MSP operators by making recovery legible and by preventing historical self-upgrade incidents from remaining context-free backlog debt.

## Live backlog scope

The live PostgreSQL backlog contained exactly ten open items with `source=self-upgrade-failure` on 2026-08-13:

1. `BI-36EDA947` — quiescence `awaitReady` outer timeout
2. `BI-916F44F0` — watchdog recovered a stuck swap
3. `BI-DF8EDFD0` — promoter `host_identity_missing`
4. `BI-D1AADD0F` — queued dispatch event likely dropped
5. `BI-2136547E` — promoter `recovery_parent_unavailable`
6. `BI-F56554AD` — incomplete Git objects during upstream fetch
7. `BI-C6FF857B` — promoter `install_state_invalid`
8. `BI-10C88630` — unclassified build-gate failure
9. `BI-938A8194` — Docker Desktop state-directory mount denial
10. `BI-4E74B340` — promoter candidate build failed while installing BuildKit tooling

They form one coherent lifecycle concern. No active pull request overlaps `apps/web/lib/backlog/capture-corrective-bi.ts` or `apps/web/lib/self-upgrade/run-store.ts`. Active edge-fleet and Work Room work is excluded.

## Validity and supersession audit

- The incidents are historical and many underlying paths have since changed, so none will be treated as proof that the same defect is still present.
- The items remain valid as unresolved corrective records until current source evidence and a successful canonical live-install upgrade demonstrate recovery.
- A later success is evidence that the governed install path recovered; it is not proof that every failure class is impossible. The implementation therefore records `recovery_observed` activity but never auto-closes, defers, or rewrites a BacklogItem.
- Each item will be closed only after its failure signature is mapped to current source/tests or to environment-specific operational recovery, and the exact deployed lineage is verified.

## Research and benchmarking

- NIST SP 800-61r3 integrates incident response with continuous improvement and recommends sharing lessons as they are identified, not waiting for all recovery work to finish: <https://csrc.nist.gov/pubs/sp/800/61/r3/final>.
- NIST SP 800-184 treats recovery planning, testing, execution evidence, and improvement as a continuous resilience loop: <https://www.nist.gov/publications/guide-cybersecurity-event-recovery>.
- GitHub can auto-close linked issues when a PR merges: <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue>. DPF rejects that behavior for runtime corrective incidents because a merge or one later success does not, by itself, satisfy the platform's proportional completion-evidence contract.

DPF adopts explicit recovery evidence and continuous improvement, while retaining governed human/agent reconciliation as the phase boundary.

## Governed decision

WWMD consultation `DI-E3FD63D12500` compared:

- a systemic corrective-incident lifecycle;
- a mixed verified-existing cleanup;
- a Windows defect plus unrelated cleanup.

It recommended the systemic lifecycle with high confidence, composite `8.530`, margin `4.084`, and `autonomyEligible=true`. The decision is attached to Work Capsule `WC-5951008E`.

## Design

### Recovery evidence writer

Extend `apps/web/lib/backlog/capture-corrective-bi.ts` with a best-effort recovery writer that:

1. selects non-terminal corrective BIs for one failure source;
2. records at most one `recovery_observed` activity per item and recovery run;
3. stores the recovery run ID, current/target/deployed SHA, completion time, and original failure fingerprint;
4. does not emit a completion-policy `evidenceKind` and does not mutate item status;
5. never causes the successful runtime transition to fail if evidence recording is unavailable.

### Self-upgrade lifecycle hook

After `completeRun` durably marks a self-upgrade run succeeded, invoke the recovery writer with the run's exact identity. The existing change-record synchronization and operator notification remain authoritative and unchanged.

### Idempotence and boundedness

The writer deduplicates by `(BacklogItem, recovery run ID)` and batches inserts. Replaying terminal reconciliation for the same run produces no duplicate activity.

## TDD and verification

1. Add failing unit tests for recovery selection, idempotence, payload identity, non-closing behavior, and best-effort failure isolation.
2. Add a failing `completeRun` test proving the successful run invokes recovery recording with exact SHA identity.
3. Implement the smallest writer and lifecycle hook that make those tests pass.
4. Run the affected unit suites.
5. Run style/module/source guards and `pnpm run pregate:preflight`.
6. Run the exact-tree local merged-code gate before publication.
7. After merge, deploy through `/ops/self-upgrade`; verify the canonical health SHA and recovery activities; then record proportional execution evidence and reconcile the ten BIs.

## Documentation impact

This is an internal runtime/backlog evidence contract. The plan is the architectural record; no user-facing workflow, route, API, migration, prompt, or coworker instruction changes. The existing self-upgrade UI already exposes run history and the existing backlog UI already exposes item activities.

## Non-goals

- Automatically closing or deferring corrective BIs.
- Claiming that one success proves a failure class can never recur.
- Changing self-upgrade batching, quiescence, promotion, rollback, or UI behavior.
- Touching active edge-fleet, federation, Work Room, or Windows-native delivery scopes.
