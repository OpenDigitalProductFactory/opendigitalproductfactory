---
status: active
---

# Bind preflight receipts to the environment that executes guards

Backlog: BI-92EE4EC5. Workroom: WC-A6C1A3B2. Shape: delivery-small.
Extends [bounded host verification](2026-10-13-bounded-host-verification-design.md),
especially its complete, successful and unchanged-identity receipt contract.

## Defect and ownership

At protected source `d2599a1dd31919782c4d0e8dc05822ed55330bb0`,
`scripts/pregate-preflight.mjs` fetches a pull-request body into `guardEnv`
and executes guards with it. Receipt identification omits that environment,
so it hashes inherited `process.env` instead. Changing fetched metadata can
therefore leave the cache identity unchanged while changing a guard input.
This is a source-confirmed gap, not a claim of an observed production exploit.

Existing `identifyGuardExecution` already accepts an explicit environment.
Reuse it; do not introduce another fingerprint or receipt store. Completed
BI-6DE5A3B6 owns bounded progress/outcomes, BI-D27ADE59 owns scope selection,
and BI-5AF52AF5 owns host-capability degradation. These are distinct defects.
Peer BI-E2669F37 supplies fetched-body parity and remains read-only.
BI-5445CECA owns the broader verification-tier redesign and the timing audit;
this independently deliverable correction is its cache-correctness prerequisite.

## Acceptance

- AC-ENV: use the exact effective guard environment for identification before
  and after execution, including the fetched `PR_BODY`.
- AC-REUSE: identical effective input may reuse a complete successful receipt;
  changed fetched body cannot reuse it despite unchanged source and inherited
  environment. A newly invalid body must execute and fail its guard.
- AC-FENCE: retain clean-tree, HEAD/tree/base/plan/toolchain/dependency identity,
  one-hour TTL, convergence lock, cancellation and complete-success checks.

## Ordered fix and verification

1. Reproduce with the actual CLI entrypoint in an isolated temporary fixture.
   Stub source discovery and external body lookup, use the real receipt runner,
   and substitute one bounded deterministic body guard for heavyweight checks.
   Prove the original body passes and reuses; then change only the fetched body
   and require the guard to execute and reject it. No external call, model,
   shared lease or global environment mutation is required.
2. Pass `guardEnv` into the existing receipt identifier. Keep execution,
   identity validation and every other guard/cache policy unchanged.
3. Run the failing regression before the repair, then the focused and existing
   receipt/preflight tests. Check syntax, frontmatter, docs and applicable
   publication guards. Obtain independent exact-source review and protected CI.
   Source-only fixtures are not canonical runtime or live cache acceptance.

One atomic deliverable maps BI-92EE4EC5 to AC-ENV, AC-REUSE and AC-FENCE;
contract `effective-guard-environment`, flow `fetched-body-to-receipt`, and
verification `pregate-preflight-effective-environment.test.mjs`.

## Boundaries, convergence and rollback

No new cross-HEAD reuse, per-command cache, parallel guard execution, skipped
guard, schema, grant, UI or runtime change. Existing contributor checkouts
receive the repair on normal source refresh. Protected CI remains mandatory.
Revert the wiring and regression through the normal PR path if needed; no
receipt deletion, historical rewrite or client restart is part of this fix.
The broader fast-fail ordering and input-closure cache work remain separate.
The actual unchanged-entrypoint regression produced one failure and one
unchanged-body control pass in 0.414 seconds. After the one-line repair,
26 focused receipt tests and 35 existing preflight tests passed. Syntax,
frontmatter, module-size and document-index checks also passed. Native research
receipt `initiative-b92042d5-c2c7-4d84-907f-77c2d41a4d1f`, proportional coverage
`cmvdbfua10xg101qrtlyheri2` and implementation admission
`IRD-3560BDCA3F36` preceded implementation. Refresh coverage for the final
published artifact. Whole host parity, shared integration, native semantic
review, protected publication and deployed acceptance remain unrun.
