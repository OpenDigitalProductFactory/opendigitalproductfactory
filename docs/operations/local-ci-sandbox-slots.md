# Local-CI sandbox slots

The contributor pregate uses durable `local-integration-ci` lease admission and
a versioned slot manifest. The lease decides who may run; the manifest decides
which physical resources that admitted owner may mutate. These are separate
safety layers.

## Current operating mode

Automatic capacity remains **one**. `slot-0` is the only automatically admitted
identity. `slot-1` is declared so isolation can be proven before the reversible
capacity pilot in BI-A4427AB8; its presence is not permission to bypass the
lease or run two gates manually.

Slot 0 preserves the established external endpoints:

- portal: `http://localhost:3010`
- PostgreSQL host port: `54329`
- scratch checkout: `D:/DPF-worktrees/.local-ci-runner` on the canonical
  Windows host layout

All other identities—including the process fence, Compose project, PostgreSQL
container/database/volume, integration branch namespace, dependency
convergence lock/store, logs, and evidence—come from
`scripts/lib/local-ci-slot-manifest.mjs`. Do not reconstruct these names in a
runbook or a second script.

## Recovery

A lost database heartbeat and a live local process fence is an unhealthy slot,
not evidence that the slot is free. Admission fails closed until the owner is
terminated or the dead fence is reaped.

Port reachability is also not resource ownership. The runner verifies the exact
manifest-named PostgreSQL container before reuse. If the assigned port is
occupied while that container is absent, provisioning fails closed and names
the conflicting slot, port, and expected container; it must never borrow a
legacy or peer database merely because TCP accepts a connection.

Lease recovery uses the recorded cleanup command:

`node scripts/local-ci-slot-cleanup.mjs --slot-key <recorded-slot>`

The cleanup planner accepts only the closed manifest slot keys, scopes Compose,
container, volume, and build-output cleanup to that identity, and validates the
filesystem target remains inside the slot scratch boundary. The command must
come from the lease record or diagnosed slot state; never guess a peer slot.
Use `--dry-run` when investigating so the exact targets are visible without
mutation.

If freshness convergence cannot prove the dependency graph, the result is
`blocked_sandbox_drift`, not a product failure. Each slot has its own
convergence mutex and scratch pnpm store, so starting a second install as a
repair is never valid.

## Evidence contract

Every exact-tree result records:

- manifest schema version and slot key
- candidate branch/SHA, accepted base, integration commit, and synthesized tree
- resolved dependency versions and toolchain fingerprint
- PostgreSQL container, port, database, and volume
- Compose project and portal URL
- production artifact kind, locator, identity, and integration-tree binding
- lease, heartbeat/fence events, output path, and freshness verdict

Capacity may increase only through the separately governed pilot after
slot-isolation tests and the capacity-one exact-tree gate pass.
