---
status: draft
---

# Repair the prebuild migration-secret lookup

Backlog: **BI-78EDA4E7**. Delivery: normal reviewed small repair.

Production incident: `SUR-A65B74FF` and `SUR-AB947617`, deployed
`6ce2f7e4453fedc897760e334712293c7ff14cb7`, targeting
`36f53132a129803fc1b4666a7e0ca10f9ca76c32`, fail with
`prebuild-failed: ENOENT: no such file or directory, open '/run/secrets/dpf-runtime-transition'`.

## Evidence and boundary

The prebuild introduced by #5975 passes `basePromoterParams` without a migration
handoff. `buildPromoterCommand` mounts the state directory for every mode but
mounts `/run/secrets/dpf-runtime-transition` only with a migration handoff or
runtime-capability transition. `promote.sh` verifies an envelope before building;
the candidate's resolver unconditionally reads the separate secret mount.
The live portal has a readable `/dpf-state/runtime-transition.secret`; no secret
contents were read for the investigation. Database reads confirmed the two failed
runs. The portal remains healthy and the failure precedes the drain.

This extends the existing N-1 candidate self-issuance contract in
`scripts/promoter-migration-envelope.mjs` and the build-before-drain contract in
[the upgrade plan](../plans/2026-09-30-upgrade-waits-for-work-plan.md), item 0.
Changing only the portal launcher cannot recover an already deployed launcher.

## Ordered repair and acceptance

1. Reproduce resolution without an explicit secret path and with the secret
   only in the mounted state directory, using a disposable local fixture.
2. Preserve explicit secret-path authority. Without an explicit path, prefer
   the existing `/run/secrets/dpf-runtime-transition`; only its ENOENT permits
   reading `runtime-transition.secret` from `DPF_PROMOTER_STATE_DIR` (default
   `/dpf-state`). Both are views of the install's existing signing authority.
3. Test the N-1 self-issued envelope, carried signed envelope, invalid explicit
   path, missing secret, malformed handoff and signature rejection. Never create
   a secret, bypass verification, or accept an unsigned state migration.
4. Run affected Node tests and source checks; publish through signed commits,
   independent review and the merge queue. Retry the canonical self-upgrade only
   through an authorized operations surface, then verify deployed identity and
   the upgrade result. Portal screen grants are currently absent for this
   assistant, so production operation remains separately blocked.

## Scope and compatibility

No schema, UI, dependency, credential rotation, runtime patch, or new service.
Existing launchers with the separate mount keep their current path. Explicit
configuration and non-ENOENT filesystem errors remain failures. The fix ships
in the candidate promoter, which the running portal builds before its prebuild.
The same container paths apply across deployment hosts; no host-specific path
is introduced. Operator docs do not change; this design records the recovery
contract for maintainers.
