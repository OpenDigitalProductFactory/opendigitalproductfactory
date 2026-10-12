---
status: active
---

# Agent process automation — what the grunt work actually cost, and what remains

One session drove nine PRs through the full landing process. This records what
that cost and why, so the next thread works from evidence rather than from a
narrative it has to be told.

**The thesis, confirmed the hard way:** an obligation an agent must REMEMBER does
not survive context compaction. An obligation a gate HANDS OVER does. Every
finding below is an instance of that.

## 1. Prose did not work, and was already there

`AGENTS.md` §4 prescribes the verification path. `pregate:preflight` printed
`see every constraint that applies to this diff: pnpm gate:context` on **every**
run. Across nine PRs the agent saw that line a dozen-plus times and invoked
`gate:context` **zero** times — discovering every required attestation and every
stale derived artifact by colliding with its refusal instead.

A third restatement in `AGENTS.md` would have been the instrument that had
already failed twice. **Do not fix process gaps with more prose.**

## 2. What existed, unused, and what it would have saved

| tool | answers | used in those 9 PRs |
|---|---|---|
| `gate:context` | required attestations, where each goes, stale derived artifacts | **0 times** |
| `gate:local` | every deterministic gate vs the WORKING TREE, reading the planned commit message | **0 times** |
| `gate:wait` | queue / retry / infra classification as code | **0 times** |
| `pr:ready` | is this branch ready to become a PR | **0 times** |
| `merge-policy:apply` | merge-readiness policy | **0 times** |
| `create_portal_pr` (MCP) | platform-side PR creation | 0 — used raw `gh` |
| `pregate` / `:preflight` / `:status`, `pr:health` | the gate, PR health | used |

Cost of not using them, counted:

- **six** `commit → refusal → fix → amend` cycles that `gate:local` collapses
  into one (convergence trailer, spec/plan/doc gate, raw-error-message guard,
  stale deps, CI test inventory, policy-guard toolchain);
- **~15** hand-written bash polling loops instead of `gate:wait`. Three were
  wrong in ways that mattered: one read an `INCONCLUSIVE` queue state as a
  terminal verdict; one treated `STALE` as non-terminal and span 39 minutes
  emitting nothing; one grepped for a failure pattern `node --test` does not
  emit and **reported a red suite as green**.

`gate-wait.mjs` had already written the lesson in its own header: *"callers used
to write that policy in bash, once per session, and get it wrong… ceremony
belongs in code, not in whoever is driving the gate."*

## 3. The recurring defect class: a window read as the whole

Six times in one session a truncated or wrong-shaped read produced a false
conclusion. Every one was the reader, not the thing read:

- the audit's truncated "most unanswered" list parsed as the full dataset — **twice**;
- an absent test runner (`vitest`/`tsx` missing) read as a clean typecheck — **twice**;
- `grep -c '^not ok'` against `node --test`, which does not emit that — a red suite reported green;
- `grep ... | head -5` over a Dockerfile with **101** script `COPY` lines, concluding two files were not image-copied when they are (lines 165, 186) — nearly filed as a false positive against the convergence gate.

**Mechanical consequence:** prefer `--json` over human-facing summaries; assert a
floor on anything parsed; never conclude from a window.

## 4. Closed-set fields invented three times

Five capability keys (`view_build_studio`, `view_platform_tools`,
`view_workspace`, `view_operate`, `view_ai_platform`) — all 76 preflight guards
passed. Then `finance`/`marketing` categories, caught by the UX ratchet. Then the
**same two categories again** in a second worktree after being reported checked.

Now guarded: `skill-capability-key-guard` (#5905), `skill-pack-category`,
`self-task-cadence-parity` (with parser floors). Vigilance did not fix this;
guards did.

## 5. Landed in this change

- `pregate:preflight` **emits** its obligations on refusal instead of pointing at
  `gate:context` — attestations (flagging the ones the gate reads from the PR
  **body**, not a commit trailer), and each stale derived artifact with its
  regenerate command.
- `gate:context` surfaces `generate`/`check`, which the derived-artifacts
  registry always carried and the context never printed.
- `pnpm land` — preconditions → context → regenerate → `gate:local` → commit →
  `gate:wait` → push → PR → auto-merge (enable **verified**). Overrides nothing,
  invents no attestation, gates before it pushes.

## 6. Remaining worklist

1. **`pnpm land` is unproven end to end.** It has never completed a real landing;
   its first real run is the one that lands its own PR. Drive it; fix what breaks.
2. **Waiting still burns agent context.** `gate:wait` moves the loop into a
   subprocess, but the agent still blocks on it. The room should own the wait and
   notify. This is the largest remaining token win.
3. **PR creation is still `gh` from the agent — and `create_portal_pr` cannot
   replace it as-is.** It resolves an *active Build Studio build* and publishes
   that build's `diffPatch` (`apps/web/lib/mcp/build-ship-handlers.ts`,
   `buildPhases: ["ship"]`); a CLI worktree has no `FeatureBuild`, so it returns
   "No active build." Platform-recorded PRs from external surfaces need a
   contract that registers an existing branch/PR against the workroom.
4. ~~**Drift handling is manual.**~~ `land` now fetches, counts commits behind
   `origin/main`, and merges forward (merge, not rebase — safe on a shallow
   clone) **before** context and regeneration, so the gate sees the merged tree.
   Unknowable drift refuses rather than reading as current.
5. ~~**`pnpm land -- --flag` is a trap.**~~ Measured, the cause was not pnpm:
   pnpm 10 forwards the `--` literally, and `node:util parseArgs` then reads
   every later flag as a positional — silently, under `allowPositionals` or
   `strict: false`. `scripts/lib/script-argv.mjs` drops one leading `--`; the
   landing spine (`land`, `gate:local`, `gate:context`, `gate:wait`) uses it.
   The other scripts that parse with those options now use it too (#5981,
   BI-EA76A597), and `scripts/check-no-hand-rolled-argv.mjs` refuses a new one
   that does not. Promoter and installer scripts run by `node`, never pnpm,
   are exempt by name.
6. **`gate:local` is not the full deterministic set.** `land`'s first two real
   runs passed it, then preflight refused three guards: spec-status frontmatter,
   the CI test inventory, and the `gate-context` image closure. The first two are
   sub-second and now run in `gate:local`; the closure test does not yet. Each
   refusal came before any lease, and `land` now says so instead of pointing at
   a stale `pregate:status`. Running all of preflight pre-commit costs ~3.5 min
   per landing — not yet worth it.
7. **`pregate:status` reports STALE from a metadata record that lags the gate
   record, and the text is actively misleading.** Hit three times in one
   session. The gate record can say `gated <HEAD> (0m ago)` while the metadata
   still carries the previous `candidateSha`, and the status then prints
   `metadata record gated <old>, not HEAD <new> — re-run pregate`. Re-running is
   the wrong action when a run is already in flight for the current HEAD: it
   queues a second claim. Either project HEAD onto the metadata when a run is
   claimed (the code already does this for a reused PASS), or distinguish "stale"
   from "a run for this HEAD is in flight".
8. ~~**`land` should merge forward BEFORE gating when behind base.**~~ Done:
   its `sync` step (item 4). By hand on PR #5958 it was 30 commits behind,
   merged forward cleanly, regenerated, gated once.
9. **`git push` is not a free read, and re-running it DESTROYS a recorded PASS.**
   The sharpest trap found. The pre-push hook runs `pregate` when it does not
   see a PASS for the current SHA — so every `git push` invocation can CLAIM A
   NEW LEASE and start another gate run, overwriting the record with `running`.

   Observed on PR #5958: `gate:wait` recorded a clean PASS on `2b84d0d091dc`;
   the push was then refused for an unrelated reason, and running `git push`
   twice more *just to read the refusal text* left three concurrent processes on
   the same branch+SHA under three different lease ids
   (`NPEL-8380DA0854`, `NPEL-DA27AF433D` x2, after `NPEL-428AF9F26D` produced
   the PASS). The earned PASS was gone, and the branch was back in the queue.

   Mechanical consequences, all cheap:
   - **read the record, never re-run the action.** `pnpm pregate:status` is
     read-only and safe to poll; `git push` is not.
   - the pre-push hook should NOT start a gate run for a SHA that already has a
     run in flight — it should wait on it, or refuse with "a run is in flight"
     rather than queueing a rival claim.
   - `land` must push exactly once, and on refusal surface the hook's text from
     the first attempt rather than re-invoking it. Its current implementation
     pushes once and reports — this is why that matters. `publish()` in
     `scripts/land-branch.mjs` now carries that test.
   - `land` must not merge main forward over a PASS already recorded for HEAD.
     Observed on PR #6029 (2026-10-06): `gate:wait` hit its deadline with the
     pool closed, the resumer later recorded PASS on HEAD, and re-running land
     would have merged main, minted a new SHA and re-gated, though the merge
     queue re-tests against main anyway. `recordedPassAction()` now skips sync
     and `gate:wait` for a clean tree whose PR is not CONFLICTING.
10. ~~**`gate:wait` read an infrastructure exit 1 as a failure.**~~ pregate runs
    with inherited stdio, so `classifyGateExit`'s exit-1 text discriminator never
    saw output in `gate:wait` — every exit 1 was FAIL. On 2026-10-06 the record
    pregate had just written said INCONCLUSIVE (`blocked_wrapper_exited`, "not a
    product verdict") and `land` stopped on "gate failed". `gate:wait` now
    re-reads the record after an exit-1 failure and retries on INCONCLUSIVE.
    The runner side is fixed too: a network error at base refresh (2026-10-02),
    or a Docker or disk failure setting up the slot, used to exit 1 and be
    recorded as a reasonless `failed`. Those now exit
    `EXIT_RUNNER_PREREQUISITE_UNAVAILABLE`, recorded as infrastructure.
11. ~~**The gate could wait on its own parents.**~~ Admission matches live
    "mutators" by command line. On 2026-10-06 `pnpm land` was launched from a
    shell whose `-c` string carried a commit message naming the runner script;
    that shell matched, so land, `gate:wait`, `pregate` and the gate itself all
    read as live mutators and admission retried until the run was killed.
    `findConflictingLocalCiMutatorPids` now excludes the gate's own ancestor
    chain — an ancestor is blocked on the gate, so it cannot be mutating the
    sandbox. A genuine runner elsewhere under the same shell still blocks.
