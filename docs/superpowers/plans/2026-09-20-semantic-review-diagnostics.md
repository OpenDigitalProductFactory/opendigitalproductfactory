---
status: active
---

# Semantic review response recovery

BI-06AE6833; WC-0FE180F2. Extends the September 6 execution reliability plan and
its existing architecture decision DI-515AD614CCF6.

Two September 13 native reviews reached external providers but returned
`unparseable-review-response`. The parser discarded both the failure stage and
schema diagnostics. The raw response was not retained, so its exact defect is
unknown; this change must not claim to repair that unknown defect.

1. Reproduce lost diagnostics with missing JSON, malformed JSON, invalid schema,
   and mixed successful/invalid independent branches. Assert no response text or
   arbitrary property names escape through diagnostics.
2. Consolidate failure construction and preserve bounded, content-free stage and
   schema field/code information in the existing result and branch checkpoints.
   Preserve strict validation and inconclusive outcomes. No new retry loop.
3. Run affected review suites, typechecks and guards; publish through the normal
   protected PR path. Verify the next bounded live review via its persisted result.
4. Record release and functional evidence separately from source verification.
   A parsed result is not automatically approval or completion of the parent item.

Refactoring is confined to shared failure construction and branch aggregation;
no new process, table, provider policy, or approval is introduced. Existing
authorization covers this repair. The connected portal remains separately owned.

## Readback and operations

`unparseable-review-response` remains an inconclusive outcome. Its result now
includes `parseDiagnostics`: the failed branch's `agentId`, a `stage` of
`missing-json`, `invalid-json`, or `schema-mismatch`, and at most eight schema
field/code violations per branch. No raw response, validation message, or
provider-supplied arbitrary key is retained. Inspect these fields through the
persisted task result before proposing another fix or dispatching another review.
Completed checkpoints preserve this information across worker restart without
another provider call. Historical receipts cannot reconstruct discarded data.
