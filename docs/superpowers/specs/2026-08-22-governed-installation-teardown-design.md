---
status: binding
---

# Governed Installation Teardown

| Field | Value |
| --- | --- |
| Date | 2026-08-22 |
| Backlog | `BI-2E9887D2` |
| Surface | `/ops/teardown` |
| Owners | Platform operations, installer lifecycle |
| Related | `2026-05-23-governed-platform-upgrade-lifecycle-design.md`; `2026-05-24-activity-quiescence-protocol-design.md`; `2026-05-17-postgres-daily-backup-design.md` |

## 1. Decision

DPF shall expose teardown as a governed installation lifecycle operation. A portal administrator can inspect the exact consequences, create and trial-restore a recovery point, drain in-flight work, and hand a short-lived signed plan to a sibling runtime that survives the portal and database being stopped. The operation is not exposed as an MCP tool or agent-callable API. The destructive transition is confirmed only by a continuous pointer gesture in the authenticated portal UI; typed phrases are rejected as a confirmation mechanism.

The operation has four scopes:

| Scope | Stops containers | Removes volumes | Removes source | Recovery/trial restore | Human hold |
| --- | ---: | ---: | ---: | ---: | ---: |
| `containers` | yes | no | no | no | no |
| `volumes` | yes | yes | no | required | required |
| `source` | yes | no | yes | source salvage required | required |
| `everything` | yes | yes | yes | database recovery + source salvage required | required |

`everything` intentionally preserves the external recovery archive and terminal evidence. “Everything” means the runnable installation—containers, install-owned volumes, and source—not the only artifacts capable of proving or reversing the action.

## 2. Current repository truth

- Install and self-upgrade are portal-governed, but `uninstall-dpf.{ps1,sh}` are host-only entry points.
- The self-upgrade path already supplies the correct survival boundary: the portal drains work and launches a sibling `dpf-promoter` container through the Docker socket.
- PostgreSQL backup and trial-restore runners already exist. The current trial runner chooses the latest backup; teardown must bind verification to the backup it just created.
- Installer state is a host bind at `/dpf-state`, backups are a host bind at `/backups`, and new installs set `DPF_BACKUPS_HOST_PATH` to a sibling of the install root.
- Existing salvage classification is authoritative: a branch is risky when `git rev-list --count <branch> --not --remotes` is non-zero; dirty paths and stashes are separate risks. Third-party clones remain `UPSTREAM-CACHE`, never “local-only.”
- Windows `Remove-Item -Recurse` can traverse NTFS junctions. Governed teardown must use a no-follow walker: inspect each entry with link metadata, unlink links as links, and delete ordinary directories only after their children.

## 3. Research & benchmarking

| System | Useful pattern | DPF decision |
| --- | --- | --- |
| [Kubernetes finalizers](https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/) | Deletion is an explicit state transition that remains pending until controllers complete required cleanup. | Adopt a finite, evidenced sequence; a failed precondition leaves the install running. |
| [Kubernetes garbage collection](https://kubernetes.io/docs/concepts/architecture/garbage-collection/) | Ownership and propagation policy make deletion scope explicit. | Adopt named scopes and install/project ownership selectors. Reject daemon-wide pruning. |
| [Argo CD app deletion](https://argo-cd.readthedocs.io/en/latest/user-guide/app_deletion/) and [delete confirmation](https://argo-cd.readthedocs.io/en/release-3.4/user-guide/sync-options/) | Cascading deletion is separately chosen and can require explicit operator approval. | Adopt a separate destructive confirmation. Reject typed confirmation that an agent can relay. |
| [Argo CD sync waves/hooks](https://argo-cd.readthedocs.io/en/release-3.5/user-guide/sync-waves/) | Ordered phases and pre-delete hooks run before resource removal. | Adopt salvage, recovery verification, quiescence, dispatch, mutation, evidence ordering. |
| [Docker volumes](https://docs.docker.com/engine/storage/volumes/) | Volumes outlive containers unless explicitly removed. | Make `containers` non-destructive and volume removal explicit. |
| [GitLab backup/restore](https://docs.gitlab.com/omnibus/settings/backups/) | Backups require application-consistent operational procedures. | Reuse the managed backup substrate, not an ad-hoc file copy. |
| [Velero manual testing](https://velero.io/docs/main/manual-testing/) | Backup success is insufficient without restore testing. | Require the exact teardown dump to restore into a temporary database before volume deletion. |

Rejected: background best-effort deletion, daemon-wide `docker system prune`, a typed phrase, a plan an MCP client can submit, evidence stored only in Postgres, and recursive deletion that follows links.

## 4. Safety invariants

1. Only a user with `manage_platform` can preview or initiate teardown.
2. No teardown MCP verb exists. The request endpoint is a server action co-located with the UI.
3. A destructive request requires a server challenge no older than five minutes and a continuous pointer hold. Scope, actor, preview digest, recovery receipt, expiry, install path, compose chain, and project are bound into the signed envelope.
4. The sibling verifies HMAC, expiry, schema, paths, project, scope, and recovery receipts before its first mutation.
5. Compose and Docker selectors are project-scoped. The runner never prunes unrelated resources.
6. `volumes` and `everything` require an `ok` backup plus an `ok` trial restore of that exact backup.
7. `source` and `everything` create source salvage evidence before deletion. The runner repeats the salvage scan; changed risk invalidates the handoff.
8. Source deletion is refused when the evidence/recovery root is equal to or nested inside the source root.
9. Link-like entries are unlinked without traversal. The source root, filesystem root, user profile, and evidence root can never be recursive deletion targets.
10. The external journal is written `planned` before mutation and terminally updated `completed` or `failed` with per-stage receipts. It survives volume and source removal and is discoverable after reinstall.
11. Quiescence precedes handoff. A failed or deferred drain leaves containers, volumes, and source untouched.
12. `containers` is the only non-destructive scope and does not require the destructive hold.

## 5. Architecture

```text
authenticated admin UI
  -> preview (scope + salvage + paths + blockers)
  -> pointer-hold confirmation challenge
  -> exact Postgres backup + exact trial restore (when needed)
  -> activity quiescence
  -> HMAC-signed, five-minute envelope
  -> detached sibling teardown runner
       -> verify envelope again
       -> write external planned journal
       -> repeat salvage + source recovery
       -> compose down [--volumes]
       -> no-follow source removal
       -> write external terminal journal
```

The portal is the policy decision point; the sibling is a narrow policy enforcement point. The sibling receives no database credentials and cannot broaden scope. It mounts only the Docker socket, the named install root, the external evidence root, and the transition secret. A detached container is required because `docker compose down` terminates the portal and job engine that launched it.

### 5.1 Envelope

The canonical JSON envelope is schema version 1 and includes:

`kind`, `runId`, `issuedAt`, `expiresAt`, `scope`, `actorRef`, `installPath`, `backupsPath`, `composeProject`, `composeFiles`, `previewDigest`, `salvageDigest`, `recovery`, and `confirmation`.

`confirmation` records either `non-destructive` or an opaque, one-use UI challenge identifier plus hold duration. It never contains user-entered prose. HMAC-SHA256 uses the existing runtime-transition secret and stable key ordering.

### 5.2 External evidence

Evidence lives under `<DPF_BACKUPS_HOST_PATH>/teardown/<runId>/`:

- `plan.json` — the verified envelope and signature digest;
- `salvage.json` — repository risk report;
- `source.bundle` plus dirty/untracked manifests when source is selected;
- `evidence.json` — append-safe stage state and terminal outcome;
- `runner.log` — bounded operational diagnostics.

On a later install, `/ops/teardown` reads these files through `/backups` and shows prior terminal evidence even though the former database no longer exists.

## 6. Interaction design

The page is a calm “Installation lifecycle” surface, not a red wall. Four scope cards explain what stops, what is retained, and whether the portal can be resumed. Selection updates a consequence map with three explicit asset rows: runtime, data volumes, source. External recovery and evidence always show as retained.

Before destructive confirmation, the page shows three readiness gates:

1. **Source salvage** — clean, protected, or blocked with branch/dirty/stash counts.
2. **Recovery point** — created and trial-restored, pending, or failed.
3. **In-flight work** — clear or named blocking surfaces.

The final control is a press-and-hold button with visible progress, keyboard-accessible hold behavior, reduced-motion support, and an immediately adjacent “Release to cancel” instruction. Releasing early cancels locally without invoking the server. The final copy states the selected nouns (“delete PostgreSQL volume and source”) rather than the generic “Are you sure?”. After dispatch, the page shows the external evidence path and explains that the portal will disconnect by design.

## 7. State machine and failure policy

`previewed -> recovery-created -> recovery-verified -> quiescing -> dispatched -> planned -> salvaging -> stopping -> deleting-volumes -> deleting-source -> completed`

Any pre-dispatch failure returns to an operable portal and records no mutation. Any sibling failure writes `failed`, stage, machine code, and completed receipts. Retry with the same `runId` is idempotent: completed stages are recognized from signed/hashed evidence, and a completed run refuses replay. A stale or altered plan fails closed.

## 8. Verification

- Unit tests: stable canonical signing, expiry/scope/path validation, exact-backup trial selection, salvage digest, scope-to-stage mapping, and confirmation challenge semantics.
- Functional runner tests: fake Docker/Git binaries prove ordering, project scoping, no mutation before journal, failed recovery refusal, changed salvage refusal, and replay behavior.
- Filesystem tests: symlink/junction-like entries are unlinked without touching their targets; broad/root/evidence-nested targets refuse.
- UI tests: all four scopes and retention map, `manage_platform` gate, destructive hold, release-to-cancel, reduced-motion/keyboard semantics, failure states, and no typed-confirmation input.
- Architecture guard: no MCP teardown definition; runner assets are baked into both portal JIT context and promoter image.
- Docker: locally build both the portal runner and promoter images after Dockerfile changes.

## 9. Rollback

Before dispatch, cancellation is a no-op. After container-only teardown, reinstall/start resumes existing data. After volume deletion, restore uses the verified external dump. After source deletion, reinstall fetches upstream and the source bundle/dirty archive restores local work if needed. The teardown runner itself never performs an implicit rollback: it preserves evidence and recovery artifacts, reports the precise completed boundary, and lets the ordinary installer/restore workflows recover from that known point.
