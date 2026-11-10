---
status: draft
---

# Native productivity: documents, Workbooks and diagrams

Date: 2026-10-11. Parent: **BI-C03605C4**. Epic: **EP-8DC217EB**.
Workroom: **WC-28624802**. Kernel decision: **DI-26225E93A768**.

This extends [the office document engine design](2026-09-22-office-document-conversion-design.md), BI-815D40C6. That engine and its export/rendition contracts remain canonical. This successor adds PDF editing and shared artifact handoffs; it does not reimplement delivered office export or diagram exchange. Independent design review and implementation authorization remain pending.

## 1. Operator intent and decision

The operator approved selective ArtCraft absorption into DPF, then asked to consolidate the existing Smartsheet-like Workbooks and diagramming capabilities. The outcome is a coherent productivity workspace for humans and AI coworkers: a business brief becomes a sheet, diagram or document; those sources can produce a customer packet; a person reviews and revises the result in the same work context.

Kernel consultation compared extending native contracts, forking the complete suite, and desktop links alone. It recommended `extend-native-contracts`, high confidence, autonomy eligible, without a commandment conflict. Grounding in existing substrate and single source of truth were its strongest contributors. This records an architectural direction, not an external-engine qualification or a release acceptance.

For this request the operator's explicit allocation takes precedence over the doctrine's default ratio: reserve at least roughly **20% of implementation effort for refactoring** shared contracts, controls and duplicate processing paths. Track that effort in the slice evidence; do not manufacture token-accounting precision.

## 2. Objectives

- **OBJ-NP-NATIVE:** Extend existing canonical sources, managed document versions and one-shot document execution instead of adding a second office suite or artifact database.
- **OBJ-NP-PDF:** Let authorized humans and coworkers assemble and revise PDF customer packets while retaining original bytes and source-version provenance.
- **OBJ-NP-HANDOFF:** Connect native sheets, semantic diagrams and generated documents through one discoverable, version-aware artifact workflow.
- **OBJ-NP-CONTROL:** Apply the same authorization, input validation, execution bounds, stale-version checks and receipts to human and coworker operations.
- **OBJ-NP-QUALIFY:** Qualify only the upstream source required by an observed workflow, with license notices, a pinned revision and a measured retirement plan.

## 3. Existing substrate and boundaries

The source audit was made on `b5746e858bc7a796175aa70069e0bd676b48c296`. Live backlog reads confirmed the existing office-engine umbrella and its S4-S8 successors. The source install does not ship the spec corpus; local source inspection supplies the design evidence.

| Existing owner | Evidence | Decision |
| --- | --- | --- |
| Workbooks | `apps/web/lib/workbooks/workbook-service.ts`, `export-workbook.ts`, `export-fods.ts`; `/workbooks` | Keep table, row, formula, view and source-record semantics. Export snapshots through the existing engine. A spreadsheet is not replaced by an opaque file. |
| EA diagrams | `apps/web/lib/ea/view-drawing-export.ts`; `/ea/views/[id]`; BI-4C17BF51 | Keep semantic element IDs and view geometry. `saveEaViewDrawing` already stores a drawing Document and tags its originating EA view. Extend that handoff; do not replace the model with vector shapes. |
| Managed files | `packages/db/prisma/schema/knowledge-docs.prisma`; `document-store.ts`, `blob-storage.ts`, `document-previews.ts` | Reuse Document, DocumentVersion, DocumentBlob, DocumentReference and DocumentRendition. Versions and rendered page previews remain the artifact spine. |
| Generated artifacts | `apps/web/lib/documents/generation/render-store.ts`; BI-3A0E5413, BI-543819B1 | Reuse saving, indexing and rendition creation. A generated packet's source PDF is editable through new operations; office generation remains separate. |
| Isolated engine | `Dockerfile.doctools`, `tools/doctools/`, `documents/conversion/convert.ts`, `command.ts`, `image.ts` | Extend the DPF-owned, digest-pinned one-shot engine only after qualification. Reuse budgets, non-root/no-network execution and failure vocabulary. |
| Governed actions | `mcp-governed-execute.ts`, document tool pack, authorized surface registry | UI and coworker projections enter the same governed operation. Engine tool discovery never grants authority. |
| Existing dependency retirement | BI-D1B40D43, BI-0AB1FD47, BI-DBDB8C6D | Coordinate with their owners. Do not claim parser or diagram-rendering retirement as new work or as complete here. |

DocumentReference supports document/version targets and `targetExternalRef`. Use canonical application routes for native source references where appropriate, validating the target and its owning organization's authority. Existing tags are discovery hints, not authorization. Before any schema extension, prove the existing references cannot express the required lineage. Do not add a generic asset, editor-session or productivity-workspace table by default.

Non-goals for the first delivery: a universal drawing engine, replacement of spreadsheet formulas, automatic inference of EA semantics from arbitrary shapes, seven embedded desktop editors, multiplayer editing, OCR, redaction, signing, public publishing or a separate office-suite account system. A freeform illustration may be a managed file; it is not automatically an EA model.

## 4. PDF operation contract

Extend the managed-document domain with a typed operation request for combine, extract, reorder and rotate. The public request names authorized DocumentVersion identities, page ranges and operation parameters; it never accepts a caller-supplied host path, binary command or arbitrary engine method. A combine creates a packet Document by default. A revision names its destination Document and expected current version.

Resolve every input and authorize reading it before materializing bytes. Authorize destination writes independently. Record exact source-version references, then run the selected operation with a per-job workspace and immutable input bytes. Validate the output as a PDF, inspect page count/order and recoverability, and only then commit its content-addressed blob, new DocumentVersion, references and action receipt. Customer documents remain inside their organization's boundary.

The existing store does not yet prove an expected-version write fence. This successor must implement and test a transaction-level compare-and-save using the destination's expected current version; a UI-only check is insufficient. Concurrent human/coworker saves produce an explicit conflict with reload or save-copy recovery, never silent overwrite.

Use the existing durable action/receipt mechanism for idempotent publication. An operation identity binds the principal, organization, immutable inputs, destination, expected version and normalized parameters. Unknown commit outcomes reconcile against the receipt before replay. Do not add a parallel job scheduler or audit table. A retry may repeat bounded computation but cannot append a duplicate committed version.

Rendering, extraction and PDF manipulation are independently selectable capabilities behind the DPF contract. CLI/MCP interfaces are evaluation evidence, not a requirement to launch long-lived stdio servers. The currently audited external-MCP executor explicitly does not support stdio execution; this design does not bypass that limitation by spawning an unrestricted Windows process from the portal.

## 5. Human and coworker experience

Use a common artifact header and action vocabulary across the existing routes: source identity, current version/revision, saved status, related work, and permitted actions. Default actions are **Preview**, **Revise**, **Export** and **Ask coworker**, shown only when supported and authorized. Format-specific tools appear after entering the appropriate editor. The shared shell does not flatten editor semantics.

For PDFs, show an accessible page-thumbnail rail and readable preview, with selected-page count, move/rotate/extract operations and a clear save-new-version action. Keyboard users can select and move pages without dragging. Distinguish rotating the view from changing the saved page. Show source versions and page count before committing a combined packet. Sensitive actions outside this first scope are not advertised as available.

For sheets, keep the current native grid, formulas and views. Export produces a managed snapshot with an explicit originating Workbook reference. For diagrams, keep the EA canvas and semantic properties; display existing generated artifacts with a return-to-source action. Discoverability can be consolidated in the existing workspace routes, but no new global navigation hierarchy is assumed until measured UX comparison.

Common states: loading; ready; unsaved changes; operation running; save conflict; engine unavailable; failed with retained inputs. Errors state the failed outcome and a concrete recovery. Never represent an absent engine as success or discard unsaved work. Preview loading remains governed by the existing version-bound rendition manifest and durable event observation contract.

Use `--dpf-*` theme tokens, report-kit for artifact lists and status, semantic controls, visible keyboard focus, responsive layouts and an equivalent authorized coworker surface. Measure UX fit on the served target. The first archetype examples are professional-services customer packets and trades job packets; archetype-specific templates remain recommendations through existing occupation skills and grants, not platform-global assumptions.

## 6. Runtime, compatibility and dependency posture

Selected Rust source may be absorbed into a small DPF PDF command within the existing doctools image, or retained as a pinned build input with a narrow patch set if full extraction would increase maintenance. Qualification chooses that boundary by inspecting crate dependencies and required operations. A separate always-on ArtCraft service, complete GUI image or office subscription is not part of the design.

A narrow fork is justified only for an identified requirement that cannot be met through the existing engine API. Keep upstream origin, exact revision, notices and patches discoverable. Contribute general fixes upstream when useful. DPF owns its business workflow and compatibility contract; it does not promise full Acrobat or Photoshop parity.

Require a before/after dependency and image-size ledger. Retire a duplicate PDF extraction/rendering path only after an independently verified corpus demonstrates equivalence. The existing LibreOffice engine remains for office formats; PdfCraft cannot replace it merely because it reads PDFs. If selected Rust source adds more than it retires, revise the absorption scope or retain the existing implementation. No new container image/service is justified by this request alone.

There is no data migration in design capture. Runtime delivery is an additive engine command and governed action; existing versions remain readable. Old engine images return a typed unsupported/unavailable result. Release convergence uses the existing image lineage/resolver and self-upgrade contracts, never a D: path or mutable latest tag. Rollback disables the new operation while retaining every saved DocumentVersion and its references.

Affected deployment contracts: release artifacts (1), runtime configuration (2), lifecycle (3), identity (4), build execution (6), observability (7), secrets (8), and client/API surfaces (10). DPF-owned tool-image release and document action projections inherit those contracts. Cross-platform containment and the platform-support watchlist must be verified before release.

## 7. Research and benchmarking

| Comparator | Model or behavior inspected | Adopt | Reject or defer |
| --- | --- | --- | --- |
| [PdfCraft v0.6.0 source](https://github.com/storytold/pdfcraft/tree/v0.6.0) | Engine sessions hold PDF documents and undoable edits; automation calls operate on document IDs and save explicitly; the CLI has root-scoped automation. | Engine-first manipulation, explicit commit and replaceable command boundary. | Full desktop chrome, arbitrary method exposure, unqualified redaction/signatures. |
| [Excalidraw JSON model](https://docs.excalidraw.com/docs/codebase/json-schema/) | A scene carries schema version, elements, appState and files. | Preserve editable structured source with explicit schema version; keep assets addressable. | Treating every scene shape as an enterprise architecture entity. |
| [LibreOffice engine](https://api.libreoffice.org/) and the prior office-engine design | Writer/Calc/Impress/Draw document families are projected through one DPF conversion/rendering facility. | Reuse existing office-format fidelity and isolated execution. | Replacing the suite engine with a PDF-only library. |
| [Smartsheet attachments](https://help.smartsheet.com/articles/518408-uploading-attachments) | Files attach to sheets/rows, with version-aware access beside structured work. | Contextual artifact navigation and source links. | A second attachment/version store beside DocumentVersion. |
| [Miro board items](https://developers.miro.com/docs/board-items) | Typed board items include documents, images and app cards. | Related content alongside the native work surface. | An opaque embedded canvas owning DPF identity or authorization. |
| [Acrobat page organization](https://experienceleague.adobe.com/en/docs/document-cloud-learn/acrobat-learning/get-started/create/organize) | Page operations include reorder, extract and rotate. | A focused, visual page organizer with clear saved effect. | Cloud storage as the document authority or an assertion of complete feature parity. |

[tldraw persistence](https://tldraw.dev/docs/persistence) additionally separates document snapshots from per-user camera/selection state. Adopt that separation as a design pattern; no tldraw dependency is proposed.

### Functional probe, not release qualification

On 2026-10-11, the installed Windows x64 PdfCraft 0.6.0 passed eight synthetic checks: JSON info, text extraction, two-page extraction, five-page combination, page-2 rotation, first-page PNG rendering, refusal to open a file outside an automation root, and original-input hash preservation. Page counts and saved rotation were checked independently with pypdf. The rendered cover was visually inspected. No customer data was used.

Reproducible local probe: `D:\DPF-scratch\artcraft-qualification\qualify_pdfcraft.py`; report: `results.json` in that directory. The probe uses reportlab/pypdf in the bundled artifact runtime, not new DPF dependencies. This is Windows evidence only. Linux engine builds, encrypted/malformed files, font/image fidelity, high-page-count bounds, worker recovery, tenant isolation and production workflow acceptance remain unrun. Capture the final reusable corpus in the qualification slice after its plan is authorized.

License and redistribution review must bind to the selected upstream revision and its dependency/asset inventory. Project code and brand marks are separate obligations; carry required notices and use DPF's own interface identity. Source availability alone is not an approval.

## 8. Acceptance contract

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-NP-001 | OBJ-NP-NATIVE, OBJ-NP-HANDOFF | Workbook records/formulas and EA element identities remain canonical while their generated Documents expose validated return-to-source references. |
| AC-NP-002 | OBJ-NP-PDF | Combining authorized immutable PDF versions creates one managed customer packet with the expected page order/count and explicit input-version references. |
| AC-NP-003 | OBJ-NP-PDF, OBJ-NP-CONTROL | Extract, reorder and rotate save a new version without modifying original input bytes. |
| AC-NP-004 | OBJ-NP-CONTROL | Human and coworker calls use the same governed action; cross-organization input reads and destination writes are refused. |
| AC-NP-005 | OBJ-NP-CONTROL | A stale expected-version save is refused and an uncertain/retried operation does not append duplicate committed output. |
| AC-NP-006 | OBJ-NP-CONTROL | Engine jobs enforce no network, no host paths, non-root execution, timeout/input/output/concurrency bounds and deterministic recovery. |
| AC-NP-007 | OBJ-NP-HANDOFF | Preview, source navigation, revise and export are keyboard accessible and usable in light/dark and narrow layouts on the served target. |
| AC-NP-008 | OBJ-NP-HANDOFF, OBJ-NP-CONTROL | Engine-unavailable and conflict states preserve source content and present actionable recovery without a false success. |
| AC-NP-009 | OBJ-NP-QUALIFY | The absorbed source has an immutable upstream reference, license/asset inventory, evaluated dependency disposition and independent runtime qualification. |
| AC-NP-010 | OBJ-NP-NATIVE, OBJ-NP-QUALIFY | The measured dependency/size ledger names the superseded implementation; no parallel office store, always-on service or second tool image is added. |
| AC-NP-011 | OBJ-NP-HANDOFF | A professional-services or trades coworker produces a reviewable packet from native work sources with a human revision handoff. |

## 9. Delivery boundaries

- **BI-5D5AB47E:** qualification and dependency/retirement disposition, independently reviewable; no runtime source bundling.
- **BI-3F319D83:** native PDF packet operation, managed saves and page organization; blocked by qualification and independent design/plan authorization.
- **BI-EBDB6CAE:** shared native artifact handoff; reuses BI-4865EB4D export and BI-4C17BF51 diagram exchange.

These are independently shippable children of BI-C03605C4, not hidden Markdown follow-ups. PhotoCraft is a later candidate using the same contracts; no photo-editor or seven-app fork implementation is claimed by this first plan.

## 10. Design grounding and verification

Grounding: prior office-engine design/plan, canonical Document models, native Workbooks/EA export implementation, authorized surface registry, shared process budgets and source-lineage resolution. No parallel utility or data store is justified by the audit. Document-only capture has no runtime/schema effects.

Each runtime slice owes meaningful behavior tests, affected typechecks, independent output inspection, shared-runtime functional verification and measured UX fit. Tenant boundaries, transaction-level concurrency and idempotent uncertain outcomes are mandatory tests; mirroring implementation details is not sufficient. Capture snapshots and failure cases, not just happy-path screenshots. Record skipped or inconclusive checks as such. External-source adoption, release publication and terminal backlog states remain gated by the actual receipts.
