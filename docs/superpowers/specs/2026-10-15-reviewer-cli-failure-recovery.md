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

## Parser contribution evidence

The [Claude Code headless contract](https://code.claude.com/docs/en/headless)
describes JSON results on stdout for failures inside a run. That output carries
diagnostics; it does not establish absence of remote effects. The helper accepts
only a complete result with a boolean error flag, a known subtype and nonempty
string payload. Unknown or nonempty error arrays remain unclassified/unknown.
Known success prose is never inspected for failure hints. Existing non-native
classification retains its behavior and shares the auth/overload predicates.

The first run of the new 32 fixtures failed because the parser did not exist.
After implementation, all 95 tests in the metadata, quota-banner, quota-fallback,
adapter and adapter-grant suites passed. Both web TypeScript 7 programs passed;
documentation index/link checks and diff whitespace checks passed.
Independent assessment and containing
runtime qualification belong to WC-1D447592. Native review remains unrun here.

## Bound review receipt deduplication — October 16

The containing repair is deployed as v2026.10.16/sourcec38edb55. The three
original handoff reviews remain held at attempt2 without a human approval.
Their outcomes are not settled. The owning BI-5366EF78 design separately
explores relevant-effect reconciliation; it does not authorize replay here.

Normal implementation admission for this bounded bug-fix contribution is
IRD-D98B82977AD9 in WC-1CE10ECF. Its scope is one canonical terminal effect per
server-bound review request. Current receipt writers use random IDs, so a
duplicate or racing writer can publish a second verdict for the same task.
Baseline CAS alone does not deduplicate the other review lanes.

Reuse the existing activity primary key as the stable receipt identity; do not
add a table, ledger, API, schema field, credential or provider request. Derive
the key from the original task, immutable request digest, exact writer, gate
and server-resolved artifact digest. Carry task identity only from authenticated
tool context and the server-issued review packet, never tool arguments.

Ordered implementation:

1. Resolve affected tests and run failing repository/pack regressions before
   implementation. Cover conflicting proposals, rejecting winners, baseline
   repeats, cancellation, request/artifact drift and transaction race losers.
2. Add one shared helper for immutable effect identity, authenticated authority
   correlation and persisted canonical receipt validation. Lock the TaskRun
   before the existing BacklogItem/Workroom locks; re-read its current request,
   actor and cancellation state. A row lock is serialization, not proof that
   an old session carries an authenticated execution generation.
3. In both canonical writers, reconcile the exact prior verdict before append.
   Preserve FAIL as well as PASS; no contradictory second opinion. Validate
   legacy random-ID receipts against their durable authority/task linkage;
   unknown or conflicting linkage refuses instead of guessing. A spec-approval
   winner must retain its current matching baseline and retention evidence.
4. Give new bound receipts the deterministic existing activity ID. After an
   actual serialization/unique-key race, allow one fresh read-only winner
   reconciliation. If no qualified winner is visible, refuse; do not repeat
   the write, inference or approval. Keep unrelated unbound calls unchanged.
5. Run affected tests, both web typechecks, source/doc/style and inventory
   guards. Freeze a DCO-signed contribution for independent exact-source review
   and the existing sole containing release owner. Report unavailable native
   review as unrun under the checked-in infrastructure-recovery procedure.

This primitive does not change the uncertainty/replay admission guard, issue
new execution credentials, establish original child membership, or claim full
current-authority/generation fencing. It supplies a required canonical-write
safeguard; actual relevant-effect closure and separately admitted continuation
still govern the original handoff reviews. Original IDs, digests and budgets
remain unchanged. Rollback preserves existing receipts and restores the prior
writer behavior; it never deletes evidence to make another attempt possible.

### Executed source verification

The first repository/pack regression run reproduced 11 failures: duplicate
receipt IDs, FAIL replaced by PASS, missing task checks and missing trusted
context carriage. The baseline suite separately reproduced two failures:
repeated approval hit baseline CAS, and an existing rejection was replaced by
a new approval baseline. The new race helper suite initially could not load
the absent implementation; that was a missing implementation, not a runtime
verification result.

After implementation, all 88 tests across the bound-effect helper, Workroom
receipt writer, baseline repository, readiness pack, author-research writer
and steward-pack suites passed. Both web TypeScript programs passed. Additional
checks cover envelope-only task attribution, conflicting links, legacy random
IDs, conflicting historical verdicts, corrupt authority snapshots, cancellation,
missing retention and serialization losers with and without a visible winner.
The test transaction queue models writer ordering; it does not claim to verify
PostgreSQL's concurrency implementation. The P2034/P2002 tests explicitly verify
one fresh winner-only read and no second append.

Native semantic review remains unrun because its execution infrastructure is
unavailable. Independent exact-source assessment and protected publication
remain required under the checked-in shadow-policy recovery procedure. Served
runtime verification has not run for this contribution.
