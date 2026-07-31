# Local-CI current-main base freshness

Backlog item: `BI-1BDBA8AA`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

An online local-CI run refreshes `origin/main` after admission and resolves the
integration base from that refreshed ref. Offline operation remains available
only as an explicit accepted-base mode. Evidence distinguishes
`remote-current`, `offline-accepted`, and `fetch-failed`; none is silently
presented as another.

## Grounding

- `scripts/local-ci-runner.mjs` currently defaults `fetchBase` to false and
  resolves `baseSha` before the optional fetch executes.
- `scripts/lib/local-integration-ci.mjs` may fetch inside the integration plan,
  after the caller already recorded the base SHA.
- `scripts/lib/git-fetch-shared-safe.mjs` is the canonical safe fetch substrate
  for linked worktrees.
- `scripts/gate-worktree.mjs` records `fetch-base` versus `local-ref`, but that
  label does not prove the recorded SHA was refreshed.

## Phases

### 1. Define freshness states test-first

- Add pure state-resolution tests for online success, explicit offline
  acceptance, and fetch failure.
- Add a regression test where `origin/main` advances after worktree creation
  and prove the admitted runner uses the new SHA.

Verification: observe the regression fail against the current default, then
pass after implementation.

### 2. Resolve freshness once at admission

- Make online refresh the default.
- Fetch through the shared-safe helper before resolving `baseSha`.
- Add an explicit offline accepted-base flag and environment contract.
- A required fetch failure writes explicit failure evidence and exits before
  integration synthesis or expensive gates.
- Do not fetch again after the base SHA has been fixed for the admitted run.

Verification: command-plan tests prove one fetch, the refreshed SHA, and no
second fetch in the integration child.

### 3. Carry truthful evidence end to end

- Extend runner and integration metadata with freshness status, resolution
  timestamp, accepted SHA, and fetch error classification.
- Update `gate-worktree` evidence summaries to report the same status.
- Preserve existing metadata fields for compatible readers while making the
  new classification authoritative.

Verification: metadata tests cover all three states and reject ambiguous
  combinations.

### 4. Document online and offline contracts

- Update local-CI operations/testing documentation with the default online
  behavior and explicit offline mode.
- Explain that queued time does not cause repeated rebases: freshness is fixed
  once, at admission, then reported.

## Risks and rollback

- **Network outage:** required online mode fails before consuming heavy sandbox
  time; explicitly requested offline mode remains available.
- **Shared clone damage:** use the existing depth-safe fetch helper.
- **Moving base during execution:** the admitted SHA is immutable for that run;
  later upstream movement belongs to merge-queue verification.
- **Rollback:** revert the change to restore local accepted-base behavior. No
  schema or stored-data rollback is involved.

## Completion gate

- Focused Node tests, policy guards, full exact-tree local-CI, and production
  build pass.
- The upstream-advance regression proves the new base SHA is used.
- Evidence fixtures prove all three states.
- No UI or migration changes.

## Backlog coverage

- Decision: atomic
- Parent: `BI-1BDBA8AA`
- Receipt: `cms8bhbof07ut01qop006uprw`
- Mapping: `base-freshness` -> `BI-1BDBA8AA`
- Rationale: fetch behavior and evidence classification must ship together to
  avoid changing execution without truthful provenance.
