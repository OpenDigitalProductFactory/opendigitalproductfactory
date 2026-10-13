---
title: Promoter fixture dispatch is independent of paths
status: active
backlog_item: BI-46FAF3C7
---

# Promoter fixture dispatch is independent of paths

Backlog: BI-46FAF3C7. Workroom: WC-982D8921.
This ordered fix design is one atomic test-harness correction.

## Evidence and boundary

On commit `8120390675872b4425e11568e6663d6df707b7d6`, importing the actual
`makeFakeBin` helper and copying valid assets to destinations ending `IdXXXX`
or `OsXXXX` returned zero without copying either asset or checksum. The ordinary
`XyXXXX` destination copied both. Inspection patterns matched the whole command,
including paths, before the copy handler. The same helper remains on base
`821586a7df90fa8b16b277f843a064e4d4ddf2fa`.

PR #6239's original CI destination was not retained. Its isolated case passed,
and one failed-job-only CI retry passed unchanged. The collision mechanism is
proven, but its association with that historical run is inferred.
Mirrored BI-683619D9 is reference evidence only; this DEV repair neither mutates
its originating installation nor claims its separate missing-recreate symptom
is solved. Duplicate intake BI-4264B37A points to this existing owner.

## Design grounding

Extend the existing `makeFakeBin` in
`apps/web/lib/self-upgrade/promote-script-functional.test-support.ts`.
Keep the real `scripts/promote.sh` and its checksum verification unchanged.
The source-local shim uses Bash, temporary filesystem fixtures and fake HTTP;
it never calls real Docker or a live database. There is no new authority,
runtime, persistence model, lease, package or user-facing UI.

CT-DISPATCH: parse the Docker operation and inspection format from argv, not
unrelated path text. Handle create/cp/rm before any legacy composite matching.
Recognize release image-inspection fields only on genuine inspect operations
and only from their format argument. Preserve existing sandbox special cases.
CT-COPY: preserve argument boundaries and propagate mkdir/copy failures.

## Acceptance

- AC-1: All copy destinations preserve the checksum file, including `.Id`,
  `.Os`, `.Architecture`, ordinary names and paths containing spaces.
- AC-2: Genuine image inspect fixtures retain their expected responses;
  unrelated argument text cannot select an inspect-format handler.
- AC-3: The existing release functional matrix and shared-harness consumers
  pass; production authorization and checksum verification are unchanged.

## Ordered implementation and verification

1. FLOW-RED / VC-DISPATCH: add direct tests invoking the actual generated shim
   with deterministic colliding destinations, genuine inspect commands whose
   target contains a different field name, and failing copies. Observe failures
   before changing the helper. No stress-run lottery or timeout inflation.
2. FLOW-FIX / VC-COPY: implement exact-operation dispatch and format extraction,
   then make the same tests pass. Test create/rm dispatch and copy error status.
3. FLOW-VERIFY / VC-MATRIX: run the functional, cleanup, service-reconcile and
   safe-directory suites found by the bounded import sweep, plus the new direct
   shim suite. Run affected typechecks and source guards. Windows results are
   local evidence; Linux results belong to protected CI, not an inferred pass.
4. Publish a separate DCO-signed PR after independent source review. Preserve
   unrun integration/native review as unrun under the existing scoped DEV
   recovery authorization; protected GitHub checks remain mandatory.

The impact contract requires the style-drift guard and generated doc index.
No operator guide changes are needed: runtime and contributor commands do not
change. This document explains the fixture contract for maintainers.

## Risk and rollback

Inspection matching could break an existing fixture response; direct response
tests and all four existing consumers cover that risk. Keep unrelated compose
and migration fake behavior unchanged. Roll back through a signed revert of
this atomic change; no data migration or deployment rollback is needed.

## Backlog coverage

One atomic deliverable maps to BI-46FAF3C7. Test, helper correction and this
design are internal sequencing, not independently shippable changes.
References: AC-1, AC-2, AC-3; CT-DISPATCH, CT-COPY; FLOW-RED, FLOW-FIX,
FLOW-VERIFY; VC-DISPATCH, VC-COPY, VC-MATRIX. Live coverage is recorded against
the immutable artifact before implementation; this text is not a receipt.
Native coverage `cmv5xhux20ovn01mr7habw65v` binds the ordered design at
`df7807b1811dc4ba6ac3184d028a0cba6f76ffbb`; research receipt
`initiative-df0acf81-13e0-4fae-b474-b92f071bd1f6` records the reproduction.
