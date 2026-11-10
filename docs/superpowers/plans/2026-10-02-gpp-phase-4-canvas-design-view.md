---
status: draft
---

# GPP Phase 4: shape design view on the EA canvas, runtime overlay and divergence

| | |
|---|---|
| Date | 2026-10-02 |
| Design | [GPP shape notation, execution semantics and compiler](../specs/2026-10-02-gpp-shape-notation-and-compiler-design.md): §4.3 layout sidecar, §5 iconography and element catalog, §8 interchange exports, §9 design view and runtime view (V-1 to V-4, shared identifiers §9.1), §11 phase table row 4, §12 AC-SHARED-ID. Not edited by this plan or by any PR in it. |
| Parent design | [GPP model to execution](../specs/2026-10-01-gpp-model-to-execution-design.md). Not edited. |
| Prior phase | [GPP Phase 3a and 3b](2026-10-02-gpp-shape-notation-compiler-phase-3.md) |
| Overlapping design | [Workroom flow map and measurement](../specs/2026-10-02-workroom-flow-map-and-measurement-design.md) (reconciled in "Overlap", below) |
| Epic | EP-B932453F |
| Backlog | BI-F8D4C529 (triaging at the time of writing; live query 2026-10-02) |
| Decision relied on | DI-035897A0F1D6 (WWMD): the source of truth is the JSON-Schema superset of `WorkShapeDefinition`; iconography derives from BPMN and lives on the existing `@xyflow/react` EA canvas; BPMN subset and SysML v2 textual notation are export formats only. DI-36D36FEBF4BA (file-authoritative-pr): an approved change to a source-authoritative file lands as a branch and pull request over the GitHub API, never as a write to the deployment clone. |
| Standard | [GPP](../../architecture/gated-permissions-process.md) §12.2 (SysML v2 mapping), §12.4.2 (V-1 to V-4), §12.4.3 and Annex A (DPF status) |
| Verified against | `origin/main` at `879b344fa1`; re-verified after review at `6ce2f7e445` (PR-3b-4/5 merged, #5977) |

## Outcome

When Phase 4 is done:

- Every registered work shape can be opened on the EA canvas as a GPP diagram, drawn with the §5
  glyphs, readable in light mode, dark mode and greyscale. This is V-1.
- A modeller with `manage_ea_model` can edit a shape document on the canvas with a typed property
  editor. Each save runs the same design-rule checks (DRC) the compiler runs and pins every finding
  to the element it names.
- "Propose" turns a passing draft into a governed change. Nothing on a production install writes
  source. A layout-only change opens a pull request over the GitHub API, exactly as approved skill
  changes do today. A semantic change becomes a recorded proposal and a backlog item that a delivery
  workroom lands through the normal PR path, where `check:gpp-shapes` compiles it on `main`.
- Every shape element exists in the EA graph under `infraCiKey = "gpp:<key>:<elementId>"`. The room
  shape view uses the same element id for the same node and links to it. This is V-3.
- The room shape view shows each stage's gate authority, gate mode and binding mode from the
  definition. It reads verdicts only off receipts, as it does today. This is V-2.
- C-6 reach, C-8 transition and gate-mode divergences become `EaConformanceIssue` rows on the
  element they concern, auto-resolved when they stop occurring, and appear in both views. This is
  V-4.
- A shape exports as a BPMN 2.0 subset (with diagram interchange taken from the sidecar) and as
  SysML v2 textual notation. Neither is ever read back.

## Constraints (founder, binding on every PR)

1. **Existing EA canvas users are unaffected.** `apps/web/components/ea/EaCanvas.tsx` is not edited.
   A view of any notation other than `gpp` renders exactly as today. Every new refusal applies only
   to `gpp`-notation views, which do not exist before PR-4a.
2. **No new dependency.** Everything composes `@xyflow/react` ^12.11.6, `elkjs` ^0.12.0,
   `lucide-react` ^1.26.0 and `zod` (all in `apps/web/package.json:50,53,62,80`). No BPMN, SysML or
   JSON Schema package is added (AGENTS.md §7; spec §13 already rejected `bpmn-moddle`, `bpmn-js` and
   SysON as dependencies).
3. **No hardcoded colour.** Every GPP renderer uses `--dpf-*` tokens only. Colour never carries
   meaning: each distinction also has a glyph, a line style or a text label (spec §5; AGENTS.md §9).
   Status colours go through `StatusBadge` and `lib/ui-model/statusColors.ts`, never a local map
   (`scripts/check-no-local-status-color.mjs`).
4. **Nothing on a production install writes source.** Publishing reuses the DI-36D36FEBF4BA PR path
   or the backlog. `propose_file_change` is not used: it refuses outside dev instances
   (`writeProjectFile` → `isDevInstance()`, `apps/web/lib/build/codebase-tools.ts:12-19,383-387`) and
   is limited to the Build Studio build phase (`build-ops-pack.ts:143`).
5. **The compiler and the drive are not changed in behaviour.** Phase 4 is a view, a projection, an
   editor and a proposal path. One change is made to the DRC: a fact it cannot establish at runtime
   becomes `not-evaluated` (PR-4b). No construct's executable flag flips. That is Phase 3c
   (BI-8875C9DF). No PR changes a type or value that the drive persists: the drive snapshot
   (`kind: "workroom-drive"`, including `stageKey`, `receipts` and the whole `conformance` object,
   `lib/queue/functions/workroom-drive.ts:260-283`) stays byte-identical for sequential shapes, so
   Phase 3c's AC-3C-SEQ-IDENTICAL
   (`docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md:294`) is not disturbed.
6. **The parent spec and the child spec are not edited.** Refinements are recorded in "Spec
   refinements" below. The documentation surfaces that change are listed under "Documentation
   impact".

## Facts this plan is built on (origin/main `879b344fa1`, re-verified at `6ce2f7e445`)

Every path and symbol below was read on `origin/main`. Facts added after review were read at
`6ce2f7e445`.

**What Phase 3 has already delivered** (`apps/web/lib/gpp/shape-language/`)

- Schema and sidecar:
  - `gppShapeDocumentSchema`, `GppShapeDocument`, `gppShapeSchemaRegistry` (Zod metadata with
    descriptions, usable for editor labels): `gpp-shape-schema.ts:56,239,257`
  - `gppLayoutSchema` (closed: nodes `{x,y,w?,h?}`, edges `{points?}`, viewport):
    `gpp-layout-schema.ts:34-42`. Its header says the canvas phase widens edge entries deliberately.
- Element ids (§9.1) and the EA key:
  - `shapeElementId` … `flowEdgeElementId`, `infraCiKeyFor(shapeKey, elementId)` returns
    `gpp:<key>:<elementId>`: `element-ids.ts:54-67`
  - `elementIdsOf`: `element-ids.ts:137`
  - A gate element exists for every governed-decision advance, typed or not:
    `element-ids.ts:27-30,96-99`
- Flow graph:
  - `buildShapeFlowGraph`: `interpreter.ts:152`
  - Implied edges get ids too: `edge:<stage>-><next>` and `edge:<last>->stop:success:1`
    (`interpreter.ts:198-232`). These ids are not in `elementIdsOf`.
- Pipeline:
  - `parseShapeDocument`: `parse.ts:342`
  - `resolveShapeDocument(document, sources)`: `resolve.ts:119`
  - `runDesignRules(document, resolved, { layout, ratification, directSites, executable })`:
    `drc.ts:113-162`. It includes soundness (`drc.ts:483`) and W-ORPHAN-LAYOUT, which already accepts
    implied-edge keys (`drc.ts:485-506`).
  - `GppDiagnostic` with `rule`, `code`, `severity` (including `not-evaluated`), `elementId` and
    `path`: `diagnostics.ts:121-130`
- Decompiling and lowering:
  - `decompile(definition)`: `decompile.ts:62`. It types a gate only from a ratified table entry
    (`decompile.ts:55-57`).
  - `lowerToDefinition`: `emit.ts:94`
- `CONSTRUCT_EXECUTABLE` (stage deadline, parallel split/join, rework edge and sub-shape are off):
  `executable-constructs.ts:58-75`
- Gate ratification: every entry in `GATE_RATIFICATION` is `proposed`, and none is ratified
  (`gate-ratification.ts`). So every decompiled gate is currently untyped.
- Resolve sources: `defaultResolveSources()` (`resolve-sources.ts:73`).
  - Its `importResolver` dynamically imports `<WEB_ROOT>/<module>.ts` (`resolve-sources.ts:97-105`).
  - A production image ships no TypeScript source (`DEV_ONLY_ERROR`, `codebase-tools.ts:19`), so in
    production that import always fails and returns `false`.
  - `liveDirectExecuteSites()` reads the source tree (`resolve-sources.ts:120`).

**Delivered by PR-3b-4/5 (merged as #5977, `6ce2f7e445`)**

- `compileShapeDocument(text, sources, { sourcePath, ...DesignRuleOptions })` runs parse → resolve
  → `runDesignRules` → lower → emit, and refuses on any error
  (`apps/web/lib/gpp/shape-language/compile.ts:41-57,64-82`). It imports `node:crypto`, so it is
  server-only.
- `shapeDocumentDigest(document)` returns `sha256:<hex>` over `canonicalJson(document)`
  (`compile.ts:58-62`).
- The generator `apps/web/scripts/build-gpp-shapes.ts` writes per-document modules,
  `generated/index.generated.ts` and `gpp/generated/gate-ratification-report.json`
  (`build-gpp-shapes.ts:9-24`). Its `--check` orphan scan covers only files ending
  `.shape.generated.ts` (`build-gpp-shapes.ts:77,124-132,228-239`), so another
  `*.generated.ts` file in that directory is not flagged as an orphan.
- `index.generated.ts` is not imported by `work-shapes.ts` in Phase 3b (`build-gpp-shapes.ts:19-21`).
- The CI workflow `.github/workflows/audit-gpp-shapes.yml` and the vitest twin
  `lib/gpp/shape-language/generated-integrity.test.ts` exist.
- `shape-documents/` and `shape-documents/prior/` exist and hold only `.gitkeep`. No shape is
  document-backed yet (PR-3b-6 has not merged).

**EA canvas**

- `EaCanvas`:
  - `NODE_TYPES = { eaElement, eaContainer }`: `EaCanvas.tsx:42`
  - Positions are keyed by `EaViewElement.id`: `buildNodeLayout`, `EaCanvas.tsx:130-187`
  - Autosave goes through `saveCanvasState`: `EaCanvas.tsx:471-477`
- `CanvasState = { viewport; nodes: Record<EaViewElement.id, {x,y}>; history? }`:
  `lib/explore/ea-types.ts:16-20`. `history` was added as an optional field by the auto-layout work
  (`docs/superpowers/plans/2026-06-19-ea-canvas-auto-layout.md`, change 3). That is the precedent
  for extending `canvasState` additively.
- Server actions:
  - `saveCanvasState` validates nothing beyond `requireManageEaModel()`:
    `lib/actions/ea.ts:847-856`
  - `addElementToView` writes the new node's position into `canvasState` by view-element id:
    `lib/actions/ea.ts:527,602-624`
- Readers of `canvasState`: `ea-data.ts:38,192`, `view-drawing.ts:134` (export drawing),
  `lib/actions/ea.ts`, `EaCanvas.tsx`, and the view page. There are no others.
- BPMN renderers:
  - Dispatched on the `BPMN__` label: `EaElementNode.tsx:83-127`
  - They and the default node use hex constants from `LAYER_COLOURS` (`ea-types.ts`
    "ArchiMate layer colours") and literals such as `#7c8cf8` and `#336` (`EaElementNode.tsx:36,163`).
    This is a pre-existing AGENTS.md §9 defect. It is not in scope here (see "Pre-existing
    findings").
- View page:
  - `app/(shell)/ea/views/[id]/page.tsx` gates on `view_ea_modeler` and sets read-only without
    `manage_ea_model`.
  - It accepts `?element=` as the initial focus.
- Layout engine: `computeEaLayout(nodes, edges, { algorithm })` with a `layered` ELK option:
  `lib/ea/canvas-layout.ts:84,386`
- Export pattern:
  - `EaDrawingExportMenu` calls the server action `exportEaViewDrawing`, which returns base64, a mime
    type and a file name (`components/ea/EaViewControls.tsx:87-115`, `lib/actions/ea-drawing.ts:12`).

**EA substrate**

- Seeding precedent:
  - `seedEaBpmn20()` upserts a notation, its element types (`isExtension`, a `BPMN__` label, a
    description), relationship types and rules (`packages/db/src/seed-ea-bpmn20.ts:328-437`)
  - It runs as `step("eaBpmn20", …)` in `packages/db/src/seed.ts:2546`
  - The `Dockerfile` init stage builds the seed with the migrations ("Stage 4: init", `Dockerfile:99`). PR-4a step 1 confirms that the init entrypoint runs it on upgrade, not only on first install, before relying on it.
- Projection:
  - `applySysmlModel(model, { db, notationSlug })`: `packages/db/src/sysml-model-seed.ts:104`
  - It writes `infraCiKey`, soft-removes by prefix (`:231`), and finds or creates the view by
    `notationId + name`. It never touches `canvasState`.
  - It updates every element it already has on every run (`updated++` at `:200`), so it is not a
    hot-path call.
  - It files conformance issues create-only and never resolves them (`:358-370`).
- `EaElement.infraCiKey` is nullable and has no index (`ea-architecture.prisma`, EaElement block).
- Orchestrator: `reconcileSysmlProjections` runs each domain through `runDomain`, so one domain's
  failure does not stop the others (`lib/ea/reconcile-sysml-projections.ts:84-120`).
  - It is invoked by the parity steward (`lib/ea/architecture-parity-steward.ts:137`) and the admin
    action (`lib/actions/sysml-projections.ts:31`).
- Conformance:
  - `EaConformanceIssue { viewId?, elementId?, issueType, severity, message, status, detailsJson }`:
    `ea-architecture.prisma:537-554`
  - `reconcileConformanceIssues(db, { issueTypes, findings })` owns create, update and auto-resolve,
    keyed by `detailsJson.issueKey`: `lib/ea/conformance-issue-reconciler.ts:73`
- View approval substrate:
  - `EaView.status`, `submittedAt`, `submittedById`, `approvedAt`, `approvedById`:
    `ea-architecture.prisma:470-493`
  - `EaSnapshot { viewId, submittedById, approvedById, approvedAt, changeSummary, elementCount, relationshipCount, graphJson }`:
    `:568-579`
  - Nothing in `lib/actions/ea*.ts` writes `submittedAt` or `approvedAt` (grep, 2026-10-02).

**Governed source change from a running install**

- `submitSkillImprovementProposal` and `approveSkillImprovementProposal`
  (`lib/skills/proposals.ts:62,137`): approval commits in the database, then calls
  `emitSeedPullRequest` (`:255`).
- `emitSeedPullRequest` (`lib/skills/seed-pull-request.ts:75-160`):
  - builds a whole-file diff (`buildSeedDiff`, `:48`)
  - resolves the token with `resolveHiveToken`
  - opens a branch and PR with `createBranchAndPR` (`lib/build/github-api-commit.ts:584`), with a
    `Signed-off-by` trailer for the approver
  - touches no working tree
  - returns `pr-opened | no-change | no-token | no-repo | pr-failed` without throwing
- Backlog creation:
  - `ingestBacklogItem(input)` (`lib/operate/backlog-ingest.ts:344`) is the shared front door
    (EP-INTAKE-UNIFY). It returns `{ itemId, id, created }` (`:87-92`).
    - It deduplicates by an `origin` marker against non-terminal items (`:391-413`).
    - It resolves `epicId` given either the semantic code or the row id
      (`where: { OR: [{ epicId: raw }, { id: raw }] }`, `:417-421`).
    - It performs no authorization; callers check capability.
  - The MCP tool `create_backlog_item` uses a pack-local `createBacklogItem` handler
    (`lib/mcp/packs/backlog-pack.ts:44`) that calls `ingestBacklogItem`. It is gated by the
    `backlog_write` grant (`:707`).
  - The ops-UI server action `createBacklogItem` (`lib/actions/backlog.ts:102`) is a different
    function. It returns `Promise<void>`, calls `requireManageBacklog()` →
    `requireCapability("manage_backlog")` (`:28-30`), and writes `epicId` as given, so it needs the
    epic row id. Phase 4 does not use it.
- Install host profile: `classifyInstallHost(evidence)` (`lib/install/host-profile.ts:35-54`)
  returns `sourceCapable: true` only when a git checkout is present and no consumer marker
  contradicts it. `readInstallHostProfile()` (`:58-88`) reads `.install-mode`, the host `.git` and
  `DPF_IMAGE_TAG` and returns that classification. This is not `isDevInstance()`
  (`codebase-tools.ts:12-17`), which reads `INSTANCE_TYPE` and `NODE_ENV`.

**Room shape view (V-2 today)**

- `projectRoomShape(view, …)` (`lib/work-management/shape-projection.ts:180`) keeps two
  test-enforced rules:
  - a gate verdict is read only off a receipt
  - liveness is passed in
- It resolves the definition with `getWorkShape(check.shapeKey)` and drops it when the version
  differs (`shape-projection.ts:241-242`). A room pinned to a frozen prior version
  (`getWorkShapeVersion`, `work-shapes.ts:294`) therefore falls back to the lifecycle projection.
- `ShapeStage` carries `key`, `label`, `state`, `rows` and `inspection`, but no element id
  (`shape-projection.ts:60-73`).
- `WorkroomShape.tsx` renders an HTML strip with `Button`, `StatusBadge domain="workroomStage"`,
  `FilterBar` and `CollapsibleList`, all with tokens. It is mounted by `WorkroomShapeSection`,
  `WorkroomBody`, `WorkroomHeader` and `CoworkerShapePanel`.

**Divergence sources**

- `ToolExecution` has no stage or shape column (`packages/db/prisma/schema/ai-coworker.prisma:1031-1106`).
  Its GPP columns are `gppPermitRef`, `gppPermitVerdict` and `gppPermitObservations` (`:1089-1091`),
  which cite a permit, not a stage. `TaskRun` has no stage column either (`build-delivery.prisma`,
  TaskRun block).
- The drive writes the dispatched stage to `ScheduledAgentTask.taskConfig.workroomStage`
  (`queue/functions/workroom-drive.ts:343-353,732-754`). The scheduled-run path reads it to pin
  stage tools (`lib/tak/scheduled-task-runs.ts:175`). The value is overwritten on each dispatch.
- `GppPermit` has `shapeRef` and `stageKey`, and `GppPermitObservation` has `toolName`, `verdict`,
  `enforcement` and `toolExecutionId` (`ai-coworker.prisma:1198-1290`). These cover only calls that
  a binding admits.
- `WORKROOM_SHAPE_CONFORMANCE_DEVIATIONS` includes `out_of_order_stage`,
  `missing_prerequisite_receipt` and `work_shape_version_mismatch`
  (`workroom-shape-conformance.ts:19-39`). A deviation carries only `code` and `summary`
  (`:52-55`).
  - The conformance input has `currentStageKey` and `proposedStageKey` (`:116-117`). The two
    stage-ordering codes are computed from them (`:311-372`).
  - The persisted result keeps `currentStageKey` and `nextPermittedStageKey` but not
    `proposedStageKey` (`:56-70`).
  - The drive derives `proposedStageKey` as `nextStageKey(definition, currentStageKey, receipts)`
    unless the caller overrides it (`drive-resolution.ts:215-221`). `nextStageKey` is exported
    (`:142`).
  - The drive snapshot persists `stageKey: plan.stageKey`, the `receipts` and the whole
    `conformance` object (`workroom-drive.ts:260-283`). `plan.stageKey` is `null` on stop and
    escalate plans (`emptyPlan`, `drive-resolution.ts:117-139`).
- `gpp-c8-transition-gate-skipped` is a Build Studio plan → build record
  (`lib/mcp/packs/build-evidence-extra-pack.ts:287`). Work shapes have no equivalent.

**Design tokens and primitives available**

- `--dpf-bg`, `--dpf-surface-1..3`, `--dpf-text`, `--dpf-text-secondary`, `--dpf-muted`,
  `--dpf-border`, `--dpf-border-strong`, `--dpf-accent`, `--dpf-accent-soft`, `--dpf-on-accent`,
  `--dpf-success|warning|error|info`, `--dpf-state-*` (`app/globals.css`)
- Form primitives: `components/ui/form/*` (`TextField`, `TextareaField`, `SelectField`,
  `CheckboxField`, `SearchableSelect`, `FormField`, and `ConsequenceNotice`, which takes `summary`,
  `what`, `who`, `reversibility`, `recovery` and `tone`: `components/ui/form/ConsequenceNotice.tsx:15-34`)
- Free-form closed sets already in the EA schema: `EaView.status` is a `String @default("draft")`
  (`ea-architecture.prisma:484`), written as `"draft"` by `applySysmlModel`
  (`sysml-model-seed.ts:385`) and compared with `"approved"` in `EaCanvas.tsx:822`.
  `EaConformanceIssue.issueType` is a `String` (`ea-architecture.prisma:541`). Each steward declares
  its own issue types as a module constant (for example `MANAGED_ISSUE_TYPES`,
  `architecture-parity-steward.ts:18`).
- Report kit: `components/ui/report-kit/*` (`StatusBadge`, `Notice`, `EmptyState`, `CollapsibleList`)
- Other primitives: `ui/Button`, `ui/Surface`, `ui/Dialog`, `ui/SaveStateIndicator`

## Overlap with existing work (AGENTS.md §1)

| Existing work | Relationship | What this plan does with it |
|---|---|---|
| Workroom flow map spec (F1–F8; the epic is not yet filed) | Shares V-2 and the node renderers | The flow map owns the **measurement** half of V-2: VSM data boxes, dwell, heat and lanes (its §7 says "This design fills its V-2 overlay with the §5 numbers, so there is one overlay definition, not two"). Phase 4 owns the **governance** half that GPP §12.4.2 V-2 names: gate authority and mode, bindings in force, design links, divergence markers. Phase 4 ships the GPP glyph kit and node renderers as presentational components with no canvas coupling, so `WorkroomFlowMap` (its F3) can reuse them rather than "its own read-only nodes in the same glyph set". Phase 4 does not build `WorkroomFlowMap`, lanes, the shape signature or any measure. |
| EA canvas (`EaCanvas`, auto-layout per `docs/superpowers/plans/2026-06-19-ea-canvas-auto-layout.md`) | Reused, not edited | Reuses `computeEaLayout`, the `@xyflow/react` set-up, `EaViewControls` patterns and the view route. `gpp` views get their own client component, so the generic canvas keeps its behaviour. |
| Parity engine (`applySysmlModel`, `reconcileSysmlProjections`) | Reused | A `gppShapes` domain projects shapes with `notationSlug: "gpp"`. No second applier. |
| `reconcileConformanceIssues` | Reused | V-4 findings go through it, keyed per element and room. `applySysmlModel.conformanceIssues` is not used, because it never resolves. |
| BI-FA970AE2 (Edge 3, architecture drift) | Shared surface | Same `EaConformanceIssue` records and EA conformance surfaces, distinct `issueType`s. Neither builds a second engine (spec §3.2). |
| Skill seed PR path (DI-36D36FEBF4BA) | Reused | Layout-only publishes use its PR primitive. The diff/PR core is extracted once and the skill path is unchanged (PR-4b). |
| `EaView` approval fields and `EaSnapshot` | Reused | A proposal is an `EaSnapshot`. `EaView.status`, `submittedAt` and `submittedById` record it. No migration. |
| BI-ACCDC3A7 (migration waves) | Precondition for semantic publish | A semantic proposal for a shape that is still code-declared names the migration as its first step. Phase 4 never migrates a shape. |
| Phase 3b PR-3b-4 / PR-3b-5 (merged, #5977) | Reused | PR-4b's draft check calls `compileShapeDocument` rather than recomposing its steps. PR-4a extends the merged generator with one sidecar-index step, as its header asks ("Later phases extend this script; they do not add a second one", `build-gpp-shapes.ts:6-8`). |

## Scope and staging

Three PRs. The operator asked for as few PRs as is safe, because the local CI gate is expensive.
Each split below follows a change in blast radius or authority, not a change in topic.

| PR | What it does | Writes? | Why it is its own PR |
|---|---|---|---|
| **PR-4a** Design view, projection, exports | GPP notation seed; glyph kit and node renderers; document → canvas graph; read-only `GppShapeCanvas` on `/ea/views/[id]` for `gpp` views; sidecar ↔ `canvasState`; `gppShapes` projection writing `infraCiKey` for every registered shape; BPMN-subset and SysML v2 exports | EA rows only, through the existing reconcile. No source, no runtime file. | Read-only and EA-only. Rollback is a revert plus the next reconcile soft-removing `gpp:` rows. It is the base the other two build on, and it is the largest UI change. Shipping it alone gives a reviewable visual baseline before any write path exists. |
| **PR-4b** Editing, DRC on save, governed propose | Typed property editor; draft save with DRC; findings on elements; runtime resolve sources (`not-evaluated` for facts production cannot see); proposal (`EaSnapshot` + backlog item); layout-only PR over the GitHub API; guards on generic EA write actions for `gpp` views | `canvasState`, `EaSnapshot`, `EaView.status`, `BacklogItem`. Opens a PR on GitHub for layout-only proposals (an outward act). | The only PR with an outward act and a user-triggered write. It touches the shared skill PR core, which needs its own security and DCO review. It can be reverted without losing the design view. |
| **PR-4c** Runtime overlay and divergence | V-2 governance overlay in `projectRoomShape` / `WorkroomShape`; prior-version resolution; design links (V-3); C-6, C-8 and mode divergence detection into `EaConformanceIssue`; markers in both views; stage attribution for tool calls (`ToolExecution.workroomStageRef`, Q1 decided); AC-SHARED-ID end-to-end test | `EaConformanceIssue`, `ToolExecution.workroomStageRef`. One additive migration. | It changes the room view that every workroom renders, which is the widest-audience surface in the phase. It is the only PR that carries a migration (build-gate item 4). Merging it with PR-4b would put a schema change and an outward-act change behind one revert. |

What was considered and rejected:

- **One PR.** Rejected. It would put an outward act (PR emission), a migration and the
  surface every room renders behind one revert, and the review would span three authorities.
- **Five or more PRs (exports alone, seed alone, editor apart from propose).** Rejected.
  - The exports are pure serializers with no surface risk and ride with PR-4a.
  - The seed has no consumer without the projection.
  - An editor that cannot propose would be a dead end shipped to users.

Order: PR-4a first. PR-4b and PR-4c both depend only on PR-4a, so they may proceed in parallel.

Branches (one per PR, from `main`): `feat/gpp-canvas-design-view`, `feat/gpp-canvas-propose`,
`feat/gpp-runtime-overlay`. Each PR is claimed in its own workroom against BI-F8D4C529.

## PR-4a: design view, EA projection, exports

**Goal.**

- Any registered shape renders on the EA canvas in the §5 notation, read-only, from its document and
  sidecar. This is V-1, the render half.
- Every element is projected into the EA graph with its derived id as `infraCiKey`. This is the EA
  half of V-3 and AC-SHARED-ID.
- Exports are available.

**Files**

*Seed*

- `packages/db/src/seed-ea-gpp.ts` (new): `seedEaGpp()`, modelled on `seedEaBpmn20`. It upserts:
  - **Notation** `{ slug: "gpp", name: "GPP shape notation", version: "0.1" }`.
  - **Element types**, all `isExtension: true`, `GPP__` labels, `domain: "process"`. One per §9.1
    element kind that has a derived id. Each description names its BPMN analogue, as spec §5
    requires:

    | slug | neoLabel | §9.1 kind | BPMN analogue (description) |
    |---|---|---|---|
    | `gpp_shape` | `GPP__Shape` | `shape` | Process |
    | `gpp_trigger` | `GPP__Trigger` | `trigger` | Start event (none / timer / conditional / escalation) |
    | `gpp_stage` | `GPP__Stage` | `stage` | Task (service / user) |
    | `gpp_gate` | `GPP__Gate` | `gate` | Exclusive gateway after a business-rule / user task |
    | `gpp_capability` | `GPP__Capability` | `tool` | Data input / service interface |
    | `gpp_binding` | `GPP__Binding` | `binding` | Group (Gated Permission binding) |
    | `gpp_stop` | `GPP__Stop` | `stop` | End event (none / error / escalation) |
    | `gpp_parallel_split` / `gpp_parallel_join` | `GPP__ParallelSplit` / `GPP__ParallelJoin` | `node` | Parallel gateway |

  - **Relationship types**: `gpp_sequence` (sequence flow; carries the `edge:` id in properties),
    `gpp_rework` (loop flow), `gpp_exit_gate` (stage → its gate), `gpp_declares` (stage →
    capability), `gpp_binds` (binding → stage), `gpp_starts` (trigger → shape), `gpp_contains`
    (shape → each element).
  - **Relationship rules** for exactly those pairs, plus one `ViewpointDefinition` "GPP shape
    design" whose allowed slugs are the above.
  - Constructs 5, 7, 8, 10, 11 and 15 (advisory, checkpoint, evidence, escalation, timer and
    environment boundary) are **adornments**, rendered from element properties. They get no element
    type, because §9.1 gives them no id, and an element without a derived id could not satisfy
    AC-SHARED-ID (see "Spec refinements" item 1).
- `packages/db/src/seed.ts`: add `step("eaGpp", () => seedEaGpp())` after `eaBpmn20` (`:2546`).
- `packages/db/src/seed-ea-gpp.test.ts` (new): injected-client test that running the seed twice
  makes the same upserts, and that every relationship rule names seeded types.

*Pure adapters* (`apps/web/lib/gpp/shape-language/`, all new)

- `runtime-document.ts`: `shapeDocumentFor(key, version)`.
  - Returns `decompile(getWorkShapeVersion(key, version))` with `awaitingRatification`, or `null`.
  - One source for current and frozen prior versions.
  - The committed `.gpp.json` is never read at runtime: L2 (spec §7.4) guarantees that decompiling
    the compiled definition equals the document, and the registry is in the bundle.
- `tool-badge.ts`: `toolBadgeLetter(resolvedTool)` → `R | W | A | O | I`, computed from
  `GppResolvedTool` (`consequential`, `consequence`). A tool that is not registered gets `?`. Never
  authored (spec §4.2 rule 1).
- `shape-canvas-graph.ts`: `buildShapeCanvasGraph(document, resolved, { executable })` →
  `{ nodes, edges, frame }`.
  - **Node ids are §9.1 element ids.** Kinds: trigger, stage, gate, stop, split, join.
    - Stage data: title; principal kind (cog, person or id-card); tool chips with badges; evidence
      kinds; binding mode; deadline or sub-shape markers.
    - Gate data: authority, or `null` and `typed: false` for an unratified gate; mode; blocking;
      checkpoint; escalation role; advisory list.
    - Stop data: kind and disposition.
    - Every node carries an `executable` flag from `CONSTRUCT_EXECUTABLE`.
  - **Edges come from `buildShapeFlowGraph`**, so their ids are the `edge:` ids the DRC already
    accepts. Two rules apply:
    - A flow edge whose source stage has a governed advance renders in two segments,
      stage → `gate:<stageKey>` → target. The segments carry render-only suffixes `#in` and `#out`,
      which are never persisted as element ids, because spec §3.1 item 3 puts the gate on the stage's
      exit.
    - Trigger → first stage edges are render-only.
  - **Failure and budget stops are not wired by fake edges.** They render in a stop column with the
    frame label "may end the instance from any stage" (spec §6.1 rule 7), so the picture does not
    claim a path the semantics do not have.
- `layout-sidecar.ts`:
  - `emptySidecar(document)`.
  - `layoutForView(document, canvasState)`:
    - returns the sidecar held in `canvasState.gpp.layout` when its `shape` equals
      `<key>@<version>`
    - otherwise returns the committed sidecar from the generated layout index (below)
    - otherwise returns `null`, and the client runs ELK
  - `toCanvasState(layout, viewElementIdByElementId)` writes `nodes` keyed by `EaViewElement.id`,
    which keeps every generic `canvasState` reader correct, and writes `gpp: { layout }`.
- `ea-projection.ts`: `gppDesiredModel(document, { digest, awaitingRatification })` →
  `SysmlDesiredModel`.
  - One element per `elementIdsOf(document)`, with `sysmlKey = infraCiKeyFor(key, id)`.
  - Properties: `{ elementId, kind, shapeVersion, provenance: "deterministic", source: "work-shape-registry" }`,
    plus gate and binding facts. A gate also carries `typed` and `decisionScope`.
  - Relationships carry `properties.elementId` for `edge:` ids. Implied edges are included.
  - View `{ name: "GPP shape · <key>", description: "<shape title> — projected from the work-shape registry (<key>@<version>)", viewpointName: "GPP shape design", scopeRef: "gpp-shape:<key>" }`.
    `description` is required by `SysmlDesiredModel.view` (`sysml-model-seed.ts:71`).
  - `softRemovePrefix: "gpp:<key>:"`.

*Projection domain*

- `apps/web/lib/ea/reconcile-gpp-shapes.ts` (new): `reconcileGppShapes({ db })`.
  - For each current definition in `listWorkShapes()`, it calls
    `applySysmlModel(gppDesiredModel(...), { db, notationSlug: "gpp" })`.
  - It projects current versions only (see "Spec refinements" item 2).
  - It then seeds `canvasState` from the committed sidecar only when the view has no `gpp.layout`,
    so a reconcile never overwrites a modeller's layout.
  - **Retiring a shape removed from the registry.** The per-shape `softRemovePrefix` only sees keys
    that are still projected, so a deleted shape's rows would stay active. After the per-shape
    passes, the reconciler lists the distinct shape keys under `infraCiKey` prefix `gpp:` that have
    an active element (`lifecycleStatus: "active"`). For each key that `listWorkShapes()` no longer
    returns, it calls `applySysmlModel` with an empty `elements` and `relationships` set,
    `softRemovePrefix: "gpp:<key>:"` and the same view name. The view description becomes
    "Shape removed from the registry".
    - `applySysmlModel` then soft-removes every element (`mirrorRemoved: true`,
      `lifecycleStatus: "inactive"`, `sysml-model-seed.ts:231-240`) and deletes their view rows
      (`:414-421`).
    - Nothing is hard-deleted.
    - Open `gpp-*` conformance issues on those elements are resolved by the next divergence
      reconcile (PR-4c), because no finding names them.
  - It returns a `SysmlSeedResult` summed across shapes.
- `apps/web/lib/ea/reconcile-sysml-projections.ts`: add `gppShapes` to `SysmlProjectionsResult`
  and one `runDomain("gppShapes", …)` line. Failures stay isolated per domain.

*Sidecar index*

- `apps/web/scripts/build-gpp-shapes.ts`: add a step that writes
  `apps/web/lib/work-management/generated/layout-index.generated.ts`.
  - Static JSON imports of every committed `shape-documents/**/*.layout.json`, keyed by
    `<key>@<version>`. Empty until a shape is document-backed.
  - The compiler still never reads sidecars. The index is a pass-through so a production bundle can
    render committed layouts. `check:gpp-shapes` keeps it honest.

*Types*

- `apps/web/lib/explore/ea-types.ts`: add an optional `gpp?: { layout: GppLayoutSidecar; draft?: GppCanvasDraft }`
  to `CanvasState`.
  - It is a type-only import, so the module stays client-safe.
  - `nodes` keeps its documented meaning (key = `EaViewElement.id`).
  - `GppCanvasDraft` is declared here and first written in PR-4b.

*Glyph kit and renderers* (`apps/web/components/ea/gpp/`, all new)

- `gpp-glyphs.tsx`: the icon registry. One entry per §5 variant, each with:
  - a `lucide-react` icon: `Hand`, `Clock`, `CalendarDays`, `Shield`, `Waves`, `Hourglass`,
    `ArrowUp`, `Cog`, `User`, `IdCard`, `Landmark` (WWMD column), `Building2` (WWWD), `BadgeCheck`
    (WSID), `Check`, `X`, `Plus`, `Lock`, `FileText`, `UserCheck`
  - a text label, used both visible and as the accessible name
  - a line style: `solid` (enforced and blocking), `dashed` (shadow), `double` (enforced,
    non-blocking), `dotted` (advisory)
  - Icons use `currentColor`. The registry exports no colours.
  - This is the single home the workroom flow map's F3 reuses.
- Node renderers: `GppStageNode.tsx`, `GppTriggerNode.tsx`, `GppGateNode.tsx`, `GppStopNode.tsx`,
  `GppFlowNode.tsx`. Each takes plain props (no `NodeProps` coupling inside), with a thin
  `@xyflow/react` wrapper.
  - **Stage**: header is the title; footer is the principal; corner glyph; chip strip with letter
    badges; document glyph listing evidence. A non-executable construct carries a visible
    "not executable yet" label.
  - **Gate**: a diamond with the authority glyph and a text label repeating the mode (for example
    "WWWD · enforced"). An unratified gate reads "gate · unratified".
  - **Stop**: a thick circle with a tick, cross or hourglass, and the disposition as text.
  - **Split / join**: a plus diamond labelled "all".
- `GppSequenceEdge.tsx`: a solid arrow, or a dashed back-arrow labelled "rework ≤ n".
- `GppShapeCanvas.tsx` (`"use client"`): read-only in this PR.
  - `ReactFlow` with the GPP node and edge types.
  - Positions come from `layoutForView`. With no layout, `computeEaLayout(..., { algorithm: "layered" })`
    runs on mount and is not persisted, because read-only.
  - Keyboard focus moves between nodes. A side panel shows the selected element's facts and its
    element id.
  - `?element=<elementId>` focuses that element (V-3 link target).
- `GppExportMenu.tsx`: the `EaDrawingExportMenu` pattern, with formats `gpp.json`, `layout.json`,
  `bpmn` and `sysml`.

*Route and dispatch*

- `apps/web/app/(shell)/ea/views/[id]/page.tsx`:
  - When `view.notationSlug === "gpp"`, it parses `scopeRef` `gpp-shape:<key>`, loads
    `shapeDocumentFor(key, currentVersion)` and resolves it with
    `runtimeResolveSources()`. (This PR ships `runtime-resolve-sources.ts` as read-only facts; PR-4b
    adds its `not-evaluated` semantics to the DRC.)
  - It renders `GppShapeCanvas` with `isReadOnly: true`.
  - Every other notation goes down the unchanged `EaCanvas` branch.
- `apps/web/components/ea/EaElementNode.tsx`: add a `GPP__` branch next to the `BPMN__` one
  (`:83`). It adapts `SerializedViewElement.element.properties` to the GPP renderers, so a GPP
  element placed in any other view draws its glyph. This is the only edit to an existing EA canvas
  file. It is reachable only by `GPP__` elements, which do not exist before this PR.

*Exports* (pure, `apps/web/lib/gpp/shape-language/`)

- `export-bpmn.ts`: `exportBpmnSubset(document, layout)` → XML string.
  - Covers: process; service and user tasks (from the principal kind); exclusive gateway for the
    gate; parallel gateways; start, timer and escalation start events from triggers; end events
    (none, error, escalation) from stops; sequence flows.
  - Adds `gpp:` extension elements (namespace `urn:dpf:gpp-shape:0.1`) for gate authority, mode,
    blocking, binding and capability set.
  - `bpmndi:BPMNDiagram` comes from the sidecar when present.
  - Element `id`s are the §9.1 ids made XML-NCName-safe by a documented, reversible escape, so a
    reader can map back to the element id.
  - Deterministic output: LF, no timestamps.
- `export-sysml.ts`: `exportSysmlV2(document)` → text, following GPP §12.2.
  - Shape → `action def`
  - Stages → `action` usages in `succession` order
  - Gate → `requirement def` with a `doc` naming authority, mode and resolution, linked by
    `satisfy` from a `part` for the owning scope
  - Capability set → `port def` with one item per tool
  - Stops → `done` successions with the disposition as `doc`
  - Element ids appear as `@` short names (`<'stage:send'>`).
  - Deterministic.
- `apps/web/lib/actions/gpp-shape-export.ts` (new, `"use server"`):
  `exportGppShape({ key, version, format })`, requiring `view_ea_modeler`. Returns
  `{ base64, mimeType, fileName }` like `exportEaViewDrawing`.

**Tests**

- `shape-canvas-graph.test.ts`:
  - For all 51 definitions (`listWorkShapes()` + `WORK_SHAPE_PRIOR_VERSIONS`), every node id is in
    `elementIdsOf`, and every flow edge id is in `buildShapeFlowGraph(...).edges`.
  - No node or edge is invented.
  - Failure and budget stops have no inbound edge.
  - A non-executable construct in a fixture carries `executable: false`.
- `ea-projection.test.ts`:
  - For all 47 current definitions, the desired model's `sysmlKey` set equals
    `elementIdsOf(document).map(infraCiKeyFor)`.
  - The `edge:` id set equals the flow-graph edge ids.
  - **This is the EA half of AC-SHARED-ID.**
- `reconcile-gpp-shapes.test.ts` (injected db, the pattern of `sysml-model-seed` tests):
  - The second run creates nothing.
  - A removed stage soft-removes its element.
  - A shape key that no longer exists in the registry has every one of its elements soft-removed,
    and its view loses their view rows.
  - An existing `canvasState.gpp.layout` is not overwritten.
- `layout-sidecar.test.ts`:
  - Round trip: `toCanvasState` followed by reading back yields the same sidecar.
  - A sidecar for another version is ignored.
  - The §4.3 worked-example sidecar (`__fixtures__/inquiry-response-watch.worked-example.layout.json`)
    maps every key.
- `export-bpmn.test.ts`:
  - The worked example is well formed. Checked by a small structural scanner in the test, not a
    dependency.
  - Every §9.1 id appears exactly once after the reversible escape, and unescaping returns it.
  - Output is byte-identical when the document's keys are shuffled.
- `export-sysml.test.ts`: a golden file for the worked example, plus a determinism test. Parsing
  in the SysML v2 Pilot Implementation is a manual verification step, as spec §13 states. It is not
  run in CI.
- `components/ea/gpp/gpp-glyphs.test.tsx` (jsdom), **the greyscale guard**:
  - For every pair of variants within a construct (trigger classes, principal kinds, gate
    authorities, gate modes, stop kinds, badge letters), the rendered DOM differs in icon, label
    text or line-style class once every `style` colour property is stripped.
  - No variant may differ only in colour.
- `components/ea/gpp/gpp-no-colour-literals.test.ts`: greps `components/ea/gpp/**` for hex, `rgb(`,
  `hsl(`, `text-white`, `text-black` and `*-gray-*`, and asserts none occur.
- `EaElementNode` existing tests stay green unedited. There is a snapshot of one BPMN node before and
  after.
- `pnpm --filter web check:gpp-shapes` passes. The layout index is empty and stable.

**UX verification** (AGENTS.md §4 item 3; run on the contributor preview runtime through
`claim_nonprod_environment_lease`, skill `dpf-use-shared-nonprod-environment`)

1. Run the projection from Admin (`lib/actions/sysml-projections.ts`). Open `/ea/views` and confirm
   a "GPP shape · inquiry-response-watch" view exists.
2. Open it as a seeded persona with `view_ea_modeler` only:
   - The canvas is read-only.
   - Triggers, two stages, the gate on `send`'s exit labelled "gate · unratified" and three stops
     render with the §5 glyphs.
   - Failure and budget stops carry the "may end from any stage" label.
3. Toggle dark mode. Every node, label and edge stays legible, and no white or black box remains.
4. Apply `filter: grayscale(1)` to the document (DevTools) and capture screenshots.
   - Each stage principal kind, gate authority, gate mode and stop kind is still distinguishable by
     glyph or label.
   - Repeat with DevTools' "achromatopsia" vision emulation.
5. Keyboard only:
   - Tab into the canvas and move between nodes.
   - The side panel shows the element id.
   - `?element=gate:send` focuses the gate.
6. Export each of the four formats. The files download and the BPMN file opens in a BPMN viewer
   (manual; any viewer).
7. Open a non-GPP view (any ArchiMate or BPMN view) and confirm it behaves exactly as before: drag,
   autosave, auto-layout, revisions.
8. At 375 px width, the canvas page does not scroll horizontally beyond the canvas, and the side
   panel collapses.

Record the result as canonical-runtime evidence on BI-F8D4C529, with screenshots for steps 2, 3
and 4.

**Rollout.**

- The seed adds a notation on the next install or upgrade init.
- The projection runs on the next reconcile.
- No existing view changes.

**Rollback.**

- Revert. The `gpp` notation and elements remain as inert rows.
- A follow-up reconcile without the domain leaves them. They can be soft-removed by running
  `applySysmlModel` with an empty desired set and the `gpp:` prefix, a one-off operator action named
  in the PR body.

**Satisfies:** V-1 (render), V-3 (EA half); AC-SHARED-ID (projection half); spec §8 exports.

## PR-4b: typed editing, DRC on save, governed propose

**Goal.**

- A modeller edits a shape document on the canvas. Every save runs the DRC and shows its findings
  on the elements they name.
- "Propose" records a governed change without writing source.

**Files**

*DRC at runtime*

- `apps/web/lib/gpp/shape-language/resolve.ts`: widen `GppResolveSources.importResolver` to
  `Promise<boolean | null>`, and `GppResolvedStage.gate.resolver.exists` to `boolean | null`.
  `null` means "this host cannot establish it". `defaultResolveSources` still returns booleans, so
  CI behaviour is unchanged.
- `apps/web/lib/gpp/shape-language/drc.ts`: when a resolver's `exists` is `null`, report D-7 as
  `not-evaluated` (message: "resolver existence is checked by the compiler in CI") instead of
  passing or failing. Every other rule is unchanged.
- `apps/web/lib/gpp/shape-language/runtime-resolve-sources.ts` (new):
  `runtimeResolveSources()` reuses `defaultResolveSources()` but returns `null` from
  `importResolver` when the source tree is absent (`!isDevInstance()`). It never calls
  `liveDirectExecuteSites()`, so C-9 is `not-evaluated` on the canvas.
- `apps/web/lib/gpp/shape-language/check-draft.ts` (new): `checkShapeDraft(text, layout, sources)`
  → `{ document | null, diagnostics, documentDigest | null }`. It is a thin wrapper over
  `compileShapeDocument(text, sources, { sourcePath: "<canvas draft>", layout })`
  (`compile.ts:64`), so the canvas runs the compiler's own pipeline, not a recomposition of it. It
  discards the emitted `module` and keeps `diagnostics`. On a refused document it re-parses with
  `parseShapeDocument` only to return the parsed document for the editor.

*Server actions* (`apps/web/lib/actions/gpp-shape-draft.ts`, new, `"use server"`)

- `saveGppShapeDraft({ viewId, documentText, layout })`:
  - Requires `manage_ea_model` (the `requireManageEaModel` path).
  - Refuses a view whose notation is not `gpp`.
  - Validates `layout` with `gppLayoutSchema`.
  - Runs `checkShapeDraft` with `runtimeResolveSources()`.
  - Writes `canvasState = toCanvasState(layout, …) + gpp.draft = { documentText, digest, savedAt, diagnostics }`
    in one update.
    - `digest` is `sha256:<hex>` of `canonicalJson({ document, layout })`, where `layout` is the
      sidecar with `viewport` removed. Viewport is per-viewer and never committed.
    - `documentDigest` (`shapeDocumentDigest`, `compile.ts:58-62`) is stored beside it, so a
      layout-only change is recognisable as an unchanged `documentDigest` with a changed `digest`.
  - Returns sorted diagnostics.
  - A draft with errors is saved, because work in progress must not be lost, and is marked
    not-proposable.
- `discardGppShapeDraft({ viewId })`: clears `gpp.draft`.
- `proposeGppShapeChange({ viewId, summary })`:
  0. **Authority (Q4, DI-6991AE3D5346).** It refuses unless both hold:
     - the caller holds `manage_ea_model` (`requireManageEaModel`)
     - `(await readInstallHostProfile()).sourceCapable === true` (`lib/install/host-profile.ts:58-88`,
       which returns `classifyInstallHost`'s result, `:35-54`)

     `isDevInstance()` is deliberately not used: it reads `INSTANCE_TYPE` and `NODE_ENV`, not
     whether this install holds a source checkout. A refused call returns the reason ("Proposing
     platform-shape changes is limited to the maintainer source install"), and records nothing.
     A **semantic** proposal additionally requires `manage_backlog` (`requireCapability`,
     `lib/actions/shared/guards.ts:68`), the same capability the ops UI requires to file an item
     (`lib/actions/backlog.ts:28-30`).
  1. Re-runs `checkShapeDraft` on the stored draft. It refuses if any diagnostic is an `error`,
     returning them.
  2. Classifies the change. A draft `documentDigest` equal to the current document's means
     **layout-only**. Otherwise it is **semantic**, classified with
     `diffWorkShapeBinding(lowerToDefinition(current), lowerToDefinition(draft))`.
     - A widening change with an unchanged `version` is refused: "bump the version; widening needs
       a new version and a governed rebind" (GPP §2.1.1).
  3. Creates an `EaSnapshot`:
     `graphJson = { format: "gpp-proposal/0.1", shapeRef, documentText, layout, digest, documentDigest, diagnostics, classification }`,
     with `submittedById`, `changeSummary`, and element and relationship counts from the canvas
     graph. It sets `EaView.status = EA_VIEW_STATUS.submitted`, `submittedAt` and `submittedById`
     (see "Closed sets" below).
  4. **Layout-only, document-backed shape:** opens a PR with only the `.layout.json` file, via
     `emitSourceFilePullRequest` (below).
     - Branch `chore/gpp-layout-<key>-<snapshotId>`; title
       `chore(gpp): layout for <key>@<version>`.
     - The `Signed-off-by` is the proposing user.
     - The PR URL is written into `graphJson.pr`.
     - Statuses `no-token`, `no-repo` and `pr-failed` are returned to the user verbatim. The
       proposal stays recorded, and nothing claims success.
  5. **Layout-only, shape not yet document-backed:** nothing to commit beside. The layout stays in
     `canvasState` and the result says so.
  6. **Semantic:** creates a backlog item through `ingestBacklogItem`
     (`lib/operate/backlog-ingest.ts:344`), the helper that returns the `itemId`. The input is:
     - `workType: "feature"`, `source: "user-request"`, `type: "product"`, `status: "triaging"`
     - `epicId: "EP-B932453F"`, the semantic code, which `ingestBacklogItem` resolves to the row id
       (`:417-421`)
     - `origin: { kind: "gpp-shape-proposal", id: <snapshotId> }`, so a re-submitted proposal bumps
       the existing item instead of filing a duplicate (`:391-413`)
     - `submittedById: <user>`
     - the title `GPP shape change: <key>@<version> — <summary>`
     - a body containing:
     - the snapshot id
     - the classification
     - the full diagnostics, with `not-evaluated` items listed as "checked in CI"
     - the document and sidecar in fenced blocks (shape documents are a few KB)
     - when the shape is still code-declared, the step "migrate first (BI-ACCDC3A7), then apply"

     The returned `itemId` is written into `graphJson.backlogItemId`. The item is landed by a
     delivery workroom (Build Studio or an external CLI). That workroom runs `build:gpp-shapes` on a
     worktree from `main` and opens the PR. So the compiler that emits the generated files is
     always `main`'s, never the running image's (see "Spec refinements" item 3).
- **Approval is a read of deployed state, never of the draft.** The proposal's acceptance is the PR
  merging and the install upgrading to it. PR-4b edits `reconcileGppShapes`
  (`lib/ea/reconcile-gpp-shapes.ts`, created in PR-4a) to set `EaSnapshot.approvedAt` and
  `EaView.status = EA_VIEW_STATUS.approved` only when the **deployed** pair matches the snapshot.
  The deployed pair is:
  - **document**: `decompile(getWorkShapeVersion(key, version))`, which is the definition in the
    running bundle
  - **layout**: the committed sidecar from `layout-index.generated.ts` for `<key>@<version>`, which
    is never `canvasState`

  Both are hashed the same way: `canonicalJson({ document, layout })` with `viewport` removed.
  - A layout-only proposal is therefore approved only after its sidecar PR merges and the install
    upgrades. Its unchanged document cannot approve it on the next reconcile, because the sidecar
    in the bundle still differs.
  - A proposal for a shape with no committed sidecar compares against `layout: null`. Such a
    proposal is semantic or stays unpublished (step 5), so it never auto-approves on the document
    alone.

*PR core extraction*

- `apps/web/lib/governance/source-file-pull-request.ts` (new): `buildWholeFileDiff`
  (moved from `buildSeedDiff`) and `emitSourceFilePullRequest({ path, before, after, branchName, commitMessage, prTitle, prBody, signer, repo })`.
  - The status union is unchanged.
  - Token resolution (`resolveHiveToken`) and `createBranchAndPR` calls are unchanged.
- `apps/web/lib/skills/seed-pull-request.ts`: re-implemented on the shared core.
  `emitSeedPullRequest`'s signature, messages and statuses are unchanged, and
  `seed-pull-request` tests pass unedited. This keeps one PR primitive (AGENTS.md §8, no parallel
  utilities).

*Closed sets (AGENTS.md §8)*

- `apps/web/lib/ea/ea-view-status.ts` (new): `EA_VIEW_STATUSES = ["draft", "submitted", "approved"] as const`,
  the `EaViewStatus` union and an `EA_VIEW_STATUS` lookup.
  - `"draft"` is today's default (`ea-architecture.prisma:484`) and `"approved"` is what
    `EaCanvas.tsx:822` already compares with. Phase 4 writes `"submitted"` and `"approved"` only
    through this module.
  - `EaView.status` stays a free-form `String` column. Converting it to a Prisma enum is a
    migration over every existing view, outside this phase. That is **recorded as pre-existing
    debt** under "Pre-existing findings".
- `apps/web/lib/gpp/shape-language/divergence.ts` (PR-4c) declares
  `GPP_DIVERGENCE_ISSUE_TYPES = ["gpp-c6-reach", "gpp-c8-transition", "gpp-c7-mode"] as const`. It
  is the only home of those strings. `reconcile-gpp-divergence.ts` passes it as `issueTypes`, the
  same pattern as `MANAGED_ISSUE_TYPES` (`architecture-parity-steward.ts:18`).
  `EaConformanceIssue.issueType` is likewise a free-form column, recorded as pre-existing debt.
- The proposal format string `"gpp-proposal/0.1"` and the origin kind `"gpp-shape-proposal"` are
  exported constants in `lib/actions/gpp-shape-draft.ts`'s non-server sibling
  `lib/gpp/shape-language/proposal-format.ts`, because a `"use server"` module exports only
  functions (AGENTS.md §6).

*Guards*

- `apps/web/lib/actions/ea.ts`: `addElementToView`, `createEaRelationship`, `deleteEaRelationship`,
  `moveStructuredViewElement`, `updateProposedProperties`, `removeElementFromView` and
  `saveCanvasState` refuse a view whose notation is `gpp`, with the message: "GPP views are edited
  through the shape document; changes made here would be overwritten by the projection".
- `apps/web/lib/mcp/packs/ea-ontology-pack.ts`: `create_ea_element` and `create_ea_relationship`
  refuse a `gpp` element type for the same reason.
- Verify in step 1 of the PR which of these accept a view or type id, and guard only those. The
  guard list in the PR body is what the code shows.

*Editor UI* (`apps/web/components/ea/gpp/`)

- `GppShapeCanvas.tsx`: editable when not read-only.
  - **Drag** updates the draft sidecar. Saves are debounced through `saveGppShapeDraft`, with a 1.5 s
    debounce matching `EaCanvas` and `SaveStateIndicator` for state.
  - **Palette** adds a stage, trigger, stop, split or join. A construct whose executable flag is off
    is drawable but labelled "draft only — the runtime does not execute this yet". Spec §5.4: the
    schema accepts it, and the compiler refuses it with `E-NOT-EXECUTABLE`.
  - **Connect** creates a flow edge only when an explicit `flow` exists. Otherwise order is the
    stage order, changed with "move earlier" and "move later" controls, so the implied sequence
    stays the only sequence.
  - **Keyboard alternatives** exist for every pointer action.
- `GppPropertyEditor.tsx`: the typed property editor, bound to the schema.
  - Sections per element kind follow the Zod schema (`gpp-shape-schema.ts`).
  - Labels and help text come from `gppShapeSchemaRegistry` descriptions.
  - Enums use `SelectField` (triggers, authority, mode, resolution, stop kind, disposition,
    collaboration shape, binding enforcement).
  - Evidence kinds use `SearchableSelect` multi-select over `WORK_SHAPE_EVIDENCE_KINDS`.
  - Tools use `SearchableSelect` over `PLATFORM_TOOLS` names supplied by the page. Each chip shows
    its computed badge letter, never an authored one.
  - Principal is a `TextField` with the `principalRef` pattern and inline validation.
  - "Tools: undeclared" versus "declares no tools" is an explicit three-way control, because absent
    and `[]` differ (spec §4.2).
  - Gate fields show the ratification table's entry for the scope and flag a mismatch (D-8) before
    save.
  - Every field change updates the draft text. A "Document" tab shows the canonical JSON, read-only,
    for review.
- `GppDiagnosticsPanel.tsx`: findings grouped by element.
  - Uses `StatusBadge` with an existing severity domain (`issueSeverity`), so no local colour map
    exists.
  - `not-evaluated` renders as "Checked in CI".
  - Selecting a finding focuses its element.
  - Elements with findings show a count badge with a text label ("2 errors"), never colour alone.
- `GppProposeDialog.tsx`: built on `ui/Dialog` and the existing
  `components/ui/form/ConsequenceNotice.tsx`. It adds no new notice component.
  - Shows the classification and the summary field.
  - `ConsequenceNotice` answers the four questions:
    - `summary`: "Opens a pull request on GitHub" (layout) or "Files a backlog item for review"
      (semantic)
    - `what`: the files or the item
    - `who`: the platform repository's reviewers
    - `reversibility`: "the PR or item can be closed"
    - `recovery`: "the draft stays on this view"
    - `tone`: `"warning"` for the outward PR
  - Submitting is a deliberate click. The outward act is never automatic.
- **Propose is hidden, not merely disabled, unless the install is source-capable and the user holds
  `manage_ea_model`** (Q4). The page passes `canPropose` computed server-side from
  `readInstallHostProfile()` and the capability. The server action re-checks both, so hiding the
  button is never the only control.

**Tests**

- `drc-corpus.test.ts` and `not-executable.test.ts` pass **unedited**. They use
  `defaultResolveSources` semantics, so CI verdicts do not move.
- `drc.test.ts` (extend): with `exists: null`, D-7 is `not-evaluated` and never `error` or silent.
- `runtime-resolve-sources.test.ts`: with `INSTANCE_TYPE=production`, `importResolver` resolves
  `null`, and no file under `WEB_ROOT` is read.
- `check-draft.test.ts`:
  - The worked example passes, with C-5, C-9 and D-7 (when a resolver is named) as
    `not-evaluated`.
  - Each DRC fixture yields the same rule and element id as the corpus.
- `gpp-shape-draft.test.ts` (action, injected Prisma):
  - Refuses a non-`gpp` view.
  - A draft with errors saves but `proposeGppShapeChange` refuses.
  - Layout-only plus document-backed calls `emitSourceFilePullRequest` once with only the sidecar
    path.
  - Semantic calls `ingestBacklogItem` once, with `epicId: "EP-B932453F"` and the
    `gpp-shape-proposal` origin, and opens no PR.
  - **A consumer host profile is refused.** `classifyInstallHost({ installMode: "consumer", hasGitSource: false, imageTag: "x" })`
    gives `sourceCapable: false`. The action refuses before writing a snapshot, an item or a PR.
    An `unknown` profile (contradictory evidence) is refused too.
  - A source-capable profile without `manage_backlog` can propose layout-only but not semantic.
  - Approval: a layout-only snapshot is **not** approved by a reconcile whose bundled sidecar
    differs. It is approved once the layout-index fixture carries the proposed sidecar. A semantic
    snapshot is approved only when both the bundled document and the sidecar match.
  - Widening without a version bump is refused.
  - `no-token` is surfaced, not reported as success.
- `seed-pull-request.test.ts`: unedited, and passes. That is the extraction-parity proof.
- `ea.test.ts` (extend): each guarded action refuses a `gpp` view and still accepts an ArchiMate
  view.
- `GppPropertyEditor.test.tsx` (jsdom):
  - Every enum renders the closed set from the schema.
  - The three-way tools control round-trips absent, `[]` and a list.
  - The badge letter is not editable.

**UX verification** (same environment)

1. Persona with `manage_ea_model`: open the inquiry-response-watch GPP view.
   - Drag a stage. "Saved" appears.
   - Reload. The position persists.
   - A generic EA view's positions are untouched.
2. Change the `send` stage's evidence so `decision-record` is removed and save.
   - D-4 appears on `gate:send` in the panel and as a labelled badge on the diamond.
   - Restore it. The finding clears.
3. Add a parallel split from the palette.
   - It is labelled "draft only".
   - Save shows `E-NOT-EXECUTABLE` on `node:<id>`.
   - Propose is disabled with the reason.
4. Name a gate resolver. D-7 shows "Checked in CI", not an error, and not silence.
5. Propose a layout-only change on a document-backed shape. On the contributor preview, use a test
   repository or `no-token`, and never the production remote.
   - The `no-token` message is shown when no token is configured.
   - With a token in the test set-up, a PR containing only the sidecar opens.
6. Propose a semantic change. A backlog item appears with the snapshot id, the classification and
   the document block. No PR opens.
7. Persona with `view_ea_modeler` only: no editor controls render, and the server actions refuse.
8. **Consumer profile.** Run the preview with a consumer host profile (`.install-mode` = `consumer`
   and no `.git` under the host install path, the inputs `readInstallHostProfile` reads). A persona
   with `manage_ea_model` can edit and check a draft but sees **no Propose button**, and calling the
   action directly is refused.
9. Dark mode and greyscale passes on the editor, panel and dialog, as in PR-4a steps 3 and 4.

**Rollout.** Editing is available to `manage_ea_model` holders on the next deploy. Proposing is
available only on the maintainer source install (Q4).

**Rollback.** Revert. Drafts in `canvasState.gpp.draft` become inert. Recorded proposals and backlog
items remain as history.

**Satisfies:** V-1 (complete: property editor, DRC on save, findings on elements); governed publish;
OBJ-DRC carried to the canvas without re-deriving a rule.

## PR-4c: runtime overlay (V-2), shared ids in the room view (V-3), divergence (V-4)

**Goal.**

- The room shape view shows, for each stage, its design element id, gate authority, gate mode and
  binding mode from the definition, with a link to the design element.
- C-6, C-8 and gate-mode divergences land on `EaConformanceIssue` for the element and appear in both
  views.
- AC-SHARED-ID is proved end to end.

**Files**

*Stage attribution for tool calls* (Q1, decided by the founder: the additive column)

- One additive migration,
  `packages/db/prisma/migrations/<timestamp>_tool_execution_workroom_stage_ref/migration.sql`:

  ```sql
  ALTER TABLE "ToolExecution" ADD COLUMN IF NOT EXISTS "workroomStageRef" TEXT;
  CREATE INDEX IF NOT EXISTS "ToolExecution_workroomStageRef_createdAt_idx"
    ON "ToolExecution" ("workroomStageRef", "createdAt")
    WHERE "workroomStageRef" IS NOT NULL;
  ```

  - The format is `<shapeKey>@<version>#<stageKey>`.
  - Adding a nullable column with no default is a catalogue-only change and rewrites no rows.
  - `ToolExecution` is a large audit table. A plain `CREATE INDEX` builds over every row while
    holding a lock that blocks writes, during upgrade init. The index is therefore **partial**,
    `WHERE "workroomStageRef" IS NOT NULL`: at migration time every existing row is null, so the
    build reads the table but indexes nothing, and later inserts maintain only attributed rows.
  - `IF NOT EXISTS` on both statements makes a re-run after a partial apply safe, so the migration
    applies cleanly to any data state: an empty schema, a populated schema, or one where an earlier
    attempt stopped between the two statements.
  - The Prisma schema adds `workroomStageRef String?` and the matching
    `@@index([workroomStageRef, createdAt])`. The partial `WHERE` clause lives only in SQL. PR step
    1 checks how this repository already reconciles partial indexes with `prisma migrate diff`, and
    follows that precedent rather than inventing one.
  - No backfill. Historic rows stay null, and null means "unattributed", never "in stage".
- Write path: the scheduled-run path that already reads `taskConfig.workroomStage`
  (`scheduled-task-runs.ts:175`) puts the ref on the run context, and `governedExecuteTool` writes
  it. Step 1 of the PR traces the exact context hand-off and names the files before any edit.

*Pure detectors* (`apps/web/lib/gpp/shape-language/divergence.ts`, new)

- `reachDivergences(definition, calls)`: C-6.
  - A call attributed to `stageKey` whose tool is not in that stage's declared `tools` lands on
    `tool:<stageKey>:<tool>` if the stage declares that tool under another stage, and on
    `stage:<stageKey>` otherwise.
  - A stage with `tools` absent (undeclared) yields `not-evaluated`, never a divergence.
- `transitionDivergences(definition, snapshot)`: C-8 for work shapes. It reads a persisted drive
  snapshot and changes nothing in it.
  - **The deviation type is unchanged.** `WorkroomShapeConformanceDeviation` stays
    `{ code, summary }`. Adding a field would change the persisted `conformance` object
    (`workroom-drive.ts:281`) and break Phase 3c's AC-3C-SEQ-IDENTICAL (constraint 5).
  - The detector derives the proposed stage the same way the drive did:
    - `snapshot.stageKey` when it is non-null
    - otherwise `nextStageKey(definition, snapshot.conformance.currentStageKey, snapshot.receipts)`
      (`drive-resolution.ts:142,215-221`), because stop and escalate plans persist
      `stageKey: null` (`:117-139`)
  - With the proposed stage known, `out_of_order_stage` and `missing_prerequisite_receipt` map to:
    - `gate:<prior stage>` when the stage before the proposed one is governed, the gate the
      transition skipped
    - `stage:<proposed stage>` otherwise
  - When the proposed stage is not on the declared shape (the first `out_of_order_stage` branch,
    `workroom-shape-conformance.ts:313-317`), the finding lands on the shape element.
  - A drive caller that overrode `proposedStageKey` (`drive-resolution.ts:215`) without recording it
    cannot be reconstructed exactly. The detector then uses `snapshot.stageKey`, and when that is
    null it places the finding on the shape element rather than guess.
  - The Build Studio record `gpp-c8-transition-gate-skipped` is not mapped. Build Studio has no
    shape document until Phase 5 (BI-D37B2C13).
- `modeDivergences(definition, observations)`: a gate shown as `enforced` whose recorded verdicts
  in the window are all shadow is C-7 on `gate:` (spec §9.3 row "Mode"). With no typed gate there
  is no claim, so no finding.

*Reconciler*

- `apps/web/lib/ea/reconcile-gpp-divergence.ts` (new): `reconcileGppDivergence({ db, window })`.
  - Loads attributed calls, conformance results and permit observations for live rooms.
  - Maps each finding's element id to `EaElement.id` by `infraCiKeyFor(key, elementId)`.
  - Calls `reconcileConformanceIssues(db, { issueTypes: ["gpp-c6-reach", "gpp-c8-transition", "gpp-c7-mode"], findings })`.
  - The issue key is `<issueType>:<infraCiKey>:<roomRef>`. So a divergence that stops occurring
    auto-resolves, and two rooms with the same gap are two issues.
  - The `detailsJson` carries `{ elementId, shapeRef, roomRef, evidenceRefs }`. Evidence refs are
    `ToolExecution` ids or receipt ids, never payloads.
  - It is called from `reconcileGppShapes` after projection, so element rows exist first.
  - A finding for a room pinned to a prior version is recorded on the shape element, with the
    version in its details (see "Spec refinements" item 2).

*Room view* (V-2 and V-3)

- `apps/web/lib/work-management/shape-projection.ts`:
  - Resolve with `getWorkShapeVersion(check.shapeKey, check.shapeVersion)` instead of `getWorkShape`
    plus a version comparison (`:241-242`). A room on a frozen prior version then shows its real
    definition rather than the lifecycle fallback. This is the one visible behaviour change in the
    phase. It is a correction toward V-3 and is called out in the PR body.
  - `ShapeStage` gains `elementId` (`stageElementId(key)`) and optional
    `gate: { elementId, typed, authority, mode, blocking }`, read from
    `advance.kind === "governed-decision"`. Absent `gate` fields render as "unratified", never
    guessed.
  - `ShapeStage` also gains `binding: { elementId, enforcement }` and
    `divergences: DivergenceMarker[]`.
  - `projectRoomShape(view, opts)` takes optional `design: { hrefFor(elementId): string | null; divergences: ReadonlyMap<string, DivergenceMarker[]> }`,
    **passed in** like liveness, so the projection stays pure and invents nothing.
- The room loader that calls `projectRoomShape` passes in `hrefFor`. It is built from one query: the
  `gpp` view by `scopeRef = gpp-shape:<key>`, giving `/ea/views/<viewId>?element=<elementId>`. It
  also passes the open `gpp-*` issues for the room's elements. Step 1 of the PR names the loader
  file. The candidates are the server components that mount `WorkroomShapeSection` and
  `CoworkerShapePanel`.
- `apps/web/components/workspace/workroom/WorkroomShape.tsx`:
  - Each step button shows the gate glyph and label from `gpp-glyphs.tsx` (PR-4a), for example
    "WWWD · enforced" or "gate · unratified", and the binding mode as text.
  - The inspection panel gains a "Design element" row with the element id and an "Open in design
    view" `ButtonLink` when `hrefFor` returns one.
  - Divergence markers render as a labelled `StatusBadge` ("Reach gap", "Skipped gate") plus
    details listing the evidence refs.
  - The receipt rule and the liveness rule are untouched.

*Design view* (V-4)

- `GppShapeCanvas.tsx`: loads open `gpp-*` issues for the view's elements and shows them as
  labelled markers on the element, in the same `GppDiagnosticsPanel` with an "Observed at runtime"
  group that is separate from design findings.

**Tests**

- `divergence.test.ts`:
  - One fixture per detector.
  - An undeclared-tools stage yields `not-evaluated`.
  - No typed gate yields no mode finding.
  - Unattributed calls are ignored.
- `reconcile-gpp-divergence.test.ts` (injected db):
  - Creates once.
  - A second identical run changes nothing.
  - Removing the call resolves the issue.
  - Two rooms produce two keys.
- `shape-projection.test.ts` (extend):
  - Every stage carries `elementId === stageElementId(key)`.
  - A gate without typed fields renders `typed: false` with null authority.
  - A room pinned to `pull-request-flow-watch@1.0.0` (a frozen prior version) resolves its prior
    definition.
  - The existing liveness-grep and receipt-only tests stay unedited and green.
- `WorkroomShape.test.tsx` (extend):
  - The gate label renders as text.
  - The design link renders only when `hrefFor` returns a value.
  - The divergence marker has text, not only colour.
- `workroom-shape-conformance` and drive tests are unedited, and no conformance or drive file is
  changed by this PR.
- `divergence.test.ts` also asserts that the C-8 detector, fed a captured stop-plan snapshot
  (`stageKey: null`), recomputes the same proposed stage the drive used, and lands on `gate:<prior>`
  for a governed prior stage.
- `drive-snapshot-unchanged.test.ts` (new): for a sequential fixture room, the persisted snapshot
  object built by `workroom-drive.ts` is deep-equal before and after this PR's code is loaded, which
  is the Phase 4 side of AC-3C-SEQ-IDENTICAL.
- `ac-shared-id.test.ts` (new). **This is the AC-SHARED-ID test.**
  1. Compile-side: `elementIdsOf(decompile(def))` for the worked-example shape.
  2. Projection-side: after `reconcileGppShapes` on an injected db, each id has an `EaElement` with
     `infraCiKey = infraCiKeyFor(key, id)`.
  3. Room-side: `projectRoomShape` for a fixture room on that shape yields stages whose
     `elementId`s are the same ids.
  4. Seeded C-6: an attributed call in `draft` to a tool `draft` does not declare. After
     `reconcileGppDivergence`, exactly one open `gpp-c6-reach` issue exists on the
     `gpp:<key>:stage:draft` element, and `projectRoomShape` with the loaded issues puts a marker on
     the `draft` stage. The design-view loader returns the same issue for `stage:draft`.
- Migration: applies on an empty schema, on a copy of a populated schema, and as a re-run after
  only the `ALTER TABLE` applied (the build-gate item 4 procedure in
  `docs/architecture/build-gate-runbook.md`). The index is confirmed partial with `\d "ToolExecution"`.
  No down-migration: migrations are forward-only.

**UX verification** (same environment)

1. Open a live standing room whose shape has a governed stage (for example an inquiry-response-watch
   room).
   - The `send` step shows "gate · unratified" (today's truth), not an invented authority.
   - "Open in design view" lands on the GPP view with `gate:send` focused.
2. Seed (fixture script in the PR, non-prod only) an attributed tool call outside the stage's tools
   and run the reconcile.
   - The marker appears on the room step and on the design element.
   - Remove the seed and re-run. Both markers clear.
3. Open a room pinned to a frozen prior version. It now renders that version's stages, not the
   lifecycle fallback, and the version-mismatch deviation (if present) still shows.
4. Run the dark mode, greyscale and 375 px passes on the room view.
5. Confirm that a room on a shape with no GPP view yet (before the first reconcile) shows no broken
   link. The design row reads "Design view not projected yet".

**Rollout.**

- The migration applies on upgrade init. It rewrites no rows, and the partial index indexes no
  existing rows.
- Divergence issues appear after the next reconcile.
- The room view change is visible on the next deploy.

**Rollback.**

- Revert the code. The nullable column remains unused (forward-only migrations).
- `gpp-*` issues remain as resolved or open history. They can be bulk-resolved by running the
  reconciler with no findings.

**Satisfies:** V-2, V-3, V-4; AC-SHARED-ID (complete).

## Acceptance mapping

| Criterion | Where it is proved | Test |
|---|---|---|
| **AC-SHARED-ID**: every element of a compiled shape has a derived id… | PR-3b-1 (already on main) | `element-ids.test.ts` |
| …that the EA projection writes as its `infraCiKey`… | PR-4a | `ea-projection.test.ts`, `reconcile-gpp-shapes.test.ts` |
| …and the room shape view uses for the same node… | PR-4c | `shape-projection.test.ts`, `ac-shared-id.test.ts` step 3 |
| …and a seeded C-6 divergence appears on that element in both views | PR-4c | `ac-shared-id.test.ts` step 4; UX step 2 |
| **V-1** design view: stages, transitions, gates with owning scope and mode, capability sets, principals | PR-4a (render), PR-4b (edit, DRC on save) | `shape-canvas-graph.test.ts`, `check-draft.test.ts`; UX 4a steps 2–5, 4b steps 1–4 |
| **V-2** runtime view: current stage, bindings in force, gate decision reference, enforcement mode | PR-4c (governance half). Measurement half: workroom flow map F3/F4 | `shape-projection.test.ts`, `WorkroomShape.test.tsx` |
| **V-3** shared identity, in both directions | PR-4a (EA), PR-4c (room → design link; design → room via issue `roomRef`) | `ac-shared-id.test.ts` |
| **V-4** C-6 and C-8 in both views | PR-4c | `divergence.test.ts`, `reconcile-gpp-divergence.test.ts`, `ac-shared-id.test.ts` |
| Spec §8 exports | PR-4a | `export-bpmn.test.ts`, `export-sysml.test.ts`; manual pilot-implementation parse |

V-2's "bindings in force" and "a reference to the gate decision that satisfied each one" can show
data only once a stage declares a binding and a gate mints a permit (the Phase 3b binding follow-up
with BI-69415B68). Until then the overlay shows "no binding declared". That is the truth, and it is
consistent with "A view MUST NOT infer a verdict the records do not contain" (GPP §12.4.2).

## Non-disruption

- **EA canvas users.**
  - `EaCanvas.tsx` is not edited.
  - `EaElementNode.tsx` gains one branch reachable only by `GPP__` elements.
  - The view page gains one branch for `notationSlug === "gpp"`.
  - The `CanvasState` change is an optional field, following the `history` precedent.
  - Generic readers (`view-drawing.ts`) keep working because `nodes` stays keyed by
    `EaViewElement.id`.
  - The new action refusals apply only to `gpp` views.
- **Runtime.** No drive, dispatcher, compiler emission, binding or enforcement change. No persisted
  drive snapshot changes shape: C-8 is derived from what the snapshot already holds. The DRC
  change only adds `not-evaluated` where production cannot see a fact. CI's verdicts are unchanged
  (unedited corpus tests).
- **Rooms.** The only visible change is PR-4c's prior-version resolution, which replaces a fallback
  with the room's real definition. Labels such as "gate · unratified" state current truth.
- **Reconcile.** A new `runDomain` entry. A failure is isolated to that domain. `applySysmlModel`
  writes every element on every run (`sysml-model-seed.ts:200`), so the domain runs only in the
  scheduled or admin reconcile, never on page load. At 47 shapes and about 10 elements each, that is
  roughly 500 updates per reconcile.
- **Skills.** The PR core extraction keeps `emitSeedPullRequest`'s contract, and its tests run
  unedited.

## Spec refinements and open questions

Refinements are recorded here and resolved in PR review. None edits a spec.

1. **Element types, not 15.** §5 says the canvas gets "these" (the 15 constructs) as EA element
   types. The plan seeds one type per §9.1 element kind with a derived id (9 types, with split and
   join separate). The six adornment constructs render from properties.
   - Reason: an EA element needs an `infraCiKey`, and §9.1 derives none for an advisory, checkpoint,
     evidence, escalation, timer or environment boundary.
   - Giving them ids would extend §9.1, and that is a spec change.
2. **`infraCiKey` collides across versions.** §9.1 gives `gpp:<key>:<elementId>`, and every id
   except `shape:` omits the version. A current version and a frozen prior version of the same key
   would therefore share `gpp:<key>:stage:<k>`.
   - The plan projects **current versions only**, with `properties.shapeVersion`.
   - Prior versions render on the canvas from `shapeDocumentFor(key, priorVersion)` without EA rows.
   - A divergence in a room pinned to a prior version lands on the current element only when the
     element id exists in both versions, with the version in `detailsJson`. Otherwise it lands on the
     shape element.
   - Alternative: put the version into the key (`gpp:<key>@<version>:<id>`). That diverges from
     §9.1 and from `infraCiKeyFor` on main (`element-ids.ts:65`). This is **open question Q2**.
3. **What "publish" means on a production install.** The spec says "governed publish" without a
   mechanism. A production image has no source (`codebase-tools.ts:19`). The plan uses two existing
   paths:
   - **Layout-only** changes use the DI-36D36FEBF4BA API PR path, because the sidecar is not compiler
     input and its PR has an empty compile diff (spec §4.3).
   - **Semantic** changes become an `EaSnapshot` plus a backlog item, landed by a delivery workroom
     that runs the compiler on `main`. The running image's compiler can differ from `main`'s, and
     `check:gpp-shapes` byte-compares against `main`'s, so an API PR built from the image could fail
     CI or, worse, encode stale emission.
   - This is **open question Q3**.
4. **"Sidecar round trip with `EaView.canvasState`" (§4.3).** The plan stores the sidecar inside
   `canvasState.gpp.layout` and keeps `canvasState.nodes` keyed by view-element id. It does not
   replace `canvasState` with the sidecar, so the documented `CanvasState` contract and its readers
   are unchanged.
   - Install-local layout persists in `canvasState`.
   - The committed sidecar is the shared copy, reached by proposing.
5. **§9.3 "tool-execution records with stageKey" do not exist.** `ToolExecution` has no stage column
   (`ai-coworker.prisma:1031-1106`; its GPP columns at `:1089-1091` cite a permit). Q1 is decided:
   PR-4c adds `workroomStageRef`.
6. **C-8 for work shapes has no skipped-gate record.** The spec's example is Build Studio's
   `gpp-c8-transition-gate-skipped`. For work shapes the plan maps the drive conformance deviations
   `out_of_order_stage` and `missing_prerequisite_receipt`. It derives their stage from the persisted
   snapshot (`stageKey`, or `nextStageKey` over `currentStageKey` and `receipts`), so the deviation
   type and the persisted snapshot are unchanged.
7. **D-7 and C-9 on the canvas.** A production host cannot import resolver modules or read the source
   tree. The canvas reports both as `not-evaluated` ("checked in CI"), the severity §7.2 already
   defines for checks that cannot run. CI stays authoritative.
8. **Failure and budget stops are drawn without inbound edges.** §4.3's example positions them, and
   §6.1 rule 7 says they "may fire from any marking". Drawing an edge from the last stage would claim
   a path that does not exist.

### Decisions (recorded 2026-10-02)

- **Q1: decided by the founder in chat. Option A.** Add the nullable column
  `ToolExecution.workroomStageRef`, written by the scheduled-run path. PR-4c carries the additive
  migration. It must apply cleanly to any existing data, per AGENTS.md §2.
- **Q4: decided by WWMD (DI-6991AE3D5346, high confidence, eligible for autonomous decision).**
  Only the maintainer install, which is source-capable, may propose platform-shape changes until
  the hive contribution policy covers shapes. Customer installs can view and check shapes but not
  propose them. PR-4b gates proposing on both `manage_ea_model` and a source-capable install.
- **Q2 and Q3: design-review defaults.** These are technical choices owned by the plan reviewers:
  - Q2: current versions only, under the §9.1 keys.
  - Q3: semantic publishing goes through a backlog item and a delivery workroom.
  A reviewer may challenge either one.

The original questions follow, for traceability.

- **Q1. Tool-call stage attribution (V-4 C-6).**
  - Option A (chosen): one additive nullable column `ToolExecution.workroomStageRef`, written by
    the scheduled-run path. C-6 works for every attributed call from the merge onward.
  - Option B (not chosen): no migration. C-6 is computed only from permit observations, so it has no data until
    bindings exist.
  - Prepare a `principle_decide` comparison in PR-4c step 0. The founder decides.
- **Q2. EA key versioning.**
  - Keep §9.1's `gpp:<key>:<elementId>` and project current versions only (recommended; no spec
    change).
  - Or amend §9.1 to include the version so prior versions get EA rows.
- **Q3. Semantic publish path.**
  - Backlog item plus delivery workroom (recommended; the compiler on `main` is authoritative).
  - Or a direct API PR from the install containing the document, sidecar and regenerated files. That
    is faster, but it has a compiler-skew risk and needs the generator to run in the production
    bundle against documents read over the GitHub API (`buildTreeFileReader`,
    `github-api-commit.ts:180`).
- **Q4. Who may propose platform shapes, and on which installs.**
  - The plan gates proposing on `manage_ea_model`.
  - On a customer install, a layout PR would target the repository resolved from its git remote, the
    same behaviour as approved skill changes today.
  - Confirm whether that is wanted, or whether proposing should be limited to source-capable
    installs (the maintainer install) until the hive contribution policy covers shapes.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The diagram shows a construct the runtime does not run | Nodes carry `CONSTRUCT_EXECUTABLE`. Non-executable constructs are labelled "draft only", and the DRC refuses them with `E-NOT-EXECUTABLE` (spec §5.4). |
| R2 | The canvas DRC drifts from the compiler's | `checkShapeDraft` calls the same `parse`, `resolve` and `runDesignRules`. Only facts the host cannot see become `not-evaluated`. The corpus tests run unedited. |
| R3 | A proposal claims success it did not achieve | Every PR status is surfaced verbatim. Approval is set only when the deployed digest equals the snapshot's. |
| R4 | GPP projection rows are hand-edited through generic EA actions and then overwritten | Server action and MCP guards on `gpp` views and types (PR-4b). |
| R5 | Colour carries meaning somewhere | Glyph distinctness test, colour-literal grep and greyscale UX pass on every PR. |
| R6 | Reconcile cost | It runs only in the reconcile pass, about 500 updates per run. `infraCiKey` has no index, but `softRemovePrefix` loads existing rows in bulk, so per-element lookups happen only on create. |
| R7 | The two V-2 overlays (governance here, measurement in the flow map) diverge | One glyph kit (`gpp-glyphs.tsx`). The flow map consumes the renderers. The overlap section assigns each half one owner. |
| R8 | The layout PR targets the wrong repository on a customer install | Resolved by Q4 (DI-6991AE3D5346): `proposeGppShapeChange` refuses unless `readInstallHostProfile().sourceCapable`, and the UI hides Propose. |
| R9 | The prior-version fix changes what some rooms show | It shows their real definition instead of a fallback. Called out in the PR body, with a UX check (PR-4c step 3). |
| R10 | Stage attribution is null for historic calls, and a reviewer reads "no gap" as "conformant" | Unattributed calls are counted and shown as "N calls without stage attribution", never as conformance. |
| R11 | `decompile` stops copying fields once bindings exist (it emits no `binding` today, `decompile.ts`) | `shapeDocumentFor` relies on L2. The registry round-trip test must cover `binding` in the slice that first emits one (Phase 3b follow-up). Noted in that follow-up's scope. |

## Research & Benchmarking

The spec's §13 table stands: `bpmn-moddle`, `bpmn-js` (licence watermark), `bpmnlint`, Camunda 8
coverage, SysML v2 / SysON. The comparisons below are new for the canvas.

| Reference | What it is | DPF adopts | DPF rejects |
|---|---|---|---|
| **Camunda Desktop Modeler element templates** ([docs](https://docs.camunda.io/docs/components/modeler/desktop-modeler/element-templates/about-templates/)); **bpmn-js-properties-panel** ([GitHub](https://github.com/bpmn-io/bpmn-js-properties-panel)) | Domain-specific task types declared as JSON, validated by a JSON Schema that drives the properties panel's fields and error highlighting | A property editor generated from the schema (Zod plus `gppShapeSchemaRegistry` descriptions) rather than hand-built forms per element. Validation shown inline before save. | The bpmn-js stack. It cannot be embedded without its watermark (spec §13), and its model is BPMN XML, not the shape document. |
| **bpmnlint / Camunda modeling guidance** ([bpmnlint](https://github.com/bpmn-io/bpmnlint)) | Rule-id'd lint findings attached to diagram elements while modelling | Findings pinned to elements with a rule id and a jump-to list. That is `GppDiagnosticsPanel`. | Its BPMN hygiene rules. The DRC is the rule set. |
| **Eclipse Sirius Web** ([project](https://eclipse.dev/sirius/sirius-web.html)); **SysON** ([project](https://mbse-syson.org/)) | Open-source low-code modelling platform that separates the domain (semantic model) from the view (how it is drawn and edited); SysON is its SysML v2 modeller | Strict separation of semantic document and representation. Positions live only in the sidecar and `canvasState`, and the compiler never reads them. | Adopting the platform or SysON as a dependency. It is a Java/Spring server stack, and SysON's site says it is not yet production-ready (spec §13). |
| **BPMN 2.0.2 Diagram Interchange** ([OMG spec](https://www.omg.org/spec/BPMN/2.0.2/)) | BPMN keeps diagram geometry (BPMNDI) apart from process semantics | The sidecar is DPF's DI. The BPMN export emits `bpmndi:BPMNDiagram` from the sidecar, so an exported diagram keeps its layout. | BPMN XML as a stored format. Export only (DI-035897A0F1D6). |
| **React Flow custom nodes** (already a dependency, `@xyflow/react` 12) | Custom node and edge renderers with handles | GPP renderers as plain components with a thin node wrapper, so the flow map can reuse them outside the editor. | A second graph library. |

## Traceability

| Deliverable | PR | Objectives (spec §12) | Acceptance | Backlog |
|---|---|---|---|---|
| GPP notation seed, glyph kit, renderers, read-only design view, sidecar handling | PR-4a | OBJ-VISIBLE-DESIGN, OBJ-NOTATION | AC-SHARED-ID (projection half) | BI-F8D4C529 |
| EA projection with shared ids | PR-4a | OBJ-VISIBLE-DESIGN | AC-SHARED-ID | BI-F8D4C529 |
| BPMN-subset and SysML v2 exports | PR-4a | OBJ-NOTATION | (spec §8) | BI-F8D4C529 |
| Typed property editor, DRC on save, governed propose | PR-4b | OBJ-DRC, OBJ-VISIBLE-DESIGN | V-1 | BI-F8D4C529 |
| V-2 governance overlay, V-3 links, V-4 divergence | PR-4c | OBJ-VISIBLE-DESIGN | AC-SHARED-ID | BI-F8D4C529 |
| Measurement half of V-2 (data boxes, heat, lanes, `WorkroomFlowMap`) | not this plan | — | flow-map OBJ-SEE / OBJ-MEASURE | Flow-map F1–F4 (epic not yet filed) |
| Binding-in-force and permit-reference rows of V-2 | Phase 3b binding follow-up | OBJ-COMPILE | — | BI-6DA17863 with BI-69415B68 |

Before `record_plan_backlog_coverage`, BI-F8D4C529 must leave triage, and the Q1 to Q4 decisions
above must be recorded on the item.

## Tasks

### PR-4a

- [ ] Claim a workroom on BI-F8D4C529 (shape declared at claim). Branch `feat/gpp-canvas-design-view` from a fresh `origin/main`.
- [ ] `seed-ea-gpp.ts`, seed step, seed test.
- [ ] `runtime-document.ts`, `tool-badge.ts`, `shape-canvas-graph.ts`, `layout-sidecar.ts`, `ea-projection.ts`, `runtime-resolve-sources.ts` (facts only), with tests.
- [ ] `reconcile-gpp-shapes.ts` and its domain line. Layout-index step in `build-gpp-shapes.ts`; `check:gpp-shapes`.
- [ ] `CanvasState.gpp` type.
- [ ] Glyph kit, renderers, `GppShapeCanvas` (read-only), `GppExportMenu`. View page branch; `EaElementNode` `GPP__` branch.
- [ ] `export-bpmn.ts`, `export-sysml.ts`, `gpp-shape-export.ts` action, with tests. Manual pilot-implementation parse of the worked example.
- [ ] Glyph distinctness and colour-literal tests. Fast local gate. UX steps 1–8 with screenshots; record evidence.
- [ ] ux-fit review (skill `dpf-ux-fit-review`). PR.

### PR-4b

- [ ] Branch `feat/gpp-canvas-propose`. Tri-state resolver fact in `resolve.ts` / `drc.ts`; corpus tests unedited.
- [ ] `check-draft.ts` (over `compileShapeDocument`), `ea-view-status.ts`, `proposal-format.ts`, and `gpp-shape-draft.ts` actions (step 0 authority: `manage_ea_model` + source-capable host; `manage_backlog` for semantic), with tests.
- [ ] Deployed-pair approval in `reconcile-gpp-shapes.ts`, with tests.
- [ ] Extract `source-file-pull-request.ts`; skill wrapper on it; skill tests unedited.
- [ ] Guards in `lib/actions/ea.ts` and `ea-ontology-pack.ts` (list confirmed in step 1).
- [ ] Editor components, palette, property editor, diagnostics panel, propose dialog, with tests.
- [ ] Fast local gate. UX steps 1–8. ux-fit review. PR.

### PR-4c

- [ ] Branch `feat/gpp-runtime-overlay`. Migration for `ToolExecution.workroomStageRef` (partial index), plus the attribution write (files named in step 1).
- [ ] `divergence.ts` (with `GPP_DIVERGENCE_ISSUE_TYPES`; C-8 derived from the snapshot, no change to the deviation type), `reconcile-gpp-divergence.ts`, `drive-snapshot-unchanged.test.ts`.
- [ ] `shape-projection.ts` (prior-version resolution, element ids, gate and binding facts, injected design inputs); room loader; `WorkroomShape.tsx`; design-view markers.
- [ ] `ac-shared-id.test.ts`. The migration applies cleanly to every data state. Fast local gate. UX steps 1–5. ux-fit review. PR.
- [ ] GPP §12.4.3 and Annex A rows V-1 to V-4 updated (see "Documentation impact"). Record execution evidence and mark BI-F8D4C529 done after acceptance.

## Verification

- Per PR, run `pnpm --filter web exec vitest run` on the new and touched suites:
  - `lib/gpp/shape-language`
  - `lib/ea/reconcile-gpp-*`
  - `components/ea/gpp`
  - `lib/work-management/shape-projection*`
  - `components/workspace/workroom/WorkroomShape*`
  - `lib/skills/seed-pull-request*`
  - `lib/actions/ea*`
  - `packages/db` `seed-ea-gpp`
- `pnpm --filter web typecheck` and `pnpm --filter web check:gpp-shapes`.
- `pnpm --filter web build` runs once, in the cloud merge queue (tiered gate, AGENTS.md §4).
- Migration: PR-4c only (`ToolExecution.workroomStageRef`, partial index).
- UX verification on the contributor preview runtime through the shared non-prod lease, never by
  rebuilding the live portal. Each PR covers light, dark, greyscale, keyboard and 375 px.
- Build Studio check: no PR touches `apps/web/lib/build/` or `apps/web/lib/explore/`. Exception:
  `lib/explore/ea-types.ts`, which is the EA type module the canvas already uses, despite its path.

## Pre-existing findings (noted, not fixed here)

- The generic EA renderers use hex constants: `LAYER_COLOURS` in `lib/explore/ea-types.ts`, and
  literals in `EaElementNode.tsx` and `BpmnGatewayNode.tsx`. This breaks AGENTS.md §9 in dark mode
  and per-org branding.
  - It is out of scope because constraint 1 keeps `EaCanvas` users' rendering unchanged.
  - Recommend a separate backlog item to move EA layer colours to tokens (the same move the
    flow-map spec plans for `PORTFOLIO_COLOURS` in its F5).
- `EaView.status` (`ea-architecture.prisma:484`) and `EaConformanceIssue.issueType` (`:541`) are
  free-form `String` columns carrying closed sets. This breaks AGENTS.md §8. Phase 4 declares its
  values as const tuples (`EA_VIEW_STATUSES`, `GPP_DIVERGENCE_ISSUE_TYPES`) and does not convert the
  columns, because a Prisma enum would be a migration over every existing row. Recommend a separate
  backlog item.
- `EaCanvas.tsx:822` styles the status badge with hex backgrounds (`#1e3a2f`, `#1a1a2e`), part of
  the same §9 debt as above.
- `sysml-model-seed.ts`'s header says "a no-delta run makes no writes". The code updates every
  existing element on each run (`:190-201`), so a re-run reports `applied`, never `noop`. This does
  not block Phase 4 (see R6). It is worth a small fix in its own PR.

## Documentation impact

- **PR-4a**: `docs/user-guide/architecture/index.md` gains a section on reading a GPP shape view
  (glyphs, labels, "unratified", "draft only", exports).
- **PR-4b**:
  - The same page gains editing and proposing, and what happens after a proposal: a layout PR, or a
    backlog item.
  - `docs/architecture/agent-skill-index.md` is unaffected, because no skill changes.
- **PR-4c**:
  - `docs/architecture/gated-permissions-process.md` §12.4.3 and Annex A rows V-1 to V-4 move from
    "Partial / Not built" to what shipped, citing the files. V-2's binding rows stay "Partial" until
    bindings exist.
  - The workroom user guide page that explains the room shape view gains the gate label and the
    design link.
- The flow-map spec's §15 note ("Annex A: note that V-2 is defined here") is honoured by stating in
  Annex A that V-2's measurement half is defined there and its governance half here.
- No AI coworker prompt changes in this phase.
