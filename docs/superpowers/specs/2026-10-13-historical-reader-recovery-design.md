---
status: active
---

# Recover historical immutable-reader requests under current bounds

Backlog: BI-E8237EAE. Workroom: WC-C34C44B3.
Base: `e4edd79cd6cfa83ac00df4dd64494090573b3e23`.

## Problem and evidence

The architecture review for BI-2AB781FA cannot resume. Its successful historical
`read_source_at_version` audit requested `maxChars: 63040, maxLines: 400`.
Current replay rejects the recorded request against the 16000-character ceiling
before it can hydrate the exact immutable artifact. Canonical read-only diagnosis
is recorded in activity `cmv68lqbe04fb01lab4yoeodz`. No task or audit was edited.
The source path is `apps/web/lib/mcp-task-terminal-writer-context.ts`:
`validateReaderExecutions` calls `normalizeTerminalToolArguments` on historical
request parameters before hydration. This differs from authorizing a fresh call.

## Ordered correction

1. Reproduce the successful redacted historical 63040/400 request in the existing
   hydration suite. It must fail before the correction and pass afterward.
2. For a successful historical execution only, recognize positive safe-integer
   page-size controls above today's ceiling. Validate a copied request with those
   controls narrowed to the current limits. Preserve all immutable identities,
   cursors, ordering and malformed-control checks. Never rewrite the audit.
3. Such a historical request cannot establish reusable source content. Discard
   cached attempt selection and reread the entire pinned artifact from line one
   with today's bounded controls. Retain current result-identity, actual-content
   size, page continuity, overall context and page-count checks. Failure remains
   inconclusive; no fabricated source or writer receipt is allowed.
4. Verify negative cases: conflicting identity, unsuccessful historical read,
   malformed numeric controls, fresh read failure and unchanged audit bytes.
5. Run affected hydration, terminal-policy, submit/recovery and citation tests,
   source/test TypeScript programs, repository guards and the governed gate.
   Obtain independent semantic review, DCO PR, protected queue and deployment.
6. After deployed-byte verification, recover the original architecture TaskRun
   through its supported same-request route and require a genuine writer result.

## Acceptance and limits

The observed successful historical metadata can lead to a fresh exact-bound read;
it cannot itself certify the source. Current dispatch bounds and authority are
unchanged. Historical failed or malformed calls do not gain eligibility. A mismatched
artifact or oversized actual page remains refused. A complete current reread must
precede writer context. No database migration, task-history rewrite, new ledger,
provider/deadline change or qualification change is introduced.

The original BI's completed page-budget changes remain intact. This corrective
slice does not claim all prior acceptance or conformance completion. Runtime
acceptance remains unrun until canonical deployment and original-task recovery.
Rollback is a DCO-signed revert through the protected queue; audit data is unchanged.
