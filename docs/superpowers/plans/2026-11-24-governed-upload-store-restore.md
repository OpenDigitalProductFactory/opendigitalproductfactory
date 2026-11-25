---
status: draft
---

# Governed upload-store restore

**Backlog item:** BI-03093FDD

This extends the [managed restore substrate](../specs/2026-07-09-managed-backup-restore-substrate-design.md).
The source run-directory format belongs to BI-1C6BF6B6 and BI-B7F4D608.
The acceptance criteria below are the scope of this delivery.

## Scope mapping

- OBJ-RESTORE maps to AC-1 and FLOW-RESTORE. VERIFY-ARCHIVE checks refusal before destination writes and the digest of each restored file.
- OBJ-TRIAL maps to AC-2 and FLOW-TRIAL. VERIFY-TRIAL checks missing or mismatched SQL references and unreferenced files.
- OBJ-RECOVERY maps to AC-3 and FLOW-RECOVERY. VERIFY-RECOVERY checks ordered application and recovery from retained evidence.
- OBJ-READINESS maps to AC-4 and FLOW-READINESS. VERIFY-READINESS checks the heartbeat, last-run data, and operator surface.

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

CT-JOURNAL: Before database replacement, sync and read back the selected and
safety pair, digests and receiver identities from the host backup journal.
Keep it outside both the replaced database and the upload roots. The journal
stays authoritative after a process crash and records completed steps.

CT-ROLLOUT: Ship the shared receipt readers and the existing DPF host guard
before the portal emits the new paired format. Verify the exact pinned
guard's capability without mutating a host. Refuse a new destructive
teardown if the capability or exact paired proof is missing. Previously
written points still restore as visibly Postgres-only.

1. FLOW-RESTORE. Implement a strict streaming reader in the upload scripts.
   Keep the reader and writer in the portal image with the existing managed
   script packaging. Reuse the managed restore engine, capability check and
   typed confirmation. Preflight the pair, take a safety pair, and hold the
   restore lock across both members. Persist the recovery journal on the host
   backup store before replacing Postgres. Apply Postgres before uploads.
   Under the existing confirmation, leave matching files intact and replace
   different files only when the verified safety pair covers them. Never
   change an unlisted file. Revalidate source, destination and collision
   evidence after preview, and before database replacement.
2. FLOW-TRIAL. Use the same read-only verifier after restoring the exact dump
   into the existing temporary Postgres trial database and before that
   database is dropped. Compare DocumentBlob and MediaAsset IDs, storage keys
   and hashes to verified archive data. Scope writer-authored deletion exceptions
   to the exact table, row ID and path. Verify their manifest digest against the
   successful capture's external custody record before honoring them.
   Report unreferenced document and media blobs without
   classifying attachments or voice audio as SQL-owned blobs. Publish failure
   through existing trial audit and notification paths. Trial never writes to
   an upload root.
3. FLOW-RECOVERY. Extend the self-upgrade recovery receipt and restore order
   with the exact uploads member. Build the pre-teardown uploads backup from
   the exact teardown Postgres run, trial the pair, and preserve both locators
   and digests outside the deleted scope. Publish readers first. The portal
   gates new destructive teardown on the exact DPF lifecycle runner's paired
   guard, and `scripts/governed-teardown.mjs` enforces both members before
   mutation. No DPF2 launcher change. Document how the successor recovers
   both from those receipts without depending on the old database audit tables.
4. FLOW-READINESS. Extend existing readiness and the admin backups surface
   with the uploads member, its paired restore state and last run. Seed the
   existing uploads-daily-backup heartbeat ID idempotently. Update the admin
   and disaster recovery guides with the paired restore order and what a
   second-member failure means.

## Verification

- VERIFY-ARCHIVE: Fail first on tampered, reordered, linked and mismatched
  archives. Confirm refusal writes no destination files. Confirm a writer-made
  fixture restores to the receiving roots and each digest matches. Cover
  identical, different but safety-backed, unlisted, unsafe and newly added
  destination files. Refuse changed source and changed receiver identity
  between preview and confirmation before Postgres is replaced.
- VERIFY-TRIAL: Exercise both blob tables, a matched deletion exception, an
  orphan, a missing file, a mismatched hash and a link. Reject a missing or
  mismatched manifest custody digest and an exception for a different row or
  file. Exercise the existing
  daily runner and restore audit tests. Use disposable pgvector/pgvector:pg16
  containers, generated data and temporary roots for all restore verification.
- VERIFY-RECOVERY: Exercise exact receipt pairing, source preflight,
  Postgres-first ordering, a blocked incomplete receipt, and explicit
  legacy restore. Kill a fixture process between Postgres and uploads
  and during file publication. A restarted controller must read the original
  safety pair from host storage with the old database unavailable. Test
  idempotent resume and safety restore, including safe removal of files
  created by the failed operation. Execute host and portal contract tests
  for missing/wrong-version guard capability and mismatched member or trial
  identity. A fake Docker actuator proves no host mutation follows a
  refused receipt. Run managed restore, rollback, recovery-point,
  teardown, queue and backup action suites.
- VERIFY-READINESS: Exercise the ScheduledJob seed and readiness projection,
  verify the served admin surface in governed nonproduction and record UX
  evidence. Run package typechecks and the shared gate before publication.

## Risk and rollback

This is a proposed design, not evidence that runtime loss modes were
eliminated. The backup lane is accountable for proving these controls in a
disposable environment before implementation publication.

| Failure | Prevention and containment | Detection and recovery |
| --- | --- | --- |
| Postgres succeeds but the process crashes or uploads partially publish | Create and read back the durable safety journal first. Drain writers, stage complete files, and leave the receiver fenced on incomplete publication. | On restart reconcile journal stage signals and per-file digests. With operator confirmation, resume the exact pair or restore the safety pair, cleaning up only verified newly published files. |
| Wrong pair, receiver root drift, an alias, or a conflicting destination | Bind exact run and root identities and revalidate at confirmation. Check the receiver without following links. Require verified safety custody for overwrite. | Refuse before Postgres or upload changes. Refresh preview or resolve receiving configuration explicitly. |
| A deleted-after-snapshot exception weakens trial | Anchor the exact manifest digest at capture and match every exception to its table, ID, and path. | Fail on an unmatched, conflicting, or unproven exception. Repair or retake the pair. Do not override the trial. |
| New teardown reaches an old host guard | Stage the DPF host reader first and gate new destructive teardown on its exact version and paired evidence. The host refuses incomplete fresh receipts. | Refusal precedes host operations. Install and verify the supported DPF guard, or leave the running install unchanged. |

No runtime or destructive test targets a live database, upload store, or
teardown target. Documentation gates verify this plan, not runtime safety.

## Backlog coverage

- Parent: BI-03093FDD
- Decision: atomic
- Receipt: blocked-by: the repository provider must serve this immutable plan commit before the coverage writer can bind it
- Rationale: The verifier, paired restore and recovery, operator projection and scheduled verification must agree on one exact receipt and are sequencing steps for the same operator outcome.
- Dependencies: BI-1C6BF6B6 defines the writer run format. BI-B7F4D608 supplies the exact bounds and filename refusal without changing it.
- Deliverable: Governed upload-store restore and paired recovery, mapped to BI-03093FDD.
- Traceability: OBJ-RESTORE, OBJ-TRIAL, OBJ-RECOVERY, OBJ-READINESS; CT-RUN, CT-RECEIVER, CT-POINT, CT-JOURNAL, CT-ROLLOUT; FLOW-RESTORE, FLOW-TRIAL, FLOW-RECOVERY, FLOW-READINESS; AC-1, AC-2, AC-3, AC-4.
