---
status: active
title: The STT digest watch hands off instead of stranding its branch when it may not open a PR
backlog_item: BI-8CEBDD09
---

# The STT digest watch hands off instead of stranding its branch

- **Date:** 2026-09-07
- **Scope:** platform — release automation (`stt-digest-watch.yml`)
- **Backlog item:** `BI-8CEBDD09`
- **Profile:** fix
- **Status:** Design — implemented in this branch.

**OBJ-STT-HANDOFF-1:** When the digest watch cannot open its own pull request, the re-pin it has already committed, pushed and verified reaches a human as one actionable click with its checks already running, rather than being stranded behind a red log.

## 1. Defect, on a named ref

Measured on 2026-09-07. `hwdsl2/whisper-server` retired the index digest pinned at `docker-compose.yml:1002`, exactly the rot this watch exists to catch. It caught it: the 12:27 UTC run re-resolved the digest, ran the contract tests and the digest-pinned manifest guard, committed, and pushed `bot/stt-digest-repin`. Then:

```
pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)
```

That is the repository setting *Allow GitHub Actions to create and approve pull requests*, not a token scope: the workflow already requests `pull-requests: write`. Under `bash -e` the refusal killed the step, so the three lines after it never ran, and the branch was left with no PR, no dispatched checks and no auto-merge. The only trace was a red scheduled run.

The consequence is not local. `verify-compose-image-manifests.mjs --only digest-pinned` fails on the rotted pin, which fails **E2E install verification (release mode)** in `publish-image.yml`. `release-runs-reader` treats a red verify job as `verify-failed`, so **no release verifies**, so the self-upgrade path has no eligible target. Release `v2026.09.07-upgrade-schedule-visibility.1` at `4c804bc` failed it twice, and three merged fixes (BI-A57B6185, BI-05F8860A, BI-3CA18934) could not reach any install. The same step also failed on 2026-09-03 and 2026-08-27, so it had been latent for at least ten days and only became load-bearing when the digest actually rotted.

Ruled out by reading rather than assuming: a token-scope gap (the workflow declares `pull-requests: write`), the `--apply` exit-3 convention (already handled, BI-BBD60CF8), and the re-resolve script itself (its unit tests passed in the failing run).

## 2. Fix sequence

1. Capture `gh pr create` instead of letting it abort: `set +e`, keep both its output and exit code.
2. Dispatch `ci.yml` and `release-gates.yml` onto the branch unconditionally, so a hand-opened PR finds its checks already running.
3. On success, arm auto-merge and exit 0, unchanged.
4. On failure, write a job summary with the refusal text and the compare link. For the permission refusal specifically, open one hand-off issue carrying the same link, guarded by a search so a daily watch cannot pile them up. Grant `issues: write`.
5. Exit non-zero regardless: the loop did not close on its own, and the run must stay red.

The complete fix is the repository setting; this makes the failure survivable and visible without widening what automation may do.

## 3. Acceptance criteria

| Criterion | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-STT-HANDOFF-1 | A refused PR creation still dispatches ci.yml and release-gates.yml onto the pushed branch |
| AC-2 | OBJ-STT-HANDOFF-1 | The refusal raises one hand-off issue and a job summary carrying the compare link and the setting to enable |
| AC-3 | OBJ-STT-HANDOFF-1 | A second daily run does not open a second issue while one is already open |
| AC-4 | OBJ-STT-HANDOFF-1 | The step still exits non-zero on refusal, and on the happy path it arms auto-merge, raises no issue and exits zero |

## 4. Non-goals

- Changing the repository or organisation setting: security-relevant, and the operator's call.
- Weakening digest pinning so a rotted digest stops failing verification. The pin is the supply-chain control; the failure is correct, the invisibility is not.
