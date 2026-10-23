---
status: active
---

# Bind Docker Desktop preview mounts to admitted POSIX source

Backlog: BI-81AF5884. Workroom: WC-DB6884ED. This is a bounded successor
to completed BI-10AC904B, which owns the contributor-preview binding flow.
Implementation was admitted after native coverage and research receipts. The [ordered plan](../plans/2026-10-21-preview-docker-desktop-mount-identity.md)
carries the delivery and verification sequence.

## Problem and source evidence

The governed preview for immutable refactor source completed sanitization, then
its keeper stopped the owned preview at `preview_actual_mount_mismatch` before
served checks ran. The admitted source was
`/Users/markbodman/dpf-worktrees/reusable-continuation`; Docker inspect reported
`/host_mnt/Users/markbodman/dpf-worktrees/reusable-continuation` bound to
`/workspace`. This is evidence of the observed Docker Desktop namespace, not
a promise that every Docker installation uses it.

On main `28ab249373336c86b409a6cb129370867533c6fc`, the shared
`packages/integration-shared/src/preview-mount-identity.cjs` recognizes the
Windows Desktop namespace and otherwise compares POSIX paths literally. Both
`scripts/lib/dev-preview-runtime.mjs` and
`apps/web/lib/govern/preview-automation-sign-in.ts` call it. Thus a repair only
in the host keeper would still leave the canonical session issuer refusing the
same admitted preview.

## Research and design grounding

[Docker's bind-mount documentation](https://docs.docker.com/engine/storage/bind-mounts/)
locates a bind source on the daemon host and describes Desktop's Linux VM
handling native host paths. The [Docker info command](https://docs.docker.com/reference/cli/docker/system/info/)
provides daemon metadata through its formatting interface. Use that existing
read surface rather than a new DPF platform setting or host-path heuristic.
DPF's `scripts/installer/macos-docker-memory.mjs` already distinguishes Desktop
using the daemon's exact `OperatingSystem` value `Docker Desktop`.

An unconditional `/host_mnt` rewrite is unsafe: native Linux may contain distinct
`/host_mnt/Users/...` and `/Users/...` directories. A path that resembles a Mac
does not establish the selected daemon's platform. The server itself runs in a
Linux container, so its process platform does not establish the host either.

## Requirements and contracts

**OBJ-MOUNT:** Admit the observed Desktop source alias without widening the
preview's authority or accepting a different source directory.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-MOUNT | Both the host keeper and canonical server issuer accept the observed /host_mnt/Users/... to /Users/... tuple only with fresh Docker daemon OperatingSystem evidence equal to Docker Desktop. |
| AC-2 | OBJ-MOUNT | Missing, failed, unknown or native Linux daemon evidence cannot make distinct /host_mnt and direct POSIX paths equivalent. |
| AC-3 | OBJ-MOUNT | Wrong roots, POSIX case changes, NUL, CR and LF, dot traversal, relative paths and prefix lookalikes remain rejected; existing direct POSIX and Windows mount behavior remains valid. |
| AC-4 | OBJ-MOUNT | Existing lease, owner, SHA, clean-source, running-container, port, service and development-environment checks remain enforced. |
| AC-5 | OBJ-MOUNT | First-failing regressions, affected tests and typechecks, independent review, and required shared-CI and native publication gates precede any ready code PR; unavailable gates remain unrun or inconclusive. |
| AC-6 | OBJ-MOUNT | This delivery makes no runtime, production-data, credential, grant, infrastructure, deployment, merge or initialized-database-reuse change. |

C-MOUNT: Extend the existing shared pure matcher with an optional daemon
operating-system fact. Reject malformed paths before translation. First retain
the existing exact normalized POSIX comparison, including admitted literal
paths beginning `/host_mnt/`. Only if direct equality fails, translate one exact
leading `/host_mnt/` when the fact is exactly `Docker Desktop`, then repeat
the exact normalized comparison. Do not lowercase
POSIX paths, accept suffixes, strip a middle component or resolve a daemon
namespace against the client filesystem. Retain the existing Windows branch.

C-ENGINE: Each adapter obtains `docker info --format {{.OperatingSystem}}`
through the same configured command boundary used for its container inspection.
Bound this read to ten seconds through each adapter's existing command boundary.
Read it for each binding check, including the keeper's renewal inspections;
do not cache it for the whole lease. Unknown or failed metadata permits no new
alias. Existing direct POSIX and Windows comparisons retain their behavior,
including when the metadata command fails. Preserve the existing NUL/CR/LF
path validation; this repair does not change the set of permitted POSIX filenames.
Daemon metadata is trusted to the same extent as the inspect result; there is
no user-supplied evidence field, environment override or persistent platform flag.

F-KEEPER: admitted lease and exact clean source -> container inspection and
fresh daemon metadata -> shared mount comparison -> existing environment,
SHA and lease assertions -> existing readiness/renewal flow.

F-ISSUER: authenticated principal and admitted lease -> source Workroom ->
container inspection and fresh daemon metadata -> shared mount comparison and
all existing bindings -> disposable-database session issuance -> existing
lease/source recheck. No new bootstrap or privilege route is introduced.

## Risks, convergence and rollback

Both source adapters must ship together. Editing host source does not update
the running canonical server image, so source tests cannot establish served
acceptance. The ordinary reviewed release and separately approved canonical
install advance must deliver these bytes before the original preview can be
retried. This branch will neither deploy nor start that preview.

Fresh daemon metadata adds a bounded read; an unavailable daemon fact must hold
the new alias rather than silently assert equivalence. Retain private command
output handling. A rollback removes the alias support and returns this Desktop
preview to the existing safe hold. No schema, migration, settings or data repair
is required. Clone-scale BI-B47BB1D7 and refresh-CI BI-25CB699C remain separate.
