---
status: draft
---

# DPF Workroom component consumer implementation

Backlog: BI-FCDCAE98. Scope: [pilot design](../specs/2026-10-31-workroom-component-consumer-design.md).
Parent: [component cutover plan](2026-10-31-component-consumer-cutover.md).

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Atomic delivery boundary

Pinning the artifact, updating the real caller, retiring the displaced bodies,
retaining named bridges, adapting source-fixture harnesses and verifying the
actual DPF closure form one accepted consumer migration. Shipping a manifest
alone would not establish adoption; shipping retirement alone would break callers.
All phases below are internal sequencing for BI-FCDCAE98. Other component-family
adoption and DPF2 implementation are separately owned and excluded.

## Sequence and evidence

1. **Current source and old behavior.** Refresh main, compare the affected
   bodies with the immutable component, enumerate importers and preserve host
   fixes. Claim exact paths and consume the impact contract before edits.
   Run related-test lookup; add colocated and bounded import searches if sparse.
   Characterize the shape-conformance, graph/marking/receipt and interpreter tests.
   Add an identity/parity test that fails while bridges still have local bodies.
2. **Pinned artifact and receiving installation.** Add the exact Workroom
   candidate archive and source/integrity identity under validators/vendor.
   Declare one shared catalog entry in pnpm-workspace.yaml, dependencies in
   web/validators manifests, and regenerate the receiving pnpm lock. Update
   the Docker dependency COPY before frozen installation. Verify a clean lock
   install and package declarations with the actual DPF compiler/loader.
3. **Real caller and same-slice retirement.** Change shape-conformance's graph,
   receipt and process-ID imports to public artifact subpaths. Replace the nine
   implementation bodies named by the design with thin public exports. Preserve
   every symbol and compatibility meaning. Record actual remaining bridge users,
   DPF ownership and the caller-migration removal condition. Run V-PARITY.
4. **Isolated examples and loader closure.** Update Workroom/GPP/policy harnesses
   that currently copy the retired closure. Install only the exact package into
   their fresh temporary test receivers; preserve original fixture source and
   adverse scenarios. Verify direct package runtime/declaration imports, source
   loader paths and emitted NodeNext/bundler paths. Run V-LOADER.
5. **Review, integration and publication.** Complete independent scope/plan/code
   review and live coverage, or accurately retain the specifically authorized
   local-refactor exception and unrun native gates. Run affected unit tests,
   validators/web typechecks and every returned guard. Run the protected merged
   integration gate and relevant served nonproduction Workroom path through the
   governed shared target. Open the DCO PR, repair actual findings and merge only
   through protection/queue after `pnpm pr:health` passes. No deployment here.

## Functional checks

- **V-PARITY / AC-PILOT-1,2,5:** old/new conformance and graph/marking/receipt
  adverse/recovery vectors; artifact and every bridge expose identical functions;
  GPP interpretation and policy deadlines see the same graph IDs and receipt
  rules. Inventory proves no replaced implementation body remains live.
- **V-LOADER / AC-PILOT-3,4:** exact artifact SHA256/npm lock integrity, normal
  package install, all intended exports/declarations, real DPF source loader,
  emitted NodeNext and bundler imports; existing isolated scenarios still pass.
  Verify the archive is present before Docker frozen dependency installation.
- **V-INTEGRATION / AC-PILOT-4:** affected tests, validators/web typechecks,
  mandatory guards and protected merged-source gate; served relevant Workroom
  happy/adverse/recovery flow on the canonical or shared nonproduction target.
  Package tests do not claim actual browser/CSP or production qualification.
- **V-ROLLBACK / AC-PILOT-5:** a source-only rollback fixture/compatibility check
  confirms the prior import/dependency/body set reads the same durable contracts;
  no DB rewrite, permit widening or duplicate effect is used as a workaround.

## Backlog coverage

Atomic deliverable: `workroom-consumer`, BI-FCDCAE98, OBJ-PILOT,
AC-PILOT-1 through AC-PILOT-5, V-PARITY/V-LOADER/V-INTEGRATION/V-ROLLBACK.
Dependencies: delivered planning BI-66681CBB and qualified Workroom foundation
from BI-A574E138 under BI-B8A4DE44. Native immutable coverage is pending; this
section is not a receipt or a claim of plan completeness. Record coverage against
the committed plan and approved objective baseline before native implementation.

## Risks and rollback

Source-loader/declaration differences, incomplete bridge retirement, an absent
archive in the Docker dependency stage, or a changed legacy receipt/hash meaning
can break recovery despite fixture success. Treat those as migration failures,
not permission to duplicate a body or change current records. Revert the whole
consumer dependency/import/body slice through a protected PR when necessary.
The package candidates, other families, DPF2 and production remain independently
owned. Public package release and installation upgrades remain held.
