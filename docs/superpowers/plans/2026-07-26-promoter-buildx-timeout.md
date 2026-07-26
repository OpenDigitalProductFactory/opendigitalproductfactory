# Candidate Promoter BuildKit Reliability Plan

Backlog item: `BI-2B4EAFC7`

Parent epic: `EP-UPGRADE-LIFECYCLE`

## Outcome

Make candidate promoter artifact construction use the supported BuildKit path and
the same governed timeout policy as the full promoter run, so a progressing
cold-cache build is not killed at an unrelated five-minute boundary.

## Phase 1 — Reproduce the contract defect

- Add unit coverage asserting the candidate artifact uses explicit Buildx
  semantics and loads the result into the local image store.
- Add unit coverage asserting candidate Docker operations receive the resolved
  promoter timeout rather than a fixed five-minute value.
- Extend the promoter image contract test to require the Buildx CLI component in
  both Docker-executing images.
- Run the focused tests and capture the expected failures before implementation.

## Phase 2 — Implement and refactor

- Change the candidate artifact build command to `docker buildx build --load`.
- Route candidate artifact Docker operations through a runner created from the
  shared `resolvePromoterTimeoutMs` policy.
- Add `docker-cli-buildx` to the portal runtime image.
- Update operator documentation so the timeout and BuildKit behavior match the
  executable contract.

## Phase 3 — Verify and deliver

- Run focused Vitest and Node contract suites.
- Run the affected package typecheck and production build through the governed
  local-CI convergence path.
- Confirm the branch merges cleanly with current `origin/main`.
- Commit with DCO sign-off, push, open a regular ready-for-review PR, and run
  `pnpm pr:health`.

## Risks and rollback

- Risk: Buildx may use a non-default builder whose result is not visible to
  `docker image inspect`. Mitigation: require `--load` and retain the existing
  immutable digest/label inspection.
- Risk: extending the candidate build budget can delay a genuine failure.
  Mitigation: retain the existing bounded, environment-overridable 25-minute
  promoter budget and timeout marker; no unbounded process is introduced.
- Rollback: revert this single PR. The prior pre-quiescence failure behavior and
  legacy builder fallback would return without affecting stored data.

## Documentation impact

Update `docs/user-guide/operations/self-upgrade.md` and the operations overview
because operators currently see a five-minute failure even though the guide
describes only the 25-minute promoter budget.

## Backlog coverage

This is one atomic, independently reviewable reliability repair. Tests,
implementation, runtime-image dependency, and documentation must land together
because splitting any of them would leave the upgrade contract internally
inconsistent.

Coverage receipt: `cms29cyz100hv01odkmnajy06`

Decision: `atomic`

Mapped item: umbrella `BI-2B4EAFC7`; no child BI is independently shippable.
