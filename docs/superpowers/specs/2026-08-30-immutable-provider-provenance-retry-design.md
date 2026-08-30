---
status: active
---

# Immutable Provider Provenance Retry

**Backlog item:** BI-E35E1183 | **Epic:** EP-56AE0F69 |
**Workroom:** WC-6D36EB1A | **Profile:** fix

## Problem and decision

An approved initiative writer failed on transient GitHub commit provenance,
consuming its single-use replay without a receipt; the same commit resolved
immediately afterward.

Keep `repository-artifact.ts` as the single canonical boundary and add one
module-private JSON request helper used by both commit-provenance and exact-blob
reads. It makes at most two immediate attempts. It retries only thrown transport
failures and HTTP 408, 429, 500, 502, 503, or 504. Other statuses and unreadable
success JSON fail after one attempt. No sleep, queue, new abstraction, schema,
tool, role, grant, receipt, or approval bypass is introduced.

## Preserved boundaries

Repository, organization, subject, credentials, and principals stay
server-resolved; commit, path, and blob id stay immutable. Workroom head, DCO,
reviewer/author separation, Git blob id, byte ceiling, SHA-256, and receipt
authority remain fail closed. A retry cannot change the TaskRun, arguments,
envelope, reviewer, organization, artifact, or audit unit, and never mints new
governance state. Diagnostics expose only class, attempt count, and HTTP status,
never secrets or provider content. Provider I/O stays outside transactions.

## Acceptance contract

- **AC-PROV-001 / OBJ-PROV-001:** transport and retryable-status failures for
  commit and blob reads may succeed on the second and final attempt.
- **AC-PROV-002 / OBJ-PROV-002:** permanent status, unreadable JSON, DCO or
  Workroom conflict, identity mismatch, blob mismatch, and oversize content
  remain immediate refusals.
- **AC-PROV-003 / OBJ-PROV-003:** terminal diagnostics are bounded and sanitized.
- **AC-PROV-004:** both reads share the helper and one audit invocation.
- **AC-PROV-005:** no immutable, authorization, approval, or coverage control is
  weakened or skipped.

## Independent spec-approval writer contract

The reviewer must read this entire immutable artifact before calling
`record_initiative_design_review`. Use `profile="fix"`,
`artifactRole="design-spec"`, and one substantive decision: `pass` with an
evidence-based reason and no findings, or `fail` with concrete findings.
`not-applicable`, another profile, placeholder/prospective reasoning, or
unread/truncated evidence is invalid and non-approvable. It establishes no
baseline and is never approved or replayed. Any later review must bind to a
materially revised artifact and fresh deterministic request identity.

## Migration, rollback, and verification

No migration is needed; failed TaskRuns, envelopes, executions, and Workroom
evidence remain immutable. Rollback is a protected revert. Tests cover both
retry paths, the two-attempt ceiling, permanent/unreadable refusals, sanitized
errors, unchanged DCO/Workroom/blob/size refusals, a complete immutable read, and
a conforming writer. Prose or an unapproved envelope is not a baseline.

The implementation plan is
`docs/superpowers/plans/2026-08-30-immutable-provider-provenance-retry.md`.
