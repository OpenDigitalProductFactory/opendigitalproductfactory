# PR Health — merge-readiness checker

`pnpm pr:health [<pr-number>]` (script: [`scripts/pr-health.mjs`](../../scripts/pr-health.mjs)) gives **one mechanical verdict** on whether a pull request can actually merge. Run it before claiming a PR is "green" or "mergeable" — do not eyeball a subset of checks.

```
pnpm pr:health           # the PR for the current branch
pnpm pr:health 2427      # a specific PR
```

Exit `0` = **READY**, `1` = **NOT READY** (blockers enumerated), `2` = usage/IO error.

## Why it exists

The canonical required-context policy includes **Failure Readiness**. It checks the trusted platform verdict for the final source commit and, in a merge group, every included source PR. Missing or expired evidence is a blocker. See [failure-analysis rollout and recovery](../architecture/failure-analysis-and-recovery.md) for producer deployment, publisher configuration and same-review status retry. A source PR alone does not activate this protection on a running installation.

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

For ordinary external non-documentation changes, readiness requires one visible `Local-CI-Evidence:`
or `Local-CI-Override:` trailer in the final PR body. An evidence identifier must
match the existing worktree slot records for the current branch and commit,
including a completed, published, unexpired verdict and matching producer
metadata. Failed, pending, skipped, test-stub and foreign records do not qualify.
The command only reads those records; it does not acquire a lease or rerun a gate.
Correct a missing trailer using the actual qualified evidence. When evidence
cannot be resolved, reconcile its provenance or use an already-authorized
override; do not invent a PASS or repeat full validation merely to repair text.
Allowed overrides are reported as **UNRUN**, and protected checks still apply.
These metadata checks run even when local guard results are reused or skipped.

### Corrections after publication

A failed GitHub check or merge attempt does not automatically send the entire
PR through local integration again. The normal Git pre-push hook can qualify an
existing published correction, and `pr:ready` selects the same affected plan.
For a direct diagnosis or an explicit related-test mapping, run:

```
node scripts/published-correction.mjs
node scripts/published-correction.mjs --related-tests <source-to-tests.json>
node scripts/published-correction.mjs --status
```

The mapping uses the existing evidence planner's object format: repository
source paths map to arrays of repository test paths. Missing mappings stop the
affected route with the precise source paths; they do not request a full lease.

This route requires a clean topic branch, an actual open non-draft PR on that
branch and repository, required checks plus a protected merge queue on `main`,
and accepted initial-publication evidence for its published source. A qualified
canonical record or a previously allowed recorded override can anchor it. An
open PR by itself, a new correction record or a prose trailer cannot. Initial
publication keeps its existing requirements.

Unchanged bytes or a commit-message correction execute no source suite. Changed
bytes use the existing affected-test/package planner and execute its checks;
full integration and broad source guards are delegated to protected GitHub.
Repository, DCO and body/label-sensitive guards remain fresh. The verifier
binds the branch's merge base, so unrelated incoming main commits do not rerun
affected checks; protected GitHub checks still verify the current integration.
The verifier
checks source, toolchain, environment, expected commands, actual PR and branch
protection again before retaining reusable evidence for at most one hour.
Failures, skips, dirty files or identity drift refuse this publication path.

Carry the exact emitted `Local-CI-Override: published-correction: ...` line in
the PR body. Every publication reader requires its current machine proof in the
existing local stage receipts. It reports **full local integration UNRUN /
delegated**; neither the previous canonical PASS nor the canonical slot records
are rewritten. Their source identities and timestamps remain historical.
All required GitHub checks, unresolved review threads and the protected merge
queue still gate the merge. Runtime and independent acceptance remain separate.

Build Studio uses the same readiness command with an internal
`--published-ref` mode. Its shipping transaction is deliberately branch-first:
it publishes a recoverable branch, fetches and checks out that exact remote
commit in the build sandbox, runs canonical readiness against the final PR
body, restores the build branch, and opens a PR only for a ready verdict.

That detached, exact `--published-ref` path retains Build Studio's separate
server-owned canonical preflight requirement; it does not require external
worktree slot files. Readiness reports **local proof UNPROVEN** in its text and
JSON notes. The flag selects mechanical checks, not publication authority or a
local integration PASS. Supplied local-CI trailers still require validation.
An original/private-tree proof is not relabeled as proof of a remapped published
tree. Transporting qualified canonical proof into that body's metadata remains
a separate follow-up; the server's existing prepublication check still applies.
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

**Hosted production-build profile**

The BI-07BCDD1E correction aligns PR production builds with the existing
non-experimental merge-group/release profile. Experimental filesystem-cache
restoration/enablement is removed from this CI job; the build command,
selection, required checks, time bounds and exact-tree artifact handoff remain.

A hosted-runner shutdown after compilation leaves production-build completion
inconclusive. Preserve source SHA, actual checkout/integration SHA, event,
cache setting and failure history. A successful manual source-branch run does
not certify a different PR merge candidate. Use the actual protected PR/queue
results and `pr:health` before claiming green; never create a replacement
success status for an interrupted run. See the
[bounded design](../superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md).
