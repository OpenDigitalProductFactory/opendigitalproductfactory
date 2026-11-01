# DPF component consumer-cutover planning

Status: proposed; independent client assessment clear; native review pending.
Planning delivery: BI-66681CBB, WC-EB8D9B19.
Design: [consumer cutover](../specs/2026-10-31-component-consumer-cutover-design.md).

For agentic workers: execute one independently reviewable backlog item at a time,
one BI, one branch, one PR. This item delivers documentation only. Later source
work uses dpf-tdd, dpf-local-merge-ci-before-push and dpf-pr-with-dco, with actual
runtime gates in the canonical runtime or a governed shared environment.

## Bound outcome and acceptance

Outcome: DPF maintainers have a source-grounded, independently reviewed cutover
design and phased plan defining canonical shared dependency ownership, immutable
distribution, first real consumer migration, compatibility retirement,
verification and rollback.

- AC-CUT-01: Every shared source responsibility has one named canonical owner and an acyclic dependency direction, with no second engine, permission system or serializer.
- AC-CUT-02: The selected immutable distribution strategy specifies exports, runtime and compiler support, complete dependency closure, licensing/provenance, integrity, release ownership and rollback.
- AC-CUT-03: The first real DPF caller migration and all retained compatibility imports have named owners, same-slice body retirement and explicit removal conditions; recent main fixes are preserved.
- AC-CUT-04: The plan identifies clean receiving-consumer, semantic/digest/receipt, loader/emitted-import, protected integration and relevant served-flow checks, distinguishing unrun checks from passes.
- AC-CUT-05: Independent review and live backlog coverage are recorded before any caller implementation; separately shippable successors have live mappings.

## Current delivery: internal sequence, one documentation PR

The following phases form one atomic documentation deliverable under BI-66681CBB;
an ownership table alone cannot satisfy the interface, receiving-consumer and
retirement contract. This rationale does not declare the later code programme atomic.

1. **Ground the boundary.** Read fresh main, seven PROVENANCE and
   DEPENDENCY-BOUNDARY manifests, the existing extraction design, relevant imports
   and live backlog. Record exact SHA, duplicate ownership and recent host changes.
   Files: this design/plan only. Evidence: 76 selected package-source paths match
   seed at ea62f5fb890390bde854b618834f5e77fd3865ea; no runtime test claim.
2. **Resolve design choices.** Preserve the two recorded decisions:
   DI-7E68467A7AD0 (`versioned-artifacts`) and DI-7AF2A4D33ED0
   (`workroom-foundation`). Map AC-CUT-01/02 to OBJ-OWNER/OBJ-DISTRIBUTION and
   VER-CLOSURE/VER-LOADER. Verify the graph has no upward edge from Workroom or
   scoped judgment. Independent reviewer checks meaning/closure and ownership fit.
3. **Define a bounded pilot.** Map AC-CUT-03/04 to OBJ-CONSUMER,
   VER-PARITY/VER-DPF/VER-ROLLBACK. Name actual shape-conformance caller,
   compatibility graph subpath and whole affected implementation closure.
   Preserve host fixes and demonstrate same-slice removal in the later source PR.
4. **Freeze and review this documentation.** Resolve the shared generated-index
   edit admission, regenerate/check the canonical index, run affected doc checks
   and diff checks, create a DCO-signed immutable commit and independently review
   its exact artifact. No product build/browser pass is required or claimed for
   documentation alone. No override of source ownership or native review gates.
5. **Record coverage and publish the planning PR.** Obtain a valid immutable
   plan-backlog coverage receipt for this documentation item, including the exact
   acceptance, contract, flow and verification references. Store the returned
   receipt here and confirm it through check_plan_backlog_coverage. Publish through
   normal protected PR checks; no implementation follows merely from a docs merge.

## Successor delivery graph

| Live item | Deliverable and boundary | Depends on | Required receiving proof |
| --- | --- | --- | --- |
| BI-66681CBB | This reviewed design/plan, documentation only | Current source and policy evidence | Doc checks, independent review, immutable coverage |
| BI-B8A4DE44 | Component-maintainer foundation release candidates for Workroom, scoped judgment and GPP | Approved BI-66681CBB boundary | VER-CLOSURE, VER-PARITY, VER-LOADER; split xlarge work into live package children before implementation |
| BI-FCDCAE98 | First real DPF Workroom consumer and same-slice retirement | BI-66681CBB and qualified Workroom foundation artifact | VER-PARITY, VER-LOADER, VER-DPF, VER-ROLLBACK |

Component candidates do not include public package publication. The exact registry,
credentials, release authority and publication action remain with the owning
component maintenance workflow. No implementation claim or spending commitment
was made by filing these successors.

Before BI-B8A4DE44 decomposition, reconcile existing BI-DBA1FE11 and
BI-721C467A source-extraction ownership. WC-BD687ACC remains within pause/resume
grace; neither the new intake nor this plan authorizes taking that room over.
The distribution successor must reuse delivered source and map overlapping
package work to its existing owner instead of repeating extraction.

The receiving-consumer handoff narrows the first foundation to graph plus GPP
schema/contracts and scope leaves across the three existing component homes.
Include clean installed-tarball runtime/declaration checks on DPF2 TypeScript
7.0.2 / Node 24.22.0 as well as the seed Node 24.16.0 / TypeScript 6.0.3 matrix
and actual current DPF pins. Preserve/version the legacy permissive receipt API;
it does not become DPF2's accepted-work predicate. Six differences in DPF2's nine
older pinned files require classified compatibility review, not an automatic reset.

Shared maintainers own packaging/contracts/fixes/vectors. BI-FCDCAE98 owns DPF
pinning, actual caller refactor, body retirement, semantic preservation, product
integration/recovery and rollback. DPF2 owns its adapter, retirement, company-flow
acceptance and Linux enforcement. No component release silently updates either
host. Fuller practice/job/context/tool/result assembly needs its own bounded
source characterization in existing homes; native execution and custody remain
host-owned and all execution holds remain in force.

Later policy, composition, business and commons migrations are outside these
delivery intakes. Before scheduling them, identify actual receiving callers,
extend this design if needed, file/reuse independently shippable BIs and obtain
their own reviewed implementation plans/coverage. Do not treat this roadmap as
seven pre-approved package installs or as a replacement for all validators.

## Backlog coverage

Coverage receipt: `cmvx2e0xp022r01pohb0jt40p`, recorded through the native
record_plan_backlog_coverage tool with decision `atomic` for BI-66681CBB.
It binds this plan at immutable commit
`0ee3b4ee9e56c16cb75f89725ec09e43fcbd968d`, Git blob
`d9d9dbea0141714cfbd8a84762e2721426598049`. This paragraph records that receipt;
it does not change the covered delivery scope or grant successor implementation.
Current plan subject: BI-66681CBB. Proposed decision: atomic, for the single
documentation delivery only; acceptance references AC-CUT-01 through AC-CUT-05.
Contract references: OBJ-OWNER, OBJ-DISTRIBUTION, OBJ-CONSUMER.
Flow references: current delivery phases 1-5 and successor delivery graph.
Verification references: VER-CLOSURE, VER-PARITY, VER-LOADER, VER-DPF, VER-ROLLBACK.
The native server selected the applicable receipt schema and immutable binding.
Successor items remain triage intake, not covered implementation admission.

## Risks, rollback and stop conditions

The highest risks are circular package ownership, changed ID/hash/receipt meaning,
declaration/runtime loader incompatibility, stale source overwriting recent host
fixes, and duplicated live bodies hidden behind compatibility names. Any such
finding blocks the affected candidate; version behavior changes separately.

Documentation rollback is a protected revert of this plan/design. Later source
rollback must restore a prior tested artifact and exact import/lockfile set while
retaining durable records, in-flight work and existing authority boundaries.

Do not implement callers, publish packages, change production data/infrastructure,
deploy or edit DPF2 as part of this planning item. Stop before declaring planning
complete until independent review, immutable coverage and required doc checks
actually pass. The generated doc-index shared claim now has executed native
approval cmvwzem003obv01pny3o1tayq and was verified on the Workroom. Toolchain
permission convergence failed on existing Grok configuration.
The docs are reviewable source drafts; no gate or runtime qualification is implied.
