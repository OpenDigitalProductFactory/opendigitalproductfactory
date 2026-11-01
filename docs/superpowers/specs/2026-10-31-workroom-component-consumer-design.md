---
status: draft
---

# DPF Workroom component consumer pilot

Backlog: BI-FCDCAE98. DPF maintainer: @markdbodman through existing CODEOWNERS.
This implements the first consumer slice of the [component cutover design](2026-10-31-component-consumer-cutover-design.md), not the later family migrations.

## Objective and acceptance

**OBJ-PILOT:** Real DPF Workroom callers use one pinned independently maintained implementation while current work, durable identities and host authority retain their existing meaning.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-PILOT-1 | OBJ-PILOT | The real shape-conformance caller imports the qualified Workroom artifact; existing Workroom and process contract paths resolve only to thin exports of that same body. |
| AC-PILOT-2 | OBJ-PILOT | Retire the displaced graph, marking, receipt, action-result, outcome-disposition and pure process identity/diagnostic/construct bodies in this slice; enumerate retained compatibility consumers and their removal condition. |
| AC-PILOT-3 | OBJ-PILOT | Exact tarball identity, integrity-pinned receiving lock, declared dependencies, Apache notices and the existing Docker dependency layer support clean installation without a new registry or public package release. |
| AC-PILOT-4 | OBJ-PILOT | Affected DPF tests, package/web typechecks, source and emitted loaders, isolated examples, merged-code integration and the relevant served nonproduction Workroom flow preserve ordinary/adverse/recovery behavior; distinguish unrun from passed. |
| AC-PILOT-5 | OBJ-PILOT | Rollback restores the prior tested dependency/import set without changing persisted records; DPF retains transactions, current actor/admission/permit decisions and effect/result custody. |

## Current source and prerequisite evidence

DPF base: `047c2fb055d392ee02d9ebc1b007429ad0cda7fd`.
A fresh comparison of forty unique Workroom/scoped/GPP package source paths
found thirty-nine original seed matches and one existing schema tool-name fix.
GPP candidate source preserves that BI-D37B2C13 fix explicitly; no old schema
is copied back into DPF. Host fixes outside these pure bodies stay in place.

The private Workroom artifact is `@opendigitalproductfactory/dpf-workroom@0.1.0-candidate.2`,
source `e106fb192ddfe7f19e9a7dfb94d2b496b5f92a97`, SHA256
`b30b8eba47df6b983e26e7a0f4b724363eb1a62df7a10829359a50e7d77acb40`.
It has no runtime dependency and exposes one ESM implementation plus declarations.
Its pinned build checks passed Node 24.16.0 / TypeScript 6.0.3, including
22 provenance entries, thirteen source and thirteen installed protocol scenarios.
An independent client reviewer found no material findings. Clean installation
of the exact Workroom, scoped-judgment and GPP archives also passed Node 24.22.0 /
TypeScript 7.0.2 on Darwin arm64: 13 Workroom, 9 advisory, 5 browser-model and
6 compiler/mapping scenario groups, declarations and generated module import.
These are package/receiver observations, not DPF or DPF2 product acceptance,
actual browser/CSP proof, Linux enforcement or native DPF review receipts.

## Boundary and dependency transport

Pin the existing private archive under `packages/validators/vendor/` and its
source/qualification identity alongside it. Add repository-relative file dependencies to validators and web, both resolving
to this single archive, with its integrity-pinned pnpm lock. pnpm 10.33.2 rejects
file-protocol catalog entries (ERR_PNPM_CATALOG_ENTRY_INVALID_SPEC); the existing
SBOM specifier-drift policy already classifies file references as first-party
plumbing rather than registry catalog drift.
The Docker dependency stage must copy that archive before frozen installation;
no image is built or deployed by hand. This is the tested versioned-artifact
route selected by DI-7E68467A7AD0, not recurring source absorption.

The real `apps/web/lib/work-management/workroom-shape-conformance.ts` caller
uses explicit artifact graph, receipt and process-identity subpaths. Replace
these old bodies with named thin exports of the same canonical implementation:
`workroom/{index,flow-graph,marking,receipts}.ts`, `action-result.ts`,
`outcome-disposition.ts`, and GPP `{element-ids,diagnostics,executable-constructs}.ts`
inside validators. Exported symbols, IDs, ordering, errors, result/receipt
semantics and legacy permissive compatibility predicates remain unchanged.
The GPP compiler/interpreter and Workroom policy stay in their current DPF
homes; their existing imports reach the same Workroom leaves through bridges.
This pilot does not adopt the independent GPP package or other families.

Enumerate every retained compatibility subpath and its actual direct importers
in the delivery evidence. DPF maintainers own each bridge. Remove a bridge when
its remaining supported consumers migrate to the explicit component subpath;
a bridge contains no local logic and never becomes a second editable body.

Original Workroom, GPP and policy isolated examples copy the affected source
closure and currently reject bare package imports. Update only their harnesses
and closure metadata to install the exact private artifact in a clean temporary
receiver, preserving their original behavioral scenarios. Reuse one bounded
example helper for installation; no application, service, credentials or state
is copied. Do not loosen import admission to arbitrary external packages.

## Verification and rollback

Use the implementation plan's V-PARITY, V-LOADER, V-INTEGRATION and V-ROLLBACK
checks. Characterize the old real caller first, observe a failing identity test
before replacement, then prove every retained bridge resolves to the identical
artifact function. Exercise graph/rework/receipt, conformance, marking, deadline
and GPP interpreter consumers. Missing linked-test advice expands this inventory.
Any new semantic difference or required persisted-data migration stops this
move-only slice for an explicitly versioned decision; tests do not manufacture
current host authority. UI impact is the existing Workroom projection; served
verification must use the canonical/shared nonproduction target, with actual
unrun checks disclosed. No production business-data write or upgrade is included.

Rollback is a protected source revert restoring the prior manifests, lock,
imports and old source bodies together. Existing durable Workroom IDs, receipts,
markings and effect records remain unchanged. Never run two live canonical
implementations or rewrite current work to make rollback appear successful.

## Research and scope rationale

Reuse the parent design's research, Node exports/ESM identity, TypeScript emission
and npm artifact-provenance standards. Source absorption, a new service/store,
and adopting every component at once were rejected in that design. This pilot
uses its selected acyclic Workroom boundary and introduces no third-party runtime
library, provider, registry or spend. The existing scope decisions remain the
reason for this extraction; local tests do not substitute native admission.

Native research receipt: `initiative-78cb09aa-f6b5-4766-bbad-a69a1611d4a9`.
The current medium delivery rule uses the five Acceptance bullets in the live item as its objective baseline; independent spec approval is not required. Independent client design/plan review passed. Plan coverage cmvx82ucj0oo101tm9r40g6v2 binds the quoted acceptance plan at be04ad60d529251e440c6f0bba6d4e80d253d496. This source update corrects only demonstrated dependency transport and the qualified candidate version; its acceptance criteria are unchanged. Reconcile coverage to this plan revision before publication. DPF execution evidence remains owed.
The prior local-refactor exception permits bounded source preparation with
independent client review and native gates honestly marked unrun; it grants no
production deployment, public package release, credential or permission change.

Strict-engine qualification first reproduced EBADENGINE on Node 24.22.0 with
the seed engine pin. Workroom `.2`, scoped judgment `.1` and GPP `.1` admit
exactly the tested Node 24.16.0 and 24.22.0; all exported APIs and emitted code
bytes are unchanged. The new exact-archive receiving matrix passed with npm
engine-strict installation and TypeScript 7.0.2.
