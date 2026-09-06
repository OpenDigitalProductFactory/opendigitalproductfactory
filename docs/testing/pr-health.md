# PR Health — merge-readiness checker

`pnpm pr:health [<pr-number>]` (script: [`scripts/pr-health.mjs`](../../scripts/pr-health.mjs)) gives **one mechanical verdict** on whether a pull request can actually merge. Run it before claiming a PR is "green" or "mergeable" — do not eyeball a subset of checks.

```
pnpm pr:health           # the PR for the current branch
pnpm pr:health 2427      # a specific PR
```

Exit `0` = **READY**, `1` = **NOT READY** (blockers enumerated), `2` = usage/IO error.

## Why it exists

Reporting a PR "green / mergeable / queued" while a real blocker was still in place was a recurring failure — because only a curated subset of signals was inspected. Three distinct blocker classes were each missed in practice, and each actually blocked merge:

1. **Non-"required" guards that still block.** Filtering to an assumed required set (Typecheck / Production Build / Unit Tests / DCO) and treating the rest as advisory is **wrong**. `Module Size Guard`, `CodeQL` (a real HIGH-severity ReDoS once slipped through this way), and the `UX-Fit Gate` all fail-and-block. There is no safe "only these N block" filter — treat **every** non-passing check as a blocker.
2. **PRs read mid-CI-run.** "0 failing" while checks are still `pending` is a transient, not a green. A clean read requires every check **terminal** (no `pending`).
3. **Unresolved review threads.** The repo requires conversation resolution, so a single bot comment (e.g. an unused-import warning from `github-code-quality`) blocks merge regardless of checks or rebases. `gh pr checks` does **not** surface these — `pr:health` fetches them via GraphQL.

## What it asserts (READY iff all hold)

- PR `state=OPEN`, not a draft.
- `mergeable != CONFLICTING` (a `CONFLICTING` PR needs a rebase + conflict resolution).
- **Every** check is terminal (`pass`/`skipping`) — zero `fail`/`cancel`, zero `pending`.
- **Zero unresolved review threads.**

`mergeStateStatus=BLOCKED` with no concrete blocker is reported as a *note*, not a blocker — that is normally a clean PR waiting its turn in the merge queue / behind main, which the queue rebases itself. Don't rebase-spin a clean PR; re-check after the queue runs. Note that `gh pr merge --admin` does **not** bypass required checks or conversation-resolution — only the branch-up-to-date rule.

## Observation versus merge authority

`pr:health` observes the broad, dynamic set of checks attached to a PR and remains intentionally
stricter than branch protection: every reported check must be terminal and non-failing.

Branch protection uses the smaller, versioned contract in
[`config/merge-readiness-policy.json`](../../config/merge-readiness-policy.json):

- **Merge Readiness** aggregates every job in `.github/workflows/ci.yml`;
- **UX Route Budget Sweep** is the stable aggregate for the reusable
  browser/Postgres runtime called by CI. It accepts a skipped runtime only when
  the authoritative planner says the change is non-portal
  (`portal_ux_required=false`, limited to docs-only and `apps/mobile`-only);
  all unknown, portal, and merge-group scopes require a successful exhaustive
  run; and
- **DCO** proves commit sign-off.

CI runs for `pull_request` and `merge_group`, while the UX implementation is a
reusable workflow that CI calls after its exact-tree production build. The repo
guard fails if a CI job is not included in the aggregate, CI loses merge-group
coverage, or the UX workflow loses its callable contract. Use
`pnpm merge-policy:check` for local conformance and `pnpm merge-policy:audit` to compare the
manifest with live `main` protection. `pnpm merge-policy:apply` changes only required status
checks; use it after new contexts have proven green on `main`, never before.

## Know the constraints before you write: `pnpm gate:context`

`pr:health` and CI tell you what already failed; the **gate-context pack**
(BI-2677A465) tells you what will be enforced, before generation or push. It
derives — from the same registries CI runs, never a hand-written list — the
constraints that apply to the current worktree diff (committed + staged +
unstaged + untracked, vs the `origin/main` merge base):

- required attestation trailers for this diff shape (Process-Spine, Design
  Grounding, UX-Fit, Seed-Fit body line, Data-Impact manifest,
  Convergence-Impact decision);
- module-size caps for touched baselined files and budgets for new modules;
- shrink-only prose/style ratchet values frozen for touched files;
- derived artifacts to regenerate in the same change;
- route budgets: absolute budgets + the four generated companions for
  net-new routes, frozen word/structure budgets for pre-existing ones;
- migration immutability and safety-attestation contracts.

Run it before writing code and again before pushing; `--json` emits the
machine-readable pack (`scripts/lib/gate-context.mjs` is the single source —
the Build Studio prompt section and MCP tool consume the same module). The
pack is advisory context: CI gates remain the only authority.

## Before a PR exists: `pnpm pr:ready`

`pnpm pr:ready -- --pr-body-file <path>` applies the same policy-profile
registry, exact diff, DCO, clean-tree, pushed-branch, and PR-trailer contracts
before a contributor opens a PR. This is the shift-left gate; `pr:health`
remains the end-to-end observer after GitHub creates the PR and starts CI.

Build Studio uses the same readiness command with an internal
`--published-ref` mode. Its shipping transaction is deliberately branch-first:
it publishes a recoverable branch, fetches and checks out that exact remote
commit in the build sandbox, runs canonical readiness against the final PR
body, restores the build branch, and opens a PR only for a ready verdict.
Typecheck, tests, and acceptance evidence are additional fail-closed blockers.
If any check fails, the tool returns the published branch, commit SHA, and
blockers; it does not create a review-lane placeholder PR.

## Local-CI infrastructure outcomes

The governed local pregate distinguishes a product failure from two shared
verification failures:

- `blocked_sandbox_drift` means the installed dependency graph was stale or not
  ready. Converge the governed sandbox and rerun; do not charge the candidate.
- `blocked_control_plane_starvation` means portal HTTP, MCP, Docker Engine, or
  direct PostgreSQL health failed in two consecutive rounds during the bounded
  production build. The gate stops only its admitted build tree, preserves the
  samples in the slot's `dpf-local-ci-control-plane*.json` evidence, contracts
  requested capacity to one, and blocks capacity-pilot retention.

A TCP listener alone is not health: the portal probe requires HTTP 200 and a
valid healthy payload, MCP requires a valid read response, and PostgreSQL is
queried over the host port independently of Docker exec. The gate never restarts
Docker Desktop or shared DPF services. If health does not return after the build
is terminated, recovery is a separately authorized, auditable operation.

## Tests & CI

The pure verdict (`evaluatePrHealth()`) is unit-tested in [`scripts/pr-health.test.mjs`](../../scripts/pr-health.test.mjs) and runs in CI as the **PR Health Logic** job (`node --test`). The script's GitHub I/O is exercised by running it against live PRs; it is not run in CI (it would be circular).
