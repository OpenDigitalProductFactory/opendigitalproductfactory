---
status: active
---

# Preserve local-CI evidence when a captured observation contains NUL

Backlog: BI-37D6E04E. Workroom: WC-2737CD3E. Shape: delivery-small.
Extends the lossless payload relocation contract in
`2026-09-08-data-lifecycle-stewardship-convergence-design.md`, slice 2
(BI-39AAE9B8). This is an ordered fix design, not a new evidence subsystem.

## Evidence and cause

F646 gate 6f264 reached FAILED but publication threw PostgreSQL 22P05 at
ExternalEvidenceRecord creation. The archived pending packet SHA256 is
`27400e27d2ce86108aa03cecbcb8c15a0db95e39325b8c2063e357c80ed7fe7c`.
Exactly one NUL occurs in `recordArgs.evidence.content.execution.vitest.observations[12].outputTail`.
The actual tail is 66,382 UTF-8 bytes, SHA256
`4d5ca396926d0fd9dc4af30429955d617112c5eb64f59f8d4815273891dd1ac8`.
The existing offloader relocates oversized strings but retains NUL in its
inline excerpt; shorter NUL tails are left inline unchanged. PostgreSQL JSONB
cannot represent a NUL even when JSON serialization escapes it.

The client checkpoint binds the original content digest. Client edits would
invalidate publication. The server fingerprints the original request before
offloading it; preserve that boundary and the existing replay comparison.
Related intake suggestions BI-F5344F65, BI-FFCFCCE0 and BI-AE87D2BE cover
stub refusal, terminal-state preservation/slot selection, and reset-failure
classification respectively; none repairs this persistence defect.

## Requirements and acceptance

- AC-NUL: the captured short NUL tail reproduces a rejected JSONB write before
  the fix; the stored presentation contains no NUL after the fix.
- AC-RAW: keep the original tail bytes in the existing content-addressed blob
  store, with digest, byte length, storage reference and a named projection
  encoding. Preserve the original packet, source/lease/gate/log hashes.
- AC-REPLAY: fingerprint the original request, keep FAILED, bind one receipt,
  and accept identical original replay; changed requests remain conflicts.
- AC-SCOPE: project only captured vitest observation `outputTail` fields at
  the known local-CI path. Leave arbitrary signed/bound content and ordinary
  tails unchanged. Reject provenance-key collisions before writing blobs.
- AC-FAILURE: a blob write failure prevents receipt creation and lease binding;
  never lose raw bytes and claim successful persistence.

## Architecture and compatibility

Add a narrowly named projection beside the existing evidence output helpers.
Call it after the original request fingerprint and before the existing
offloader. Affected tails remain strings for existing readers: represent NUL
as visible `\\0`, retaining a bounded excerpt through the existing excerpt
helper. A sibling `outputTailProjection` records encoding `nul-visible-v1`,
NUL count and the original blob reference. Refuse an existing sibling instead
of overwriting evidence. A second projection is a no-op because its displayed
string contains no NUL. Existing offload behavior is otherwise unchanged.

The transaction, owner/lease checks, immutable gate key, verdict, full-log
digest, original input fingerprint and replay comparison remain canonical.
No schema migration, new tool/table, client packet rewrite, runtime asset
change, live restart, model call or new gate is in scope.

## Ordered implementation and verification

1. Resolve related tests; write a regression using the captured failing tail
   shape and a persistence double that enforces JSONB's NUL restriction.
2. Reuse the existing blob writer/excerpt implementation for the scoped
   projection; wire it after identity capture. Test raw byte/digest retention,
   visible output, ordinary-content identity, provenance collisions and blob
   failure. Test original failed-request replay and changed-input refusal.
3. Run affected evidence/nonprod tests and package typecheck as source-local
   evidence, plus named module/style/frontmatter/derived-document guards.
   Send frozen source and exact results to Root for independent review.
4. Publish through normal source gates or the already authorized documented
   recovery route, without claiming unrun local integration passed. Runtime
   acceptance remains pending until a containing canonical release is deployed.
5. The original gate owner then uses supported `--finalize-evidence` once with
   the unchanged packet. Successful FAILED publication still exits 1; require
   evidencePending=false, an actual receipt and the unchanged FAILED verdict.

## Traceability and source-local results

One atomic deliverable maps BI-37D6E04E to AC-NUL, AC-RAW, AC-REPLAY,
AC-SCOPE and AC-FAILURE. Flow F-NUL is `recordLocalIntegrationResult` ->
`projectLocalCiObservationTails` -> `offloadEvidenceOutput` -> existing recorder.
Contract C-NUL preserves the original input fingerprint, immutable gate key,
blob bytes and canonical lease replay. Verification V-NUL is
`bounded-evidence-output.test.ts` plus `local-integration.test.ts`, the recorder
MCP contract tests and original-owner supported finalization after deployment.
Projection without recorder wiring cannot repair publication, and wiring
without lossless projection would discard evidence.

Before implementation, both added persistence regressions failed with the
expected 22P05 at the JSONB-compatible storage double (19 existing tests passed).
After implementation, 79 tests in three source-local files passed. The entire
archived packet passed through the real projection and offloader with an
in-memory blob writer: zero remaining NULs in stored evidence, original packet
unchanged, original 66,382-byte tail and digest retained, verdict still failed.
This does not prove live PostgreSQL acceptance. Package typecheck and named
style, frontmatter, module-size and document-index checks passed. Shared local
integration, native semantic review and runtime acceptance remain unrun.
