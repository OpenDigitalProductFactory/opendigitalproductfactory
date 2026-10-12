---
status: proposed
---

# Native productivity absorption delivery plan

Parent: **BI-C03605C4**. Workroom: **WC-28624802**.
Design: [native productivity](../specs/2026-10-11-native-productivity-artcraft-absorption-design.md).
Existing engine: [office conversion plan](2026-09-22-office-document-conversion-plan.md).
Decision: **DI-26225E93A768**, `extend-native-contracts`.

For agentic workers: execute this plan one independently reviewable backlog item at a time: one BI, one branch, one PR. Use `dpf-tdd` for behavior changes, `dpf-local-merge-ci-before-push` and the slice's completion gate for verification, and `dpf-pr-with-dco` for delivery. A gate that could not run is not a pass.

## Current admission

Design capture is underway. The eight Windows synthetic PdfCraft checks passed; they are not engine/runtime acceptance. Independent research/spec/architecture/plan reviews and provider-verified plan coverage are pending. Do not implement runtime source adoption against this proposed plan until its exact immutable coverage is valid. Do not downgrade the parent xlarge scope to bypass decomposition.

## Deliverable graph and traceability

| Slice | Live item | Dependency | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- | --- | --- |
| Q: selected source qualification | BI-5D5AB47E | Existing BI-815D40C6 engine contract | AC-NP-009, AC-NP-010 | Dockerfile.doctools; tools/doctools/; documents/conversion/image.ts | F-NP-QUALIFY | V-NP-CORPUS; V-NP-LICENSE; V-NP-FOOTPRINT |
| P: native PDF packet editing | BI-3F319D83 | BI-5D5AB47E | AC-NP-002, AC-NP-003, AC-NP-004, AC-NP-005, AC-NP-006, AC-NP-008, AC-NP-011 | document-store.ts; documents/conversion/command.ts; authorized-surface-registry.ts | F-NP-PACKET; F-NP-REVISION | V-NP-PACKET; V-NP-TENANT; V-NP-CONFLICT; V-NP-RUNTIME |
| H: shared artifact handoff | BI-EBDB6CAE | Existing BI-4865EB4D and BI-4C17BF51 | AC-NP-001, AC-NP-007, AC-NP-008, AC-NP-011 | export-workbook.ts; view-drawing-export.ts; knowledge-docs.prisma | F-NP-HANDOFF | V-NP-SOURCE; V-NP-UX; V-NP-RUNTIME |

Each slice is independently shippable and maps to a live BI. PDF runtime bundling waits for Q. H can improve existing source/artifact navigation without waiting for a PDF engine. Existing S4/S5/S8 work is reused, not re-filed or re-delivered by this plan.

## Q: qualify the selected engine

Inspect the exact PdfCraft v0.6.0 commit, relevant engine/automation crates, dependency closure, notices and bundled assets. Preserve a reproducible synthetic corpus and independent validators in the approved qualification scope. Test extraction, reorder, rotation, combine, malformed/encrypted inputs, reference preservation, root confinement, page/input/output caps and renderer/font/image fidelity. Source the security/license evaluation through the existing tool-evaluation and reviewer lanes; a local startup check is not that receipt.

**F-NP-QUALIFY:** immutable source -> license/dependency inventory -> bounded worker build -> independent corpus validation -> dependency retirement decision -> evaluation disposition.

**V-NP-CORPUS:** independent output inspection checks page count, order, text, orientation, image/font behavior and unchanged input hashes. Run against the intended Linux worker and supported host shapes; mark unrun shapes explicitly.
**V-NP-LICENSE:** record code, asset and transitive dependency obligations with the exact source revision and required notices.
**V-NP-FOOTPRINT:** compare engine dependencies/image bytes and identify what retires. Reject an unqualified replacement or a net-expanded adjacent suite.

Paths: `Dockerfile.doctools`, `tools/doctools/`, `apps/web/lib/documents/conversion/image.ts`, source-lineage/release contracts, existing evaluation records. Q does not add runtime source before evaluation passes.

## P: governed PDF operations

First refactor the existing execution budget and save path into the smallest reusable seams. Add the typed PDF operations behind the same engine contract. Read immutable authorized versions, run the isolated command, independently validate output, then commit version, source references and receipt through existing document storage. Add a transaction-level expected-version fence and reuse durable idempotency receipts; do not create a second scheduler/store.

**F-NP-PACKET:** select authorized source versions -> show order/provenance -> combine -> validate -> create managed packet -> preview and human handoff.
**F-NP-REVISION:** load immutable version -> organize pages -> compare expected version -> save new version or return conflict -> reconcile any uncertain commit.

**V-NP-PACKET:** fixtures prove extraction, reorder, rotation and assembly, preserving source hashes; validate persisted page order/content with an independent reader.
**V-NP-TENANT:** denied cross-organization inputs and destinations never materialize unauthorized blobs or run an engine command.
**V-NP-CONFLICT:** concurrent human/coworker saves and lost-response retry cannot overwrite or duplicate committed versions.
**V-NP-RUNTIME:** exercise the happy path and unavailable/time-out/conflict recovery on a governed served target; verify containment and release image identity.

Paths: `apps/web/lib/documents/`, existing document MCP pack and authorized-surface projector, document detail route, `tools/doctools/` and its image. Claim exact edit paths and consume changeImpactContract before Red. Keep the domain module and UI thin enough for the existing module-size guard.

## H: shared source and artifact handoff

Compose the shared artifact header, permitted actions and source provenance into existing routes. Reuse generated drawing Documents and workbook export generation. Where a workbook download currently has no managed snapshot, add a save-through-existing-store option instead of another asset model. Source links validate organization and actual identity; tags are not grants. Keep view/camera/selection state outside saved business content.

**F-NP-HANDOFF:** native sheet or EA view -> generate/export selected snapshot -> managed Document preview -> return to canonical source or include its immutable version in a packet.

**V-NP-SOURCE:** export and return navigation preserve Workbook/formula and EaElement identities; unknown or unauthorized references are refused.
**V-NP-UX:** measured served-route review covers light/dark, keyboard use, narrow layouts, page selection, action discoverability and realistic empty/failure states. Common actions reuse theme tokens/report-kit and share the authorized coworker projection.

Paths: existing `/workbooks`, `/ea/views` and `/workspace/documents` routes; `export-workbook.ts`, `view-drawing-export.ts`, managed-document references, shared UI primitives. Do not add a new global navigation route until its comparison has measured justification.

## Refactoring allocation and rollback

Reserve at least roughly 20% of each implementation slice for shared-contract consolidation, duplicate-path retirement and common interaction components, per operator instruction. Record what was removed and what now has one owner. Keep spreadsheet and EA domain models separate where their semantics differ.

Rollback disables new PDF operations and removes only new UI entry points. Preserve every committed DocumentVersion, its blobs and source references; leave existing exports and engine behavior working. Unavailable old images return a typed unsupported result. No destructive migration is part of this plan.

## Backlog coverage

Proposed decision: **decomposed**. Parent BI-C03605C4 maps Q to BI-5D5AB47E, P to BI-3F319D83, H to BI-EBDB6CAE. P depends on Q; H reuses BI-4865EB4D and BI-4C17BF51. The governed coverage receipt is **pending** independent scope approval and the provider-verified immutable plan. A Markdown table is not a receipt. Copy the returned receipt here only after the server validates the current design baseline and exact plan blob.

## Capture verification

The initial edit-path changeImpactContract is resolved and documentation-only. It requires the generated doc index check; no runtime tests are inferred from it. Regenerate `apps/web/lib/docs/doc-index.generated.json` for these added docs and run its check plus applicable docs guards. Before any runtime edit, obtain a new scope claim and its testImpact/guardObligations. The present worktree is source-only until the managed readiness probe says otherwise; do not claim typecheck or build passes from structural dependency presence.
