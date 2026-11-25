---
status: draft
---

# Governed upload-store restore

**Backlog item:** BI-03093FDD

This extends the [managed restore substrate](../specs/2026-07-09-managed-backup-restore-substrate-design.md).
The source run-directory format belongs to BI-1C6BF6B6 and BI-B7F4D608.
The acceptance criteria below are the scope of this delivery.

## Acceptance

- AC-1: Restore writes the files back and verifies every hash; a tampered or reordered archive is refused before any write.
- AC-2: Trial restore fails on a missing or mismatched referenced blob and reports orphans.
- AC-3: A self-upgrade rollback and a teardown recovery restore the paired uploads member.
- AC-4: The admin backups page and readiness show the uploads member and its last run.

## Contracts and order

CT-RUN: Preserve the manifest keys, file list, archive format, size limits and
deterministic ustar header bytes. Bind the uploads archive to its trusted
BackupRun receipt and the exact Postgres run ID and dump digest. The archive
reader does not trust text paths recorded in the source manifest.

CT-RECEIVER: Resolve the destination roots using the receiving install's
upload and voice configuration before Postgres restore can replace its settings.
Refuse links, unsafe or colliding paths, unknown roots, and non-regular
members. Verify every source member and the terminal framing before writing
any destination files. Use a controlled destination staging area on the same
filesystem so unverified payloads do not become visible.

CT-POINT: New recovery receipts are complete only with both members verified.
Preserve the distinction between explicitly legacy Postgres-only receipts and
incomplete new paired receipts. Do not make teardown more permissive or
silently fall back to a Postgres-only recovery.

1. FLOW-RESTORE. Implement a strict streaming reader in the upload scripts.
   Keep the reader and writer in the portal image with the existing managed
   script packaging. Reuse the managed restore engine, capability check and
   typed confirmation. Preflight the pair, take a safety pair, and hold the
   restore lock across both members. Preserve the required source and safety
   audit rows across Postgres replacement. Apply Postgres before uploads.
2. FLOW-TRIAL. Use the same read-only verifier after restoring the exact dump
   into the existing temporary Postgres trial database and before that
   database is dropped. Compare DocumentBlob and MediaAsset IDs, storage keys
   and hashes to verified archive data. Scope deletion exceptions to the exact
   table, row ID and path. Report unreferenced document and media blobs without
   classifying attachments or voice audio as SQL-owned blobs. Publish failure
   through existing trial audit and notification paths. Trial never writes to
   an upload root.
3. FLOW-RECOVERY. Extend the self-upgrade recovery receipt and restore order
   with the exact uploads member. Build the pre-teardown uploads backup from
   the exact teardown Postgres run, trial the pair, and preserve both locators
   and digests outside the deleted scope. The portal and host guards enforce
   the same receipt. Document how the successor recovers both from those
   retained receipts without depending on the old database audit tables.
4. FLOW-READINESS. Extend existing readiness and the admin backups surface
   with the uploads member, its paired restore state and last run. Seed the
   existing uploads-daily-backup heartbeat ID idempotently. Update the admin
   and disaster recovery guides with the paired restore order and what a
   second-member failure means.

## Verification

- VERIFY-ARCHIVE: Fail first on tampered, reordered, linked and mismatched
  archives. Confirm refusal writes no destination files. Confirm a writer-made
  fixture restores to the receiving roots and each digest matches.
- VERIFY-TRIAL: Exercise both blob tables, a matched deletion exception, an
  orphan, a missing file, a mismatched hash and a link. Exercise the existing
  daily runner and restore audit tests. Use disposable pgvector/pgvector:pg16
  containers, generated data and temporary roots for all restore verification.
- VERIFY-RECOVERY: Exercise exact receipt pairing, source preflight,
  Postgres-first ordering, a blocked incomplete receipt, second-member failure,
  historic receipt behavior and successor recovery from retained teardown
  artifacts. Run the graph-linked managed restore, rollback, recovery,
  teardown, queue and action suites.
- VERIFY-READINESS: Exercise the ScheduledJob seed and readiness projection,
  verify the served admin surface in governed nonproduction and record UX
  evidence. Run package typechecks and the shared gate before publication.

## Risk and rollback

This path can change the database and files. A checksum or member failure
must stop before destination writes. A later I/O failure must leave the
safety pair, source identity and a failure receipt for governed recovery.
No cross-filesystem atomicity is promised. Confirm manifest custody for
deletion exceptions, receiving-path overwrite behavior and release-image
script presence in review. No operator action is tested on a live database,
upload store, or teardown target.

## Backlog coverage

- Parent: BI-03093FDD
- Decision: atomic
- Receipt: blocked-by: the repository provider must serve this immutable plan commit before the coverage writer can bind it
- Rationale: The verifier, paired restore and recovery, operator projection and scheduled verification must agree on one exact receipt and are sequencing steps for the same operator outcome.
- Dependencies: BI-B7F4D608 supplies the exact writer bounds and filename refusal without changing the run format.
- Deliverable: Governed upload-store restore and paired recovery, mapped to BI-03093FDD.
- Traceability: AC-1, AC-2, AC-3, AC-4; CT-RUN, CT-RECEIVER, CT-POINT; FLOW-RESTORE, FLOW-TRIAL, FLOW-RECOVERY, FLOW-READINESS; VERIFY-ARCHIVE, VERIFY-TRIAL, VERIFY-RECOVERY, VERIFY-READINESS.
