# Local-CI gate mechanical enforcement — plan

- Date: 2026-07-06
- BIs: **BI-C74F4DE9** (enforcement chain + PR guard + skill clarity, EP-5560770F) and
  **BI-157DC9B2** (non-mutating checked-in runner, EP-056D2A5E)
- Predecessor design: [`2026-05-31-tiered-dev-loop-isolation-design.md`](../specs/2026-05-31-tiered-dev-loop-isolation-design.md)
  (BI-166C59F3 built the gate mechanics this plan turns on by default)
- Related: sandbox freshness gate (BI-ECDF9520), lease-punt guard (BI-2D167283)

## 1. Problem

AGENTS.md, the skills, and the MCP lease/evidence substrate all describe the correct
pre-PR workflow — verify a branch's merged-code gates in the shared local-CI
convergence sandbox under a `local-integration-ci` lease — but nothing *mechanically*
enforced it. Verified gaps (2026-07-06, main @136628406):

1. `.githooks/pre-push` ran only Git LFS. Git invokes only the `pre-push` hook name,
   so the sibling `.githooks/pre-push-gate` file **never executed**. The whole gate
   lane was dormant.
2. `scripts/gate-worktree.sh` (behind `pnpm run pregate`) died unless the invisible
   `DPF_LOCAL_CI_COMMAND` env var was hand-set — no checked-in default runner, and the
   available `scripts/local-integration-ci.mjs` mutated the caller's checkout.
3. `pnpm pr:health` had no local-CI evidence dimension — a PR with zero sandbox
   evidence read READY.
4. `dpf-verify-on-live-install` triggered on "test on the running portal / 3000"
   language for **unmerged** branches, conflating pre-PR sandbox verification with
   post-merge canonical-install validation. A 2026-07-05 thread pushed and opened a PR
   with no sandbox gate because of exactly this stack of gaps.

## 2. Decision — enforcement shape

Options considered: hard-block every push (silent bypass kept), **block with recorded
override** (chosen), warn-only. `principle_decide` returned a low-confidence
zero-composite ledger (the options did not map onto the closed dimension registry), so
the operator directive from the 2026-07-05/06 process-gap thread governs — and it
explicitly specifies "pre-push should enforce a passing record" *plus* "unless an
explicit operator override is recorded", i.e. block-with-recorded-override:

- Pushes of runtime code require a passing gate record for the exact branch+SHA.
- The bypass is never silent: `DPF_SKIP_PREPUSH_GATE=1` now **requires**
  `DPF_SKIP_PREPUSH_GATE_REASON`, and the reason is persisted into the gate state file
  where `pnpm pr:health` surfaces it as an attested override.
- Docs-only diffs vs `origin/main`, delete/tag-only pushes, detached HEAD, and `main`
  (merge-queue-governed) pass without a record — the sandbox gate exists for runtime
  code, and the `always-push-after-committing` recovery contract must survive for
  doc/WIP lanes without training agents to bypass habitually.

## 3. Changes

| Surface | Change |
| --- | --- |
| `.githooks/lib/pre-push-chained.sh` (new, tracked) + `scripts/lib/ensure-pre-push-hook.mjs` (new) + `scripts/set-hooks-path.mjs` | The local `pre-push` file is gitignored (git-lfs generates it — this is WHY the gate lay dormant), so the chained body ships tracked: captures stdin once, runs Git LFS with its exact contract, then chains `.githooks/pre-push-gate`. `postinstall` converges the local shim to delegate (missing/stock-LFS shims replaced; custom hooks left with a warning; idempotent). |
| `.githooks/pre-push-gate` | Parses pushed refs (delete/tag skip), skips `main`/detached HEAD, auto-passes docs-only diffs, honors the in-flight marker from gate-worktree's own push (`DPF_PREPUSH_GATE_INFLIGHT`), records overrides with mandatory reason, and otherwise requires a passing branch+SHA record. |
| `scripts/local-ci-runner.sh` (new) | Checked-in default gate command (BI-157DC9B2): resolves the root clone, maintains a dedicated scratch worktree at `<root>-worktrees/.local-ci-runner`, and runs the caller's copy of the canonical local-integration plan there — the topic worktree is never mutated. `--dry-run` for inspection; `DPF_LOCAL_CI_WORKSPACE` overrides the location. |
| `scripts/gate-worktree.sh` | Defaults `DPF_LOCAL_CI_COMMAND` to the runner when unset (env var stays as override; stub still refused); marks its own pre-gate push with `DPF_PREPUSH_GATE_INFLIGHT=1` so the chained hook cannot deadlock the gate run. |
| `scripts/pr-health.mjs` | New localCi dimension: READY requires a passing gate record for the PR head SHA, a recorded push-time override, a `Local-CI-Override:`/`Local-CI-Evidence:` PR-body trailer, or a docs-only change set. Pure logic in `evaluatePrHealth` + `parseLocalCiAttestation` + `isDocsOnlyFileSet`. |
| AGENTS.md §5, `docs/testing/pre-pr-gate.md` | "Opt-in" language replaced with the default-on contract; explicit "pre-PR test = sandbox lease, test on :3000 = post-merge only" doctrine line. |
| Skills | `dpf-verify-on-live-install`: scope guard + When-NOT-to-use bullet (pre-merge ":3000" language is a misfire → pregate). `dpf-local-merge-ci-before-push`: `pnpm run pregate` named as the mechanical front door. `dpf-pr-with-dco`: step 3b carries the evidence/override trailer into the PR body. |
| Tests | `tests/release/local-ci-gate-contract.test.mjs`: hook chaining (LFS ran AND gate blocked), record match/stale/override/docs-only/delete/in-flight/main cases, default-command discovery, runner dry-run + main refusal. `scripts/pr-health.test.mjs`: all localCi verdict branches. |

## 4. What this deliberately does NOT do

- **No per-worktree runtimes** — the runner is a merge/build workspace, not a second
  portal; runtime/UX verification stays on the leased sandbox or the canonical install
  (`worktree-is-source-control-not-runtime`).
- **No CI-side attestation validator yet** — GitHub Actions cannot reach a local
  install's MCP evidence, so the PR-time guard lives in `pr:health` (which AGENTS.md §4
  already mandates before claiming a PR green). If trailer abuse emerges, a CI
  format-check in the spirit of the Spec/Plan/Doc gate is the follow-up.
- **No new MCP tool** — `gate-worktree.sh` already *is* the high-level
  claim→run→record→release workflow; the gap was its default command and its
  activation, not a missing tool.
