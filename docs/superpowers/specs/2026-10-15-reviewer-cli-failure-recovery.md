---
backlog: BI-8B8731EE
status: active
---

# Preserve bounded CLI terminal diagnostics

The owner explicitly authorized closing the reviewer blocker before delivering
BI-B22C8E02's handoff successor BI-5366EF78. The current native review attempts
E06FF96F3D65, 48F9C052C883 and EB10911061D8 have no verified review receipt;
their native Claude calls ended as `NativeCliExecutionUncertainError`. No quota,
authentication or model cause is established by that error. Existing exact
TaskRun identities and request digests remain held until supported recovery.

## Design grounding

Reuse `apps/web/lib/routing/cli-result-errors.ts` and its existing quota/auth/
overload classifiers. The execution-reliability owner in WC-1D447592 owns native
process observation, uncertainty persistence, receipt races and retry fencing.
That owner requested this separate pure metadata parser, will independently
assess its immutable source and integrate it into the sole containing repair.
No competing edits, reviewer requests, provider probes or releases.

The parser reports success/error/unknown, only known type/subtype categories,
the boolean error flag and a bounded known failure hint. It returns no raw text,
error arrays, session identity, paths, prompts or credentials. Unknown shapes
and malformed/partial/empty results remain unknown. A successful native envelope
needs a complete result payload and no error flag/subtype. A failed terminal
record is not evidence of no tool effects or remote settlement; the caller
retains uncertainty and retry fences. Legacy error classification stays intact.

## Objectives and acceptance

- AC-1: Recognize complete successful and failed CLI result records; unknown
  type/subtype, malformed/partial/empty records do not establish success.
- AC-2: Existing known quota/auth/overload patterns and a bounded known model
  startup error produce only typed hints, with no raw data returned.
- AC-3: Metadata from any child output cannot claim no-start, child closure,
  remote settlement or retry authority.
- AC-4: First-failing fixtures cover valid/error/unknown results, sensitive raw
  fields and arrays, misleading success prose and legacy classifier behavior.

## Ordered repair and verification

1. Resolve impact using related-test lookup and colocated quota/fallback tests.
2. Write and run failing pure-parser regressions against dca25ccab156b7aa73e990dc1391ab18ffc205f8.
3. Add the parser, consolidating shared known-error predicates instead of
   duplicating them. Run the new tests plus existing quota/banner/fallback and
   adapter tests; run the web TypeScript programs and applicable source guards.
4. DCO-sign and freeze the helper; provide exact source and actual check evidence
   to the existing independent execution-reliability owner. Native review is
   unavailable for this repair and is unrun, not passed. The checked-in bounded
   DEV review-infrastructure recovery applies; no self-written independent receipt.
5. The existing owner integrates and qualifies the sole containing source/release.
   Then prove recovery through real review receipts before resuming handoff code.

One atomic helper contribution under BI-8B8731EE. No new API, table, tool,
dependency, account configuration or migration. Rollback removes the helper and
shared predicate refactor; existing native uncertainty handling stays controlled.
Local tests are source evidence, not proof of live reviewer recovery.
