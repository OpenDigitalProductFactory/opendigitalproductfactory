# Lockfile minimum-release-age recovery plan

Backlog item: `BI-72E0A27B`

## Evidence and scope

The governed local-integration gate fails before Prisma generation with
`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. Commit `a84a6ac5a` (dependency PR
#2779) upgraded root `@mermaid-js/mermaid-cli` from 11.15.0 to 11.16.0. Its
`@zenuml/core` graph resolved five `@floating-ui/*` releases published on
2026-07-11, younger than the repository's 1440-minute `minimumReleaseAge`.
The candidate UX branch does not touch dependency files, and the failure
reproduces on current `origin/main` in the governed sandbox.

## Phase 1 — recover the dependency seed

- Restore root `@mermaid-js/mermaid-cli` to the last accepted 11.15.x line in
  `package.json`.
- Regenerate only the affected lockfile graph; do not relax
  `minimumReleaseAge` or add policy exclusions.
- Verify the five rejected Floating UI versions and their ZenUML-only graph are
  absent from `pnpm-lock.yaml`.

## Phase 2 — make the invariant executable

- Add a deterministic lockfile-policy check that invokes pnpm's configured
  policy against the committed lockfile without installing runtime packages.
- Wire it into dependency-changing CI/pre-commit coverage so a dependency PR
  cannot merge a lockfile the next clean sandbox will reject.
- Add a regression test for the guard's command/exit behavior.

## Phase 3 — functional recovery

- Run the governed merged-code local-integration gate for this blocker branch.
- Re-run the previously blocked `feat/rfc-expandable-card` gate and confirm it
  proceeds through unit tests, typecheck, and production build.

## Risks and rollback

- Risk: Mermaid CLI 11.15 may differ from 11.16 in generated documentation
  diagrams. Mitigation: this is the immediately preceding version already used
  by DPF; run its existing tests/build.
- Risk: broad lockfile churn. Mitigation: reject the change if the diff extends
  beyond the Mermaid/ZenUML/Floating UI graph and necessary peer snapshots.
- Rollback: revert this branch's package and lockfile commit. Do not weaken the
  supply-chain policy as a rollback mechanism.
