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
No layout or header change is part of this delivery.

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
path supplied by the backup. Detect destination aliases and verify existing
parent directories and target paths without following links. Stage on the
receiver's filesystem and publish only checked complete files. Do not erase
unrelated files as an incidental effect of archive restore.

Under the existing restore lock, take both safety members from the current
install before database replacement. Keep the selected and safety run
identity in memory across Postgres replacement, then restore uploads after
Postgres succeeds. If file publication fails, the combined result is failed
and retains completed-step and safety evidence. It does not advertise a
successful or atomic rollback across two storage types.

### Trial

Use the same verifier without writing uploads. After the exact Postgres dump
is restored into the temporary database, compare its DocumentBlob and
MediaAsset references and expected hashes with the verified upload members.
Any deletion exception must match a row's table, ID and storage key in that
dump. Qualify manifest evidence for these exceptions; retain its digest in new
recovery receipts. Report unreferenced entries in the SQL-backed document and
media namespaces without misclassifying unrelated attachment or voice files.
Use the current trial audit and failure surface. A failed Postgres trial
cannot be represented as a passing pair.

### Recovery and readiness

Add a versioned, explicit uploads member to new self-upgrade recovery points
and pre-teardown receipts. New receipts are incomplete unless they carry both
successful member identities and digests. Read historical Postgres-only
receipts as legacy rather than treating a missing uploads member in a new
receipt as acceptable. Rollback and successor recovery share the order
Postgres, then uploads. Retain teardown member locators and custody evidence
with the existing external journal so a succeeding installation can validate
and locate them without the former database. Do not weaken the signed plan,
current destructive confirmation or host project restrictions.

Extend existing readiness summaries and /admin/backups to show uploads and
their last run. Create or update the already-defined daily heartbeat row in
the normal seed path, preserving the runner's history. Package the managed
upload scripts with the portal's existing explicit source list.

## Scope boundaries

No new archive format, second backup repository, host/launcher adoption,
PostgreSQL major upgrade, Inngest member, or WAL retention policy. Those
database-lifecycle duties follow under BI-921B2D17. No live destructive or
restore test. Fixtures use generated data, disposable pgvector/pgvector:pg16
containers and temporary roots.
