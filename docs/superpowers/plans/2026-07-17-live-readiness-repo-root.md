# Live-readiness repo-root wiring

Date: 2026-07-17
Backlog: BI-1D55A2AD
Epic: EP-5410E8EA — Forge-neutral, offline-capable Git integration substrate

## Goal

Make the portal-side `verify_live_install_readiness` path compute Git ancestry on a normal local install without assuming the container working directory is a Git repository.

## Grounding

- `apps/web/lib/verify/preflight-service.ts` already delegates verdicts to `computePreflightVerdict`.
- `apps/web/lib/verify/git-ancestry.ts` already supports `DPF_REPO_ROOT`, `DPF_GIT_WORK_TREE`, `GIT_DIR`, and then `process.cwd()` as candidate roots.
- `docker-compose.yml` already mounts the host install path at `/host-dpf` for the `portal` service.
- The missing contract is the environment variable that tells the portal to use that mount as the Git repo root.

## Plan

1. Add a failing compose-runtime regression test proving the `portal` service exports `DPF_REPO_ROOT: /host-dpf`.
2. Set `DPF_REPO_ROOT: /host-dpf` in the installed `portal` runtime environment, adjacent to `DPF_HOST_INSTALL_PATH`.
3. Run the compose-runtime test and the live-readiness unit tests.
4. After merge and governed self-upgrade, verify `verify_live_install_readiness(featureSha)` returns `CAN-TEST` or `MUST-ADVANCE` instead of `BLOCKED` for a normal Git-stamped local install.

## Verification

- `node --test scripts/lib/compose-runtime-env.test.mjs`
- `pnpm --filter web exec vitest run lib/verify/git-ancestry.test.ts lib/verify/preflight-service.test.ts lib/verify/preflight.test.ts`
- Post-upgrade MCP check: `verify_live_install_readiness` against the #3168 merge SHA.

## Rollback

Remove the `DPF_REPO_ROOT` environment variable from `docker-compose.yml`; the portal will fall back to the previous behavior and return the existing operator-readable `BLOCKED` result when it cannot find a Git repo.
