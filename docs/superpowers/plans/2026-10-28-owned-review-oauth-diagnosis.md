---
title: Exact owned-review OAuth diagnosis
date: 2026-10-28
backlog:
  - BI-CAP-29F5787B
---

# Exact owned-review OAuth diagnosis

Design: [owned review authority diagnostics](../specs/2026-10-26-owned-review-authority-diagnostics.md), October 28 amendment.

One atomic deliverable under BI-CAP-29F5787B: refine the existing shared OAuth
execution predicate and project safe fixed refusal details through existing
owner-admitted review reads. Predicate and projection are one behavior and one
revert; neither is separately shippable. Existing transport and executor
reconciliation work remain separately owned.

1. Reproduce ambiguous refusal with source tests for missing/revoked client,
   unavailable continuity, consent mismatch and unavailable storage. Check exact
   fixed detail and unchanged execution denial, rather than token identifiers.
2. Extract inspection from the existing OAuth boolean predicate; retain boolean
   wrapper, query/short-circuit semantics and thrown storage errors. Add optional
   safe detail to the current review authority observation and fixed guidance.
3. Verify valid access and refresh/successor continuity, credentials-client
   compatibility, all refusal branches, foreign-owner isolation, no raw fields,
   no mutation and unchanged retry/settlement. Run affected tests and typechecks.
4. Use normal exact-head publication gate, independent review, signed PR and
   protected merge. Verify canonical deployment before original-owner read.
5. Record actual current 5C843 refusal detail or observation failure. No new
   provider test, health receipt or retry follows solely from diagnostic success.

Requirement mapping: OBJ-CAP29-AUTH; AC-CAP29-1 through AC-CAP29-5.
Contract: existing OAuth execution authority and owned semantic-review recovery.
Flow: original-owner task read → existing shared verifier → fixed safe detail.
Verification: predicate parity tests, recovery projection tests, canonical owner
read. Local source checks are not live acceptance.

## Existing item acceptance retained verbatim

1. This authenticated review owner can read the named task's canonical status, immutable request digest, deadline, bounded unresolved node IDs and scoped remediation verification identity through a supported host-accessible route.
2. The route enforces current owner, token, coworker and room authorization and refuses unrelated callers; it does not return raw provider output or credentials.
3. Readback distinguishes unknown execution from settled execution. Deadline expiry alone never sets executionSettled or authorizes retry.
4. An authorized recovery owner records genuine provider/executor reconciliation and executed canonical-runtime health evidence if an expired successor is required. retry_semantic_review retains its existing digest, evidence freshness, lineage and budget checks.
5. Verify the route on the named task and record the result or exact remaining authority remedy. Do not mint a passing review receipt, change grants silently, resubmit blindly or edit database evidence.

Coverage references: OBJ-CAP29-AUTH, AC-CAP29-1, AC-CAP29-2, AC-CAP29-3,
AC-CAP29-4, AC-CAP29-5; existing OAuth execution authority;
owned semantic-review recovery; original-owner task read to shared authority
inspection; predicate parity source tests; owner recovery projection tests;
canonical original-owner read.
