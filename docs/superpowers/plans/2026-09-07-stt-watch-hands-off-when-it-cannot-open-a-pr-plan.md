---
status: active
title: The STT digest watch hands off instead of stranding its branch — fix plan
backlog_item: BI-8CEBDD09
design: docs/superpowers/specs/2026-09-07-stt-watch-hands-off-when-it-cannot-open-a-pr-design.md
---

# The STT digest watch hands off instead of stranding its branch — fix plan

- **Backlog item:** `BI-8CEBDD09` (fix profile, atomic)
- **Design:** [`2026-09-07-stt-watch-hands-off-when-it-cannot-open-a-pr-design.md`](../specs/2026-09-07-stt-watch-hands-off-when-it-cannot-open-a-pr-design.md)

## Backlog coverage

- Decision: atomic
- Parent: `BI-8CEBDD09`
- Receipt: `blocked-by: the coverage receipt is minted against this plan blob once it is on the bound Workroom head; recorded on the next push`
- Rationale: guarding the refusal without the hand-off leaves the branch just as
  invisible; the hand-off without the guard never runs, because the refusal
  aborts the step before reaching it. One step, one behaviour.
- Dependencies: none

| Key | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- |
| stt-watch-handoff | OBJ-STT-HANDOFF-1 | issues: write, GITHUB_STEP_SUMMARY, bot/stt-digest-repin | capture gh pr create instead of letting it abort; dispatch the checks unconditionally; raise one guarded hand-off issue | AC-1, AC-2, AC-3, AC-4 |

## Fix sequence (all complete)

1. `.github/workflows/stt-digest-watch.yml`: add `issues: write`.
2. Same file: capture `gh pr create` output and exit code under `set +e`; dispatch `ci.yml` and `release-gates.yml` unconditionally; arm auto-merge and exit 0 on success.
3. Same file: on refusal write the job summary, and for the permission refusal open one hand-off issue guarded by an open-issue search; exit with the original code.
4. `scripts/stt-digest-watch-workflow.test.mjs`: execute the step tail against a stub `gh` that returns the real refusal text, covering AC-1..AC-4.

## Verification

Red-then-green: the three new hand-off assertions fail against the `origin/main` workflow and all 10 pass with the fix. OBJ-STT-HANDOFF-1 is covered by AC-1, AC-2, AC-3, AC-4.
