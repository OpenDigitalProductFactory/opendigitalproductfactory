# Local reusable component handoff

Three working subsets are ready for a bounded absorption study: the Workroom
graph/evidence kernel, offline GPP toolkit and scoped judgment. They coexist in
one DPF checkout on `codex/gpp-toolkit`. Real DPF callers use each extracted
implementation, and the displaced source implementations are removed.

This is an unpublished local checkpoint under the operator's explicit exception.
Independent Codex review and source-local verification ran. Native review,
plan coverage, shared-runtime gates and production qualification remain unrun.
DPF2 was read-only throughout this work. This document authorizes no consumer
edits, publication, deployment, corpus export or change to current authority.

## Exact source and entry points

| Component | Immutable extraction revision | Entry points relative to DPF |
| --- | --- | --- |
| Workroom WK-01 | `91550be3e97ad8d99af3d01992323c07d2f1d1c5` | `packages/validators/src/workroom/index.ts`; `@dpf/validators/workroom` |
| GPP GP-01 | `47d9a332f023f56cc1c466d11ff957290a5c97bb` | `packages/validators/src/gpp/browser.ts`, `compiler.ts`; `@dpf/validators/gpp/browser`, `@dpf/validators/gpp/compiler` |
| Judgment SJ-01 | `98e357addebc2e980bf537bac49b2ed1751680ff` | `packages/validators/src/judgment/index.ts`; `@dpf/validators/judgment` |

The joined producer implementation is
`53d1e0ba6bc28990b50c5c67a4444c7968ed553b`. Its sole source conflict was the
package export list, resolved by retaining every component entry. The identical
`decision-scopes.ts` addition has one home. The joined checkout also carries the
two frozen planning documents from `e61136fa94155801f28714269a35b6348aa815c0`:

- [Seven-family extraction map](../docs/superpowers/specs/2026-10-18-reusable-architecture-extraction-design.md).
- [Implementation sequence and remaining work](../docs/superpowers/plans/2026-10-18-reusable-architecture-extraction.md).

Those documents are the earlier planning snapshot; their statements that source
moves and isolated proofs were unrun are superseded by this checkpoint's local
evidence. Their native-gate and remaining-scope limitations still apply. The final
chat handoff names the enclosing revision containing the updated proof fixtures.

## Contracts, dependencies and migrated callers

| Subset | Working responsibility | DPF consumers and retirement |
| --- | --- | --- |
| Workroom | Structural graph construction, marking transitions, split/join, bounded rework, deadline/child observations and run/iteration receipt matching. Trusted time and observations enter as values. | Runtime drive planners, evidence/writeback adapters, queue drive functions, room projections and GPP checks import the package. Removed graph, marking and receipt implementations plus four displaced GPP support modules. The real ActionResult helper moved too; its existing application address remains a named compatibility bridge for incumbent callers. |
| GPP | Strict `gpp-shape/0.1` and layout schemas, parser, resolver, deterministic diagnostics, soundness, lowering/emission, draft bindings and reference interpretation. The Node compiler adds the canonical SHA-256 digest. | `apps/web/scripts/build-gpp-shapes.ts` uses the new DPF policy adapter; interpreter/soundness and their actual callers use portable modules. Twelve old pure implementation files are removed. Structural contracts and existing scope/evidence/trigger/collaboration/consequence vocabularies have canonical package homes. Application exports retain actual registry and policy responsibilities. |
| Judgment | Existing scoring, MCDA quality and bounded retry preserve behavior. New `scoped-advice/0.1` validates bounded owner/context/reference/eligibility inputs and returns advice or hold. | MCP principle decisions, perspective, ledger, golden/backtest and retry callers use moved math. Three old math implementations are removed. The golden guard uses deterministically derived JavaScript rather than handwritten duplicate math. The new scoped-advice wrapper is exercised by the standalone consumer; production MCP callers still own their existing scope adapters. |

The Workroom and judgment isolated source closures have zero runtime
dependencies. GPP's only third-party runtime dependency is Zod **4.6.7**. Its
Node digest additionally imports the existing pure
`@dpf/integration-shared/canonical-json` leaf and Node `crypto`. The producer
package retains its existing workspace package owner; that parent declares
`undici`, which is not evaluated by the tested deep-entry closure.

The GPP consumer proves a minimal copied canonical-JSON leaf package as an
absorption alternative. It copies the exact algorithm and notices, creating no
second handwritten JSON implementation. Copying source transfers the obligation
to track upstream changes and rerun byte/serialization fixtures. Importing the
existing package retains its wider declared dependency graph. Record that choice
in the consumer's existing dependency disposition before absorption.

All examples use actual Node **24.16.0** and TypeScript **6.0.3**. The Node GPP
build uses `@types/node` **26.6.5** with declaration-only `undici-types` **8.9.0**.
Browser tooling compiles separately with ES2022+DOM, `types: []` and no skipped
declaration checks; its import closure excludes Node builtins. Browser contract
smoke executes under Node, so browser/CSP qualification is unrun. The legacy
golden guard is plain ES2022 JavaScript compatible with the repository's declared
Node >=20 floor; actual Node20 execution was unavailable and is unrun.

Each example includes its complete source closure, strict standalone compiler
configuration, runner and notices. Runners materialize temporary regular files
outside the producer, clear producer resolution paths, compile and execute
emitted JavaScript, and report exact source/dependency hashes. They neither
install dependencies nor boot DPF. Copied DPF source remains Apache-2.0; Zod and
build declaration distributions retain their own MIT notices.
The retained product-wide NOTICE also names dependencies outside these source
closures; it does not add those dependencies to the examples.

## Required trusted adapters and unsupported behavior

The host retains one authenticated command/query path and transaction owner.
It supplies current definition/profile/binding versions, trusted time, principals,
revocation and protected artifact/input facts; reserves effects and dedupe
durably; and reconciles pending or uncertain attempts before retry. A caller
supplying a reference object or receipt kind has established none of those facts.

Workroom fixtures bind exact room/run/stage/iteration/attempt and output/input
content, current profile/binding and separate owner decisions. They cover replay,
lost acknowledgment, uncertainty, rework and recursive dependency revocation.
They are synthetic, single-writer adapters. The legacy kernel's wildcard receipt
semantics remain compatible; production authentication, concurrent stores, real
effect cancellation, scheduling, funded capacity and executor recovery are not
qualified by this extraction. Forward graph edges into failure/budget stops
remain unsupported. Trigger/proactivity/attention/funding policy extraction is
the later WP-01 slice.

GPP compilation is structural output, never execution admission. Missing tool
classification, grant facts, required policy or direct/transitive child facts
hold emission. Child traversal is bounded at 1024 unique references and exhaustion
holds. A rejected compilation prevents all generator writes and orphan deletion.
The emitter requires safe single-line metadata and comment-only instructions.
C-8 records a host declaration rather than claiming verified mediation.

Whole actor/session capability aggregation, including combinations spread across
stages, is unsupported and unqualified. C-5 co-occurrence and C-7 containment
remain visibly unevaluated. GPP 0.19's actual attributable human decision for the
full combination remains required; successful compilation, a validator, a binding
label or `doctrine-then-human` text supplies no such decision or qualification.
The examples perform no real effects. Their exact synthetic checkpoint is kept
separate from the assigned executor and may not be replaced by another reviewer.
The small stage mapper supports only a supplied executor that matches an exact
declared agent/person reference; role resolution and differing accountable versus
executor assignments are unsupported. Retain accountable human, coordinator,
executor, requester and reviewer identities in their existing consumer owners.
Do not infer an assignment or authority from a label to make a mapping succeed.

Scoped advice requires the exact WWMD platform, WWWD organization or WSID
profession owner, current context/principle references and host hard-eligibility
results before preference scoring. The host validates its existing feature
catalog and authenticates source applicability/currentness. Cross-scope doctrine
cannot fill missing owning context. A score or legacy `autonomyEligible` flag is
never permission. Synthetic WWWD capture/re-consult is tested; portable WSID
feedback, real corpus quality and authenticated outcome capture are unsupported.

The existing `trusted-agent-contracts.ts` and `trusted-agent-reference-loop.ts`
remain reusable draft 0.1.0 representation/reference transitions. They are
non-authoritative and sequential-only; this graph extraction does not extend
their interchange schema. GAID identifies/binds receipts, JSI qualifies, GPP
describes the admitted envelope and TAK enforces current reach. Retain the
consumer's trusted mediation rather than replacing it with these fixtures.

## Bounded DPF2 absorption

Read DPF2's current absorption rule, implementation plan, core contract and
requirements before editing. These are adoption candidates, not claims that
DPF2 has adopted or accepted them.

| Candidate | Existing DPF2 home and possible retirement | Required compatibility proof |
| --- | --- | --- |
| WK-01 | Adapt only structural next-stage/terminal math and bounded iteration/rework in `packages/core/src/index.ts`. Keep canonical definitions in `types.ts`/`seed.ts`, commands and all `apps/control/src/store.ts` writes with their current owners. | Map DPF2's 1-based iterations to the kernel's 0-based iterations explicitly. Preserve `validArtifact`, input evidence, protected bytes/lineage, current admission/permit/revocation and effect comparisons. Retire only structural calculations actually replaced after unchanged core/experience tests pass. |
| GP-01 | Author/validate a supported sequential definition for existing core types/seed through a narrow adapter. DPF2 has no existing graph compiler to claim retired. | Resolve id/key, actor and owning scope separately; preserve exact versions, declared-empty versus absent tools, arbitrary output kind versus closed evidence vocabulary, binding and data/effect/cost/qualification facts. Unsupported graph exchange holds. Compile a generated module against the consumer contract and preserve its current authority and store. |
| SJ-01 | Add advisory evaluation in the existing core home behind its current gate; there is no current MCDA implementation to retire. | DPF2's existing policy doctrine label does not provide WSID owner/corpus context. Supply actual scoped owners, current revisioned sources, host eligibility and domain validation. Hold missing owning context, and keep independent admission/outcome storage. |

The current synthetic consumers resemble DPF2's bounded customer-report and
enabling-improvement flow, but do not replace its real protected core adapters.
No DPF2 source, database, dependency or runtime was changed to obtain this proof.
No DPF2 acceptance checks ran. Absorption must update its existing
`evaluations/dependency-dispositions.json` and requirement/test links, including
R002/R004, R005–R007, R011/R013/R015/R018/R020 and R028. Producer tests do not
satisfy those consumer acceptance cases. Preserve the current unavailable-executor
hold in `packages/runtime/src/ports.ts` and the distinct composition planner.

## Verification, maintenance and remaining work

Agent verification entries are `examples/workroom-kernel/run.mjs`,
`examples/gpp-toolkit/run.mjs` and `examples/scoped-judgment/run.mjs`, invoked with
the pinned Node executable from a managed producer checkout. Their neighboring
READMEs specify manifests, exact scenarios and unavailable capabilities.
Affected application/package tests, web/package typechecks, existing generated
GPP byte checks, golden-runtime freshness, SBOM shape, module/style and document
checks ran. Independent review found and repaired exact-human, Node-floor,
missing-fact, rejected-generator and emitted-comment defects. Native gates,
shared-runtime/build, actual Node20 and real browser/CSP acceptance remain unrun.

The final joined runs passed 130 application suites / 2,147 tests, three changed
pure-package suites / 47 tests, 28 generator/golden/registry tests, and 33 isolated
scenario groups (Workroom 13, scoped judgment 9, GPP browser 5 plus Node 6).
Earlier real-caller and compatibility evidence is retained per slice; those
counts are not summed with these runs. Unit-test fallback/error traces are
synthetic adverse fixtures, not observations about the live install.

Maintainer: @markdbodman, tracked by BI-DBA1FE11, BI-721C467A and BI-4DD124E7 under
BI-E23432C1. Upgrade the canonical sources and manifests together, regenerate the
golden distribution, retain notices and exact contract fixtures, then rerun
consumer and real-caller checks. Compatibility bridges name their actual callers,
owner, tracking item and removal condition. Rollback restores a moved
implementation together with every import/generator change; restore no parallel
store, engine, authority or effect path.

All seven families were audited. Workroom policy modules (BI-D30CD423), operating
composition (BI-9874488F), business surface/canonical facts (BI-9A6163AD) and
Commons/Hive exchange (BI-0D316824) remain planned implementation slices. Existing
portable trust contracts are retained rather than recreated. This checkpoint
does not claim those later slices, a full Workroom platform or full standards
conformance are complete.
