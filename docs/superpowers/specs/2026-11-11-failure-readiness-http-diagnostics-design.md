# Failure Readiness HTTP denial diagnostics

Backlog: BI-9ED0B273. Workroom: WC-7B5194D4.

## Problem and evidence

PR6966, source `8fb8e4477dffb8d5fdc84752f664e7ebc4004951`, failed in
workflow43116489750/job130845695605 at2026-11-11T23:01:25Z while reading
GitHub evidence: HTTP403 before verdict validation. The publisher is configured
and the reader already uses the creator-bearing LIST endpoint. The response
message and headers were discarded, so permission, resource and rate-limit
causes cannot be distinguished. None is established as the cause.

Reproduction on `4f4271eb934acedc0741f7769f721ce7203ccc87` uses the real
`checkFailureReadiness` request helper with an injected403 Response containing
`Resource not accessible by integration` and a request ID. One request fails
closed but retains neither fact. Success and actual failed verdict controls
remain in the existing Node tests. This is a diagnostic defect, not a claim
that the underlying denial is repaired.

## Existing contract and boundaries

Extend [failure analysis and recovery](../../architecture/failure-analysis-and-recovery.md)
at the existing GitHub evidence-read boundary. Reuse
`scripts/lib/safe-log.mjs`; scripts execute as plain Node without new packages.
Related publisher continuation BI-2A8A8FC8, endpoint repair BI-0CB3B61A,
rate-load BI-A35B14B6, rerun BI-7C4E732C, CLI excerpt BI-EA13B5BA,
exception publication BI-92253B23 and pr-health BI-5B80D52F are distinct.
Targeted live overlap reads found no same diagnostic carrier; broad truncated
listings are not exhaustive absence proof.

The existing workflow identity, URL, token, request count and failure decision
remain authoritative. No grants, workflow permissions, publisher, status
freshness, retry policy, review requests or queue controls change. No database,
migration, UI, mailbox access, provider or customer-data flow is introduced.

## Objectives and acceptance

**OBJ-DIAG:** A failed GitHub read exposes safe observed facts for recovery.

**OBJ-SAFE:** Diagnostic capture cannot turn denial into approval or expose
credentials or unbounded response content.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-DENIAL | OBJ-DIAG | Permission-style403 retains its JSON message and GitHub request ID without classifying an unproven cause. |
| AC-RATE | OBJ-DIAG | Rate-style403 retains its message and allowlisted remaining/reset/Retry-After facts. |
| AC-REDACT | OBJ-SAFE | Exact request token and recognized credential forms are redacted before excerpting; control characters and extra body/header fields never reach logs. |
| AC-BOUND | OBJ-SAFE | Body capture, capture duration and diagnostic output are bounded; oversized, malformed, unreadable or absent bodies still fail closed. |
| AC-CONTROL | OBJ-SAFE | Existing success, publisher, freshness, LIST endpoint, merge-group and missing-configuration checks retain behavior; diagnostics issue no extra HTTP requests or retries. |

## Design and ordered implementation plan

1. Extend the existing Node request-helper tests with real injected HTTP
   Responses. Prove missing403 message/request/rate metadata RED; preserve
   actual success and denial controls.
2. At the existing non-OK response branch, capture at most8KiB of JSON body
   with a bounded wait. Parse only its string `message`; never dump the body,
   URLs, errors array or full headers. Cancel oversized/unreadable capture.
3. Redact the exact supplied token and recognizable credential values before
   truncating. Apply existing log sanitization. Limit the message to500
   characters and each allowlisted metadata value to120 characters. Include
   only request ID, remaining/reset and Retry-After. A capture failure retains
   the original status and `no approval inferred` refusal.
4. Run affected Node tests, source syntax/style/secret guards and gate-context
   obligations. Update the existing recovery contract with these diagnostics.
   Record source proof separately from any actual GitHub workflow result.
5. Use normal signed publication, required independent review/protected CI
   and queue. Keep PR6966 source frozen. Inspect the next actual workflow's
   diagnostic to choose the underlying403 remedy; do not infer recovery from
   mocks or replay an unchanged native review.

One atomic deliverable: implementation, redaction tests and documentation must
ship together. No phase provides an independent safe recovery contract.
Implementation parent BI-9ED0B273 owns this ordered fix scope; there is no
separate plan artifact. Public API and successful response behavior remain
compatible. Failure text gains bounded safe metadata. Rollback removes that
metadata and leaves the existing refusal intact.
