# Required service recovery after upgrade

Backlog: BI-FFFEA4ED. Workroom: WC-C6BBDE4C. Profile: fix.

## Problem and evidence

SUR-B0654823 completed the portal swap but left five monitoring containers in
Created state. Docker inspection shows bind sources under `/host-source`, the
promoter's mount namespace, rather than the host install path. The next upgrade
counts these containers as present and never retries them. On this macOS install,
the service projection also requires Docker speech although the platform overlay
uses native speech at port 8771. Separately, sandbox startup fails resolving
`@dpf/validators` from `packages/db`: source exists but its dependency link does not.
These observations establish defects, not a successful repair or live verification.

## Acceptance criteria

- AC-1: Required monitoring services start using valid host mounts after a canonical upgrade.
- AC-2: A Created container from a prior failed start is retried; an intentionally stopped previously-running container remains stopped.
- AC-3: Failed required service recovery remains visible in durable upgrade evidence.
- AC-4: macOS requirements match native speech delivery and voice synthesis succeeds.
- AC-5: Sandbox serves its health endpoint with workspace dependencies resolvable.
- AC-6: Regression tests pass and canonical runtime evidence verifies the repaired services.

## Research and existing contracts

The existing postgres mount repair documents the same Docker daemon namespace
problem in `2026-07-16-postgres-baked-image-self-upgrade-mount-fix.md`. Its baked
image also supplies pgvector; monitoring configurations remain shipped files.
BI-DB87D925 already isolates each missing service's startup. Preserve that behavior.
BI-E2763038 covers the independently tracked unavailable speech image; this repair
does not select a replacement image. The capability resolver already filters by
host platform, so correct its canonical manifest rather than add a second filter.

Contract C-MOUNTS: Docker bind sources must name daemon-visible host paths; named
volumes and paths outside known promoter mounts must remain unchanged.
Contract C-RECOVERY: Retry missing or Created/never-started required containers;
preserve previously started containers and dependencies. Retain per-service failure.
Contract C-HOST: Use the canonical host-filtered service projection.
Contract C-SANDBOX: Converge dependencies for the sandbox's actual source before
serving it; never revive the retired image-to-workspace source-advance engine.

## Ordered implementation and verification

1. V-REGRESSION: Add failing behavioral coverage for path translation (including
   spaces, Windows host paths, nested release assets, named volumes and unrelated
   binds), retryable Created containers, stopped/running preservation and failed
   retries. Extend the existing promoter shell harness, not a parallel runner.
2. F-UPGRADE: Pass host mount identity into the promoter. Render the selected
   compose configuration and append a bind-only override using the existing
   compose chain. Preserve all mount options and container targets. Apply the
   mapping before service reconciliation, after release identity commit. The
   existing portal swap/rollback and baked postgres paths remain unchanged. Retry only containers
   proven never started, once per upgrade, using per-service isolation. Keep
   durable degraded evidence when inspection or recovery fails.
3. F-HOST: Remove macOS from the container speech requirement in the substrate
   manifest and regenerate its catalog. V-HOST verifies Windows/Linux projection
   remains intact, macOS uses its native endpoint, and live synthesis returns audio.
4. F-SANDBOX: Inspect the canonical sandbox source/dependency recovery path and
   repair missing dependency convergence there. Add V-SANDBOX coverage proving
   an unresolved workspace dependency prevents a false readiness claim and that
   convergence happens before startup; preserve user source. Verify `/api/health`.
5. V-DELIVERY: Run affected tests, package typechecks, generated-artifact guards and
   diff-scoped local gates. Deliver through a DCO PR and the cloud build gate.
   Advance the canonical install through Self-Upgrade and verify required service
   status, monitor endpoints, sandbox health and voice synthesis. A blocked or
   unrun runtime check remains explicitly unverified.

## Backlog coverage

Parent BI-FFFEA4ED covers one required-service recovery outcome. Steps above are
internal sequencing of that outcome, not independent feature deliveries: a retry
without correct mounts repeats the failure; correct paths without retry strand
existing installations; an inaccurate host projection makes every repaired run
degraded. Sandbox dependency verification is part of the required topology check.
Coverage decision: atomic. Initial receipt: cmurw5rog0b2601qur9hwdt7e
(bound to commit 120a0359c7a7522d35eb1272a9779b002c3ee474).
Implementation keeps mount translation in the already-shipped compose argument
helper so an older portal can stage the candidate promoter without knowing a new
file. The sandbox uses an image-baked entrypoint that performs a frozen install
for existing workspace source; it does not alter source or bootstrap sentinels.
Docker volumes merge by target per the [Compose merge specification](https://docs.docker.com/reference/compose-file/merge/#unique-resources).
Requirement refs: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6.
Contract refs: C-MOUNTS, C-RECOVERY, C-HOST, C-SANDBOX.
Flow refs: F-UPGRADE, F-HOST, F-SANDBOX.
Verification refs: V-REGRESSION, V-HOST, V-SANDBOX, V-DELIVERY.

## Impact, documentation and rollback

The scope claim returns no testImpact or guardObligation entries; it requires a
Convergence-Impact trailer and regeneration of the document index and capability
catalog. Update the platform support watchlist and operator recovery documentation.
No schema migration, new service, dependency, or UI is planned.

Risks include rebasing already absolute binds, accidentally restarting intentional
stops, and mapping extracted release assets to temporary paths. Tests must prove
path-boundary matching and preserve host-owned binds. Release assets must remain
available for the lifetime of the created services. An inspection failure must
never be interpreted as permission to recreate an unknown container.

Rollback is a single PR revert followed by the canonical upgrade/recovery process.
Do not delete volumes or replace operator configuration. Keep the prior portal's
identity and rollback behavior intact. Native speech uses the existing supported
host setup/recovery procedure; it is verified independently from Docker presence.
