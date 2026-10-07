---
status: draft
---

# GPP Phase 5: Build Studio as one declared work shape

| | |
|---|---|
| Date | 2026-10-06 |
| Epic | EP-B932453F |
| Backlog | BI-D37B2C13 (child of BI-6DA17863) |
| Parent design | [GPP shape notation, execution semantics and compiler](2026-10-02-gpp-shape-notation-and-compiler-design.md), §3.1 item 2, §6.2, §6.4, §10, §11 (Phase 5 row). Approved; **not edited** by this spec. |
| Sibling designs | [Phase 3c drive graph execution](2026-10-02-gpp-phase-3c-drive-graph-execution-design.md) (BI-8875C9DF); Phase 4 canvas plan `docs/superpowers/plans/2026-10-02-gpp-phase-4-canvas-design-view.md` (BI-F8D4C529) |
| Normative owner | [GPP](../../architecture/gated-permissions-process.md) §2.1.1, §7, §12.4, Annex C |
| Related open decision | BI-5D59A982 (whether `save_phase_handoff` evaluates the WWMD plan-advancement gate) |
| Verified against | `origin/main` at `b48b6d908a` (2026-10-06). Phase 3c PR-3c-1 is merged (#6021, `fb6cdad042`); no Phase 3c construct flag is on. |

## 0. Founder constraint and how this design meets it

The backlog item states the constraint: Build Studio changes only as defect fixes. The conversion
must preserve behaviour, use characterization tests, and sit behind L1-style equality and an
unchanged binding diff. The founder restated it for this design: **no endless breakage to Build
Studio**.

This design meets it structurally, not by care:

1. **An allowlist, not a denylist, of files a Phase 5 PR may change.** Rather than define "a Build
   Studio file", every path in `git diff --name-only origin/main...HEAD` must match:
   ```text
   ^(apps/web/lib/gpp/|apps/web/lib/work-management/declared-flows/|apps/web/lib/work-management/generated/(declared-flows|[a-z0-9-]+\.flow)\.generated\.ts$|apps/web/scripts/build-gpp-shapes\.ts$|apps/web/lib/docs/doc-impact\.generated\.json$|docs/)
   ```
   Any other path fails the check. Everything Build Studio runs on (`lib/build/`, `lib/explore/`,
   `lib/actions/`, `lib/decision-perspective/`, `lib/mcp/`, the routes, the registry and the drive)
   is therefore outside what a Phase 5 PR can touch. This is the Phase 3c rule (AC-3C-BUILD-STUDIO)
   made mechanical.
2. **No runtime reader.** The compiled Build Studio shape is imported only by tests and by the
   generator. It is not registered in the work-shape registry, so no room can claim it, the drive
   never runs it, and no permit is minted from it.
3. **Declare first, change later.** The declared shape describes what Build Studio does today,
   including its gaps. Every gap is a finding on a shrink-only list. Closing a gap that changes
   behaviour (for example BI-5D59A982) remains its own decided PR.

## 1. Problem

GPP §12.4.1 requires a machine-readable model that the runtime either executes or is verified
against, with a declared gate set per transition that every path enforces (C-8). Annex C.3 item 1
says Build Studio fails this first: its flow is implicit across several modules. Annex C.4 step 1
is to express it as one declared work shape.

Build Studio's flow lives today in:

| Part | Source |
|---|---|
| Phases | `BuildPhase` and `PHASE_ORDER`, `apps/web/lib/explore/feature-build-types.ts:475`, `:570-572` |
| Allowed transitions | `ALLOWED_TRANSITIONS`, `feature-build-types.ts:705-716`; `canTransitionPhase` `:718-722` |
| Evidence gates per transition, by build type and size | `GATE_REQUIREMENTS` (`apps/web/lib/explore/build-process-matrix.ts:73-90`), the per-type gate sets (`:137-230`), `DEFAULT_LIFECYCLE_MATRIX` (`:336-363`), `checkPhaseGate` (`:805`) |
| Plan → build gate profiles, five paths | `PLAN_TO_BUILD_GATE_SET`, `PLAN_TO_BUILD_GATE_PROFILES`, `transitionPlanToBuild` in `apps/web/lib/build/plan-to-build-transition-core.ts:45-50`, `:140-251`, `:313-340` |
| WWMD gates | `evaluateBuildStudioPlanAdvancementGate` (`apps/web/lib/decision-perspective/build-studio-gate.ts:109`); `evaluateBuildStudioShipGate` and `evaluateBuildStudioIdeateStartGate` (`build-studio-ship-gate.ts:21`, `:87`) |
| Capability set per phase | `buildPhases` on each tool (`apps/web/lib/mcp-tool-types.ts:162-164`), applied by `filterToolsForCoworkerRuntime` (`apps/web/lib/actions/coworker-tool-filter.ts:70-77`) |
| Build engine containment | A coding CLI run inside the sandbox container with permission prompts off (`apps/web/lib/build/claude-dispatch.ts:174`; `codex-dispatch.ts:103`; `opencode-dispatch.ts:339`; ideate research `ideate-dispatch.ts:2`, `:489`) |

The compiler (Phase 3b) can now turn a shape document into a checked definition. The question for
Phase 5 is how to use it on Build Studio without changing Build Studio.

## 2. Scope

**In scope.**

- A hand-authored GPP shape document for Build Studio, `build-studio@1.0.0`, compiled by the
  existing pipeline (parse, schema, resolve, design rules, emit; `compile.ts:9-14`).
- The plan → build gate set taken from `PLAN_TO_BUILD_GATE_PROFILES`, read, not copied.
- The build sandbox declared as an environment boundary (construct 15) with its egress.
- A realization map: each model element to exactly one runtime artifact (GPP §12.4.1, bullet 4),
  plus every transition path and its gate modes.
- Conformance tests that verify the running configuration against the model whenever either
  changes (GPP §12.4.1, bullet 2, the "verify" branch).
- The compiler changes this needs, scoped so the one compiled work shape
  (`inquiry-response-watch`) recompiles byte-identically.

**Out of scope.**

- Running Build Studio through the workroom drive (§4 explains why).
- Changing any Build Studio gate, path, phase, tool tag or prompt.
- Routing review → ship (Annex C.4 step 2) or unifying the plan → build profiles (BI-5D59A982).
- Enforcing any binding. `GPP_BINDING_ENFORCEMENT` stays empty
  (`apps/web/lib/gpp/binding-enforcement.ts:54`).
- Canvas rendering (Phase 4) and an automated C-6 report. Both get named follow-ups (§11).
- Merging Build Studio's phases with the delivery shape that Build Studio rooms already claim
  (§4.4).

## 3. Grounding: what exists and how this design uses it

| Existing work | Where | Use |
|---|---|---|
| Compile pipeline | `apps/web/lib/gpp/shape-language/compile.ts:64-82` | Unchanged. The Build Studio document goes through it like any other |
| Design rules | `drc.ts:165-494` | Two corrections (§7.3, §7.4) and one evaluated clause (§7.5) |
| C-7 build-sandbox clause, reserved for Phase 5 | `drc.ts:199-206` (standing `not-evaluated`, code `C-7/SANDBOX-CONTAINMENT`, `diagnostics.ts:99`) | Evaluated for declared flows (§7.5) |
| Executable flags | `executable-constructs.ts:66-83`; `environment-boundary: true`, the four graph constructs `false` | Unchanged. The Build Studio document uses no graph construct (§6) |
| Gate ratification table and two-way test | `gate-ratification.ts`; `gate-ratification.test.ts:27`, `:76` | One new scope for Build Studio; the two-way test also reads declared flows (§7.6) |
| Generator | `apps/web/scripts/build-gpp-shapes.ts` ("Later phases extend this script; they do not add a second one") | Gains a second document root for declared flows (§7.2) |
| Registry guard for compiled shapes | `apps/web/lib/work-management/work-shapes.ts:377-384` (every `GENERATED_WORK_SHAPES` entry must be the registered object) | Why the Build Studio document cannot sit in `shape-documents/` (§7.2) |
| Migration precedent | `inquiry-response-watch.gpp.json`, `migration-proof.test.ts:85-137` | The equality style this phase adapts (§8) |
| Bindings and enforcement | `bindings.ts:60-80` (two hand-declared bindings); `binding-enforcement.ts:54`, `:61`; `bindings-emit.ts:51-80` (drafts, fixture-tested only) | Read; the environment binding is declared only (§9) |
| Direct phase-write scanner | `findDirectPhaseWrites` (`apps/web/lib/gpp/direct-phase-writes.ts:120`) and `KNOWN_DIRECT_BUILD_PHASE_WRITES` (`:170-195`) | Reused to inventory every transition write, not just writes to `build` (§10.3) |
| Unmediated sites | `KNOWN_UNMEDIATED_EXECUTE_SITES` (`unmediated-execute-sites.ts:88-100`): `lib/build/*` holds 16 direct sites across 7 files | C-9 warnings on ship and build tools; unchanged |
| Build Studio rooms | `attachBuildStudioWorkCapsule` binds the item's delivery shape (`apps/web/lib/work-capsules/build-studio-attachment.ts:43-70`, executor kind `build-studio` at `:110`) | Why Build Studio is not a second drive shape (§4.4) |

## 4. Decision 1: executed by the drive, or declared and verified

### 4.1 The two options

**Option A. Build Studio's lifecycle becomes a `WorkShapeDefinition` that the workroom drive runs.**
The drive would dispatch each phase, earn receipts from evidence, and own the advance.

**Option B. Build Studio's lifecycle is a declared shape that the existing orchestrator conforms
to.** The document compiles and is checked like any shape. It is never registered, claimed or
driven. Conformance tests verify Build Studio's code against it in CI, and the design view (Phase
4) can render it.

### 4.2 Evidence

| Question | Evidence | Favours |
|---|---|---|
| Who owns Build Studio's state and transitions today? | `FeatureBuild.phase`, written by `transitionPlanToBuild` (`plan-to-build-transition-core.ts:331`), `advanceBuildPhase` (`apps/web/lib/actions/build.ts:556-560`), `advanceReviewedBuildToShip` (`ship-on-review-approval.ts:353-356`), `save_phase_handoff` (`build-evidence-extra-pack.ts:328`), the gauntlet (`gauntlet-repair.ts:234-236`, `:280`) and more (§10.3). The drive owns `workspaceState.workroomDrive`, a different record | B. A would make two writers of one lifecycle, or rewrite every path |
| Can the drive run it as is? | The drive advances one stage per tick on a completing receipt (`nextStageKey`, `apps/web/lib/work-management/drive-resolution.ts:127-141`; `resolveDrivePlan` `:143-260`), on a 15-minute cadence. Build Studio transitions are synchronous user actions and reconciler steps with path-specific gate sets | B |
| Is the lifecycle one definition? | No. The phase graph is one, but the evidence gates vary over 16 (type × size) cells with three phase subsets (`build-process-matrix.ts:232-234`, `:336-363`), and the plan → build gate set varies over five paths (`plan-to-build-transition-core.ts:140-251`) | B. One `WorkShapeDefinition` has one advance per stage |
| What happens to the rooms? | Build Studio rooms already claim a delivery shape (`build-studio-attachment.ts:43-70`), and the drive drives every room with a `workShape` claim (`loadStandingRoomIds`, `apps/web/lib/queue/functions/workroom-drive-data.ts:349-371`). A room holds one shape claim; Phase 3c relies on "one shape version per room" (3c design §9.1) | B. A forces a choice between two shapes on one room, which is a behaviour change either way |
| What does registry membership cost? | `listWorkShapes()` order is pinned by `migration-proof.test.ts:125-127`; the ratification two-way test reads the registry (`gate-ratification.test.ts:27`, `:76`); a registered shape becomes claimable through `rebind_workroom_shape` and room claims | B |
| Does GPP accept B? | §12.4.1 bullet 2: "either execute that model directly … or verify the running configuration against it whenever either one changes" | B satisfies the second branch |
| Founder constraint | §0 | B. A is a rewrite of Build Studio orchestration |

### 4.3 Recommendation

**Option B.** The document is a design-view and conformance artifact. It meets §12.4.1 by
verification. Moving Build Studio onto the drive (Option A) is not ruled out for ever, but it is a
behaviour change and needs its own design, decision and shadow period. Nothing in Phase 5 makes it
harder: the document, ids and realization map are what Option A would start from.

### 4.4 Relationship to the delivery shapes

Build Studio rooms carry a delivery shape (`delivery-small`, `-medium`, `-large`, and so on;
`apps/web/lib/work-management/delivery-shapes.ts:53-86`). For a medium item that shape is
design-note → implement → merge → accept (`delivery-shapes.ts:186-215`), and the drive and
initiative readiness read it. Annex C.3 item 1 names this as the second, parallel model.

Phase 5 does not merge the two. It records, in the realization map, which Build Studio phase
boundary corresponds to which initiative-readiness lane, because the code already ties them: the
plan → build paths call `checkBuildPhaseInitiativeReadiness` or `enforceBuildInitiativeReadiness`
with target `implementation` (`plan-to-build-transition-core.ts:288-302`), and review → ship calls
it with target phase `ship` (`ship-on-review-approval.ts:310-312`). Merging the models is a
separate decision with its own owner.

## 5. The document

### 5.1 Which Build Studio it describes

Two facts make "Build Studio" more than one flow. The document picks one reading of each and the
realization map declares the rest.

- **Lifecycle cell.** The document describes the default cell, (feature, medium), which the code
  calls "the baseline. Every other cell is a delta against this" (`build-process-matrix.ts:236-245`,
  `POLICY_FEATURE_STANDARD`). The other 15 cells are declared as computed deltas (§10.2).
- **Configuration.** The document describes the shipped default configuration:
  `DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE` unset, which `getAutonomousPlaybookMode` reads as `off`
  (`apps/web/lib/build/build-studio-config.ts:303-310`). Two WWMD gates run only when that mode is
  `shadow` or `enforce` (`ship-on-review-approval.ts:217-218`; `ideate-on-approval.ts:258-259`). They
  are declared as configuration-dependent gates in the realization map, not as document gates,
  because the document's gate `mode` admits only `shadow` and `enforced`
  (`work-shapes.ts:74-87`) and GPP's third mode, `off` (§7 element 11), has no value in the
  schema. See §12 item 6.

### 5.2 Stages

`key: "build-studio"`, `version: "1.0.0"`, `triggers: ["claim"]`, `collaborationShape:
"change-consequential"`. Five stages, in `PHASE_ORDER` order. No `flow` block: the document is
sequential (§6).

| Stage | Accountable principal | Exit advance | Evidence (proposed mapping, §5.4) | `tools` | `binding` |
|---|---|---|---|---|---|
| `ideate` | `role:build-owner` | `status-change` | `design-doc`, `architecture-review-receipt` | every tool whose `buildPhases` includes `ideate` | none (§9.3) |
| `plan` | `role:build-owner` | `governed-decision`, scope `build-studio-plan-advancement`, typed gate (§5.3) | `plan-doc`, `plan-review-receipt`, `decision-record` | every tool tagged `plan` | none |
| `build` | `role:build-owner` | `status-change` | `passing-test` | every tool tagged `build` | `build-studio-sandbox@1`, `environment` (§9) |
| `review` | `role:build-owner` | `status-change` | `acceptance-receipt`, `ux-verified` | every tool tagged `review` | none |
| `ship` | `role:build-owner` | `status-change` | `pr-gate`, `merged-sha`, `deployment-record` | every tool tagged `ship` | none |

Stops: success "The build reaches `complete`" (`proceed`); failure "The build moves to `failed`"
(`inconclusive`); budget "The build is `abandoned`, escalated to its owner"
(`awaiting-person`), which matches `abandoned` meaning "Escalated to owner"
(`feature-build-types.ts:586`, `:713-715`).

Why each choice:

- **`role:build-owner` on every stage.** Every Build Studio phase action is the build owner's: the
  UI path refuses anyone else (`build.ts:359`). The executing agents are participants, not the
  accountable principal. Annex C.3 item 3 says the agent identity per phase is not one thing yet,
  so the document does not invent one. C-4 checks agent principals only (`drc.ts:249-279`), so for
  `role:` stages it is honestly not exercised. Step 3 of Annex C.4 stays open (§11).
- **Stage `tools` are the `buildPhases` sets, exactly.** The conformance test (§8, P2) computes them
  from `PLATFORM_TOOLS` and fails on any difference. A hand-authored list that drifted from the tags
  would be the second source of truth §1 forbids.
- **Only `plan` is governed.** Under the default configuration the only blocking doctrine gate on
  a forward transition is the WWMD plan-advancement gate on the canonical path. The other exits
  are evidence checks (`checkPhaseGate`), initiative readiness, and path-local checks, which GPP
  treats as preconditions (§7 element 8), not as gates of an owning scope.

### 5.3 The plan gate

```json
{
  "authority": "wwmd",
  "gateKey": "build-studio",
  "mode": "enforced",
  "blocking": true,
  "resolution": "doctrine-then-human",
  "resolver": {
    "module": "lib/decision-perspective/build-studio-gate",
    "exportName": "evaluateBuildStudioPlanAdvancementGate"
  },
  "advisory": [{ "authority": "wsid", "blocking": false }],
  "escalation": { "role": "role:build-owner", "whileWaiting": "hold" }
}
```

- **Taken from `PLAN_TO_BUILD_GATE_PROFILES`.** The declared gate is the canonical path's profile,
  `advance-build-phase`: `wwmdMode: "blocking"`, every gate `blocking`
  (`plan-to-build-transition-core.ts:141-170`). Annex A and Annex C.2 call this the canonical path.
  The other four profiles are not copied into the document. The conformance test reads all five
  and computes each path's divergence from the declared set (§10.1).
- **Why canonical, not weakest.** GPP §12.4.1 bullet 3 says to declare the complete gate set for
  the transition and requires every path to enforce it. The declared set is therefore the intended
  set, and a path that enforces less is a C-8 finding. Declaring the weakest path's set would hide
  C-8.
- **Resolver path form.** `lib/…`, web-root relative, with no `@/` alias and no extension. The
  resolve step accepts only `^lib/…` (`RESOLVER_MODULE_PATTERN`, `resolve-sources.ts:62-63`), and the
  two existing bindings use that form (`bindings.ts:66`, `:80`). An `@/lib/…` path fails the pattern,
  `importResolver` returns `false` (`resolve-sources.ts:96-103`), and D-7 refuses the gate.
- **The preconditions are the canonical profile's `callerChecksBefore` too.** `advance-build-phase`
  declares `["build owner", "Approve Start", "canTransitionPhase"]`
  (`plan-to-build-transition-core.ts:158`). The schema has no preconditions element (§12 item 6), so
  the realization map declares that set as the plan exit's preconditions, and P3 diffs every
  profile's `callerChecksBefore` against it. Without this, `save-phase-handoff` skipping Approve
  Start (`:226`, `["auto-advance requested", "canTransitionPhase"]`) would be invisible.
- **`gateKey: "build-studio"`.** Annex C.2 records that the evaluator gate key is `build-studio`,
  projected to WWMD.
- **`doctrine-then-human`.** WWMD resolves; `escalate` goes to the Build Studio owner (Annex C.2;
  the gate's options are start, revise plan, escalate to owner).
- **`advisory: wsid`.** Acumen profession consults are advisory and never change the verdict (Annex
  C.1; `build-studio-ship-gate.ts:28-33`, `:58-59` for the same rule at ship).
- **Ratification.** D-8 refuses a typed gate whose scope is not ratified (`drc.ts:373-382`). The
  new scope needs a ratified entry with a DI before the content PR merges. That is the founder's
  decision (`gate-ratification.ts:16-18`). See Q1 (§14).
- **`doctrine-then-human` against the ratification test.** `gate-ratification.test.ts:100-118`
  requires every table entry to be `enforced`, blocking and `accountable-human`, because every
  registry governed stage is a `role:` stage the drive never executes. That premise does not hold for
  Build Studio's plan gate: the WWMD evaluator resolves it and escalates to the owner. Two options:
  ratify it as `accountable-human` (which misstates who resolves it today), or narrow that assertion
  to scopes used by registry shapes and let P3 check declared-flow gates against their source.
  **Recommended: narrow the assertion** (PR-5a, task 5a-7), recorded in the PR body. D-8 still
  compares the declared gate field by field with the ratified entry (`drc.ts:378`).

### 5.4 Evidence mapping

`checkPhaseGate` checks `GATE_REQUIREMENTS`, not evidence kinds. The document needs
`WORK_SHAPE_EVIDENCE_KINDS`. The proposed mapping, kept in the realization map and checked by test:

| Gate requirement | Evidence kind |
|---|---|
| `designDoc-present` | `design-doc` |
| `designReview-passed`, `designReview-not-failed-if-present` | `architecture-review-receipt` |
| `buildPlan-present` | `plan-doc` |
| `planReview-passed` | `plan-review-receipt` |
| `verification-typecheck-passed` | `passing-test` |
| `acceptance-evaluated`, `acceptance-all-met-if-array` | `acceptance-receipt` |
| `uxVerification-not-blocking` | `ux-verified` |
| `fixContext-complete`, `happyPathIntake-ready`, `verification-depth-satisfied` | no evidence kind; declared as preconditions in the realization map |

A stage's `evidence` is the mapped requirements of its exit transition in the default cell
(`FEATURE_FULL_GATES`, `build-process-matrix.ts:137-155`). `review → ship` re-checks `designDoc-present`
and `buildPlan-present`; the realization map records them as re-checked preconditions rather than
duplicating the kinds on `review`.

## 6. Decision 2: which Phase 3c constructs Build Studio needs

| Build Studio behaviour | GPP construct | Needed in Phase 5? |
|---|---|---|
| review → build send-back (`ALLOWED_TRANSITIONS.review`, `feature-build-types.ts:709`) | 13 rework edge (PR-3c-3, `rework-edge`) | **Not representable faithfully even after PR-3c-3.** See below |
| Ship forks (PR, promotion) that must all finish before `complete` (`apps/web/lib/build-flow-state.ts:449-493`) | 12 parallel split/join | No. The forks are inside the `ship` stage; the stage completes when all forks are terminal |
| xlarge decomposition into child builds (`approve-decomposition.ts:620`) | 14 sub-shape | No. Children are separate builds with their own lifecycle; the parent is not modelled as waiting on them |
| Inert-build reaper sets `abandoned` (`inert-build-reaper.ts:213`) | Interrupting timer | Excluded by the parent (§6.1 table). Modelled as the budget stop |

**Why the rework loop waits.** The parent's rework semantics are: taken only on the stage gate's
`refuse` verdict, bounded by `maxIterations`, and on exhaustion the token goes to the budget stop
(parent §6.1 rule 6; interpreter as cited in 3c §6.2). Build Studio's send-back matches one of
these and differs on two:

1. **Trigger (differs).** The gauntlet or a semantic review sends the build back
   (`routeGauntletFailureToRepair`, `gauntlet-repair.ts:170`; `GauntletFailure.source` `:22-35`), not
   a refusal by the review stage's gate. Under default configuration the review stage has no gate.
2. **Exhaustion (matches).** After `GAUNTLET_REPAIR_MAX_ATTEMPTS = 2` (`:15`, `decideGauntletRepair`
   `:50-58`) the gauntlet calls `escalateBuildToHuman` (`:194-212`), which writes `phase: "abandoned"`
   (`escalate-build-to-human.ts:294-299`). That is the document's budget stop, so exhaustion lands
   where the parent's rule sends it. Review → abandoned is a realization-map row (§10.1).
3. **Bound (differs).** The owner can also send a build back by hand through `advanceBuildPhase`
   (`review → build` is allowed, `feature-build-types.ts:709`), with no bound. S-5 requires every
   cycle to be bounded.

Differences 1 and 3 are enough: declaring `review → build` as a rework edge with
`maxIterations: 2` would state a semantics Build Studio does not have. Phase 5 therefore **does not
depend on any Phase 3c PR**. The document stays sequential, and the send-back is declared in the
realization map as a transition the notation cannot yet express, attached to `stage:review`. Drawing
it later needs PR-3c-3 *and* a decision on how a gate-less, partly unbounded send-back maps to the
notation. That belongs to BI-6DA17863's owner, not to Phase 5.

Sequencing consequence: Phase 5 can merge before, during or after the remaining 3c PRs. It must not
merge a document that uses a construct whose flag is off. The design rules already refuse that
(`drc.ts:464`).

## 7. Compiler changes

### 7.1 Principle

Every change is scoped so the one compiled work shape, `inquiry-response-watch`, recompiles
byte-identically and `check:gpp-shapes` passes on main unchanged. Declared-flow behaviour is opt-in
by document root.

### 7.2 A second document root: declared flows

- Source: `apps/web/lib/work-management/declared-flows/<key>.gpp.json`.
- Output: `apps/web/lib/work-management/generated/<key>.flow.generated.ts`, plus
  `generated/declared-flows.generated.ts` exporting `GENERATED_DECLARED_FLOWS`.
- `listGeneratedShapeModules` matches only `.shape.generated.ts` (`build-gpp-shapes.ts:78`,
  `:126-133`), so the flow module never enters `GENERATED_WORK_SHAPES`, and the registry guard
  at `work-shapes.ts:377-384` never sees it.
- **Orphans.** For the same reason, today's orphan rule (`build-gpp-shapes.ts:227-243`: a generated
  module with no source document is stale under `--check` and removed on write) would never see a
  `.flow.generated.ts` file. PR-5a adds `listGeneratedFlowModules` (suffix `.flow.generated.ts`) and
  feeds it to the same orphan rule. `declared-flows.generated.ts` is an output, not an orphan.
- **Generator tests** live in `apps/web/lib/gpp/shape-language/` (`generated-integrity.test.ts`,
  `determinism.test.ts`), not beside the script. PR-5a extends those.
- **Binding drafts.** The generator does not call `emitBindingRecords` for either root
  (`bindings-emit.ts:24-25`: nothing writes a draft or reads one at runtime). PR-5b adds a test that
  asserts the draft `emitBindingRecords` *would* produce for the Build Studio document (§9.3). It is
  never written to disk and never added to `GPP_BINDINGS`.
- The emitted module uses the existing `emitShapeModule` and the same type import, because it sits
  in the same `generated/` directory (`emit.ts:171-172`).
- A test fails if a declared-flow key equals a registered work-shape key.

Why not `shape-documents/`: a document there is compiled into `GENERATED_WORK_SHAPES`, and
`work-shapes.ts:377-384` throws unless the shape is registered in `ALL_SHAPES`. Registration is
Option A by the back door.

### 7.3 Known design-rule findings, for declared flows only

An honest Build Studio document will fail some design rules. That is the point of modelling it
(Annex C.3). The O/A/I tools that drive the entry rules, read from their declarations:

| Tool | Consequence | `buildPhases` |
|---|---|---|
| `release_nonprod_environment_lease` | authority (`nonprod-lease-pack.ts:273`) | all five (`:274`) |
| `recover_sandbox` | irreversible (`sandbox-pack.ts:92`) | build, review, ship (`:93`) |
| `create_portal_pr` | outward (`build-lifecycle-pack.ts:152`) | ship (`:154`) |
| `deploy_feature` | irreversible (`build-lifecycle-pack.ts:134`) | ship (`:135`) |
| `execute_promotion` | irreversible (`release-pack.ts:69`) | ship (`:70`) |

`provision_build_engine`, `reconcile_build_engines` (`build-engine-pack.ts:39-40`, `:58-59`) and
`propose_leave_decision` (`leave-decision-pack.ts:30-32`) are side-effecting and tagged for build,
but declare no `consequence` and are not on `ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES`
(`consequential-tool-policy.ts:37-46`), so `classifyConsequentialTool` returns
`ordinary-mutation`, `consequential: false` (`:132-137`). They do not trigger entry rules.

Expected findings, to be confirmed by the PR-5b first compile (the generator's refusal lines; plan
task 5b-2) before the list is written:

| Finding | Element | Why |
|---|---|---|
| C-1 clause 2 | `stage:ideate` | The start stage holds an authority tool (the lease) and is entered by its trigger (`drc.ts:398-403`) |
| D-1 | `stage:ideate` | Status change into `plan`, which holds the lease (`drc.ts:415-425`) |
| D-3 | `gate:plan` | `build` holds an irreversible tool (`recover_sandbox`), and the plan gate has no checkpoint with `exactAction: true` (`drc.ts:445-456`) |
| D-1 | `stage:build` | Status change into `review`, which holds `recover_sandbox` and the lease |
| D-1 | `stage:review` | Status change into `ship`, which holds outward and irreversible tools. Under default configuration only evidence and readiness guard entry into ship |
| `C-7/SANDBOX-CONTAINMENT` | `stage:ideate`, `stage:review` | Both act in the sandbox (§7.5) and carry no environment binding (§9.3) |
| C-9 (warning, not listed) | ship and build tools with direct sites | `unmediated-execute-sites.ts:94-100`. Warnings never block |

Not a finding but asserted by test: the binding-record draft that `emitBindingRecords` would produce
for `build` (binding `build-studio-sandbox@1`, owning gate `gate:plan` by §7.4, tools
`recover_sandbox` and `release_nonprod_environment_lease`). `bindings-emit.ts:61-64` drafts any bound
stage with O/A/I tools and does not look at `enforcement`, so an environment binding still yields a
monitor-shaped draft. Phase 5 records this; whether an environment binding should draft at all is
for the binding-attach follow-up (BI-69415B68).

Options considered:

| Option | Verdict |
|---|---|
| Declare stronger gates than the runtime has, so the rules pass | Rejected. C-7 mode honesty; GPP §13 "A shadow gate is reported as enforcement" |
| Leave the gaps out of the document | Rejected. The model would hide the findings Annex C.3 exists to show |
| Skip the design rules for declared flows | Rejected. Loses C-2, C-3, D-4, D-7, D-8 and soundness, which do pass |
| **A shrink-only known-findings list for declared flows** | **Adopted, by WWMD decision DI-EFCFA7596534.** Same pattern as `KNOWN_STAGE_TOOL_GAPS`, `KNOWN_DIRECT_BUILD_PHASE_WRITES` and the parent's `KNOWN_UNMIGRATED_SHAPES` |

Mechanism:

- **Eligible rules are a closed, typed set.**
  ```ts
  export const KNOWN_FINDING_ELIGIBLE_RULES = [
    { rule: "C-1" }, { rule: "D-1" }, { rule: "D-2" }, { rule: "D-3" }, { rule: "D-6" },
    { rule: "C-3" }, { rule: "C-7", code: "C-7/SANDBOX-CONTAINMENT" },
  ] as const;
  ```
  These are the rules that describe how the runtime guards entry and containment, which is what
  Build Studio's gaps are. `KnownFinding.rule` is typed as `GppRuleId` and `code` as
  `GppDiagnosticCode` (`diagnostics.ts:64`, `:116`), narrowed to the eligible pairs.
  `applyKnownFindings` refuses an entry for any other rule or code, and a test pins the set.
- **Never suppressible:** D-8 (unratified gate), D-7 (resolver), E-NOT-EXECUTABLE, S-1 to S-6,
  C-2 (vocabulary), D-5 (egress), C-4, D-4, PARSE, SCHEMA and the other C-7 codes
  (`C-7/ENFORCEMENT-ENTRY`, `C-7/RESOLVER`). A document that fails one of these is wrong, not merely
  honest about a gap.
- **Match key.** An entry matches on rule, code, element id and, for the entry rules (C-1, D-1,
  D-2, D-3, D-6), the set of O/A/I tool names that triggered the finding. Those findings gain a
  structured `tools` field (today the names appear only in the message, `drc.ts:396`, `:422`,
  `:453`). So a tag change that adds a new consequential tool to a stage produces a finding the list
  does not match, and the compile refuses. P2 (§8) also fails on any tag drift.
- An error finding that matches an entry is returned with `knownFinding: { reason, backlogItemId }`
  attached. `hasBlockingDiagnostic` (`diagnostics.ts:166-168`) treats such a finding as non-blocking.
  Its severity stays `error`, so a report never shows it as a pass.
- **Declared flows only, enforced twice.** `compile.ts` accepts `knownFindings` only when
  `sourcePath` is under `apps/web/lib/work-management/declared-flows/` and refuses otherwise; the
  generator passes it only for that root. A test asserts both.
- **Exact, shrink-only.** A listed entry that no longer occurs fails the generator (stale entry).
  A new error not on the list refuses the compile. So the list can only shrink, and only when the
  gap is really closed.
- The list lives beside the document: `declared-flows/build-studio.known-findings.ts`.

This is not a weakened gate in the AGENTS.md §1 sense. It applies to a document no runtime executes,
and it makes each gap a named, owned, visible finding rather than an invisible one.

### 7.4 C-3 and binding records: the owning gate is the entry gate

`drc.ts:295-309` reports C-3 when a stage with a `binding` has no typed gate **on its own advance**,
and `bindings-emit.ts:57-68` takes the binding record's gate key and authority from that same
advance. The stage's own advance is its **exit** gate (parent §3.1 item 3). So a stage permit would
be minted when the stage's own exit gate admits, which is after the stage's work. GPP Annex C.2
attaches the build-sandbox binding to the plan → build gate, the gate that **admits entry** to
`build`. The two disagree (§12 item 1).

Phase 5 corrects both to the GPP reading: a binding's owning gate is the typed gate on the
transition **into** the stage, that is, the predecessor stage's exit gate in the flow graph
(`buildShapeFlowGraph`, already used by the D-rules at `drc.ts:388-397`). A start stage has no
entering gate, so a binding on it has no owning scope and C-3 refuses it, as today.

Non-disruption: no registry shape carries a `binding` (`decompile.ts:18-19`), and `bindings-emit.ts`
is fixture-tested only (`:24-25`). The change alters no emitted file. Its fixtures change with it.

**This supersedes parent §6.4's binding-record rule.** The parent is not edited (its own rule), so
the supersession is recorded twice: as a WWMD outcome (`principle_decide`, recorded with
`dpf-record-decision-outcome`) in PR-5a task 5a-0, and as a dated note on BI-69415B68, whose
binding-attach slice is the first consumer of the rule.

### 7.5 C-7 build-sandbox containment, evaluated

The standing finding at `drc.ts:199-206` becomes:

- **Work-shape root:** `info`, "not applicable: the drive dispatches no stage into the build
  sandbox". This replaces the `not-evaluated` finding, which said the clause awaited Phase 5.
- **Declared-flow root:** evaluated. A stage that the sandbox executes, by the injected design-rule option
  `sandboxStages`, must carry a binding with `enforcement: "environment"`; otherwise
  `C-7/SANDBOX-CONTAINMENT` is an error.

`sandboxStages` is the union of two computed sets:

1. **Phases where a coding engine acts in the sandbox**, from a ratchet over the one chokepoint and
   its callers:
   - `runSandboxAgentCli(` call sites (definition at `sandbox/agent-cli-runtime.ts:315`): the four
     engine modules `claude-dispatch.ts:181`, `codex-dispatch.ts:168`, `grok-dispatch.ts:269`,
     `opencode-dispatch.ts:593`, and `ideate-dispatch.ts:675` (ideate research);
   - callers of the four engine dispatchers, which is where the phase is decided: the agent runners
     `sandbox/agents/claude-agent-runner.ts:52`, `codex-agent-runner.ts:53`, `grok-agent-runner.ts:52`,
     `opencode-agent-runner.ts:58`, and `build-pipeline.ts:591`;
   - `provider.exec(` and `provider.writeFile(` users, the sandbox-provider path that does not go
     through the CLI: `sandbox/agents/dpf-native-agent-runner.ts:190` (`writeFile`) and
     `lib/queue/functions/git-promotion-sandbox-verification.ts:124` (`exec`, a promotion check
     outside the Build Studio lifecycle, classified as such).

   Each file carries a hand-maintained phase label typed `BuildPhase | "outside-lifecycle"`. **The
   ratchet fails only when a file's call count changes or a new file appears.** It cannot detect a
   relabelling that leaves the counts unchanged; the labels are reviewed like any data change.
2. **Phases whose tags include a sandbox-acting tool**, computed from `PLATFORM_TOOLS`. Acting means
   writing to or executing in the sandbox workspace: `write_sandbox_file`, `edit_sandbox_file`,
   `run_sandbox_command`, `run_sandbox_tests` (`sandbox-pack.ts:119-130`, `:154-188`, `:225-237`,
   all tagged build and review). A test classifies every `sandbox-pack.ts` tool as `read`, `act` or
   `lifecycle` (`start_sandbox`, `recover_sandbox` manage the container from the portal), so a new
   sandbox tool cannot go unclassified.

Expected result: `ideate` (engine), `build` (engine and acting tools), `review` (acting tools;
Annex C.1 already says "sandbox still writable" at review).

### 7.6 Ratification two-way test reads declared flows

`gate-ratification.test.ts:76` requires the table's keys to equal the decision scopes across
`listWorkShapes()` and `WORK_SHAPE_PRIOR_VERSIONS` (`:27`). It gains `GENERATED_DECLARED_FLOWS`, so
`build-studio-plan-advancement` is a legal key. The registry side is unchanged.

The "every proposal describes today's behaviour" assertion (`:100-118`) is narrowed to scopes that
registry shapes use (`governedUsesByScope` already iterates registry uses). A scope used only by a
declared flow is checked by P3 against its source instead (§5.3).

## 8. Non-disruption proof: L1-style equality against current behaviour

There is no prior `WorkShapeDefinition` to round-trip, so L1 cannot apply directly. The equivalent
is a set of equalities between the compiled document and the runtime's own declarations. Each runs
in vitest (fast local gate) and fails on drift in either direction.

| Property | Statement | Reads |
|---|---|---|
| P1 Topology | The document's stage keys equal the non-terminal `PHASE_ORDER` phases in order. Every edge of `ALLOWED_TRANSITIONS` is either a document edge (forward sequence), a stop (`failed`, `complete`, `abandoned`), or a realization-map row. **Write scope:** every non-test `.ts`/`.tsx` file under `apps/web/app/` and `apps/web/lib/` is scanned with `findDirectPhaseWrites`; every write it returns, including the `phase` of a `create`/`createMany` entry row, is attributed by `(file, target, count)` to exactly one realization-map path row (§10.1). A new write, a moved count or an unattributed target fails | `feature-build-types.ts:570-572`, `:705-716`; `direct-phase-writes.ts:120` |
| P2 Capability | For each stage, `tools` equals `{ t ∈ PLATFORM_TOOLS : t.buildPhases includes the stage }` exactly | `mcp-tool-types.ts:162-164`; `PLATFORM_TOOLS` |
| P3 Gate set and preconditions | The plan gate equals the canonical `advance-build-phase` profile. For each of the five profiles, `planToBuildDivergences()` (§10.1) equals the realization map's C-8 rows exactly, for both the per-gate modes and `callerChecksBefore` diffed against the canonical set `["build owner", "Approve Start", "canTransitionPhase"]` | `plan-to-build-transition-core.ts:140-251`, `:158` |
| P4 Evidence | Each stage's `evidence` equals the §5.4 mapping of its exit transition's requirements in the default cell | `build-process-matrix.ts:137-155` |
| P5 Containment | Stages with an `environment` binding plus the known `C-7/SANDBOX-CONTAINMENT` entries equal `sandboxStages` (§7.5) | §7.5 |
| P6 Variants, including rightsizing | The computed deltas against the default cell equal a committed snapshot, over 16 cells × {base, `qualityFirst`, each `DeliverableSensitivity`}. `checkPhaseGate` raises requirements through `rightsizingOptsFromEvidence` (`build-process-matrix.ts:797-803`, used at `:813-817`), so the base cells alone would miss what some paths enforce | `getProcessPolicy` (`:511`) over `DEFAULT_LIFECYCLE_MATRIX` |
| P7 Inertness | No module under `app/` or `lib/`, other than tests and the generator, imports `build-studio.flow.generated.ts` or `GENERATED_DECLARED_FLOWS` | import scan, as `generated-integrity.test.ts` does |
| P8 Registry unchanged | `listWorkShapes()` keys and `GENERATED_WORK_SHAPES` are unchanged; `migration-proof.test.ts` passes without edits | existing tests |
| P9 Tooling neutral | `inquiry-response-watch.shape.generated.ts`, the index and the ratification report are byte-identical after the tooling PR | `check:gpp-shapes` |
| P10 Build Studio untouched | Every path in `git diff --name-only origin/main...HEAD` matches the §0 item 1 allowlist. Every Build Studio characterization test (`plan-to-build-transition.characterization.test.ts`, `build-on-plan-approval.plan-to-build.characterization.test.ts`, `build-evidence-extra-pack.plan-to-build.characterization.test.ts`) passes unedited | git, vitest |
| P11 Drive untouched | The PR-3c-1 characterization golden `apps/web/lib/work-management/drive-sequential-identity.test.ts` and the full `apps/web/lib/work-management` suite pass unedited | vitest |

P1–P6 are the "verify the running configuration against the model whenever either one changes"
branch of §12.4.1. **They verify code declarations at the default configuration only.** An install
running `DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE=shadow` or `enforce` behaves differently on the gates in
§10.1's configuration table, and no test fails, because tests cannot see an install's environment.
That divergence is a runtime-view (V-2) concern, not something Option B claims to cover. A Build Studio PR that changes a tag, a gate profile, a lifecycle cell or a phase
write fails one of them and must update the document or the realization map in the same PR. That
is the intended coupling, and it is the only way Phase 5 touches future Build Studio work. It adds
no runtime check.

**Shadow first.** The declared shape changes no behaviour, so there is nothing to shadow at merge.
Shadow evidence already exists where a behaviour change is pending:
`gpp-c8-transition-gate-skipped` on `save_phase_handoff` (`plan-to-build-transition-core.ts:132-133`,
`:332-338`). Any later step that makes Build Studio obey a declared gate it does not obey today
starts as a shadow record and is promoted by its own decided PR.

## 9. Decision 3: the sandbox as an environment boundary

### 9.1 The declaration

```json
{
  "id": "build-studio-sandbox",
  "version": 1,
  "enforcement": "environment",
  "subjectScope": "The build's own sandbox worktree (DPF_BUILD_WORKTREE_ISOLATION) and the sandbox database",
  "validity": { "until": "stage-exit" },
  "egress": []
}
```

### 9.2 Why each value, from code

- **`environment`.** The build engine runs with permission prompts off:
  `--dangerously-skip-permissions` (`claude-dispatch.ts:174`), `codex exec --full-auto`
  (`codex-dispatch.ts:103`), `opencode run … --dangerously-skip-permissions`
  (`opencode-dispatch.ts:339`). The MCP phase filter does not apply there (Annex C.3 item 5). The
  code already treats the sandbox as the containment: the sandbox MCP tools declare
  `sideEffect: false // Sandbox only` (`sandbox-pack.ts:166`, `:187`, `:236`).
- **`subjectScope`.** The sandbox container has its own workspace volume and database
  (`docker-compose.yml:512-557`: `sandbox_workspace`, `sandbox-postgres`), with per-build worktree
  isolation on by default (`DPF_BUILD_WORKTREE_ISOLATION: ${…:-1}`).
- **`egress: []`.** Egress is the platform tools reachable from inside the boundary. None of the
  engine dispatchers mounts the platform MCP server: `claude-dispatch.ts`, `codex-dispatch.ts` and
  `opencode-dispatch.ts` contain no MCP configuration. The diff leaves the sandbox through
  `deploy_feature`, which the portal runs in the `ship` stage, outside the boundary.
- **Network egress is not declared as contained.** The sandbox service has no restricted network
  (`docker-compose.yml:512-557` has no `networks` key; it adds `host.docker.internal`), and the
  portal accepts plain-HTTP MCP traffic from the sandbox host (`MCP_INSECURE_INTERNAL_HOSTS`,
  `docker-compose.yml:428-433`). GPP §14 says a model does not reduce the need for egress control.
  The realization map records this as a residual risk with a follow-up (§11), not as a passed check.
- **The sandbox shares the portal's `AUTH_SECRET`.** The sandbox service receives
  `AUTH_SECRET: ${AUTH_SECRET:?…}` (`docker-compose.yml:535`), the same variable the portal uses
  (`docker-compose.yml:184`). A permission-disabled coding CLI inside the boundary can therefore read
  the key that signs portal sessions. That is an egress of authority the `egress: []` declaration
  does not capture. Recorded as a residual risk beside network egress, tracked as defect
  **BI-F1C680C7**, and never recorded as a passed check.

### 9.3 Mapping to binding enforcement without enabling it

| GPP element | Where it lands | Enforcement effect |
|---|---|---|
| Binding `build-studio-sandbox@1`, `environment` | Document `stages[build].binding`; compiled definition | None. No runtime reader |
| Owning scope | The plan gate (WWMD), by the §7.4 entry-gate rule | None |
| Binding record draft | `emitBindingRecords` would draft one: `build` holds `recover_sandbox` (irreversible) and `release_nonprod_environment_lease` (authority) (§7.3), and `bindings-emit.ts:61-64` drafts any bound stage with O/A/I tools. The generator never calls it (`:24-25`); PR-5b pins the would-be draft in a test | None |
| `GPP_BINDINGS` / `KNOWN_SHADOW_BINDINGS` | Unchanged (`bindings.ts:60-80`; `binding-enforcement.ts:61`). An environment binding is not a monitor binding: the monitor has `enforced` and shadow only | None |
| `GPP_BINDING_ENFORCEMENT` | Unchanged, empty (`binding-enforcement.ts:54`). The compiler never writes it (parent §6.4) | None |
| C-7 | Evaluated for declared flows (§7.5) | Design-time only |

`environment-boundary` is already `true` in `CONSTRUCT_EXECUTABLE` (`executable-constructs.ts:82`),
meaning "Declared only": what the document says is exactly what the runtime does with it
(`executable-constructs.ts:26-28`). Phase 5 uses it as that.

**Ideate.** `ideate-dispatch.ts:2`, `:489` runs a coding CLI inside the sandbox with permission
prompts off. By the §7.4 rule, a binding on the first stage has no owning gate, because nothing
before `ideate` is a typed gate under default configuration (the WWMD ideate-start gate runs only in
autonomous mode, `ideate-on-approval.ts:258-259`, and Approve Start applies only to backlog-linked
drafts, `build.ts:363-375`). The document therefore leaves `ideate` unbound, and C-7 reports
`C-7/SANDBOX-CONTAINMENT` on `stage:ideate` as a known finding. This is a real gap that Annex C did
not record (§12 item 3).

**Review.** `write_sandbox_file`, `edit_sandbox_file`, `run_sandbox_command` and `run_sandbox_tests`
are tagged for review as well as build (`sandbox-pack.ts:130`, `:167`, `:188`, `:237`), so review
acts in the sandbox. Review is entered by `build`'s status-change exit, so a binding on `review`
would have no owning gate and C-3 would refuse it. Binding it would trade a C-7 finding for a C-3
one; the document leaves `review` unbound and C-7 reports `stage:review` as a known finding, which
names the actual gap (containment exists physically, but no gate admits it).

## 10. The realization map

`apps/web/lib/work-management/declared-flows/build-studio.realization.ts`. Pure data plus pure
functions; it imports Build Studio constants read-only and is imported only by tests and the
generator.

### 10.1 Transitions and paths

One row per transition and runtime path, with each gate's mode and whether the path passes the
rightsizing opts (`qualityFirst`, `deliverableSensitivity`) to `checkPhaseGate`, which raises the
required evidence when present (`build-process-matrix.ts:797-803`, `:813-817`).

**Plan → build rows are generated, never restated.** `planToBuildDivergences()` reads
`PLAN_TO_BUILD_GATE_PROFILES` and returns, per path, every gate whose mode ranks below the canonical
profile's, plus the `callerChecksBefore` entries missing from the canonical set. The mode ranking
is defined once, in the realization map:

| Rank | Mode | Why (all `plan-to-build-transition-core.ts`) |
|---|---|---|
| 5 | `blocking` | Evaluated; a refusal stops the transition (`:84-85`) |
| 5 | `blocking-soft` | Evaluated; a refusal **stops the transition** too; only the caller reports success (`:86-87`). Same rank: the transition is gated identically. The reporting difference is emitted as an info row, not a divergence |
| 4 | `autonomous-mode` | Evaluated; stops on refusal under `off` and `enforce`, proceeds under `shadow`, and an evaluator error fails open except under `enforce` (`:69-71`, `:88`) |
| 3 | `upstream` | Evaluated earlier in the same flow, not at the transition (`:89`) |
| 2 | `not-evaluated-recorded` | Not called; the skip is recorded (`:72-74`) |
| 1 | `not-evaluated` | Not called, not recorded (`:75`, `:90`) |

The design does not reproduce the function's output by hand; the PR-5b test prints it, and that
printed table is what the GPP Annex A update cites. The `save-phase-handoff` WWMD row is tied to
**BI-5D59A982**.

**Declared rows for every other transition.** Each row names its writer by file and line, and P1
attributes every scanned write to one of them. The complete set at merge is whatever P1's scan
returns; the rows below are the ones the design must already account for:

| Transition | Path (writer) | Gates on the path | Rightsizing opts |
|---|---|---|---|
| ideate → plan | `advanceBuildPhase` (`build.ts:556-560`) | Approve Start (backlog drafts, `:363-375`), readiness (`:507`), business brief (`:509-519`), structural (`:522`) | not passed (`:393-411`) |
| ideate → plan | admin route (`app/api/agent/build/advance-phase/route.ts:203`) | Approve Start (`:86-87`), structural (`:113-125`) | not passed |
| ideate → plan | design-review handler, fix (`lib/mcp/build-design-review-handler.ts:96`) | structural (`:76`) | passed (`:80`) |
| ideate → plan | design-review handler, feature (`build-design-review-handler.ts:647`) | structural (`:619`) | passed (`:625-626`) |
| ideate → plan, build → review, review → ship | `save_phase_handoff` auto-advance (`build-evidence-extra-pack.ts:328`) | Structural only (`:236-330`); skips Approve Start, business brief, releasable diff, readiness. Tagged ideate through review (`:90`), and reachable over external MCP, which applies no phase filter (§10.4). **BI-BDB63485** (wider than C-8, including completing a ship build over external MCP) | not passed (`:250-264`) |
| build → review | `advanceBuildPhase` | readiness (`:507`), structural (`:522`), releasable diff (`:524-537`) | not passed |
| build → review | orchestrator, gated (`lib/build/build-orchestrator.ts:1806`) | structural (`:1795`) | not passed |
| build → review | orchestrator "already completed" path (`lib/actions/agent-coworker.ts:1794-1797`) | **none** | n/a |
| build → review | gauntlet repair finished (`runGauntletRepair`, `lib/build/gauntlet-repair.ts:257`, write `:280`) | **none** | n/a |
| review → ship | `advanceBuildPhase` | readiness, structural, releasable diff (`:540-555`); never the WWMD ship gate | not passed |
| review → ship | `advanceReviewedBuildToShip` (`ship-on-review-approval.ts:353-356`) | WWMD ship gate by configuration (`:217-218`, `:249`), readiness (`:310-312`), structural (`:322-339`) | not passed |
| review → build | gauntlet route (`gauntlet-repair.ts:234-236`) and owner send-back (`advanceBuildPhase`) | `checkPhaseGate` allows review → build unconditionally (`build-process-matrix.ts:811`) | n/a |
| review → abandoned | gauntlet exhaustion → `escalateBuildToHuman` (`gauntlet-repair.ts:194-212`; `escalate-build-to-human.ts:294-299`) | the bound (`gauntlet-repair.ts:15`, `:50-58`) | n/a |
| any → abandoned | `escalateBuildToHuman` (other callers), `self-abandon-eligibility.ts:232`, `resume-pre-build-phase.ts:157`, `plan-to-build-transition.ts:245` (unsatisfiable dependency, `plan-to-build-transition-core.ts:206-207`), inert-build reaper (`inert-build-reaper.ts:213`) | per writer | n/a |
| plan → failed | decomposition supersedes the build (`approve-decomposition.ts:685`) | per writer | n/a |
| failed → build | `resetBuildExecution` (`build.ts:835`), `retryBuildExecution` (`build.ts:884`) | not in `ALLOWED_TRANSITIONS` (`feature-build-types.ts:710-712`) | n/a |
| review/ship → build | `resumeBuildImplementation` (reason at `direct-phase-writes.ts:180-182`) | not in `ALLOWED_TRANSITIONS` for ship | n/a |
| ship → complete | `completeFeatureBuildTransition` (`build-terminal-transition.ts:185`); `reconcileBuildCompletion` (`build-flow-state.ts:458`, `:493`) | completion readiness; forks terminal | n/a |
| entry (create) | build rows created with an initial phase, for example decomposition children "go straight to plan" (`approve-decomposition.ts:620`) | per writer | n/a |

Configuration-dependent gates, declared here and not in the document (§5.1):

| Gate | `off` (default) | `shadow` | `enforce` |
|---|---|---|---|
| WWMD ideate-start (`build-studio-ship-gate.ts:87`) | not evaluated | evaluated, proceeds | blocks (`ideate-on-approval.ts:278`) |
| WWMD ship (`build-studio-ship-gate.ts:21`), autonomous path only | not evaluated | evaluated, proceeds | blocks (`ship-on-review-approval.ts:249`) |

### 10.2 Lifecycle variants

Computed deltas of the 16 cells against the default cell: per transition, requirements added or
removed, and phases skipped (`PHASES_NO_IDEATE`, `PHASES_NO_IDEATE_NO_REVIEW`,
`build-process-matrix.ts:233-234`). P6 snapshots them, so a matrix change shows up as a reviewed
diff to the declared model.

### 10.3 Element → runtime artifact

One row per derived element id (`shape:build-studio@1.0.0`, `stage:<phase>`, `gate:plan`,
`tool:<phase>:<tool>`, `binding:build-studio-sandbox@1`, `stop:<kind>:1`) naming exactly one source
artifact: the phase literal, the gate function, the tool definition, the dispatcher, the terminal
phase write. This is §12.4.1 bullet 4. A test asserts every element id of the compiled document
has exactly one row and every row names an element that exists.

### 10.4 Other recorded facts

- **Three reach rules for the same tags.**
  1. *Coworker:* during an active build phase an untagged tool is unavailable and a tagged tool is
     available only in its phases (`coworker-tool-filter.ts:70-77`, the untagged rule at `:75`).
  2. *Pipeline:* an untagged tool is available in `build` (`build-pipeline.ts:495`). This is the
     rule the type's own comment states: "Null/undefined = available in all phases (non-build
     tools)" (`mcp-tool-types.ts:162-163`).
  3. *External MCP:* no `buildPhases` filter at all. No module under `app/api/` or `lib/mcp/`
     (outside the packs that declare tags) reads `buildPhases`; the only readers are
     `coworker-tool-filter.ts`, `build-pipeline.ts`, `capability-inventory.ts:74` and
     `critical-interaction-map.ts:102`.

  **Decision:** the document's stage `tools` declare the coworker rule, because it is the only rule
  that narrows reach per phase, which is what a stage capability set means (GPP §7 element 5). The
  pipeline rule and external MCP are recorded as known reach divergences (§12 item 7), not derived
  from the comment.
- **Initiative-readiness correspondence** (§4.4).
- **Residual risks: sandbox network egress, and `AUTH_SECRET` shared with the sandbox (BI-F1C680C7)** (§9.2).

## 11. Annex C.4 steps: what Phase 5 does with each

The backlog item names steps 1–6; the parent's Phase 5 row names steps 1 and 4 as the gate.

| Step | Phase 5 |
|---|---|
| 1 Declared shape | **Delivered.** The document, compiled and checked |
| 2 One transition function per transition | **Declared and ratcheted, not routed.** Every path is inventoried with its gate modes (§10.1). Routing review → ship is a Build Studio refactor and needs its own item under the defect-fix constraint |
| 3 One accountable identity per stage | **Partly.** One accountable principal per stage (`role:build-owner`). Binding each stage to one agent identity holding its grants stays open (Annex C.3 item 3) |
| 4 Sandbox as environment binding | **Delivered** for `build`; `ideate` and `review` are known C-7 findings (§9.3) |
| 5 Render bindings, modes, envelope | **Follow-up.** The Phase 4 projector reads `listWorkShapes()` (Phase 4 plan, line 427). A follow-up adds `GENERATED_DECLARED_FLOWS` to its input; Phase 4 already notes Build Studio has no document until Phase 5 (Phase 4 plan, lines 974-975) |
| 6 Reconcile tools called per stage | **Follow-up.** Annex A records that an automated C-6 report is not built; Build Studio's reach reconciliation belongs to that work |

Already filed: **BI-BDB63485** (`save_phase_handoff` advances any phase with only the structural
gate, and over external MCP from any phase, including completing a ship build) and **BI-F1C680C7**
(the sandbox receives the portal's `AUTH_SECRET`). Follow-ups to file when the content PR merges:
route review → ship through one transition function; agent identity per Build Studio stage; Phase 4
projection of declared flows; Build Studio C-6 reconciliation; sandbox network egress control;
notation support for a gate-less, partly unbounded send-back; whether an environment binding should
yield a monitor binding draft (BI-69415B68); the two ungated build → review writers (§10.1).

## 12. Contradictions found between code and the GPP document or parent spec

1. **Binding owning gate.** Parent §6.4 and the code (`drc.ts:295-309`, `bindings-emit.ts:57-68`)
   take a binding's gate from the stage's own advance, which parent §3.1 item 3 defines as the
   exit gate. GPP Annex C.2 attaches the build binding to the plan → build gate. Resolved in §7.4
   toward GPP.
2. **Ship gate mode.** Annex C.1 and C.3 item 6 say the ship gate is "blocking in enforce mode
   only, otherwise shadow". Code: under the default `off` it is not evaluated at all
   (`ship-on-review-approval.ts:217-218`, `build-studio-config.ts:303-310`), and the UI path never
   evaluates it (`build.ts:540-560`). Annex C needs a one-line correction. (The ideate-start gate
   is not a contradiction: Annex C.1 already says it runs only in autonomous mode.)
3. **Ideate runs in the sandbox.** Annex C.1 says ideate has "no sandbox write" and C.3 item 5
   names only the build path. `ideate-dispatch.ts:2`, `:489` runs a permission-disabled coding CLI
   inside the sandbox container.
4. **Transitions outside `ALLOWED_TRANSITIONS`.** `failed` and `abandoned` are terminal and ship
   cannot go back to build (`feature-build-types.ts:705-716`), yet `retryBuildExecution` writes
   failed → build (`build.ts:884`), `resumeBuildImplementation` reopens ship builds
   (`direct-phase-writes.ts:180-182`), and the reaper writes `abandoned` (`inert-build-reaper.ts:213`).
5. **C-8 is wider than plan → build.** Annex A and BI-5D59A982 frame the open C-8 gap as the
   `save_phase_handoff` plan → build path. `save_phase_handoff` advances every transition from ideate
   through review with the structural gate alone (`build-evidence-extra-pack.ts:236-330`, `:90`),
   and external MCP applies no phase filter (§10.4). Filed as **BI-BDB63485**. Two more build →
   review writers have no gate at all (`agent-coworker.ts:1794-1797`; `gauntlet-repair.ts:280`).
6. **Schema gaps against GPP §7.** The shape schema and `WorkShapeGate` have no preconditions
   element (§7 element 8) and no `off` mode (§7 element 11; `work-shapes.ts:74-87`). Phase 5 works
   around both in the realization map. A notation change belongs to BI-6DA17863.
7. **Three reach rules for one set of tags** (§10.4): coworker, pipeline and external MCP. The type comment (`mcp-tool-types.ts:162-163`) states the pipeline rule, not the coworker rule.
8. **Rework semantics.** The parent's construct 13 does not fit Build Studio's send-back on trigger
   and bound (§6; exhaustion does match, via `escalateBuildToHuman` → `abandoned`), so "Phase 5 waits
   for PR-3c-3" would not by itself make the loop declarable.
10. **Rightsizing is applied on some paths only.** `checkPhaseGate` raises requirements when the
    evidence carries `qualityFirst` or `deliverableSensitivity` (`build-process-matrix.ts:797-803`).
    The design-review handler (`build-design-review-handler.ts:80`, `:625-626`), the plan-review
    precheck (`build-review-handlers.ts:579-580`) and `performPlanToBuildTransition`
    (`plan-to-build-transition.ts:350-351`) pass them; `advanceBuildPhase`, the admin route,
    `save_phase_handoff` and `advanceReviewedBuildToShip` do not. The same build can face different
    evidence requirements on the same transition depending on the path.
11. **Binding drafts ignore `enforcement`.** `bindings-emit.ts:57-68` drafts a monitor binding for an
    `environment` binding as for any other (§7.3).
9. **Phase 5 gate.** Parent §11 names Annex C steps 1 and 4; the backlog title names 1–6. §11 above
   reconciles them.

## 13. Relation to BI-5D59A982 (C-8 on `save_phase_handoff`)

Phase 5 neither decides nor preempts it.

- The declared plan gate is the canonical profile's set. `save-phase-handoff`'s
  `not-evaluated-recorded` WWMD mode becomes a computed C-8 divergence row tagged BI-5D59A982.
- If BI-5D59A982 changes that profile to `blocking`, P3 recomputes the divergence, the row
  disappears, and the shrink-only list must drop it in the same PR. The decision's effect becomes
  mechanically visible in the model with no Phase 5 change.
- If it keeps the path recorded-only, the row stays with that decision's reason.
- Phase 5 does not need the decision first. The order of the two is free.

## 14. Open founder questions

- **Q1 (required before the content PR merges).** Ratify the gate for decision scope
  `build-studio-plan-advancement` as in §5.3: WWMD, enforced, blocking, doctrine-then-human,
  resolver `evaluateBuildStudioPlanAdvancementGate`, WSID advisory, escalation to the build owner.
  This states the canonical path as it is today; it changes nothing. Ratification is a DI via
  `principle_decide` (`gate-ratification.ts:16-30`), as DI-BEEAF36D0244 was for the first shape.
- **Q2, decided.** The shrink-only known-findings mechanism, for declared flows only, was decided by
  WWMD decision **DI-EFCFA7596534** and is followed as specified in §7.3.
- **Recommendation attached to Q1.** Keep `doctrine-then-human` and narrow the ratification test's
  "accountable-human" assertion to registry scopes (§5.3, PR-5a task 5a-7), rather than ratifying a
  resolution that misstates who resolves the gate.

Everything else in this design is a technical recommendation owned by design review.

## 15. Objectives and acceptance (scope baseline for BI-D37B2C13)

- **OBJ-5-DECLARED:** Build Studio's ideate → plan → build → review → ship lifecycle exists as one hand-authored GPP shape document that the GPP compiler parses, checks and emits.
- **OBJ-5-FAITHFUL:** The declared shape's stages, transitions, capability sets, plan → build gate set, evidence and containment equal what Build Studio's code declares, and any change on either side fails a test until both agree.
- **OBJ-5-HONEST:** Every way Build Studio departs from its declared shape or from the GPP design rules is a named finding with a reason and an owning backlog item, on a list that can only shrink.
- **OBJ-5-CONTAINMENT:** The build sandbox is declared as an environment boundary with its egress, and the build-sandbox containment check is evaluated rather than reported as not evaluated.
- **OBJ-5-NODISRUPT:** No Build Studio behaviour changes: only allowlisted paths are changed, nothing at runtime reads the declared shape, no binding is enforced, and the existing compiled work shape recompiles byte-identically.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-5-COMPILE | OBJ-5-DECLARED | The build-studio document compiles through the generator with no unlisted error finding, check:gpp-shapes passes, and the generated module is byte-identical across two compiles with shuffled keys. |
| AC-5-TOPOLOGY | OBJ-5-FAITHFUL, OBJ-5-HONEST | The document's stages equal the non-terminal build phases in order, and every allowed transition and every direct phase write is either a document edge, a stop, or a realization-map row. |
| AC-5-CAPABILITY | OBJ-5-FAITHFUL | Each stage's declared tools equal the platform tools tagged for that build phase, exactly. |
| AC-5-GATESET | OBJ-5-FAITHFUL, OBJ-5-HONEST | The plan gate equals the canonical plan-to-build profile, and the divergence computed for each of the five profiles, over gate modes and caller preconditions, equals the declared C-8 list. |
| AC-5-EVIDENCE | OBJ-5-FAITHFUL | Each stage's evidence equals the mapped gate requirements of its exit transition in the default lifecycle cell, and the deltas of all sixteen cells, each under the base, quality-first and every sensitivity setting, equal the committed snapshot. |
| AC-5-SANDBOX | OBJ-5-CONTAINMENT | The build stage carries an environment binding with declared egress, the C-7 sandbox clause is evaluated for declared flows, every stage where an engine or a sandbox-acting tool runs is bound or listed, and a new sandbox dispatch site or an unclassified sandbox tool fails the ratchet. |
| AC-5-KNOWN | OBJ-5-HONEST | Only the eligible rules can be listed, a stale entry fails the generator, an unlisted error or a changed triggering tool set refuses the compile, and only a declared-flow source path can receive known findings. |
| AC-5-ELEMENT-MAP | OBJ-5-DECLARED | Every element id of the compiled document maps to exactly one runtime artifact and every mapping names an existing element. |
| AC-5-C3-ENTRY | OBJ-5-CONTAINMENT | A binding's owning gate is the gate on the transition into its stage, for both C-3 and binding-record drafts, and a binding on a start stage is refused with C-3. |
| AC-5-NODISRUPT | OBJ-5-NODISRUPT | Every changed path in the phase matches the allowlist, the Build Studio characterization tests, the drive's sequential golden and the migration proof pass unedited, nothing outside tests and the generator imports the declared flow, the enforcement table is unchanged, and the compiled work shape, its index and the ratification report are byte-identical. |

## 16. Research and benchmarking

The parent's §13 and 3c's §12 decisions stand (Camunda coverage, workflow-net soundness, ASL,
Serverless Workflow, bpmnlint, Temporal, Airflow). These rows are new for declaring an existing
delivery pipeline and its execution environment.

| Reference | What it does | DPF adopts | DPF rejects |
|---|---|---|---|
| **GitHub Actions environments** ([deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)) | A job that names an environment waits until its protection rules pass: required reviewers (up to six, one approval suffices), a wait timer, branch and tag restrictions, up to six custom protection rules, and optional prevention of self-review. Environment secrets reach only jobs that reference the environment, and only after approval | An environment as a declared, named boundary whose secrets and reach are scoped to it: the `build-studio-sandbox` binding with `subjectScope` and `egress`. Protection rules declared next to the thing they protect, not inside each job | Wait timers and reviewer counts as gate fields: GPP gates have one owning scope and a resolution mode. Rules configured in a settings UI: the declaration must be checked-in source |
| **GitLab protected environments and deployment approvals** ([deployment approvals](https://docs.gitlab.com/ci/environments/deployment_approvals/)) | Deployments to a protected environment are blocked until all required approvals are given; approval rules say who may approve; the pipeline triggerer cannot approve their own deployment unless an administrator allows it | Blocking-until-approved as the meaning of `enforced` and `blocking: true`. The self-approval rule as precedent for the realization map recording who resolves each gate | Per-environment approval counts. Build Studio's gates resolve by doctrine then the owner, and Phase 5 declares what exists rather than adding approvals |
| **Backstage software templates** ([writing templates](https://backstage.io/docs/features/software-templates/writing-templates)) | A template declares JSON-Schema parameters and an ordered list of steps, each a named action with inputs and outputs; steps may carry `if` conditions and `each` loops | A declared, ordered, schema-validated pipeline kept as source next to the system it scaffolds | Data-driven `if` and `each` in the declaration: the parent excludes data-based choice (§6.1), and loops must be bounded rework |
| **Argo Workflows** ([retries](https://argo-workflows.readthedocs.io/en/latest/retries/); [suspend](https://argo-workflows.readthedocs.io/en/latest/walk-through/suspending/)) | `retryStrategy.limit` bounds retries; when the limit is exhausted the step fails permanently. A `suspend` template pauses the workflow until it is resumed by hand or after a duration | The bounded-loop discipline: a loop has a declared bound and a defined end when it is exhausted. Argo's end (fail), the parent's (budget stop) and Build Studio's gauntlet (escalate, then `abandoned`) agree. What Argo has and Build Studio's manual send-back lacks is the bound itself, one reason the loop is not declared in Phase 5 (§6). `suspend` with manual resume confirms "hold for a person" as an executable primitive | Adopting Argo, or encoding retries as an implicit per-step property: a send-back is a governed transition and must be visible as one |

Standards followed: GPP §7 and §12.4 for the binding and model elements; BPMN 2.0.2 as restricted
by the parent for semantics; JSON Schema draft 2020-12 for the document format. The deviations are
the two schema gaps in §12 item 6, recorded rather than worked around in the format.

## 17. Risks

| Risk | Mitigation |
|---|---|
| A Phase 5 change alters Build Studio behaviour | Only allowlisted paths change (§0, P10); nothing at runtime imports the declared flow (P7); characterization tests and the drive golden run unedited (P10, P11) |
| Conformance tests become friction for every Build Studio PR | They fail only when Build Studio's own declaration changes, and the fix is a data edit in the realization map or document. The failure message names the file and the row. This coupling is the §12.4.1 requirement |
| The known-findings list becomes a dumping ground | Exact and shrink-only; declared-flow root only; each entry needs a reason and a BI; the work-shape root is refused it |
| The compiler changes disturb `inquiry-response-watch` | P9: generator outputs byte-identical; `check:gpp-shapes` in CI |
| The C-3 entry-gate correction conflicts with the binding-attach follow-up (BI-69415B68) | No registry shape has a binding and drafts are fixture-only; the correction lands before any binding is emitted, and the coordination note goes on BI-69415B68 |
| The declared plan gate is read as "C-8 solved" | The C-8 rows are part of the realization map and the design view; §12.4.3 and Annex A keep C-8 marked open |
| Ratification (Q1) stalls the content PR | The tooling PR merges independently; the content PR waits only on one DI |
| Sandbox egress read as contained | Recorded as a residual risk with a follow-up, never as a check that passed |
| `AUTH_SECRET` shared with the sandbox read as contained | `docker-compose.yml:535` vs `:184`; residual risk beside network egress, tracked by BI-F1C680C7, never recorded as a passed check |
| Known findings used to hide a wrong document | Closed eligible-rule set; D-8, D-7, E-NOT-EXECUTABLE, S-*, C-2 and D-5 can never be listed; match includes the triggering tool set; declared-flow source paths only (§7.3) |
| The plan gate's resolver import pulls heavy modules into the generator | `build-studio-gate.ts` imports the evaluator (`:6`) and voice synthesis (`:14`). `importResolver` turns any import failure into `false` (`resolve-sources.ts:96-103`), which surfaces as D-7, which cannot be listed. Plan R7 |

## 18. Documentation impact

- **GPP standard** (`docs/architecture/gated-permissions-process.md`), in the content PR:
  §12.4.3 "Executable model" and "Transition gate sets" rows, Annex A "Executable model source" and
  "Transition path uniqueness" rows, Annex C.1 corrections (§12 items 2 and 3), C.4 status per step
  (§11), revision-history entry.
- **GPP revision 0.10** in the content PR (the current last entry is 0.9,
  `gated-permissions-process.md:802`), and regenerate `apps/web/lib/docs/doc-impact.generated.json`
  with `pnpm docs:impact:graph` (`package.json:103`), checked with `docs:impact:graph:check`.
- **This spec's §7.5** replaces the `drc.ts:68-69` header note ("applies only to Build Studio stages
  (Phase 5)"); the tooling PR edits that comment.
- **`executable-constructs.ts`** header: no change; no flag moves.
- **User-facing and coworker-facing docs:** none. No screen, prompt, tool or behaviour changes. The
  no-docs reason is recorded in each PR body.
- **Runbooks:** none.
