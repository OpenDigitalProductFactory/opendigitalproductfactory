---
status: draft
---

# GPP Phase 3a and 3b: shape document, decompiler, compiler

| | |
|---|---|
| Date | 2026-10-02 |
| Design | [GPP shape notation, execution semantics and compiler](../specs/2026-10-02-gpp-shape-notation-and-compiler-design.md), §4 document, §5.4 executable subset, §6 semantics, §7 compiler, §10 migration, §11 phases, §12 baseline |
| Parent design | [GPP model to execution](../specs/2026-10-01-gpp-model-to-execution-design.md). Not edited by this plan or by any PR in it. |
| Prior phase | [GPP Phase 2: shadow permits, then per-binding enforcement](2026-10-01-gpp-phase-2-permits-and-enforcement.md) |
| Epic | EP-B932453F |
| Backlog | BI-6DA17863 slice 1 (Phase 3a) and slice 2 (Phase 3b). A follow-up touches BI-69415B68 (see "Out of scope for 3b"). |
| Decision relied on | DI-035897A0F1D6 (WWMD): the source of truth is a JSON-Schema superset of `WorkShapeDefinition`; BPMN subset and SysML v2 are export formats only |
| Scope baseline | `baseline-699e82bc-1075-45f1-91e7-1c2b9c2aa9cb` (minted from the spec at `d644cf948`) |
| Standard | [GPP](../../architecture/gated-permissions-process.md) §7, §10, §12.4 |
| Verified against | `origin/main` at `86b3f2c027` |

## Outcome

At the end of Phase 3a, every one of the 51 registered work-shape definitions (47 current, 4 frozen
prior versions) can be written as a shape document that validates against a published JSON Schema.
Lowering that document back to a definition reproduces the original field for field. Nothing is
migrated, and no runtime file changes.

At the end of Phase 3b, a compiler turns a document into the TypeScript the runtime already reads.
Before it emits anything it runs the design-rule checks (DRC) C-1 to C-9, the soundness rules S-1 to
S-6 and D-1 to D-8, and it refuses any construct the drive does not execute. Generated files are
committed and integrity-checked in CI. One shape is migrated, as a proof, behind the L1 equality gate.
Every other shape stays hand-declared.

## Constraints (founder, binding on every PR)

1. **No disruption to running rooms.** No PR changes what the drive, the dispatcher, the room
   projection, the rebind planner or the conformance checks see, with one exception: the proof
   migration (PR-3b-6). That PR must show the definition is unchanged under L1, the binding diff
   classification is `unchanged`, and every existing work-shape test passes without edits. Shapes
   stay code-declared. The compiler is offline tooling until a shape passes L1.
2. **No new dependency.** Zod is already a dependency of `apps/web` (`"zod": "catalog:"`, catalog
   `^4.6.5`, locked at `4.6.5`). Zod 4's `z.toJSONSchema(..., { target: "draft-2020-12" })` is
   already used on main (`packages/validators/src/trusted-agent-contracts.ts:201`). No workspace
   `package.json` declares a JSON Schema validator (`ajv`, `@cfworker/json-schema` or similar), and
   none is added. No property-testing package (`fast-check`) is present, so generated sequences use a
   seeded PRNG written in the test. `tsx` is a root devDependency (`"tsx": "catalog:"`), and
   `apps/web` scripts already invoke it.
3. **Build Studio is untouched in Phase 3.** No PR edits a file under `apps/web/lib/build/`,
   `apps/web/lib/explore/`, the Build Studio MCP packs or the Build Studio routes. C-8 is reported as
   information, citing the existing `direct-phase-writes-ratchet.test.ts`, which is only read. Build
   Studio as a declared shape is Phase 5 and needs its own BI.
4. **The parent spec is not edited.** Where this plan refines the child spec, it says so in "Spec
   refinements and open questions". It does not change the spec in these PRs either.
5. **The compiler never writes `GPP_BINDING_ENFORCEMENT`** and never adds to `GPP_BINDINGS`
   (`apps/web/lib/gpp/bindings.ts`) in Phase 3a or 3b.

## Facts this plan is built on (origin/main `86b3f2c027`)

Every path and symbol below was read on `origin/main`. `git log e2d22ad43..origin/main` shows no
commit under `apps/web/lib/work-management/` or `apps/web/lib/gpp/`, so the spec's counts (taken by
importing the registry at `e2d22ad43`) still describe main. They were not re-imported for this plan.

**Registry and type**

- `WorkShapeDefinition`, `WorkShapeStage`, `WorkShapeAdvance` and `WorkShapeStopCondition` are
  `export type` aliases in `apps/web/lib/work-management/work-shapes.ts` (lines 53–154).
  `WorkShapeStage.tools` is optional, and absent means undeclared.
- `ALL_SHAPES` (line 274) is a non-exported `Record<string, WorkShapeDefinition>`. It spreads, in this
  order: `SHAPES` (the anchor), `STANDING_SHAPES`, `COWORKER_STANDING_SHAPES`,
  `COWORKER_STANDING_SHAPES_OPERATE`, `COWORKER_STANDING_SHAPES_CRAFT`, `DELIVERY_SHAPES`,
  `ORCHESTRATION_SHAPES`. `listWorkShapes()` returns `Object.values(ALL_SHAPES)`, so registry order is
  the spread order.
- `getWorkShape(key)` and `getWorkShapeVersion(key, version)` (lines 288 and 294).
  `getWorkShapeVersion` falls back to `WORK_SHAPE_PRIOR_VERSIONS`
  (`work-shape-prior-versions.ts`, a `readonly WorkShapeDefinition[]`).
- `validateWorkShape(shape)` (line 349) checks the §8.11 MUSTs, including the failure and budget stops.
- `readWorkShapeDefinitionContract` (line 172) copies 11 fields. It does not copy
  `collaborationShape`.
- Vocabularies with one owner, which the Zod schema derives from instead of restating:
  - `WORK_SHAPE_TRIGGER_CLASSES` (`work-shapes.ts`)
  - `WORK_SHAPE_EVIDENCE_KINDS` (`work-shape-evidence-kinds.ts`)
  - `WORKROOM_SHAPE_KEYS` (`room-shapes.ts`, six keys)
  - `OUTCOME_DISPOSITIONS` (`@dpf/validators`, re-exported by `apps/web/lib/shared/outcome-disposition.ts`)

**Runtime readers of a stage's advance** (none reads a field beyond `kind`, `condition` and `decisionScope`)

- `drive-resolution.ts:281`
- `room-owner-ladder.ts:56`
- `shape-projection.ts:278`
- `stage-briefing.ts:162`
- `work-shape-binding-diff.ts:83–90`
- `workroom-stage-decision.ts:88–99`

So an added optional `gate` field is invisible to every one of them.

**Drive step function**

- `nextStageKey(definition, currentStageKey, receipts)` (`drive-resolution.ts:142`) is **not
  exported**.
- It decides completion with `isCompletingWorkroomDriveReceipt` (`workroom-drive-receipts.ts:19`).

**Binding diff**

- `diffWorkShapeBinding` (`work-shape-binding-diff.ts:97`) compares stages by key: tools, evidence,
  accountable principal, `advance.kind`, title and condition, plus shape grants.
- It ignores any field it does not name. Adding `advance.gate` therefore classifies as `unchanged`
  today.

**Checks the DRC must reuse, not re-derive**

- `stage-tool-parity.test.ts` composes:
  - `PLATFORM_TOOLS` (`@/lib/mcp-tools`)
  - `getAgentToolGrantsAsync`, `isToolAllowedByGrants` and `TOOL_TO_GRANTS` (`@/lib/tak/agent-grants`)
  - `stageDeclaredTools` and `STAGE_EVIDENCE_TOOL` (`stage-briefing.ts`)
  - `KNOWN_STAGE_TOOL_GAPS` and `stageToolGapKey` (`stage-tool-gaps.ts`)
  - `REQUIRED_TOOL_PIN_CAPACITY` (`@/lib/actions/coworker-tool-budget`)
- It mocks `@dpf/db` with `HARDCODED_COWORKER_GRANTS` from `@dpf/db/workforce-seed`, so grant
  resolution is offline and deterministic. `getAgentToolGrantsAsync` reads the database and otherwise
  falls back to `packages/db/data/agent_registry.json`.
- `classifyConsequentialTool` (`apps/web/lib/tak/consequential-tool-policy.ts:95`) and
  `ToolConsequence` (`apps/web/lib/tool-consequence.ts`) give the O/A/I class.
- `governedDecisionStage` and `STAGE_DECISION_CHOICES = ["accept", "patch", "defer"]`
  (`workroom-stage-decision.ts:32`, `:81`). D-4 depends on `governedDecisionStage` returning non-null
  only when a stage declares `decision-record`.
- `bindings.test.ts` resolves a resolver by dynamic import from `WEB_ROOT`
  (`apps/web/lib/gpp/source-files.ts`) and checks that it is an exported function. D-7 uses the same
  mechanism.
- `GPP_BINDING_ENFORCEMENT` (empty), `KNOWN_SHADOW_BINDINGS` and `DECISION_ID_PATTERN`
  (`^DI-[0-9A-F]{12}$`) are in `apps/web/lib/gpp/binding-enforcement.ts`.
- `KNOWN_UNMEDIATED_EXECUTE_SITES` is in `apps/web/lib/gpp/unmediated-execute-sites.ts`.

**Generated-file pattern to copy**

- `apps/web/scripts/build-route-manifest.ts` (`--check` at line 150) and the `build:route-manifest` /
  `check:route-manifest` scripts in `apps/web/package.json`.
- The shared helper `writeOrCheckGeneratedJson`, with `serializeStableJson` and `findRepoRoot`
  (`apps/web/scripts/registry-generator-support.ts`).
- The CI guard `.github/workflows/audit-route-manifest.yml` (path filters, `pull_request`, `push` and
  `merge_group`, read-only permissions).
- Other generators that follow the same pattern: `build:route-audience`, `build:route-shells`,
  `build:page-purpose`, `build:design-tokens`.

**Canonical JSON**

- `canonicalJson` is exported from `@dpf/integration-shared/canonical-json`
  (`packages/integration-shared/src/canonical-json.ts:50`), and `apps/web` already depends on it. It
  is the one sanctioned canonicaliser for TypeScript. Its header records why hand-rolled variants
  disagree.

**Things that do not exist yet** (each is marked "(new)" where it first appears)

- The directories `apps/web/lib/gpp/shape-language/`, `apps/web/lib/gpp/generated/`,
  `apps/web/lib/work-management/shape-documents/` and `apps/web/lib/work-management/generated/`.
- `apps/web/scripts/build-gpp-shapes.ts` and the `build:gpp-shapes` / `check:gpp-shapes` scripts.

**Shape for the proof migration**

- `inquiry-response-watch@1.0.0` is declared at `standing-operations-shapes.ts:411` under
  `INQUIRY_RESPONSE_WATCH_SHAPE_KEY` (line 33).
- It has two stages and one governed decision (scope `outbound-customer-communication`). It is not one
  of the four frozen prior keys, and it is the spec's §4.5 worked example.
- It is referenced by `stage-tool-parity.test.ts` (lines 123 and 209) and by
  `packages/storefront-templates/src/standing-rooms.ts:118`, both by key.

## Scope and staging

Ten PRs. Each one is revertable on its own and passes the fast local gate and the merge queue on its own.

| PR | What it does | Runtime behaviour change? | Files outside `lib/gpp/shape-language`, `scripts/`, generated dirs |
|---|---|---|---|
| **PR-3a-1** | Zod schema for the shape document and layout sidecar; generated JSON Schema 2020-12, committed; `build:gpp-shapes` / `check:gpp-shapes` (schema step only) | None | `apps/web/package.json` (two scripts) |
| **PR-3a-2** | Gate ratification table: all 50 `decisionScope` strings, every entry `proposed` | None | None |
| **PR-3a-3** | Decompiler and lowering (document ↔ definition); legacy projection; ratification report builder | None | None |
| **PR-3a-4** | Registry-wide suite: AC-SCHEMA over 51 definitions, L1 field-for-field, R report, in-memory determinism | None | None |
| **PR-3b-1** | Strict parse, structured diagnostics, derived element ids (§9.1), resolve step with injected sources | None | None |
| **PR-3b-2** | Reference interpreter and soundness S-1 to S-6; `nextStageKey` exported; AC-INTERPRETER | None (one `export` keyword) | `drive-resolution.ts` (export only) |
| **PR-3b-3** | DRC: C-1 to C-9, D-1 to D-8, W-ORPHAN-LAYOUT, E-NOT-EXECUTABLE with executable-construct flags; fixture corpus (AC-DRC, AC-NOT-EXECUTABLE) | None | None |
| **PR-3b-4** | Optional `gate?` / `binding?` types; `diffWorkShapeBinding` rows for them; TypeScript emitter; `compile()` pipeline; pure binding-record emitter | None. The types are optional and no shape uses them. | `work-shapes.ts` (types), `work-shape-binding-diff.ts` |
| **PR-3b-5** | Full generator: writes generated modules, index and ratification report; `--check`; vitest twin; CI workflow; AC-DETERMINISM, AC-EMIT-INTEGRITY | None. The generated index is empty and not yet spread into the registry. | `.github/workflows/audit-gpp-shapes.yml` (new) |
| **PR-3b-6** | Proof migration of `inquiry-response-watch@1.0.0` behind L1, with an unchanged binding diff and unedited tests (AC-NODISRUPT) | None by construction. This is the only PR whose emitted definition reaches the runtime. | `standing-operations-shapes.ts`, `work-shapes.ts`, `shape-key-parity.test.ts`, GPP doc |

Order:

- PR-3a-1 → PR-3a-2 → PR-3a-3 → PR-3a-4.
- PR-3b-1 → PR-3b-2 → PR-3b-3 → PR-3b-4 → PR-3b-5 → PR-3b-6.
- PR-3b-1 and PR-3b-2 depend only on PR-3a-1, so they may start in parallel with PR-3a-2 to PR-3a-4.
- PR-3b-6 also needs a separate ratification PR for `outbound-customer-communication`, citing a WWMD
  decision (spec §10 step 2). That PR is listed as **PR-3b-R**. It is a one-entry change to the table,
  and the founder decides its content. The agent does not decide it.

Branches: one per PR, from `main`, named `feat/gpp-shape-<slug>` (PR-3b-R: `chore/gpp-ratify-<scope>`).
Each is claimed in its own workroom against BI-6DA17863.

## PR-3a-1: shape-document schema, layout sidecar, published JSON Schema

**Goal.**
- One Zod definition of the shape document (spec §4.2) and of the layout sidecar (§4.3).
- The JSON Schema 2020-12 is generated from it and committed.
- A test fails when the committed file differs from a fresh generation.

**Files**

- `apps/web/lib/gpp/shape-language/gpp-shape-schema.ts` (new).
  - `gppShapeDocumentSchema`, built with `z.strictObject` at every level, so unknown fields fail.
  - Vocabularies are derived, not restated:
    - `triggers` from `WORK_SHAPE_TRIGGER_CLASSES`
    - `evidenceKind` from `WORK_SHAPE_EVIDENCE_KINDS`
    - `collaborationShape` from `WORKROOM_SHAPE_KEYS` plus `null`
    - `disposition` from `OUTCOME_DISPOSITIONS`
  - Construct coverage:
    - `advance` is a discriminated union on `kind`.
    - `binding` is a discriminated union on `enforcement`, so the `environment` variant requires
      `egress`. This is how the §4.2 `if`/`then` is expressed in a form Zod can emit.
    - `gate`, `checkpoint`, `escalation`, `timer` and `flow` follow §4.2 field for field.
  - Set-typed arrays (`triggers`, `evidence`, `tools`) carry a uniqueness refine. The JSON Schema
    generation adds `uniqueItems: true` to the same paths through `z.toJSONSchema`'s `override`
    callback.
  - Exports the inferred type `GppShapeDocument`, plus
    `gppShapeJsonSchema() = { ...z.toJSONSchema(schema, { target: "draft-2020-12" }), $id: "urn:dpf:gpp-shape:0.1" }`,
    following the `trustedArtifactJsonSchema` precedent.
- `apps/web/lib/gpp/shape-language/gpp-layout-schema.ts` (new): `gppLayoutSchema` (§4.3,
  `format: "gpp-layout/0.1"`, `shape: "<key>@<version>"`, `nodes`, `edges`, `viewport`) and the type
  `GppLayoutSidecar`. Types only in Phase 3. No published layout schema is committed: the canvas is
  Phase 4.
- `apps/web/lib/gpp/shape-language/gpp-shape.schema.json` (new, generated).
- `apps/web/scripts/build-gpp-shapes.ts` (new). Schema step only:
  - `writeOrCheckGeneratedJson({ relativePath: "apps/web/lib/gpp/shape-language/gpp-shape.schema.json", value: gppShapeJsonSchema(), check, label: "gpp-shapes", buildCommand: "pnpm --filter web build:gpp-shapes" })`.
  - PR-3b-5 extends this script. It is not replaced, so there is one generator home.
- `apps/web/package.json`: add `"build:gpp-shapes": "tsx scripts/build-gpp-shapes.ts"` and
  `"check:gpp-shapes": "tsx scripts/build-gpp-shapes.ts --check"`.

**Tests** (`pnpm --filter web exec vitest run lib/gpp/shape-language`)

- `apps/web/lib/gpp/shape-language/gpp-shape-schema.test.ts` (new). Failing before: the module does
  not exist.
  - "the committed JSON Schema equals the generated one" (the AC-SCHEMA second clause). It reads the
    file and compares it with `serializeStableJson(gppShapeJsonSchema())`.
  - "the published schema is draft 2020-12, has `$id urn:dpf:gpp-shape:0.1`, and every object schema
    has `additionalProperties: false`". This walks the generated JSON.
  - "an unknown field at any level is rejected": one case for each object in §4.2.
  - "`tools` absent and `tools: []` both validate and stay distinct after parse".
  - "an `environment` binding without `egress` is rejected; with it, it validates".
  - "every enum equals its owning vocabulary": triggers, evidence kinds, collaboration shapes,
    dispositions.
  - "every `uniqueItems` path in the JSON Schema has a matching Zod uniqueness refine, and the reverse".
    This keeps the in-process validator and the published contract equal, since no JSON Schema
    validator is added.
  - "the §4.5 worked example document validates", using a fixture copied from the spec.
- `apps/web/lib/gpp/shape-language/gpp-layout-schema.test.ts` (new): the §4.3 example validates, and
  an unknown top-level field is rejected.

**Rollout.** No runtime import of the new modules. This is offline tooling only.

**Rollback.** Revert the PR. Nothing reads the schema.

**Satisfies:** OBJ-NOTATION (a schema home for all 15 constructs), OBJ-NODISRUPT; AC-SCHEMA
(committed-equals-generated clause).

## PR-3a-2: gate ratification table (all proposed)

**Goal.**
- Turn the parent's "reported for founder ratification" step into a reviewable file.
- Each of the 50 current `decisionScope` strings maps to a proposed `{ authority, mode, blocking, resolution }` and a status.
- Nothing is ratified in this PR. The decompiler reads only `ratified` entries, so the proposals are
  inert.

**Files**

- `apps/web/lib/gpp/shape-language/gate-ratification.ts` (new).
  - `GATE_RATIFICATION: Readonly<Record<string, GateRatificationEntry>>`, where
    `GateRatificationEntry = { proposed: GppGate; status: "proposed" } | { proposed: GppGate; status: "ratified"; decisionId: string; ratifiedAt: string }`.
  - `GppGate` is the type inferred from the schema's `gate` (PR-3a-1).
  - `ratifiedGateFor(decisionScope): GppGate | null`.
  - Proposed values follow the §4.5 reasoning, which the PR body groups by owning scope:
    - `mode` and `blocking` describe today's behaviour. The drive refuses to execute a `role:` stage
      and waits for a `decision-record`, so a `role:`-principal gate is `enforced` and blocking.
    - `resolution: accountable-human` applies wherever a person records the decision through
      `workroom-stage-decision.ts`.

**Tests**

- `apps/web/lib/gpp/shape-language/gate-ratification.test.ts` (new). Failing before: the module does
  not exist.
  - "the table's keys equal the set of `decisionScope` strings across `listWorkShapes()` and
    `WORK_SHAPE_PRIOR_VERSIONS`". This is two-way: a new scope without an entry fails, and so does a
    stale entry. Expected size: 50.
  - "every `proposed` value validates against the schema's `gate`".
  - "every `ratified` entry carries a `decisionId` matching `DECISION_ID_PATTERN` and an ISO
    `ratifiedAt`". It reuses the pattern from `binding-enforcement.ts`.
  - "no entry is ratified at merge". This assertion is deleted by PR-3b-R, the first ratification PR.

**Rollout.** Inert data. **Rollback.** Revert.

**Satisfies:** OBJ-LOSSLESS (the source the R report lists against), OBJ-NODISRUPT; AC-LOSSLESS
(ratification-report input).

## PR-3a-3: decompiler and lowering

**Goal.**
- Add `decompile(definition) → document` and its inverse `lowerToDefinition(document) → WorkShapeDefinition`.
- The inverse is the object half of "emit". PR-3b-4 adds the TypeScript-text half.
- Add the legacy projection L1 compares under, and a pure ratification-report builder.

**Files**

- `apps/web/lib/gpp/shape-language/decompile.ts` (new), following spec §7.3.
  - Copies every current field verbatim, in schema order, and prefixes `format: "gpp-shape/0.1"`.
  - Never emits `flow`, `binding`, `deadline` or `subShape`.
  - Adds `advance.gate` only from `ratifiedGateFor(decisionScope)`.
  - Preserves `tools` absence: absent stays absent, and `[]` stays `[]`.
  - Returns `{ document, awaitingRatification: string[] }`.
- `apps/web/lib/gpp/shape-language/emit.ts` (new).
  - `lowerToDefinition(document)` drops `format` and builds the definition in `WorkShapeDefinition`
    declaration order.
  - Optional new fields are carried only when present.
- `apps/web/lib/gpp/shape-language/legacy.ts` (new): `legacyProjection(definition)` drops only the
  fields spec §4.4 adds (`advance.gate`, `stage.binding`, `stage.deadline`, `stage.subShape`,
  `flow`). It never drops an existing field.
- `apps/web/lib/gpp/shape-language/ratification-report.ts` (new):
  `buildRatificationReport(definitions)` returns, sorted by shape, then stage, then field, every new
  typed field L1 drops, plus every governed stage still awaiting ratification. Pure. PR-3b-5 writes it
  to disk.

**Tests**

- `apps/web/lib/gpp/shape-language/decompile.test.ts` (new). Failing before: no module.
  - "`inquiry-response-watch@1.0.0` decompiles to the §4.5 document minus the `gate` block, since no
    entry is ratified".
  - "with a test-only ratified entry for `outbound-customer-communication`, the `gate` block appears
    exactly as §4.5 shows". This uses an injected table. No production entry changes.
  - "`tools` absent and `tools: []` survive decompile → lower unchanged".
  - "lower(decompile(S)) returns a fresh object; mutating it does not mutate the registry".

**Rollout.** Offline only. **Rollback.** Revert.

**Satisfies:** OBJ-LOSSLESS; AC-SCHEMA, AC-LOSSLESS (mechanism; the registry-wide proof is PR-3a-4).

## PR-3a-4: registry-wide losslessness, report and determinism suite

**Goal.** Prove over all 51 definitions what PR-3a-3 proves on one, in the form the scope baseline
states.

**Files**

- `apps/web/lib/gpp/shape-language/registry-roundtrip.test.ts` (new). It is the only new file. It
  iterates `listWorkShapes()` and `WORK_SHAPE_PRIOR_VERSIONS`. Failing before: the file does not
  exist. It is green only because PR-3a-3 is correct.
  1. **AC-SCHEMA.** "all 51 definitions decompile to documents that pass `gppShapeDocumentSchema`".
     It asserts the count is exactly 47 + 4. A shape added later is covered automatically.
  2. **AC-LOSSLESS / L1, field for field.**
     `canonicalJson(legacyProjection(lowerToDefinition(decompile(S).document))) === canonicalJson(S)`
     for every `S`.
     - It also checks that the own-key set of every object node is equal, walked recursively. This is
       stricter than canonical JSON alone, because canonical JSON does not show a key set to
       `undefined` versus an absent key, and that difference would appear in emitted TypeScript.
     - On failure it prints the first differing path.
  3. **R.** "every field L1 drops appears in `buildRatificationReport`", and the report is snapshot
     tested. At merge the dropped set is empty, because nothing is ratified, and 55 governed stages are
     listed as awaiting ratification.
  4. **Determinism, in memory.** For every `S`:
     - `decompile(S)` is byte-identical under `canonicalJson` across two runs and across a copy of
       `S` with every object's keys reversed.
     - The same holds for `lowerToDefinition`.
     - PR-3b-5 extends this to the generated TypeScript bytes (AC-DETERMINISM proper).
  5. **L2 on decompiled documents.**
     `canonicalJson(decompile(lowerToDefinition(D)).document) === canonicalJson(D)` for each
     decompiled `D`.

**Rollout.** Test only. **Rollback.** Revert.

**Satisfies:** OBJ-LOSSLESS, OBJ-NOTATION; AC-SCHEMA, AC-LOSSLESS (the Phase 3a finish gate in spec
§11); AC-DETERMINISM (in-memory precursor).

## PR-3b-1: strict parse, diagnostics, element ids, resolve

**Goal.** The first three pipeline stages (spec §7.1 steps 1–3), with every finding expressed as data.

**Files**

- `apps/web/lib/gpp/shape-language/diagnostics.ts` (new).
  - `GppDiagnostic = { rule: GppRuleId; severity: "error" | "warning" | "info" | "not-evaluated"; elementId: string; message: string }`.
  - `GppRuleId` is a closed union: `PARSE`, `SCHEMA`, `C-1`…`C-9`, `S-1`…`S-6`, `D-1`…`D-8`,
    `E-NOT-EXECUTABLE`, `W-ORPHAN-LAYOUT`.
  - `sortDiagnostics` orders by element id, then rule, then message, so output is stable.
  - The shape follows the AWS `ValidateStateMachineDefinition` diagnostic precedent (spec §13).
- `apps/web/lib/gpp/shape-language/element-ids.ts` (new). These are the §9.1 derivations, which are
  the shared-identifier contract:
  - `shape:<key>@<version>`, `trigger:<class>`, `stage:<stageKey>`, `gate:<stageKey>`
  - `tool:<stageKey>:<toolName>`, `binding:<id>@<version>`, `stop:<kind>:<n>`
  - `node:<id>`, `edge:<from>-><to>`
  - `elementIdsOf(document)` enumerates them, and `infraCiKeyFor(shapeKey, elementId)` returns
    `gpp:<key>:<elementId>` for Phase 4's projection.
- `apps/web/lib/gpp/shape-language/parse.ts` (new): `parseShapeDocument(text)`.
  - Rejects a BOM, CRLF, duplicate object keys and trailing content.
  - Duplicate keys are found by a small scanner, because `JSON.parse` silently keeps the last one. No
    dependency is added.
  - Then validates with `gppShapeDocumentSchema`. Zod issues are mapped to `SCHEMA` diagnostics on the
    nearest element id.
- `apps/web/lib/gpp/shape-language/resolve.ts` (new): `resolveShapeDocument(document, sources)`.
  - `sources` is injected:
    `{ platformTools, grantsFor(agentId), knownAgents, classify(toolName), importResolver(module, exportName), shapeVersionExists(ref) }`.
  - `defaultResolveSources()` builds them from `PLATFORM_TOOLS`, `classifyConsequentialTool`,
    `packages/db/data/agent_registry.json` and `HARDCODED_COWORKER_GRANTS`
    (`@dpf/db/workforce-seed`), exactly as `stage-tool-parity.test.ts` resolves them.
  - So the compiler never opens a database connection and gives the same answer on every host.
  - Returns resolved facts: each tool's O/A/I class and grant requirement, and the existence of each
    agent, resolver and sub-shape reference. It returns no verdicts. Verdicts are the DRC's job.

**Tests**

- `parse.test.ts` (new):
  - "a duplicate key is a `PARSE` error naming its path"
  - "a BOM / CRLF is refused"
  - "an unknown field is a `SCHEMA` error on the right element id"
  - Failing before: no module.
- `element-ids.test.ts` (new):
  - The §4.3 sidecar's ids are exactly the ids `elementIdsOf` derives for `inquiry-response-watch`.
  - Stop ordinals are 1-based per kind, in document order.
- `resolve.test.ts` (new):
  - `defaultResolveSources().grantsFor` agrees with the seed for every agent named by a stage in the
    registry.
  - `classify` agrees with `classifyConsequentialTool` for every `PLATFORM_TOOLS` entry.

**Rollout.** Offline. **Rollback.** Revert.

**Satisfies:** OBJ-DRC (diagnostics as data), OBJ-VISIBLE-DESIGN (id contract); AC-SHARED-ID (id
derivation only; the EA and room-view halves are Phase 4).

## PR-3b-2: reference interpreter and soundness

**Goal.**
- Write the executable statement of the §6.1 token game.
- Add the structural soundness checks S-1 to S-6 (§6.3).
- Prove that for sequential shapes the interpreter and the drive agree.

**Files**

- `apps/web/lib/gpp/shape-language/interpreter.ts` (new):
  `stepShapeInstance(definition, marking, event) → marking`. Pure.
  - Events: `receipt { stageKey, kind }`, `gate-verdict { stageKey, verdict, mode }`, `stop { kind }`.
  - Stage completion reuses `isCompletingWorkroomDriveReceipt`. It does not restate it.
  - Gate verdict semantics follow §6.2: only `admit` moves the token under `enforced`, and a refuse
    never defaults to admit.
  - The split, join and rework rules exist so that soundness can reason about explicit `flow`. They
    are never reached by an emitted shape while their executable flag is off (PR-3b-3).
- `apps/web/lib/gpp/shape-language/soundness.ts` (new): `checkSoundness(document): GppDiagnostic[]`
  over the implied sequence or the explicit block-structured `flow`. The checks run in linear time:
  - reachability (S-1)
  - option to complete (S-2)
  - split/join pairing and nesting (S-3)
  - no dead stage (S-4)
  - every cycle carries a bounded rework edge (S-5)
  - failure and budget stops exist (S-6, delegating to `validateWorkShape`'s rule)
- `apps/web/lib/work-management/drive-resolution.ts`: change `function nextStageKey` to
  `export function nextStageKey`. **No other change.** The function body, its callers and its
  behaviour are identical, and `git diff` shows one token.

**Tests**

- `apps/web/lib/gpp/shape-language/interpreter-parity.test.ts` (new). **This is the AC-INTERPRETER
  test.**
  - For every sequential definition in the registry (all 51), it generates receipt sequences with a
    seeded PRNG: 200 sequences per shape.
  - The sequences mix completing and blocked receipts, receipts for other stages, and duplicates.
  - After each prefix, it asserts that the interpreter's marked stage equals `nextStageKey`'s result.
  - The seed is fixed and printed on failure.
  - Failing before: `nextStageKey` is not exported and the interpreter does not exist.
- `apps/web/lib/gpp/shape-language/soundness.test.ts` (new):
  - Every decompiled registry document has zero soundness findings.
  - One seeded violation per rule, S-1 to S-6, yields that rule id on the expected element id. These
    fixtures join PR-3b-3's corpus.
- `drive-resolution` suites stay green unchanged.

**Rollout.** No behaviour change: adding `export` does not alter the function. **Rollback.** Revert.

**Satisfies:** OBJ-SEMANTICS, OBJ-DRC; AC-INTERPRETER, AC-DRC (the S-1 to S-6 part).

## PR-3b-3: design-rule checks and the executable subset

**Goal.**
- Add the DRC of spec §7.2. Errors stop emission; warnings and info do not.
- C-5 is reported `not-evaluated`, never passed.
- A construct whose executable flag is off is refused with `E-NOT-EXECUTABLE <construct> at <element id>`.

**Files**

- `apps/web/lib/gpp/shape-language/executable-constructs.ts` (new):
  `CONSTRUCT_EXECUTABLE: Readonly<Record<GppConstruct, boolean>>`, matching the spec §5 Exec column.
  - Off: `stage-deadline`, `parallel-split-join`, `rework-edge` (which covers `gate.onRefuse`), and
    `sub-shape`.
  - On: every other construct. Advisory consult (recorded only) and environment boundary (declared
    only) compile.
  - A header comment states the rule: a flag flips only in the Phase 3c PR that teaches the drive the
    construct, with interpreter parity.
- `apps/web/lib/gpp/shape-language/drc.ts` (new):
  `runDesignRules(document, resolved, { layout?, ratification }): GppDiagnostic[]`. Rules:
  - **C-1 Stage coverage.**
    - An agent stage of a cadence shape that declares no tools and is not on
      `KNOWN_STAGE_TOOL_GAPS` (via `stageToolGapKey`) is an error.
    - A stage whose tools include O/A/I with no governed gate guarding entry to it is an error.
  - **C-2 Vocabulary.** Every tool name must be in `resolved.platformTools`.
  - **C-3 Scope ownership.** A gate needs an authority (enforced by the schema) and a stage may have
    only one gate.
  - **C-4 Grant held.** The accountable agent must hold a grant that `isToolAllowedByGrants`
    accepts, for every declared tool.
  - **C-5** is always emitted as `not-evaluated`, with the message that capability tags do not exist
    on main.
  - **C-7 Mode honesty.**
    - `binding.enforcement: "enforced"` without an entry in `GPP_BINDING_ENFORCEMENT` is an error.
    - An enforced gate whose resolution needs a resolver and names none is an error (see "Spec
      refinements" item 2).
    - The sandbox-containment clause is reported `not-evaluated`. It applies only to Build Studio
      (Phase 5).
  - **C-8** is `info`: "the drive is the only transition path for work shapes".
  - **C-9** is a `warning` when a declared tool has a call site counted in
    `KNOWN_UNMEDIATED_EXECUTE_SITES`, resolved through `critical-interaction-map.ts`'s existing
    inputs.
  - **D-1 to D-8** follow spec §7.2.
    - D-4 calls `governedDecisionStage` on the lowered stage, so it uses the runtime's own rule.
    - D-7 uses the dynamic-import check from `bindings.test.ts`.
    - D-8 compares each `gate` with `ratifiedGateFor`.
  - **E-NOT-EXECUTABLE** is checked for each flagged construct present: `stage.deadline`, `flow` with
    a split or join, `flow.edges[].rework`, `gate.onRefuse` and `stage.subShape`.
  - **W-ORPHAN-LAYOUT** is a warning when a sidecar id matches no derived element id.
- `apps/web/lib/gpp/shape-language/__fixtures__/drc/` (new): one `*.gpp.json` per rule.
  - Each file holds exactly one seeded violation, plus `expected.json` mapping each file to
    `{ rule, elementId }`.
  - It includes the S-1 to S-6 fixtures from PR-3b-2.
  - It also includes five E-NOT-EXECUTABLE fixtures (parallel split, rework edge, stage deadline,
    sub-shape, refuse edge), and a set of passing documents for L2.

**Tests**

- `apps/web/lib/gpp/shape-language/drc-corpus.test.ts` (new). **This is the AC-DRC test.**
  - For each fixture, the pipeline refuses with exactly the expected rule id and element id. The
    rules covered are C-1, C-2, C-3, C-4, C-7, S-1 to S-6 and D-1 to D-8.
  - "C-5 appears on every compile as `not-evaluated` and never as a pass".
  - Failing before: no DRC.
- `apps/web/lib/gpp/shape-language/not-executable.test.ts` (new). **This is the AC-NOT-EXECUTABLE
  test.**
  - Each of the five schema-valid documents is refused with `E-NOT-EXECUTABLE` naming its construct
    and element id.
  - "flipping a flag in a test-only override removes only that finding". This proves the flag is the
    only switch.
- `drc-registry.test.ts` (new) is informational and is not the AC. It asserts that the proof shape
  (`inquiry-response-watch`), decompiled with a test-only ratified gate, passes the DRC with no
  errors. Findings for the other 50 definitions go to the CLI's `--report` output in PR-3b-5. They are
  not snapshotted, so the test does not churn when other shapes change.

**Rollout.** Offline. **Rollback.** Revert.

**Satisfies:** OBJ-DRC, OBJ-SEMANTICS, OBJ-NODISRUPT; AC-DRC, AC-NOT-EXECUTABLE.

## PR-3b-4: additive types, binding-diff rows, TypeScript emitter, `compile()`

**Goal.**
- Give the emitted definition a typed home for the fields a passing document can carry today: a
  `gate` on a governed advance, and a `binding` on a stage.
- Teach the binding diff what those fields mean.
- Emit TypeScript `as const satisfies WorkShapeDefinition`.
- Compose the pipeline.

**Files**

- `apps/web/lib/work-management/work-shapes.ts`: **types only.**
  - Add `WorkShapeGate`, which mirrors the schema's `gate`.
  - Add `WorkShapeBinding`, which mirrors `binding`.
  - Change the governed variant of `WorkShapeAdvance` to
    `{ kind: "governed-decision"; condition; decisionScope; gate?: WorkShapeGate }`.
  - Add `WorkShapeStage.binding?: WorkShapeBinding`.
  - No runtime code, registry entry or reader changes. `deadline`, `subShape` and `flow` are **not**
    added here. Each one arrives with the Phase 3c PR that makes it executable, so the type never
    advertises a field the runtime ignores (see "Spec refinements" item 3).
- `apps/web/lib/work-management/work-shape-binding-diff.ts`: add change kinds and handling.
  - New kinds:
    - `gate-mode-relaxed` (enforced → shadow) and `gate-blocking-relaxed`, both widening
    - `gate-authority-changed`, widening
    - `binding-enforcement-raised`, narrowing
    - `binding-enforcement-lowered`, widening
    - `binding-version-changed`, widening
  - **Absent → present `gate` or `binding` is not a change.** It is a making-explicit transition that
    GPP §2.1.1 lets apply to pinned rooms, so the classification stays `unchanged`. This is the
    property PR-3b-6 relies on.
- `apps/web/lib/gpp/shape-language/emit.ts` (extend). `emitShapeModule(definition, { sourcePath, digest })`:
  - Writes the header comment from spec §4.5, with no timestamp.
  - Writes `import type { WorkShapeDefinition } from "../work-shapes";`.
  - Writes `export const <KEY>_<VERSION> = { … } as const satisfies WorkShapeDefinition;`.
  - Keys appear in `WorkShapeDefinition` declaration order. Strings are escaped with
    `JSON.stringify`. Two-space indent, LF line endings, and a trailing newline.
  - The digest is `sha256` over `canonicalJson(document)`.
- `apps/web/lib/gpp/shape-language/bindings-emit.ts` (new):
  `emitBindingRecords(documents) → GppBindingRecordDraft[]` (spec §6.4).
  - The draft type is local to this module. It carries `attach: { shapeRef, stageKey }` and
    `admission: "stage-gate-admit"` as data, and **does not import or widen `GppBinding`**.
  - It is pure and fixture-tested only. Nothing writes it to disk or reads it at runtime in Phase 3b
    (see "Out of scope for 3b").
- `apps/web/lib/gpp/shape-language/compile.ts` (new):
  `compileShapeDocument(text, sources) → { ok: true; definition; module; diagnostics } | { ok: false; diagnostics }`.
  - Steps: parse → schema → resolve → soundness → DRC → lower → emit.
  - Emission happens only when no diagnostic has severity `error`.

**Tests**

- `apps/web/lib/work-management/work-shape-binding-diff.test.ts` (extend):
  - One case per new kind.
  - "adding a `gate` equal to today's behaviour to a governed stage classifies `unchanged`".
  - Existing cases stay unedited.
- `apps/web/lib/gpp/shape-language/emit.test.ts` (new):
  - "the emitted module for the worked example type-checks". The module is written to a temp file
    inside the test, and a `satisfies` failure is asserted for a corrupted copy.
  - "`evidence` and `collaborationShape` keep their literal types". This is a type-level assertion
    through `expectTypeOf`.
  - "L2: `decompile(compile(D)) ≡ D` for every passing fixture and for the worked example".
- `apps/web/lib/gpp/shape-language/bindings-emit.test.ts` (new): a fixture stage with a `binding`
  and O/A/I tools yields one draft whose `tools` lists only its O/A/I tools. A stage without a binding
  yields none.
- `pnpm --filter web typecheck` passes, which shows the optional fields break no existing shape or
  reader.

**Rollout.** No shape uses the new fields. The binding diff's existing classifications are unchanged,
because a new kind fires only when both versions carry the field.

**Rollback.** Revert. The types are optional, and no data depends on them.

**Satisfies:** OBJ-COMPILE, OBJ-NODISRUPT; AC-NODISRUPT (diff precondition), AC-LOSSLESS (L2).

## PR-3b-5: generator, `--check` integrity guard, CI workflow

**Goal.**
- `build:gpp-shapes` writes every generated artifact, and `check:gpp-shapes` fails if any differs
  from a fresh compile. This is the route-manifest pattern.
- A vitest twin catches a hand edit in the fast local gate.
- A CI workflow catches it on the PR and in the merge queue.

**Files**

- `apps/web/scripts/build-gpp-shapes.ts` (extend PR-3a-1's script).
  1. Regenerate `gpp-shape.schema.json`.
  2. Compile every `apps/web/lib/work-management/shape-documents/*.gpp.json` and
     `shape-documents/prior/*.gpp.json`. There are none at merge.
  3. Write `apps/web/lib/work-management/generated/<key>.shape.generated.ts` per document, and
     `generated/index.generated.ts`. The index exports `GENERATED_WORK_SHAPES` and
     `GENERATED_PRIOR_WORK_SHAPES`, both empty at merge.
  4. Write `apps/web/lib/gpp/generated/gate-ratification-report.json` from `buildRatificationReport`
     over the registry.
  5. `--check`: compare every output with a fresh compile and exit 1 naming each stale file. A
     generated file with no source document is also stale.
  6. `--report`: print registry-wide DRC findings for all 51 decompiled definitions to stdout. It
     writes nothing. This shows which shapes are migratable.
  - Text outputs go through one `writeOrCheckGeneratedText` helper, added beside
    `writeOrCheckGeneratedJson` in `apps/web/scripts/registry-generator-support.ts`, so there is no
    second copy of the compare logic.
- `apps/web/lib/work-management/shape-documents/.gitkeep` and `shape-documents/prior/.gitkeep`
  (new, empty).
- `apps/web/lib/work-management/generated/index.generated.ts` (new, generated, empty registries).
  **Not imported by `work-shapes.ts` in this PR.**
- `apps/web/lib/gpp/generated/gate-ratification-report.json` (new, generated).
- `.github/workflows/audit-gpp-shapes.yml` (new), copied from `audit-route-manifest.yml`.
  - Same triggers, read-only permissions and Node/pnpm setup.
  - Path filters: `apps/web/lib/gpp/shape-language/**`, `apps/web/lib/gpp/generated/**`,
    `apps/web/lib/work-management/**`, `apps/web/scripts/build-gpp-shapes.ts`,
    `apps/web/scripts/registry-generator-support.ts`, `apps/web/package.json`, and the workflow
    itself.
  - Runs `pnpm --filter web check:gpp-shapes`.

**Tests**

- `apps/web/lib/gpp/shape-language/generated-integrity.test.ts` (new). **This is the AC-EMIT-INTEGRITY
  vitest twin.**
  - "the committed generated files equal a fresh compile". This runs the same function as `--check`,
    in-process.
  - "a hand-edited generated module is reported stale". The test copies the outputs to a temp dir,
    edits one byte and runs the check against the temp root.
  - "a generated module without a source document is reported stale".
  - "a document without a generated module is reported stale".
  - Failing before: no generator.
- `apps/web/lib/gpp/shape-language/determinism.test.ts` (new). **This is the AC-DETERMINISM test.**
  - For every committed document, every passing fixture and every decompiled registry document, it
    compiles twice. The second compile uses a copy whose object keys are shuffled by a seeded PRNG.
  - It asserts byte-identical module text and report text.
  - It asserts that the output contains no `\r` and no ISO timestamp pattern.
- `pnpm --filter web check:gpp-shapes` exits 0 on the branch.

**Rollout.** Generated files exist but are not part of the registry yet, so the runtime is unchanged.
The new workflow is not added to required checks by this PR. The vitest twin already runs in every
web shard.

**Rollback.** Revert. The generated files go with it, and nothing imports them.

**Satisfies:** OBJ-COMPILE; AC-DETERMINISM, AC-EMIT-INTEGRITY.

## PR-3b-R: ratify one gate (precondition of PR-3b-6)

**Goal.**
- Change `GATE_RATIFICATION["outbound-customer-communication"]` from `proposed` to `ratified`, citing
  a WWMD decision id.
- The founder reviews the proposed value, which is the §4.5 gate block. The agent prepares the
  `principle_decide` comparison and records the outcome only after the founder's decision. It does not
  decide the value.

**Files.**
- `gate-ratification.ts`: one entry.
- `gate-ratification.test.ts`: delete the "no entry is ratified at merge" assertion.
- `gate-ratification-report.json`: regenerated.

**Rollout.** No shape is migrated by this PR, and the runtime is unchanged. **Rollback.** Revert.

**Satisfies:** OBJ-NODISRUPT (ratified gate values describe today's behaviour); input to AC-NODISRUPT.

## PR-3b-6: proof migration of `inquiry-response-watch@1.0.0`

**Goal.**
- Move one shape from hand-declared TypeScript to a compiled document.
- Prove AC-NODISRUPT on it.
- No other shape moves in Phase 3b.

**Preconditions.**
- PR-3b-R is merged.
- `build-gpp-shapes.ts --report` shows the decompiled document passes the DRC with no errors.

**Files**

- `apps/web/lib/work-management/shape-documents/inquiry-response-watch.gpp.json` (new). This is the
  decompiled document, committed byte-for-byte as the decompiler produced it.
- `apps/web/lib/work-management/generated/inquiry-response-watch.shape.generated.ts` (new,
  generated). It exports `INQUIRY_RESPONSE_WATCH_1_0_0`.
- `apps/web/lib/work-management/generated/index.generated.ts` (regenerated).
- `apps/web/lib/work-management/standing-operations-shapes.ts`:
  - Delete the hand-written literal at line 411.
  - Replace it **in the same position** with
    `[INQUIRY_RESPONSE_WATCH_SHAPE_KEY]: INQUIRY_RESPONSE_WATCH_1_0_0`.
  - The exported `INQUIRY_RESPONSE_WATCH_SHAPE_KEY` constant stays.
  - Keeping the position keeps `listWorkShapes()` order identical (see "Spec refinements" item 4).
- `apps/web/lib/work-management/work-shapes.ts`:
  - Read `GENERATED_WORK_SHAPES` only to assert, at module load, that no generated key is missing from
    `ALL_SHAPES` under the same object identity.
  - It does not spread the generated map, because the in-place reference above already registers the
    shape.
- `apps/web/lib/work-management/shape-key-parity.test.ts`: add a `describe` block. This file is where
  spec §7.5 names the check.
  - "no work-shape key is both hand-declared and generated".
  - "every generated shape is registered exactly once".
- `docs/architecture/gated-permissions-process.md` §12.4.3 and Annex A: "Executable model" reads
  "document-compiled" for `inquiry-response-watch@1.0.0` and "code-declared" for all other shapes.
  This edit belongs to the implementing PR (spec §17).

**Tests**

- `apps/web/lib/work-management/migration-proof.test.ts` (new). **This is the AC-NODISRUPT test.**
  - The pre-migration definition is pinned as a fixture captured from `origin/main` before the PR:
    `__fixtures__/inquiry-response-watch@1.0.0.pre-migration.json`.
  1. `getWorkShape("inquiry-response-watch")` and
     `getWorkShapeVersion("inquiry-response-watch", "1.0.0")` equal the fixture under
     `canonicalJson(legacyProjection(·))`, with equal own-key sets.
  2. The only key added beyond the fixture is `stages[1].advance.gate`, and it equals the ratified
     entry and the ratification report row.
  3. `diffWorkShapeBinding(fixture, migrated).classification === "unchanged"`, and its `changes` list
     is empty.
  4. `listWorkShapes().map(s => s.key)` is identical to the pre-migration order.
  5. `readWorkShapeDefinitionContract(migrated)` equals the contract of the fixture, apart from the
     `gate` key.
  - Failing before: the generated module does not exist.
- **Every existing work-shape test passes without edits.** The PR is blocked if any of these needs a
  change: `work-shapes.test.ts`, `stage-tool-parity.test.ts`, `work-shape-binding-diff.test.ts`
  (beyond PR-3b-4's additions), `work-shape-prior-versions.test.ts`,
  `work-shape-stop-disposition.test.ts`, `work-shape-grants-resolve.test.ts`,
  `workroom-stage-decision*.test.ts`, the drive-resolution suites and
  `packages/storefront-templates/src/standing-rooms.test.ts`.
- `pnpm --filter web check:gpp-shapes` exits 0.

**Rollout.**
- Rooms pinned to `inquiry-response-watch@1.0.0` resolve the same definition. The drive, dispatcher,
  room projection and rebind planner read only fields that are unchanged.
- UX verification (AGENTS.md §4 item 3) applies because a room's definition source changes. On the
  canonical runtime, through the shared non-prod lease, open a room bound to `inquiry-response-watch`
  and confirm three things: the shape view, the stage briefing and the attention plan for `send` match
  a pre-merge capture.

**Rollback.** Revert the PR. The hand-written literal returns, and the generated module and document
go with it. No data or migration is involved.

**Satisfies:** OBJ-NODISRUPT, OBJ-COMPILE, OBJ-LOSSLESS; AC-NODISRUPT (the Phase 3b finish gate in
spec §11, together with PR-3b-2 to PR-3b-5).

## Out of scope for 3b (named so every acceptance criterion keeps an owner)

- **Binding attachment and emitted binding records at runtime.** This covers the
  `"stage-gate-admit"` member of `GppBindingAdmission`, the optional `attach` on `GppBinding`,
  writing `apps/web/lib/gpp/generated/shape-bindings.generated.ts`, and seeding
  `KNOWN_SHADOW_BINDINGS`.
  - These change BI-69415B68's code and are useful only once a document declares a `binding`. None
    does in Phase 3.
  - The pure emitter (PR-3b-4) is ready for it. The work lands as a slice coordinated with
    BI-69415B68 when the first binding is declared.
- **Further migrations** beyond the proof. Each is its own PR under spec §10, after its scopes are
  ratified in batches by owning scope. A shape that fails a check goes on a shrink-only
  `KNOWN_UNMIGRATED_SHAPES` list.
- **Phase 3c** (drive execution of split/join, rework, stage deadline, sub-shape), **Phase 4**
  (canvas, EA projection, V-2 overlay, V-4 surfacing, exports) and **Phase 5** (Build Studio as a
  declared shape). These are rows in the traceability table.

## Tasks

### PR-3a-1
- [ ] `gpp-shape-schema.ts` (strict objects, derived vocabularies, discriminated unions, uniqueness refine plus `override`)
- [ ] `gpp-layout-schema.ts` (types and validator only)
- [ ] `build-gpp-shapes.ts` schema step; `build:gpp-shapes` / `check:gpp-shapes` scripts
- [ ] Commit generated `gpp-shape.schema.json`; schema and layout tests; fast local gate; PR

### PR-3a-2
- [ ] `gate-ratification.ts` with 50 `proposed` entries, grouped by owning scope in the PR body
- [ ] Two-way completeness test against the 51 definitions; DI-pattern rule; "none ratified" assertion
- [ ] Fast local gate; PR

### PR-3a-3
- [ ] `decompile.ts`, `emit.ts` (`lowerToDefinition`), `legacy.ts`, `ratification-report.ts`
- [ ] Worked-example tests, with and without an injected ratified entry
- [ ] Fast local gate; PR

### PR-3a-4
- [ ] `registry-roundtrip.test.ts`: AC-SCHEMA, L1 with own-key-set walk, R snapshot, in-memory determinism, L2
- [ ] Fast local gate; PR. Record execution evidence on BI-6DA17863 (slice 1 complete)

### PR-3b-1
- [ ] `diagnostics.ts`, `element-ids.ts`, `parse.ts` (BOM, CRLF and duplicate-key scanner), `resolve.ts` (injected, seed-backed sources)
- [ ] Tests; fast local gate; PR

### PR-3b-2
- [ ] `interpreter.ts`, `soundness.ts`; `export` on `nextStageKey` (one token)
- [ ] AC-INTERPRETER seeded-PRNG parity test; S-1 to S-6 fixtures
- [ ] Fast local gate; PR

### PR-3b-3
- [ ] `executable-constructs.ts`, `drc.ts`; fixture corpus with `expected.json`
- [ ] AC-DRC and AC-NOT-EXECUTABLE tests; proof-shape DRC check
- [ ] Fast local gate; PR

### PR-3b-4
- [ ] `WorkShapeGate` / `WorkShapeBinding` optional types; binding-diff kinds (absent → present = unchanged)
- [ ] `emitShapeModule`, `bindings-emit.ts` (pure, local draft type), `compile.ts`
- [ ] Emit, L2 and type-level tests; `pnpm --filter web typecheck`; fast local gate; PR

### PR-3b-5
- [ ] Generator writes modules, index and report; `--check`, `--report`; `writeOrCheckGeneratedText` helper
- [ ] `audit-gpp-shapes.yml`; integrity twin and determinism tests
- [ ] Fast local gate; PR

### PR-3b-R
- [ ] Prepare the `principle_decide` comparison for `outbound-customer-communication`. The founder decides; record the outcome
- [ ] One-entry ratification PR

### PR-3b-6
- [ ] Capture the pre-migration fixture from `origin/main`
- [ ] Commit document, generated module and index; in-place reference in `standing-operations-shapes.ts`
- [ ] Parity block in `shape-key-parity.test.ts`; `migration-proof.test.ts`
- [ ] Existing suites unedited; `check:gpp-shapes`; UX check on the canonical runtime via the non-prod lease
- [ ] GPP §12.4.3 / Annex A edit; PR. Record execution evidence on BI-6DA17863 (slice 2 complete)
- [x] File the new BIs named in the traceability table: BI-8875C9DF (3c), BI-F8D4C529 (4), BI-D37B2C13 (5), BI-ACCDC3A7 (migration waves)

## Spec refinements and open questions

These are recorded here and resolved in PR review. None of them edits the spec or the parent spec in
these PRs.

1. **3a needs the object half of "emit".** Spec §11 puts the L1 test in 3a and the compiler in 3b. L1
   is `legacy(compile(decompile(S))) ≡ S`. The plan splits emit: `lowerToDefinition` (document →
   object) lands in 3a, and the TypeScript text emitter and the DRC pipeline land in 3b.
2. **C-7's resolver clause and the worked example.** §7.2 C-7 errors on "`gate.mode: enforced` on a
   gate whose resolver is missing". The §4.5 worked example is `enforced` with
   `resolution: accountable-human` and no `resolver`. Read literally, C-7 would refuse the spec's own
   example and the proof shape.
   - The plan applies the resolver requirement only when `resolution` is `doctrine` or
     `doctrine-then-human`.
   - For `accountable-human`, D-4 (`governedDecisionStage` needs `decision-record`) is the check that
     a mechanism exists.
   - Confirm in PR-3b-3 review.
3. **§4.4 field timing.** §4.4 adds all five optional fields. The plan adds only `gate?` and
   `binding?` in 3b, the two a passing document can carry. `deadline?`, `subShape?` and `flow?`
   arrive with the 3c PR that makes each one executable. The semantics are unchanged.
4. **Registry order.** §7.5 says a migrated shape is spread into `ALL_SHAPES` through
   `generated/index.generated.ts`. Spreading would move the shape to the end of `listWorkShapes()`,
   which is a visible order change.
   - The plan references the generated constant in place in its original file.
   - It uses the index only for the "hand-declared xor generated" check.
   - Confirm in PR-3b-6 review.
5. **AC-NODISRUPT "equal".** After migration, the proof shape carries `advance.gate`, an additive
   field no runtime reader consumes. The plan reads "equal to the pre-migration one" as equal under
   `legacyProjection` with identical own-key sets, the added key listed in the ratification report,
   and binding-diff `unchanged`. This matches AC-LOSSLESS's wording.
   - Strict equality is possible only by migrating with an untyped advance.
   - §7.2 forbids that ("a shape whose scopes are not all ratified is not migrated").
   - Confirm at plan review.
6. **Proof migration depends on a founder ratification** (PR-3b-R). If it does not land, PR-3b-6
   waits. Phase 3b can then close every acceptance criterion except AC-NODISRUPT.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Zod's generated JSON Schema differs structurally from the §4.2 text: `oneOf` versus `anyOf` for unions, a discriminated union in place of `if`/`then`, `uniqueItems` added by `override` | The committed generated file is the contract, and §4.2 is its semantic description. PR-3a-1's tests assert the semantics: closed objects, required sets, enums, patterns, the environment → egress rule, and refine/`override` parity. The PR body records each structural difference. |
| R2 | No JSON Schema validator means AC-SCHEMA's "validate against the committed JSON Schema" is proved by equivalence (Zod-valid and committed-equals-generated), not by an independent validator | The refine ↔ `uniqueItems` parity test closes the one known gap. External tools validate the committed file themselves. Adding a validator would break the no-new-dependency constraint. |
| R3 | The DRC refuses some decompiled current shapes (C-1's O/A/I clause or D-1 on status-change advances into O/A/I stages) | This is expected and is the point of the DRC. Such shapes stay hand-declared on `KNOWN_UNMIGRATED_SHAPES`. `--report` lists them. Phase 3a's acceptance does not depend on the DRC. |
| R4 | Compiler output varies by host (locale sort, CRLF, timestamps, map order) | `canonicalJson` for digests, an explicit declaration-order serializer for TypeScript, LF only, no timestamps. AC-DETERMINISM with shuffled keys. |
| R5 | The DRC drifts from the runtime's grant or tool rules | `resolve.ts` composes the same resolvers as `stage-tool-parity.test.ts` and uses the same seed. D-4 calls `governedDecisionStage`. D-7 reuses the `bindings.test.ts` import check. |
| R6 | `defaultResolveSources` pulls a database client through `@dpf/db/workforce-seed` into an offline script | Verify in PR-3b-1 that the import opens no connection. If it does, import `HARDCODED_COWORKER_GRANTS` from its defining module (`packages/db/src/coworker-grants.ts`) through an existing package export, or inject it from the test and CLI. |
| R7 | Exporting `nextStageKey` invites new callers outside the drive | The export carries a comment naming the interpreter-parity test as its only intended external consumer. Behaviour is unchanged. |
| R8 | Ratifying 50 scopes stalls migration | Phase 3a and the compiler need no ratification. Only the one proof does. Batches follow by owning scope. |
| R9 | A later PR forgets the generated files and CI fails late | The vitest twin runs in the fast local gate, and the workflow runs on PRs and in the merge queue. |
| R10 | The proof migration changes a room's view subtly | AC-NODISRUPT test items 1–5, unedited existing suites, and a UX check on the canonical runtime with a pre-merge capture. |

## Research & Benchmarking

See the spec's [§13 Research and benchmarking](../specs/2026-10-02-gpp-shape-notation-and-compiler-design.md#13-research-and-benchmarking).
The parent's §7 adopt/reject decisions also stand. For this phase, the relevant rows are:

- Zod 4 `z.toJSONSchema`: the schema is generated from one definition.
- JSON Schema draft 2020-12: the published contract.
- AWS `ValidateStateMachineDefinition`: diagnostics as data, where errors block and warnings do not.
- bpmnlint: rule-id'd findings on elements.
- Camunda 8 BPMN coverage: an explicit executable subset, hence E-NOT-EXECUTABLE.
- Workflow-net soundness (van der Aalst et al., 2011): block structure makes S-1 to S-6 linear.

This plan adds no new comparison.

## Traceability to the scope baseline

The baseline is `baseline-699e82bc-1075-45f1-91e7-1c2b9c2aa9cb`, minted from spec §12 by
spec-approval on 2026-10-02. Rows for later phases are included so every objective and every
acceptance criterion has an owner. "Needs new BI" marks a deliverable with no backlog item yet:
EP-B932453F holds none for Phase 3c, the canvas-UX split, Phase 5 or the migration waves (live query,
2026-10-02).

| Deliverable | Phase | Objectives | Acceptance | Contracts | Flows |
|---|---|---|---|---|---|
| PR-3a-1 schema, layout sidecar, published JSON Schema | 3a (BI-6DA17863 slice 1) | OBJ-NOTATION, OBJ-NODISRUPT | AC-SCHEMA | contract:gpp-shape-document-schema, contract:gpp-shape-json-schema, contract:gpp-layout-sidecar | flow:zod-schema-to-json-schema, flow:generated-file-integrity-check |
| PR-3a-2 gate ratification table | 3a (BI-6DA17863 slice 1) | OBJ-LOSSLESS, OBJ-NODISRUPT | AC-LOSSLESS | contract:gate-ratification-table | flow:gate-ratification-review |
| PR-3a-3 decompiler and lowering | 3a (BI-6DA17863 slice 1) | OBJ-LOSSLESS | AC-SCHEMA, AC-LOSSLESS | contract:work-shape-definition, contract:gpp-shape-document-schema, contract:gate-ratification-report | flow:definition-to-document-decompile, flow:document-to-definition-lower |
| PR-3a-4 registry-wide L1, R and determinism suite | 3a (BI-6DA17863 slice 1) | OBJ-LOSSLESS, OBJ-NOTATION, OBJ-COMPILE | AC-SCHEMA, AC-LOSSLESS, AC-DETERMINISM | contract:work-shape-definition, contract:gate-ratification-report | flow:definition-to-document-decompile, flow:document-to-definition-lower |
| PR-3b-1 parse, diagnostics, element ids, resolve | 3b (BI-6DA17863 slice 2) | OBJ-DRC, OBJ-VISIBLE-DESIGN | AC-DRC, AC-SHARED-ID | contract:gpp-diagnostics, contract:gpp-element-id | flow:document-compile-pipeline |
| PR-3b-2 reference interpreter and soundness | 3b (BI-6DA17863 slice 2) | OBJ-SEMANTICS, OBJ-DRC | AC-INTERPRETER, AC-DRC | contract:shape-token-semantics, contract:gpp-diagnostics | flow:sequential-receipt-to-next-stage |
| PR-3b-3 DRC and executable subset | 3b (BI-6DA17863 slice 2) | OBJ-DRC, OBJ-SEMANTICS, OBJ-NODISRUPT | AC-DRC, AC-NOT-EXECUTABLE | contract:gpp-diagnostics, contract:executable-construct-flags, contract:gate-ratification-table | flow:document-compile-pipeline |
| PR-3b-4 additive types, binding-diff rows, emitter, `compile()` | 3b (BI-6DA17863 slice 2) | OBJ-COMPILE, OBJ-NODISRUPT, OBJ-LOSSLESS | AC-LOSSLESS, AC-NODISRUPT | contract:work-shape-definition, contract:generated-shape-module, contract:work-shape-binding-diff | flow:document-compile-pipeline |
| PR-3b-5 generator, `--check`, CI workflow | 3b (BI-6DA17863 slice 2) | OBJ-COMPILE | AC-DETERMINISM, AC-EMIT-INTEGRITY | contract:generated-shape-module, contract:gate-ratification-report | flow:generated-file-integrity-check, flow:document-compile-pipeline |
| PR-3b-R ratify `outbound-customer-communication` | 3b (BI-6DA17863 slice 2) | OBJ-NODISRUPT | AC-NODISRUPT | contract:gate-ratification-table | flow:gate-ratification-review |
| PR-3b-6 proof migration of `inquiry-response-watch@1.0.0` | 3b (BI-6DA17863 slice 2) | OBJ-NODISRUPT, OBJ-COMPILE, OBJ-LOSSLESS | AC-NODISRUPT, AC-EMIT-INTEGRITY | contract:work-shape-definition, contract:generated-shape-module, contract:work-shape-binding-diff | flow:shape-migration, flow:generated-file-integrity-check |
| Binding attach and emitted binding records (`stage-gate-admit`, `GppBinding.attach`, `shape-bindings.generated.ts`) | 3b follow-up, when the first document declares a binding (BI-6DA17863, coordinated with BI-69415B68) | OBJ-COMPILE, OBJ-NODISRUPT | AC-EMIT-INTEGRITY | contract:gpp-binding-record | flow:document-compile-pipeline |
| Migration waves after the proof (ratification batches, per-shape PRs, prior versions into `prior/`, `KNOWN_UNMIGRATED_SHAPES`) | 3b+ (BI-ACCDC3A7) | OBJ-NODISRUPT, OBJ-LOSSLESS | AC-NODISRUPT, AC-LOSSLESS | contract:gate-ratification-table, contract:generated-shape-module | flow:shape-migration, flow:gate-ratification-review |
| Drive execution of split/join, rework (incl. `onRefuse`), stage deadline, sub-shape; one construct per PR, each flipping its Exec flag | 3c (BI-8875C9DF; BI-580A970A's per-target fork is the first consumer) | OBJ-SEMANTICS, OBJ-NODISRUPT | AC-INTERPRETER, AC-NOT-EXECUTABLE | contract:shape-token-semantics, contract:executable-construct-flags | flow:sequential-receipt-to-next-stage |
| Canvas: GPP element types and renderers, typed property editor, DRC on save, sidecar ↔ `EaView.canvasState`, EA projection writing `infraCiKey` via `applySysmlModel`, V-2 overlay, V-4 divergence surfacing | 4 (BI-F8D4C529) | OBJ-VISIBLE-DESIGN, OBJ-NOTATION | AC-SHARED-ID | contract:gpp-element-id, contract:gpp-layout-sidecar | flow:element-id-to-ea-projection |
| BPMN-subset and SysML v2 textual exports | 4 (BI-F8D4C529) | OBJ-NOTATION, OBJ-VISIBLE-DESIGN | AC-SHARED-ID | contract:gpp-element-id | flow:element-id-to-ea-projection |
| Build Studio as one declared shape (hand-authored document; plan → build gate set from `PLAN_TO_BUILD_GATE_PROFILES`; sandbox as an environment boundary; C-7 containment clause evaluated) | 5 (BI-D37B2C13) | OBJ-NOTATION, OBJ-DRC, OBJ-SEMANTICS | AC-DRC, AC-NOT-EXECUTABLE | contract:gpp-shape-document-schema, contract:executable-construct-flags | flow:document-compile-pipeline |

Coverage check:

- Objectives: OBJ-NOTATION, OBJ-SEMANTICS, OBJ-COMPILE, OBJ-LOSSLESS, OBJ-DRC, OBJ-VISIBLE-DESIGN
  and OBJ-NODISRUPT each appear against at least one Phase 3a or 3b deliverable.
- Acceptance: AC-SCHEMA, AC-LOSSLESS, AC-DETERMINISM, AC-EMIT-INTEGRITY, AC-DRC, AC-NOT-EXECUTABLE,
  AC-INTERPRETER, AC-SHARED-ID and AC-NODISRUPT each appear against at least one deliverable.
- AC-SHARED-ID is owned jointly. PR-3b-1 derives the ids. Phase 4 writes them as `infraCiKey`,
  uses them in the room view, and shows a seeded C-6 divergence in both views.
- Before `record_plan_backlog_coverage`, the "needs new BI" rows need filed items, because coverage
  maps every deliverable to a backlog item.

## Verification

- Per PR, run `pnpm --filter web exec vitest run` for the new files and the touched suites
  (`lib/gpp/shape-language`, `lib/work-management/work-shape*`, `stage-tool-parity`, the
  drive-resolution suites, `shape-key-parity`, `migration-proof`).
- Run `pnpm --filter web typecheck` and `pnpm --filter web check:gpp-shapes`.
- `pnpm --filter web build` runs once, in the cloud merge queue (tiered gate, AGENTS.md §4).
- Migrations: none. No PR in this plan adds a Prisma migration.
- UX: PR-3b-6 only, on the canonical runtime through `claim_nonprod_environment_lease` (see its
  Rollout). PR-3a-1 to PR-3b-5 change no surface.
- Build Studio check: `git diff --name-only origin/main...HEAD` on each PR shows no path under
  `apps/web/lib/build/`, `apps/web/lib/explore/` or the Build Studio packs.
- After each merge, record execution evidence on BI-6DA17863 as canonical-runtime evidence. Mark
  slice 1 complete after PR-3a-4 and slice 2 complete after PR-3b-6.

## Documentation impact

- PR-3b-6 updates GPP §12.4.3 and Annex A for the one migrated shape.
- PR-3a-1 adds a short header comment in `gpp-shape-schema.ts` pointing to the spec. No user-facing
  docs change in Phase 3a or 3b: the canvas, the only user-visible surface, is Phase 4.
- `docs/architecture/agent-skill-index.md` is unaffected because no skill changes.
