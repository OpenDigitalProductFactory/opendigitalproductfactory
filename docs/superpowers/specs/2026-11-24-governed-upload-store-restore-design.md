---
status: draft
---

# Governed upload-store restore and paired recovery

**Backlog item:** BI-03093FDD

The governed Postgres backup captures references to uploaded files, but
restoring the dump by itself cannot restore those bytes. The paired upload
archive already has a run-directory contract. This design adds its consumer
to the existing governed restore, trial and recovery surfaces.

## Objectives

**OBJ-RESTORE:** Restore the exact validated Postgres and upload pair without
writing unverified files or using source-install paths on the receiver.

**OBJ-TRIAL:** Prove that the exact Postgres snapshot and archived uploads
are recoverable together, including visibility into missing references and
orphaned files.

**OBJ-RECOVERY:** Carry the pair through self-upgrade and teardown, retaining
the evidence needed to recover it when the originating database is gone.

**OBJ-READINESS:** Show the operator whether the upload member is backing up
and when it last ran.

## Acceptance

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-RESTORE | Restore writes the files back and verifies every hash; a tampered or reordered archive is refused before any write. |
| AC-2 | OBJ-TRIAL | Trial restore fails on a missing or mismatched referenced blob and reports orphans. |
| AC-3 | OBJ-RECOVERY | A self-upgrade rollback and a teardown recovery restore the paired uploads member. |
| AC-4 | OBJ-READINESS | The admin backups page and readiness show the uploads member and its last run. |

## Research & benchmarking

| Reference | Decision |
| --- | --- |
| [GNU tar formats](https://www.gnu.org/software/tar/manual/html_node/Formats.html) | Retain the existing POSIX ustar subset and deterministic header encoding. Reject general-purpose tar extraction at the release boundary because the contract deliberately excludes links, special files, extensions, and independent member ordering. |
| [restic snapshot model](https://restic.readthedocs.io/en/stable/040_backup.html) | Adopt an explicit, independently identifiable recovery selection. Do not introduce a second backup repository or substitute timestamps for exact run IDs and digests. |
| [Borg backup](https://www.borgbackup.org/) | Adopt verification before exposing restored data. Keep the existing portable run directory instead of making DPF and DPF2 depend on Borg's chunk store. |

The DPF2 intake at commit `3ed6fb23b8811f21bbf15123a727b94f56e9922c`
reads and verifies each listed member in order, exactly two zero end blocks,
the released manifest and archive digests, and the paired dump digest.
The writer contract in BI-B7F4D608 already enforces the reader's size bounds.
The writer change and its synthetic reader verification are in
[DPF PR #7195](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/7195).
Before implementation, compare the actual reader and writer source for
the framing and bound assertions. No layout or header change is part of
this delivery.

## Design

### Governed restore

Extend the existing `RestoreEngineSpec` and `runManagedRestore` path under
the existing backup administration capability and typed confirmation. Link
the source only by its recorded backup IDs and digests. A preview names
both members, their availability, and the consequence of restoring them.
Confirm revalidates the source and receiver because preview does not reserve
storage or preserve mutable settings.

Validate the entire source pair before any restore writes. The strict reader
bounds every artifact, binds the uploads manifest to the selected Postgres
ID and digest, verifies the governed archive digest, checks the list digest
and canonical member ordering, and verifies each header, padding, payload
hash and the final two empty blocks. Keep input files ordinary and protect
against replacement between passes by validating the copied content against
the checked digests before it is published. This is fail closed for invalid
UTF-8, links, unknown or overlapping roots and unsafe paths.

Snapshot the receiver's upload-root configuration before replacing its
database. Resolve member names under those roots, never under an absolute
path supplied by the backup. Confirm refuses an identity change since preview,
an unknown root, a destination alias, and a link or non-regular target.
An existing file with the expected digest is a no-op. An existing ordinary file
with a different digest can be replaced only if it is in the exact collision
set the operator reviewed and the verified safety pair contains its original
bytes. Confirmation rechecks the collision-set digest. Otherwise refuse before
replacing Postgres. Unlisted files are untouched.
Stage verified complete files on each destination filesystem and publish with
per-file rename while upload writers are drained.

Under the existing restore lock, take both safety members from the current
install before database replacement. Write an atomic, fsynced recovery journal
at `<backupsRoot>/restore/<operationId>/recovery.json`, on the host backup
storage alongside the run directories. The journal records operation and
install identity, the selected and safety pair locators and digests, resolved
receiver root identities, overwrite scope and completed steps. Write and
read back that journal before Postgres replacement. Both the journal and its
artifacts stay readable after a crash or a partially replaced database. Audit
rows in the restored database are a projection, not the recovery authority.

The journal records stage entry before each effect and completion after
verification. Persist file publication intents before rename, and pin the
referenced runs against retention until recovery is complete. If Postgres
completes but uploads are incomplete, the receiver stays closed to writers.
The runtime checks unfinished journals before reopening writers after a restart.
An unfinished operation cannot report success. The operator can resume
the exact selected pair after revalidation, or choose the journal's safety
pair through the existing restore confirmation to return to the prior state.
Replaying a file already at the verified digest is a no-op. When undoing partial
publication, remove only files the journal identifies as newly created by
this operation and whose bytes still match the published digest. A differing
or unknown file needs explicit resolution before reopening writers. There is
no automatic safety restore or cross-store atomicity.

### Trial

Use the same verifier without writing uploads. After the exact Postgres dump
is restored into the temporary database, compare its DocumentBlob and
MediaAsset references and expected hashes with the verified upload members.
The existing backup writer alone records `deletedAfterSnapshot` after
the paired dump refers to a file that is absent and the exact live row no
longer exists. These records remain in the unchanged manifest. The governed
backup engine anchors the emitted manifest digest in an atomic, host-side
custody record under `<backupsRoot>/uploads-custody/<runId>.json` before
marking capture successful. This record is outside the DPF2 run directories.
Pair receipts bind that digest alongside the
archive and Postgres dump digests. A deletion exception is accepted only with
that custody proof and an exact table, ID and storage-key match in the trial
database. Missing proof or a conflicting, duplicate, or unmatched exception
fails the upload trial. Report unreferenced entries in the SQL-backed document and
media namespaces without misclassifying unrelated attachment or voice files.
Use the current trial audit and failure surface. A failed Postgres trial
cannot be represented as a passing pair.

### Recovery and readiness

Extend the existing recovery point and teardown receipt with one shared
versioned paired-recovery contract. Put member identity and state validation
in `packages/integration-shared`, following its shared script-and-TypeScript
contract pattern. Consumers distinguish `legacy-postgres`, `paired`, and
`incomplete`. A point written before uploads membership is recoverable as
Postgres-only, with that limitation shown in the preview and result. A new
paired-format point is incomplete, not legacy, if either member or digest
is missing. Rollback and successor recovery share the order
Postgres, then uploads. Retain teardown member locators and custody evidence
with the existing external journal so a succeeding installation can validate
and locate them without the former database. Do not weaken the signed plan,
current destructive confirmation or host project restrictions.

Ship additive readers before emitting the new version of a paired receipt.
Keep the existing DPF host enforcement point, `scripts/governed-teardown.mjs`,
owned by the DPF install-lifecycle lane. Its paired plan validation must be
present in the exact pinned host runner and confirmed by a non-mutating
capability check before the portal enables a new volume-deleting teardown.
The host validates both exact member receipts and the paired trial result
before any Compose or filesystem change. Old runners fail closed on the
unknown envelope version, never reinterpret it as Postgres-only. New readers
keep historical Postgres-only recovery support independently of new teardown
execution admission. This updates DPF's existing guard, not the DPF2 launcher.

Extend existing readiness summaries and /admin/backups to show uploads and
their last run. Create or update the already-defined daily heartbeat row in
the normal seed path, preserving the runner's history. Package the managed
upload scripts with the portal's existing explicit source list.

## Scope boundaries

No new archive format, second backup repository, DPF2 host or launcher change,
PostgreSQL major upgrade, Inngest member, or WAL retention policy. Those
database-lifecycle duties follow under BI-921B2D17. No live destructive or
restore test. Fixtures use generated data, disposable pgvector/pgvector:pg16
containers and temporary roots.
