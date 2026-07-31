# Local-CI Control-Plane Starvation Implementation Plan

- **Status:** ready for implementation
- **Date:** 2026-07-31
- **Backlog item:** `BI-CE6E2882`
- **Epic:** `EP-0DFF753B`
- **Architecture:** `docs/superpowers/specs/2026-07-31-local-ci-control-plane-starvation-design.md`
- **WWMD decision:** `DI-EBA2C9239C5C`
- **Work Capsule:** `WC-BD87F076`
- **Backlog coverage receipt:** `cms9082c00he801mznrw3jxfr` (`atomic`)

## Backlog coverage

- Decision: atomic
- Parent: `BI-CE6E2882`
- Receipt: `cms9082c00he801mznrw3jxfr`
- Dependencies: none
- Rationale: The bounded builder, independent watchdog, infrastructure status,
  evidence propagation, pilot rollback rule, and recovery policy form one safety
  boundary. Shipping any part independently would either leave starvation possible,
  detect it without containment, or lose the evidence needed to prevent unsafe
  capacity expansion.
- Bounded local-CI build and end-to-end control-plane starvation prevention ->
  `BI-CE6E2882`

## Outcome

Prevent a canonical local-CI production build from consuming the shared control
plane, prove portal/MCP/Docker/PostgreSQL responsiveness throughout each build, and
classify a sustained breach as infrastructure evidence that binds the capacity pilot.
The implementation preserves exact Docker artifact identity and keeps requested
capacity at one.

## Atomic delivery decision

This plan is one safety boundary under `BI-CE6E2882`. Resource bounding without the
watchdog would be unproven; a watchdog without bounding would detect harm after it
began; a new status without pilot consumption would allow unsafe expansion. None of
the four implementation sections is independently shippable or claimable as the
outcome.

## 1. Define the bounded builder contract with tests

### Files

- modify `apps/web/lib/nonprod/local-ci-slot-resources.json`
- modify `scripts/lib/local-ci-slot-manifest.mjs`
- modify `scripts/lib/local-ci-slot-manifest.test.mjs`
- create `scripts/config/local-ci-buildkitd.toml`
- create `scripts/lib/local-ci-bounded-builder.mjs`
- create `scripts/lib/local-ci-bounded-builder.test.mjs`

### Red-green sequence

1. Add failing tests for deterministic slot builder identity, resource policy
   projection, Buildx create arguments, and effective-container limit validation.
2. Add the checked-in BuildKit parallelism configuration and slot resource policy.
3. Implement idempotent inspect-or-create provisioning. Fail closed on driver or
   resource drift; never fall back to plain `docker build`.
4. Prove command arguments are argv-safe and no secret-bearing environment value is
   written to evidence.

## 2. Add the concurrent control-plane watchdog

### Files

- create `scripts/lib/local-ci-control-plane-watchdog.mjs`
- create `scripts/lib/local-ci-control-plane-watchdog.test.mjs`
- create `scripts/local-ci-bounded-build.mjs`
- modify `scripts/lib/local-integration-ci.mjs`
- modify `scripts/lib/local-integration-ci.test.mjs`
- modify `scripts/local-integration-ci.mjs`

### Red-green sequence

1. Add failing tests for valid portal payloads, MCP protocol responses, Docker and
   PostgreSQL timeouts, recovery after one unhealthy round, and sustained two-round
   breach.
2. Add failing tests proving the child process tree is terminated and reserved exit
   code 5 is emitted only for a sustained control-plane breach.
3. Implement the asynchronous Buildx wrapper with injected probes and timers.
4. Persist versioned samples and resource policy to the slot evidence path, tied to
   branch, SHA, integration tree, and slot.
5. Replace only the `docker-build` production command; leave host-next behavior
   unchanged.

## 3. Carry the distinct infrastructure status end to end

### Files

- modify `scripts/lib/sandbox-freshness.mjs`
- modify `scripts/lib/sandbox-freshness.test.mjs`
- modify `scripts/gate-worktree.mjs`
- modify `apps/web/lib/nonprod/local-integration.ts`
- modify `apps/web/lib/nonprod/local-integration.test.ts`
- modify `apps/web/lib/mcp/packs/build-evidence-pack.ts`
- modify relevant MCP pack tests
- modify `apps/web/lib/nonprod/local-ci-pool-circuit-breaker.ts`
- modify `apps/web/lib/nonprod/local-ci-pool-circuit-breaker.test.mjs`

### Red-green sequence

1. Add failing status-mapping and evidence-validation tests for
   `blocked_control_plane_starvation`.
2. Implement reserved exit-code classification and MCP schema/handler support.
3. Attach the watchdog evidence to the gate record and pending evidence.
4. Make any starvation result contract requested capacity to one without charging a
   product failure.

## 4. Bind the pilot and contributor documentation

### Files

- modify `scripts/lib/local-ci-pilot-report.mjs`
- modify `scripts/lib/local-ci-pilot-report.test.mjs`
- modify `docs/testing/pr-health.md`
- modify `docs/superpowers/plans/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-plan.md` only if its sandbox failure table lacks the new status

### Red-green sequence

1. Add a failing pilot test proving one control-plane breach forces `ROLLBACK`.
2. Include per-surface health-throughout counts and starvation failures in the pilot
   report.
3. Document the status, evidence location, non-product semantics, and explicit
   recovery boundary.

## Verification

1. Run all affected Node tests from the source-only worktree using the repository
   runtime.
2. Run affected web Vitest tests and typecheck in the governed sandbox.
3. Run module-size and documentation guards.
4. Claim the `local-integration-ci` lease and run the exact merged-tree pregate. Capture
   branch/SHA/slot, builder policy, freshness, production artifact, and all four
   control-plane signals.
5. Run a representative injected-breach harness and prove exit 5, process-tree
   termination, infrastructure classification, and pilot rollback.
6. Push a DCO-signed commit, open a ready PR, run `pnpm pr:health`, enqueue with squash
   auto-merge, then use governed self-upgrade before live verification.

## Rollback

Revert the bounded-builder integration and status addition through a PR. Do not
restore unbounded execution as an operational workaround; leave capacity at one and
classify gates blocked until a safe replacement is deployed. Builder containers are
slot-scoped cache infrastructure and may be removed only through the governed local-CI
cleanup/recovery path.
