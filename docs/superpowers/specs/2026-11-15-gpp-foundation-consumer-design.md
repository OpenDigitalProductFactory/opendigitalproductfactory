# Receive the shared GPP toolkit in actual DPF callers

- **Backlog:** BI-2D3F986C; component maintainer BI-ABB5587B.
- **Workroom:** WC-6EF91A62; original Codex chat 01a14fdc-b10c-76c1-8e78-300d44226659.
- **Status:** proposed receiving design; implementation and independent approval unrun.
- **Parent:** [accepted extraction design, GPP section](2026-10-18-reusable-architecture-extraction-design.md#2-gpp-toolkit) and [existing phased plan](../plans/2026-10-18-reusable-architecture-extraction.md). This document applies that boundary to the existing receiving item; it does not replace the seven-family architecture.
- **Current source:** protected main dea3d8cf7b3a774f03a362275cad4825c20a420e. Judgment receiving PR7142 and Workroom receiving PR6821 are delivered dependencies, not work to repeat.

## Objectives and unchanged acceptance

**OBJ-GC-1:** Real DPF schema, compiler and tooling callers use one qualified portable GPP implementation, with displaced local implementations retired in the same slice.

**OBJ-GC-2:** Current canonical bytes, diagnostics, identity, stage effort and supported loaders retain incumbent behavior with closed, immutable dependency transport.

**OBJ-GC-3:** Host authority, persistence and effects retain their existing owners, with explicit evidence boundaries and a coupled rollback.

The statements below reproduce the existing item's six acceptance criteria. They add no new independent product or service.

| Acceptance ID | Objective IDs | Statement |
|---|---|---|
| AC-GC-01 | OBJ-GC-1 | Actual DPF GPP schema/compiler/tooling callers import the pinned shared GPP toolkit and displaced receiving bodies no longer implement a separately evolving compiler or serializer. |
| AC-GC-02 | OBJ-GC-2 | Runtime/declaration imports, exact immutable dependency closure and notices work in supported clean DPF installers, filtered Docker contexts, mobile/browser/server loaders and application-free receivers as applicable. |
| AC-GC-03 | OBJ-GC-2, OBJ-GC-3 | Canonical bytes, shape IDs, diagnostics, source mappings, binding/version/receipt vocabulary and supported ordinary/adverse/recovery behavior preserve incumbent parity; unsupported behavior stays explicit. |
| AC-GC-04 | OBJ-GC-1, OBJ-GC-3 | Acyclic GPP→Workroom/scoped-judgment ownership is preserved, every compatibility export has real callers/owner/tracking/removal condition, and no second orchestration engine or trusted enforcement owner is introduced. |
| AC-GC-05 | OBJ-GC-2, OBJ-GC-3 | Affected compiler/schema/conformance/guard tests and typechecks, protected integration/build and relevant governed served authoring/Workroom flows have exact-source evidence; unrun/native uncertain remain distinguished from pass. |
| AC-GC-06 | OBJ-GC-3 | Revert restores the prior coupled manifest/lock/import/body set without changing persisted process records or host authority. DPF keeps current admission, revocation, human decision attribution, protected lineage and effect/result transactions. |

## Observed source and reproduction

The parent design's original web-file inventory is historical. Current portable bodies are in `packages/validators/src/gpp/`; current host policy, ratification and source-fact adapters remain in web. The actual generator `apps/web/scripts/build-gpp-shapes.ts` compiles registered current and frozen prior documents, publishes the JSON schema and verifies generated artifacts. `packages/validators/package.json` exposes the local GPP subpaths consumed by real registry, scheduler and compiler code. The receiving inventory must enumerate actual current imports before replacement, rather than restore old web bodies.

Historical GPP candidate4 has 22 public ESM entries and exact Workroom candidate4/scoped-judgment candidate2 dependencies. Actual DPF main now carries Workroom candidate5 and judgment candidate3. Its three portable semantic changes are the optional stage-effort schema, lowering and structural contract. Canonical JSON is byte-identical; candidate4 already includes the camelCase tool correction.

A new application-free differential ran on Node24.16 against a nonsymlink clean install of the immutable candidate4 archive, SHA256 `ed8b36f6c96945248c857d7d7724e7fa45f09f3c8899a1e711cef09bff60bc2c`, with its original pinned foundation dependencies. Four valid effort values are rejected by its strict schema and dropped by its raw lowering; current DPF admits and preserves them. Absent effort lowers identically; three invalid values refuse in both; two camelCase tools pass in both. These ten cases are preserved in `GPP4-CURRENT-EFFORT-DIFFERENTIAL-20261115.json`, result SHA256 `ecde9b1fbb74bf107be3046c1ef148940530832e32ca493d0bfc9c5105ebfb04`, and native research receipt `initiative-af1b2f9a-5342-4f2b-9f7c-2fad9512c38b`.

This establishes a real compatibility gap. It is not a new candidate qualification, current W5/J3 combined matrix or historical 33-group matrix rerun. The earlier unbound research write was refused; the research receipt above followed normal source/workroom binding and exact protected-main selection.

## Research and chosen boundary

| Comparable primary implementation | What this design adopts | What it rejects and why |
|---|---|---|
| [Zod JSON Schema](https://zod.dev/json-schema) generates JSON Schema from its typed definition. | Keep the current pinned Zod schema as one implementation and qualify exact JSON-schema output. | A second hand-maintained validator/schema body would duplicate strictness, diagnostics and effort vocabulary. |
| [Ajv standalone validation](https://ajv.js.org/standalone) separates build-time generation from runtime validation with explicit generated closure limitations. | Require clean-installed declaration/runtime closure and separate browser/compiler entry qualification. | Adding Ajv or a generated replacement validator is unnecessary; it would replace established GPP diagnostics and create a second maintenance owner. |
| [XState pure transitions](https://stately.ai/docs/pure-transitions) calculate state and intended actions without executing actor effects. | Preserve the already extracted Workroom pure-state/host-effect boundary. | Adding XState or another actor runtime would duplicate the current Workroom executor and authorization boundary. |

Use the existing JSON Schema output contract, Node public exports and TypeScript NodeNext package declarations. GPP's duplicate-key, BOM, CRLF, depth and stable-diagnostic rules remain project-specific canonical-byte requirements. This work adds none of the compared libraries. The industry examples support the chosen boundary, not interchangeability with GPP.

## Delivery boundary and dependency order

1. **Qualify the component under existing BI-ABB5587B.** Reconcile its admitted component workroom to actual candidate4 source before writing. Preserve all old archives. Produce a new immutable candidate that carries the current optional effort schema/lowering/contracts, exact compatible Workroom5/judgment3 closure and actual receiving-loader qualification. Current source identity, notices and modifications enter provenance; do not rename old receipts.
2. **Approve and plan the actual receiver under this item.** Independently approve this design and record normal exact plan coverage before implementation. The component qualification is a dependency with its own existing item, not a duplicate receiving intake. Do not take over abandoned extraction WC-B8197971 or restart completed extraction/pilot items.
3. **Adopt one coherent artifact set.** Update the existing root/web/validators/mobile installer and Docker transport where the actual inventory proves them applicable. Use the current closed installer machinery and dependency policy. Match real imports and runtime/declaration loaders before replacing bodies.
4. **Move real callers and retire displaced bodies together.** The generator, schema and compiler/tooling entry points import public shared entries directly. Any retained compatibility exports contain identity-preserving exports, with exact callers, owner and removal condition recorded. No second GPP facade service or pure implementation remains behind those exports.
5. **Qualify the assembled receiving change.** Preserve exact source-generated schema, current/prior emitted bytes, digests, diagnostics, mappings and binding semantics. Exercise normal and adverse authoring/compiler behavior, supported reference recovery and actual governed served Workroom behavior with current runtime ownership.
6. **Protected delivery and reconciliation.** Current source-local tests/types, shared integration, independent exact-source review, protected PR/queue and actual applicable receiving acceptance remain separate evidence. Record actual caller removals and retained host responsibilities. Reconcile both original receiving custody and this item before retirement.

This is internal sequencing, not approval to implement. The implementation plan must classify which deliverables are independently shippable and map them to the two existing items; no new backlog decomposition is presumed.

## Compatibility and authority invariants

- Stage effort is optional, with exactly minimal/low/medium/high values. Preserve absence and declared values through parse/lower/emit/decompile. Do not change existing schema identities, signed hashes or persisted records to accommodate extraction.
- The host's governed-decision high floor, effort warrant, scheduling policy and grants remain owned by the existing host, per [stage-effort design](2026-10-01-stage-effort-tier-design.md). The portable schema carries metadata; it grants no reach.
- GPP depends downward on Workroom and scoped judgment. Existing Workroom transition/receipt/process identity ownership is reused. Judgment remains a leaf.
- Resolve current and prior shape documents against trusted injected facts. Keep the host registry, datastore, permit issue/consume/revoke, human decision attribution, protected lineage and effect/result transactions in DPF.
- Check actual Next CommonJS TypeScript hooks and browser/mobile boundaries before selecting export conditions. If require support is needed, qualify one synchronous ESM implementation and shared values on admitted Node versions; do not add a parallel CommonJS implementation.
- Node20 dependency-free guards cannot begin loading unsupported runtime ESM. Reuse the existing verified generated-guard mechanism if actual dependency impact requires it, bound to immutable archive/provenance/file hashes; otherwise record the evidence for no effect.
- Canonical JSON replacement is permitted only for byte-identical callers with complete import closure. Preserve independently versioned signing/hashing semantics. Do not redirect every hash helper merely because its name is similar.
- The compiler emits draft bindings and synthetic structural observations, not a human approval or production permit. Existing not-evaluated GPP checks and unsupported combined-envelope behavior retain those limits.
- DPF2 remains read-only. Historical W4/J2/GPP4 receiving evidence stays historical; a newly qualified set carries its own matrix. No deployment, public npm release, credential/grant change, migration or production business-data write belongs in this slice.

## Verification and stop conditions

| Boundary | Required observable proof |
|---|---|
| Component current-source closure | New immutable tarball/source provenance, package tests/types, clean installed Node/declaration/browser/compiler tests and current exact foundation dependency identity. Four valid effort cases change from demonstrated RED to preserved GREEN; invalid cases remain refused. |
| Current DPF callers | Exact import/body inventory, direct real generator/schema/compiler use, identity-preserving compatibility exports and same-slice retired implementations. |
| Transport/loaders | Actual clean installers and applicable filtered Docker/mobile/browser/server/Next hook checks; closed exports and immutable archive hash validation. No alias/symlink shortcut. |
| Semantic parity | Current/prior schema and emitted bytes, stable IDs/pointers/diagnostics, source mapping, bindings/receipt vocabulary, ordinary/adverse/reference recovery and unchanged host high floor. |
| Receiving delivery | Affected local tests/types, current governed integration/build, independent source review, protected source/queue checks and applicable served authoring/Workroom proof under a fresh admitted lease. |
| Completion | Exact native evidence and custody/rollback/removal manifests, normal scope/runtime release and remaining obligations explicitly reconciled. |

An unavailable runtime is inconclusive/unrun. Missing source, declaration, grant, topology or immutable evidence refuses the affected step. Stop on an actual denied operation and follow its recorded owner remedy. Do not weaken tests, grant oneself access, copy private credentials, edit migration history or replace a required actual runtime check with synthetic proof.

The canonical preview repair and designated actuator installation are dependencies of real served acceptance, not of source research or portable component checks. Its old uncertain preview and original host execution are preserved; this receiver cannot settle them by importing a package.

## Owner, publication and rollback

Accountable module maintainer remains the existing repository code owner `@markdbodman`; no new team or service is created. Existing component-maintainer and receiving workrooms retain their actual scopes. The connected GitHub app's selected-repository access currently omits the three component repositories. Component PR creation remains blocked until its owner supplies the recorded access remedy; preserved source/archives do not imply a merged release.

Rollback reverts the coupled archive/manifest/lock/import/body/generated-output set through one protected receiver source revert. It restores the incumbent implementation without changing persisted process records, authority or historical evidence. A separately delivered component remains immutable and unused after receiver rollback. Actual incompatible persisted effects would require their own owner-led recovery, not an unreviewed source revert.

The final receiving manifest names exact source and archive hashes, all public entry mappings, current import closure, loader/toolchain evidence, real removed bodies, compatibility owners/removal conditions, supported and unsupported behavior, trusted host adapters, notices and rollback. It is required before this objective is terminal.
