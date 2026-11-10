---
status: active
---

# Immutable Provider Provenance Retry Implementation Plan

**Backlog item:** BI-E35E1183
**Epic:** EP-56AE0F69
**Workroom:** WC-6D36EB1A
**Branch:** `fix/repository-provenance-retry`
**Design:** `docs/superpowers/specs/2026-08-30-immutable-provider-provenance-retry-design.md`

## Outcome

Make canonical commit and blob verification resilient to one transient provider
failure inside the same approved initiative-writer invocation. Preserve all
immutable identity, DCO, author, Workroom, reviewer, authority, and receipt
checks and keep permanent failures fail closed.

## Reproduced evidence

The human-approved BI-F48D7059 writer replay executed once as ToolExecution
`cmtf6vg0o01p401phwjx4tkvv` under envelope
`cmtf6my0n01go01phujpcoxfq`. It retained the independent PASS arguments but
failed `CANONICAL_DESIGN_REQUIRED` because the provider could not resolve commit
provenance. No receipt or baseline was written. The exact public commit
`2e8a2246915092b7fb8c16ba496e90613da6fbc4` resolved with HTTP 200 both from the
host and from the live portal container afterward. The consumed identity will
not be replayed.

## Test-first implementation

1. Extend `repository-artifact.test.ts` with RED cases for a thrown commit read,
   retryable commit status, thrown blob read, and retryable blob status that each
   succeed on the second attempt.
2. Add RED refusal cases for permanent HTTP status, unreadable JSON, sanitized
   terminal errors, blob mismatch, and the two-attempt ceiling.
3. Add one module-private discriminated GitHub JSON request helper with two
   total attempts and the explicit retryable status set.
4. Route commit provenance and exact blob retrieval through that helper while
   retaining their existing public error-code mappings and decode logic.
5. Refactor under green only to remove duplicate request construction and keep
   the provider boundary legible.
6. Run the focused test file, web typecheck, style guard, affected-test/blast
   checks, preflight, DCO verification, independent semantic review, and exact
   tree verification. If a shared gate is demonstrably unavailable, preserve
   that evidence and rely on protected CI rather than altering or weakening the
   gate.
7. For canonical spec approval, require the independent reviewer to read the
   complete immutable design and call the writer once with `profile="fix"`,
   `artifactRole="design-spec"`, and a substantive `pass` or `fail`. Preserve
   placeholder, `not-applicable`, non-fix, truncated-read, or unapproved calls as
   non-baseline audit evidence; never approve or replay them. A fresh review is
   allowed only after a materially revised immutable design artifact.
8. Publish normally, open a protected PR, inspect review findings and all checks,
   merge, ship an immutable release, and verify the live provider path.
9. Create exactly one fresh BI-F48 reviewer identity after deployment. Require a
   real receipt/baseline, then resume plan coverage and the downstream WordPress
   readiness recovery without fabricating or proxying evidence.

## Expected code surface

- `apps/web/lib/backlog/initiative-readiness/repository-artifact.ts`
- `apps/web/lib/backlog/initiative-readiness/repository-artifact.test.ts`
- `docs/superpowers/specs/2026-08-30-immutable-provider-provenance-retry-design.md`
- `docs/superpowers/plans/2026-08-30-immutable-provider-provenance-retry.md`

No schema, migration, public route, receipt type, MCP tool, role, grant, or UI
surface changes are expected. The doc index is regenerated only if the standard
documentation guard requires it.

## Risks and rollback

The principal risk is retrying a failure that actually needs operator repair.
The helper therefore retries only thrown transport failures and HTTP 408, 429,
500, 502, 503, and 504; every other status and any unreadable success payload is
terminal. Attempts are bounded at two and do not sleep. Rollback is the normal
protected revert; existing provider reads return to single-attempt behavior and
all immutable audit records remain unchanged.

## Backlog coverage

- Decision: atomic
- Parent: BI-E35E1183
- Receipt: pending canonical spec baseline and provider-verified plan artifact
- Rationale: The shared helper and its two call sites are one availability
  contract. Shipping only the helper is unreachable; shipping only one call
  site leaves the approval flow vulnerable at the other immutable provider
  read. The tests and both call-site migrations must ship and roll back together.
- Dependencies: protected deployment precedes the fresh BI-F48 reviewer replay

| Deliverable key | Backlog item | Independently shippable | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- | --- | --- |
| `provider-provenance-retry` | BI-E35E1183 | no | OBJ-PROV-001, OBJ-PROV-002, OBJ-PROV-003 | provider-request-contract, immutable-artifact-contract, fail-closed-diagnostics | commit-provenance-read, exact-blob-read, fresh-reviewer-recovery | AC-PROV-001, AC-PROV-002, AC-PROV-003, AC-PROV-004, AC-PROV-005 |

The coverage receipt cannot exist before a canonical spec-approval baseline and
a provider-readable immutable plan blob. This plan records the complete atomic
mapping now; after the design/plan commit is published and reviewed, the
canonical writer must replace `pending` with its real receipt and bindings.

The expired BI-E35 review envelopes remain immutable evidence only. Neither a
placeholder/`not-applicable` call nor a correct but unapproved call satisfies
the baseline. The next independent review must bind to the materially revised
design blob containing the writer contract above.

The first review of that amended blob completed after six immutable reads but
never invoked the terminal writer. Preserve that TaskRun as no-receipt evidence;
do not replay it. The canonical design is therefore refactored without semantic
loss into a bounded complete artifact that fits one reader result plus the
reserved writer step. Any next review must bind to this new blob and remain the
only identity for it.

The subsequent concise-artifact review reached a genuine `fix`/`pass` writer
call with no findings, but its approval window expired without human approval.
It also remains no-baseline evidence and is never approved or replayed. This
revision makes that expiry disposition explicit; one fresh independent review
may bind to the new artifact identity.
