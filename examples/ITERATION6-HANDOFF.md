# Iteration 6 implementation takeover

“Iteration 6” names this producer handoff sequence, not a consumer plan, adoption or
acceptance. Existing delivery and authority owners remain; this work changes no consumer
source or production state.

Read the [component inventory](REUSABLE-COMPONENTS.md), historical [verification
record](CONTINUATION-VERIFICATION.json) and selected READMEs. The final artifact must pin
the full producer commit, archive SHA-256 and source hashes. Historical results cover their
recorded revisions, not a moving branch.

## Establish the consumer boundary

Read the consumer's `AGENTS.md`, `docs/IMPLEMENTATION-PLAN.md`,
`docs/COMPONENT-ARCHITECTURE.md`, `docs/ABSORPTION-AND-DEPENDENCIES.md`,
`docs/reviews/PRODUCER-EXTRACTION-CONSUMER-REVIEW.md`, `packages/core/CONTRACT.md` and
`evaluations/dependency-dispositions.json`. Its existing requirements registry remains
authoritative; this guide adds no registry or all-family adoption gate.

The inspected `packages/core/src/reusable-components.ts` consumes structural graph/schema
sources pinned to `4faccd852a49bba58e40ad7146f3d9c585874cf0`. It excludes marking, receipt
predicates, the full compiler and scoped judgment. Record an actual consumer revision or
source manifest; reconcile later changes.

## Producer entries and isolated consumers

Use narrow entries and declared closures, not a parent application barrel. Retain
[Apache-2.0 licensing](../LICENSE), each selected NOTICE and copied third-party notices.
These are source distributions, not npm install instructions.

| Family | Producer entry | Consumer, source closure and attribution |
| --- | --- | --- |
| WK | `@dpf/validators/workroom` | [README](workroom-kernel/README.md), [closure](workroom-kernel/closure.json), [NOTICE](workroom-kernel/NOTICE) |
| GP | `@dpf/validators/gpp/browser`, `@dpf/validators/gpp/compiler` | [README](gpp-toolkit/README.md), [closure](gpp-toolkit/closure.json), [NOTICE](gpp-toolkit/NOTICE) |
| SJ | `@dpf/validators/judgment` | [README](scoped-judgment/README.md), [closure](scoped-judgment/closure.json), [NOTICE](scoped-judgment/NOTICE) |
| WP | `@dpf/validators/workroom-policy` | [README](workroom-policies/README.md), [closure](workroom-policies/closure.json), [NOTICE](workroom-policies/NOTICE) |
| OP | `@dpf/validators/operating-composition` | [README](operating-composition/README.md), [manifest](operating-composition/source-manifest.json), [NOTICE](operating-composition/NOTICE) |
| BS | `@dpf/storefront-templates/operations` | [README](business-operations/README.md), [closure](business-operations/closure.json), [NOTICE](business-operations/NOTICE) |
| HX | `@dpf/validators/commons`; optional `@dpf/validators/commons/node` | [README](commons-exchange/README.md), [closure](commons-exchange/closure.json), [NOTICE](commons-exchange/NOTICE) |

Retain the existing [trusted-agent
contracts](../packages/validators/src/trusted-agent-contracts.ts), [reference
loop](../packages/validators/src/trusted-agent-reference-loop.ts) and [draft
contract](../docs/architecture/trusted-agent-reference-contract.md). Use complete
importer/semantic checks, not JSON Schema alone. Reference execution adds no enforcing
coordinator, authority store or eighth consumer command.

With managed build dependencies available, invoke exact Node 24.16.0 for these commands; the
external compiler is TypeScript 6.0.3. The isolated NodeNext runners start no DPF runtime
and install nothing. Record actual final-revision results.

Current relative source imports use `.ts` extensions. Preserve exact source bytes and
enable `rewriteRelativeImportExtensions` in the consumer's emitting NodeNext build;
characterize that build before updating provenance. The read-only October 28 consumer
refresh found that DPF2's `tsconfig.server.json` lacks this option. DPF2 remains unchanged.

The policy resolver includes current DPF's gate-governed room-default behavior. Its
`gateGoverned` input is a trusted host fact derived from the actual executor, followed by
room-declaration and hard-policy floors. A supplied label, compile result or posture does
not establish governed execution or permission to act.

```sh
node examples/workroom-kernel/run.mjs
node examples/gpp-toolkit/run.mjs
node examples/scoped-judgment/run.mjs
node examples/workroom-policies/run.mjs
node examples/operating-composition/run-isolated.mjs
node examples/business-operations/run.mjs
node examples/commons-exchange/run.mjs
```

The cores exclude Next.js, Prisma and queue/framework hosts. GPP retains Zod and its
declared canonical-JSON leaf; browser and Node-crypto compiler entries stay separate. OP
retains the same pure internal leaf; HX's Node digest adapter is optional. Do not copy
unrelated parent-package runtimes.

## Adopt and retire one actual responsibility at a time

1. **WK/GP first:** extend `packages/core/src/reusable-components.ts` and its
   existing core callers for the selected sequential translation. Preserve IDs,
   arbitrary output kinds, binding revisions and one-based/core versus zero-based/
   kernel iterations. Retire only replaced translation/structural calculations.
   Marking or legacy receipt compatibility needs a named caller and migration;
   neither may introduce another lifecycle writer.
2. **OP next where useful:** resolve exact composition facts through
   `packages/core/src/types.ts`, `packages/core/src/work-package.ts` and
   `packages/runtime/src/composition-plan.ts`. DPF2 has no AIDoc hash body to retire.
   Replace only equivalent composition/qualification interpretation; preserve
   joint account/channel/tool/context/cost eligibility and professional packaging.
3. **BS through the existing read model:** adapt selected behavior in
   `packages/experience/src/operating-surface.ts` and
   `apps/web/src/OperatingBoard.tsx`. `getBusinessOverview` is already retired.
   Remove only overlapping projection assembly; retain core readiness/source
   owners. Fixture commitments are not subscriptions or shelter custody.
   A contrasting domain fixture precedes generic operating-model reuse.
4. **HX only after private custody:** extend the existing `Contribution`,
   submit/review/accept commands and Store transaction. Company/candidate/revision
   must name one immutable complete candidate: ordered private source/provenance
   references, scope, payload identity, destination/policy generation and separate
   accountable/requester/author principals. Keep its full-candidate identity private
   under existing versioned canonicalization, distinct from the outbound payload hash.
   Independently authorized review
   resolves those exact stored bytes; review/reservation conflicts atomically on
   drift. Assessment alone cannot detect same-revision private-field changes.
   Unbound legacy candidates stay private/held. Version any full-candidate digest
   field; never silently extend strict `commons-candidate/0.1`. Delivery is not
   steward or receiving-company acceptance.
5. **Defer WP and SJ without a useful caller:** WP needs actual composed-posture/
   persistent-attention and owned decision-mode/funding facts; it does not replace
   profession-context compilation. SJ needs a real advisory decision, exact owning
   corpus and hard eligibility. Neither warrants a speculative engine or grant.

## Trusted ports and strict compatibility

The host resolves principals, trusted time, current policy/revocation, source revisions and
JSI scheme/role qualification. Preserve WWMD platform, WWWD company and WSID profession
owners; scope strings prove none. Preflight the selected job's author/reviewer/coordinator
readers, writers, result/recovery methods and normalized tool/account/target/data
destinations. Missing, stale, revoked, unsupported or throwing required facts hold; unknown
usage/cost is not zero.

Keep `apps/control/src/store.ts` as atomic command/receipt/state/event owner and
`packages/core/src/artifact-custody.ts` plus material/runtime-wire lineage checks. Retain
original successful/uncertain effects; current disclosure and authority checks cannot repeat
them. `packages/runtime/src/ports.ts` stays the execution/ transport seam. Schemas, sample
hosts and receipts cannot clear its native hold.

The same format label does not establish compatibility with changed source semantics. For
SI-04, vary shape version, binding revision, checkpoint person and required extension
separately: re-resolve/refuse affected meaning, never inherit consent or invalidate
unrelated company facts. Keep accountable owner separate from executor, absent tools from
`[]`, and evidence from output kinds. Refuse unsupported fork/join, subshape, deadline and
explicit rework-edge meanings. Do not equate producer `enforced/environment` with consumer
`fixture-only`, or shadow/off with enforcement. Whole actor/session
untrusted/sensitive/state-change reach still needs its actual covered human decision.
Routine phase transitions reuse valid scope; they do not automatically create another
approval or reset context.

## Takeover evidence and exit

Pin compatible/incompatible vectors before replacement; exercise applicable SI-01–08 and
HX-01–04 through existing commands. They remain specified/unrun until the changed consumer
executes them. Preserve protected custody, historical replay and exact canonicalization;
changed digest semantics need an explicit version. Record source/notices, migrated callers,
actual retirement, compatibility consumers and removal conditions in existing dispositions.
Run required consumer checks and changed served flows in its authorized environment. Report
exact revisions/results, supported subset and remaining holds. Producer closure proof,
consumer integration, native qualification and company acceptance stay separate; synthetic
examples cannot establish owner comprehension, real benefit, native release or public Hive
acceptance.
