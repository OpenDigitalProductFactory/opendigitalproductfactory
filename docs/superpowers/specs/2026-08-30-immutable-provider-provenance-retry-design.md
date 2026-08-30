---
status: active
---

# Immutable Provider Provenance Retry

**Backlog item:** BI-E35E1183
**Epic:** EP-56AE0F69
**Workroom:** WC-6D36EB1A
**Status:** Approved bounded remediation in progress

## Problem

The initiative evidence writer verifies its design artifact from the canonical
repository provider before it persists a receipt. On BI-F48D7059, independent
review completed and the exact human-approved writer replay reached that
verification boundary, but the commit read failed once with
`CANONICAL_DESIGN_REQUIRED: Repository provider could not resolve immutable
commit provenance.` The same exact public GitHub commit resolved from the host
and from the portal container immediately afterward.

The provider reader currently makes one request for commit provenance and one
request for the exact blob. A thrown fetch or retryable HTTP response becomes a
terminal generic error. Because the approved reviewer envelope is single-use,
that transient read consumes the only lawful replay even though neither the
artifact identity nor the reviewer decision changed.

## Outcome

Both canonical provider reads use one bounded, fail-closed JSON request helper.
The helper retries only transient transport failures and explicitly retryable
HTTP statuses within the same writer invocation. Permanent provider responses,
unreadable payloads, immutable identity mismatches, DCO conflicts, Workroom
conflicts, and size limits continue to fail immediately. A retry never creates a
new TaskRun, approval envelope, decision, receipt, or authority grant.

## Governed scope manifest

- **OBJ-PROV-001:** Recover a transient canonical provider read inside the same
  approved writer invocation without consuming another reviewer identity.
- **OBJ-PROV-002:** Keep all immutable commit, blob, DCO, Workroom, author, size,
  repository, and subject checks fail closed.
- **OBJ-PROV-003:** Return bounded, sanitized diagnostics that distinguish
  transport, HTTP status, and unreadable-provider failures without exposing
  tokens or response bodies.

| Acceptance | Objectives | Statement | Design evidence |
| --- | --- | --- | --- |
| AC-PROV-001 | OBJ-PROV-001 | A first-attempt transport exception followed by a valid response succeeds for commit provenance and for exact blob reads within one resolver call. | Provider request contract; Verification |
| AC-PROV-002 | OBJ-PROV-001 | Retryable HTTP responses (408, 429, 500, 502, 503, 504) receive at most one immediate retry; success on that retry continues canonical verification. | Provider request contract; Invariants |
| AC-PROV-003 | OBJ-PROV-002 | Permanent 4xx responses, malformed success payloads, DCO ambiguity, Workroom/head mismatch, blob mismatch, and oversized content do not retry or become successful. | Invariants; Verification |
| AC-PROV-004 | OBJ-PROV-003 | Terminal messages name failure class, attempt count, and HTTP status when available, but never include authorization headers, tokens, or response bodies. | Diagnostics contract; Verification |
| AC-PROV-005 | OBJ-PROV-001, OBJ-PROV-002 | Commit provenance and exact blob retrieval share the same bounded provider helper; no second source-of-truth, schema, receipt type, tool, reviewer role, or bypass is introduced. | Architecture; Substrate verification |

## Existing substrate

`repository-artifact.ts` is already the canonical boundary for:

- resolving the installation repository and GitHub credential;
- requiring one live Workroom whose head equals the immutable commit;
- fetching commit provenance and parsing one DCO sign-off;
- resolving the accountable principal and optional agent context; and
- fetching the provider blob, verifying its Git blob id, byte ceiling, and
  SHA-256 digest.

The repair stays in this module and its colocated tests. It does not add a
provider abstraction, database record, retry queue, receipt, authority grant, or
reviewer role.

## Provider request contract

Introduce one module-private GitHub JSON fetch helper with exactly two attempts.
It uses the existing request URL, headers, token resolution, and `no-store`
cache policy.

Retry eligibility is deliberately narrow:

- a thrown fetch/transport exception; or
- HTTP 408, 429, 500, 502, 503, or 504.

The retry is immediate. The writer path must not sleep inside an approval-bound
request, and deterministic tests must not depend on wall time. HTTP 400, 401,
403, 404, 409, and 422 are permanent for this invocation and fail after one
attempt. A successful HTTP response whose JSON cannot be decoded is also
terminal: retrying an unreadable success could hide a provider contract defect.

The helper returns a discriminated result with `transport`, `http`, or
`unreadable` failure kind, attempts, and status where applicable. Callers map
that result onto their existing public error codes. Diagnostics may include the
status and bounded attempt count; they never include the token, request headers,
exception text, or provider response body.

## Flow

1. Resolve canonical repository identity and credentials server-side.
2. Validate repository, commit, blob, path, subject, and live Workroom binding.
3. Read commit provenance through the bounded helper.
4. Parse the DCO sign-off and resolve the accountable Workroom principal.
5. Read the exact blob through the same helper.
6. Verify blob identity, byte ceiling, and content digest.
7. Return the artifact to the existing receipt repository, which retains all
   reviewer-authority and receipt audit checks.

No retry crosses steps, mutates database state, or reuses a failed payload. The
single writer invocation remains the audit unit.

## Invariants

- Repository and organization identity remain server-resolved.
- The requested commit, path, and provider blob id remain immutable inputs.
- A retry cannot change the TaskRun, writer arguments, envelope, reviewer,
  subject, organization, or Workroom.
- Only transport and the explicit retryable status set are retried.
- All other errors remain immediate and fail closed.
- Retry count is fixed and bounded at two total attempts per provider read.
- Provider response bodies and credential material are never logged or returned.
- No approval, authority, receipt, or plan-coverage requirement is skipped.

## Independent spec-approval writer contract

The independent reviewer must read the complete immutable design artifact before
calling `record_initiative_design_review`. For this bounded remediation the
writer call must use `profile="fix"`, `artifactRole="design-spec"`, and exactly
one substantive terminal decision:

- `decision="pass"` with an evidence-based reason and no findings when the
  design satisfies the review criteria; or
- `decision="fail"` with concrete findings when it does not.

`decision="not-applicable"`, a non-`fix` profile, placeholder or prospective
reasoning, and claims based on unread or truncated source are invalid for this
spec-approval gate. Such a call is non-approvable, cannot establish a baseline,
and must remain preserved as terminal audit evidence. It is never corrected by
approving or replaying the invalid envelope. Any subsequent review must bind to
a materially revised immutable design artifact and a fresh deterministic
request identity.

## Rejected alternatives

- **Replay the consumed reviewer TaskRun or mint another envelope.** The exact
  envelope is terminal evidence and must not be reused.
- **Trust local Git or commit metadata supplied by the caller.** The receipt
  requires provider-verified immutable repository evidence.
- **Retry every HTTP failure.** Authentication, authorization, not-found, and
  invalid-input responses require operator correction and remain fail closed.
- **Add a durable retry job or provider table.** Two request attempts inside one
  writer invocation solve the observed transient boundary without new state.
- **Relax provider, DCO, blob, or Workroom checks.** Those controls establish
  artifact identity and authorship; the repair changes availability only.

## Migration and reconciliation

No schema or data migration is required. Existing failed TaskRuns, envelopes,
ToolExecutions, and Workroom evidence remain immutable. After a protected
release, BI-F48D7059 must use one fresh governed reviewer identity; the failed
TaskRun and envelope are not replayed. A successful receipt can then establish
the canonical baseline and resume the original readiness path.

## Verification

Tests must prove transient transport and retryable-status recovery for both
commit and blob reads, one-attempt refusal for permanent statuses and malformed
payloads, sanitized terminal diagnostics, unchanged DCO and Workroom refusal,
unchanged blob mismatch and size refusal, and a hard maximum of two attempts.
The governed review trace must additionally show a complete immutable-source
read and a writer call conforming to the independent spec-approval contract;
reviewer prose or an unapproved envelope is not a receipt or baseline.

The implementation plan is
`docs/superpowers/plans/2026-08-30-immutable-provider-provenance-retry.md`.
