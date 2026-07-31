# Build Studio fail-closed PR readiness

Backlog item: `BI-121DC3A3`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Build Studio publishes a recoverable branch first, evaluates that exact branch
with the canonical readiness contracts, and opens a PR only when the verdict is
ready. A blocked verdict leaves the branch available and returns actionable
blockers. The same result records whether Build Studio had gate context and
readiness context so deterministic failure trends can be measured by surface.

## Design grounding

- Existing specs/plans reviewed: `docs/testing/pr-health.md`, the canonical
  local readiness contract, and PR #3777's Build Studio gate-context delivery.
- Current code substrate reviewed:
  `apps/web/lib/mcp/build-ship-handlers.ts` currently runs the smaller
  `runPrePRGates(diff)` list and can create a PR with `verification-issues`.
- `scripts/pr-readiness/core.mjs` owns trailer validation and readiness
  evaluation for contributor branches.
- `scripts/lib/ci-policy-guards.mjs` owns the source/workspace/PR policy
  profiles consumed by local readiness and CI.
- `apps/web/lib/integrate/github-api-commit.ts` currently combines branch
  publication and PR creation in one side effect.
- PR #3777 already delivers canonical gate context to Build Studio prompts.
- Source of truth: `scripts/pr-readiness/core.mjs` and
  `scripts/lib/ci-policy-guards.mjs`.
- Decision: publish a recoverable branch, validate its exact remote commit,
  and only then open a PR; retain one compatibility wrapper for other callers.

## Phases

### 1. Define the shipping verdict test-first

- Add focused tests proving failed typecheck, failed tests, incomplete
  acceptance, invalid trailers, or canonical policy blockers prevent PR
  creation.
- Prove a blocked result still returns the published branch and exact commit.
- Prove a ready result passes the exact validated body to PR creation.

Verification: run the focused Vitest files and observe the new assertions fail
before implementation, then pass.

### 2. Split branch publication from PR opening

- Refactor `github-api-commit.ts` so the existing API remains compatible while
  exposing branch publication and PR opening as separately testable operations.
- Do not duplicate blob/tree/commit construction, DCO identity, existing-PR
  recovery, or label behavior.

Verification: existing GitHub API commit tests plus new ordering tests pass.

### 3. Converge Build Studio on canonical readiness

- Add one Build Studio adapter around the canonical readiness core and policy
  profile registry.
- Extend the readiness command with a published-ref mode. In that mode a
  detached checkout is accepted only when `HEAD` exactly equals the fetched
  remote branch ref; the normal named-branch and unpushed-commit exceptions do
  not apply otherwise. All diff, DCO, clean-tree, trailer, and canonical policy
  checks remain active.
- Remove `runPrePRGates` from the shipping decision path.
- Treat verification and acceptance failures as blockers, not PR labels.
- Publish the branch, fetch and detach-checkout the exact published commit in
  the build sandbox, evaluate the exact published commit/body, restore the
  build branch in `finally`, and open the PR only on a ready verdict. A fetch,
  checkout, or restore failure is itself a blocker.
- Return canonical blockers and recovery branch data when blocked.

Verification: handler contract tests prove no PR-side effect occurs for every
  blocker class and prove the ready path uses the validated body unchanged.

### 4. Record shift-left effectiveness

- Record surface, gate-context availability, readiness-context availability,
  exact head SHA, verdict, and blocker taxonomy in existing build activity.
- Keep measurements low-cardinality and derived from the verdict; add no new
  telemetry registry.

Verification: tests assert the activity payload distinguishes context-present
  and context-missing attempts.

## Documentation impact

Update contributor/process documentation describing Build Studio's branch-first
handoff and fail-closed PR creation. No product UI, route, or form changes are
planned.

## Risks and rollback

- **Partial side effect:** branch succeeds and readiness fails. This is the
  desired recoverable state; return the branch and never open a PR.
- **Duplicate rules:** importing a copied checklist would drift. Consume the
  canonical readiness and policy modules.
- **Public/private diff mismatch:** evaluate the same shareable diff and body
  that will be published.
- **Rollback:** revert the PR. The previous atomic helper remains available
  through its compatibility wrapper, but premature PR creation must not be
  re-enabled as an operational workaround.

## Completion gate

- Focused tests, web typecheck, full exact-tree local-CI, and production build
  pass.
- A test demonstrates a pushed branch with blockers and zero PR POSTs.
- A test demonstrates a ready exact head and one PR POST with the validated
  body.
- Documentation states why no UX or migration evidence is required.

## Backlog coverage

- Decision: atomic
- Parent: `BI-121DC3A3`
- Receipt: `cms8bh7h607ul01qo3bjpw9f5`
- Mapping: `build-studio-readiness` -> `BI-121DC3A3`
- Rationale: branch publication, readiness, PR opening, and measurement are one
  shipping transaction; none is safe to ship independently.
