---
status: draft
---

# GPP Phase 1: see and ratchet, without blocking

| | |
|---|---|
| Date | 2026-10-01 |
| Design | [GPP model to execution](../specs/2026-10-01-gpp-model-to-execution-design.md), §5.0 adoption constraints and §8 Phase 1 |
| Epic | EP-B932453F |
| Backlog | BI-69415B68 (slice 1), BI-45F9CB7A |
| Standard | [GPP](../../architecture/gated-permissions-process.md) C-6, C-8, C-9 |

## Outcome

DPF can **see** every critical interaction: each outward, authority-changing or irreversible tool,
how it can be reached, and which gate guards it. It also **stops the hole count from growing**.
Phase 1 changes no runtime behaviour, adds no permit, refuses no call, and changes Build Studio only
by recording one additional activity event.

## Scope and staging (architecture review AGT-WS-EA, receipt initiative-a29400d9, item 1)

- BI-69415B68 covers **Phase 1 and Phase 2** of the design (§8). **This plan covers Phase 1 only.**
- Phase 2, shadow permits for O/A/I tools, gets its own plan after Phase 1 has merged and its
  evidence is reviewed.
- Phase 1 ships as **two PRs** so that Build Studio risk stays isolated:
  - **PR-A**, tests and an on-demand script only: T1, T2, T3, T5. It touches no runtime path, so it
    cannot change behaviour.
  - **PR-B**, the single Build Studio change: T4, a shadow activity event. It merges after PR-A, and
    its rollback is independent.
- Each PR passes the local-CI gate and the merge queue on its own. Neither requires a deployment
  step beyond the normal self-upgrade.

## Constraints (from the founder, binding on every task)

1. **No disruption.**
   - No tool call that succeeds today may fail because of this phase.
   - No gate that is not yet implemented may be demanded.
2. **Critical calls only.** The map and the ratchets concern O/A/I tools and the C-5 combination.
   R and W tools are listed, but no new requirement is attached to them.
3. **Ratchet, never flip.** Each check freezes today's state on a shrink-only list. CI fails only on
   a *new* exception.
4. **Build Studio stays as it is.** Its direct `executeTool` call sites are allowlisted, not routed.

## Facts this plan is built on (origin/main, 2026-10-01)

- `executeTool` is defined at `apps/web/lib/mcp-tools.ts:368`. `governedExecuteTool` in
  `apps/web/lib/mcp-governed-execute.ts` is the reference monitor.
- **Direct `executeTool(` call sites outside tests:** 33 grep hits. Two are comments
  (`actions/build.ts:1662`, `tak/page-action-manifests/employee.ts:5`) and two are inside the
  monitor itself (`mcp-governed-execute.ts:193, :283`), which leaves **29 call sites to classify**.
  They are enumerated in the next section.
  - 9 files are Build Studio pipeline code: `lib/build/*`, `actions/build.ts`, `build-review-verification`.
  - 2 sites are the monitor itself (`mcp-governed-execute.ts`).
  - The rest are portal server actions: `agent-coworker.ts` (5), `proposals.ts`, `demand-*`,
    `request-brand-extraction.ts`, `execute-proposal` route, `screen-pack.ts`, `employee.ts`
    page-action manifest.
- Consequence classes are declared per tool (`ToolDefinition.consequence`):
  `consequential-tool-coverage.ts` derives the consult-gated set, and `collaborationShapeForTool`
  maps outward and irreversible tools to room shapes.
- The BI-45F9CB7A path is `save_phase_handoff`, which auto-advances in
  `build-evidence-extra-pack.ts` (~:232-313) with `checkBuildPhaseGate` only. Calling the WWMD gate
  from there in "observe" mode would write `DecisionInteraction` rows and can start voice synthesis
  (`build-studio-gate.ts`), so it is not an acceptable shadow.

## Call-site inventory and phase assignment (review item 3)

Read from the working tree at `origin/main` `c8462cb6ec`. Consequence classes come from the tools'
own declarations. Two declarations look internally inconsistent, and T1/T2 must verify them before
any phase relies on them (see the footnotes).

| # | Site | Tool invoked | Declared class | Phase |
|---|---|---|---|---|
| 1 | `build/ship-on-review-approval.ts:111` | `deploy_feature` | irreversible (platform) | **Phase 2: wrap in monitor when its binding is enforced** |
| 2 | `queue/functions/build-review-verification.ts:473` | `deploy_feature` | irreversible (platform) | **Phase 2** |
| 3 | `build/auto-open-build-pr.ts:50` | `create_portal_pr` | outward (platform) | **Phase 2** |
| 4 | `build/ship-on-review-approval.ts:513` | `contribute_to_hive` | outward (platform) | **Phase 2** |
| 5 | `actions/request-brand-extraction.ts:68` | `extract_brand_design_system` | outward | **Phase 2** |
| 6 | `build/build-on-plan-approval.ts:158` | `start_build` | irreversible, but `sideEffect: false`¹ | Phase 2 once T2 confirms the class |
| 7 | `app/api/admin/ops/execute-proposal/route.ts:109` | dynamic: approved proposal's `actionType` | varies | **Phase 2**: route approved-proposal execution through the monitor (a tool varies by call) |
| 8 | `actions/proposals.ts:60` | dynamic: approved proposal's `actionType` | varies | **Phase 2**, as row 7 |
| 9 | `actions/demand-activation.ts:13` | dynamic: `name` argument | varies | **Phase 2**: route through the monitor, or restrict to an allowlist of W tools |
| 10 | `mcp/packs/screen-pack.ts:613` | dynamic: `underlyingToolName` | varies | **Phase 2**: route through the monitor |
| 11 | `build/build-orchestrator.ts:1030` | `save_phase_handoff` (AGT-ORCH-300 internal, `autoAdvance:false`) | W, no class | Allowlisted; no permit (constraint 2) |
| 12–17 | `actions/agent-coworker.ts:2082, 2167, 2211`; `build/build-orchestrator.ts:1556, 1643`; `build/ideate-on-approval.ts:472` | `saveBuildEvidence` | `sideEffect: false`² | Allowlisted; no permit |
| 18–23 | `actions/agent-coworker.ts:2187, 2225`; `build/ideate-on-approval.ts:582, 904, 933`; `build/resume-pre-build-phase.ts:589` | `reviewDesignDoc` | `sideEffect: false`², but can advance ideate→plan | Allowlisted; T2 records the classification gap |
| 24–26 | `actions/build.ts:1691`; `build/plan-on-approval.ts:287`; `build/resume-pre-build-phase.ts:739` | `reviewBuildPlan` | `sideEffect: false`², but can advance plan→build | Allowlisted; T2 records the gap. Phase-transition integrity is C-8, BI-45F9CB7A follow-up. |
| 27 | `build/resume-pre-build-phase.ts:484` | `propose_build_decomposition` | W, no class | Allowlisted |
| 28 | `actions/demand-estimate.ts:77` | `record_effort_estimate` | W, no class | Allowlisted |
| 29 | `build/ship-on-review-approval.ts:538` | `register_digital_product_from_build` | side effect, no class | Allowlisted; T2 lists it as unclassified |

¹ The `start_build` reading came from a quick declaration scan and may have picked up a neighbouring
declaration. T1 reads the resolved `ToolDefinition` from the registry, not source text.
² A tool that writes data, or advances a phase, while declaring `sideEffect: false` is a
classification defect. T2 surfaces these and does not fix them in Phase 1.

Rows 12–17 are the six `saveBuildEvidence` sites and rows 18–23 the six `reviewDesignDoc` sites, so the table accounts for all 29 (11 + 6 + 6 + 3 + 3).
The T3 ratchet seeds per-file counts from exactly these sites.

**Phase 1 routes none of them.** Rows 1–10 are the only sites that Phase 2 changes, and only for
tools whose binding is promoted to enforced. Every other site stays allowlisted indefinitely,
because read and internal-write tools never need a permit.

## Tasks

### T1. Critical-interaction map (on demand, not a CI gate)

- Add a pure function `buildCriticalInteractionMap(tools, grants, callSites)` under
  `apps/web/lib/gpp/`, plus a `tsx` script that prints it as Markdown and JSON.
- For every tool, the map lists:
  - `consequence` class, or **unclassified side-effecting**
  - honouring grants, and the coworkers that hold them
  - `buildPhases` tags
  - `collaborationShapeForTool`
  - whether the alignment gate, escalation gate or projector covers it
  - direct call sites that reach it without the monitor
- Output: a reviewable report that is regenerated on demand. It is not a derived artifact, so it
  creates no CI churn.
- **Artifact format** (review item 4): JSON `{ generatedAt, gitSha, tools: [...] }`. Each tool
  entry has:
  - `name`, `sideEffect`, `consequence | null`, `consequenceScope | null`
  - `grants[]`, `holders[]` (agent ids)
  - `buildPhases[]`, `collaborationShape | null`
  - `guards: { alignment, escalation, projector, shapeGate }`, each a mode: `enforced | shadow | none`
  - `directSites[]` (file:line)
  - `critical`, which is true for O/A/I, or when the tool contributes to C-5

  A Markdown summary lists critical tools first, then unclassified side-effecting tools. Both files
  are written to a path given on the command line and are not committed. A reviewed run is attached
  to BI-69415B68 as evidence.
- **Completion criteria:**
  - every `PLATFORM_TOOLS` entry appears exactly once
  - counts by class reconcile with the registry
  - every critical tool has at least one reachability row (grant holders or direct sites)
  - every row 1–29 above appears in some tool's `directSites`
  - the script runs on main in under a minute
- **Test:** unit tests for the pure function on fixtures only. No snapshot of the live registry.
- **Acceptance:** the report runs on main and lists every O/A/I tool and every unclassified
  side-effecting tool.

### T2. Consequence-classification ratchet

- Add a test listing side-effecting tools that carry **no** consequence class, in
  `KNOWN_UNCLASSIFIED_SIDE_EFFECT_TOOLS`, seeded from current main.
- **Fails only** when a *new* side-effecting tool is added without a class. When a tool is
  classified, the test asks for the list to be shrunk.
- **Acceptance:** green on main; red on a fixture that adds an unclassified side-effecting tool.

### T3. Unmediated-reach ratchet (C-9, observe)

- Add a test that counts `executeTool(` call sites per file outside tests and outside the monitor
  module, and compares them against `KNOWN_UNMEDIATED_EXECUTE_SITES` (file → count), seeded from main.
- Counts are per file, not by line number, so ordinary edits never break it.
- **Fails only** when a new file appears or a count grows. Shrinking passes with a prompt to update
  the list.
- **Acceptance:** green on main; red when the counter is run over a synthetic source tree that has
  one extra call site.

### T4. BI-45F9CB7A: record the skipped gate (shadow, Build Studio-safe)

**The bypass** (review item 2): `advanceBuildPhase` (`actions/build.ts:322`) enforces five things on
plan→build:
- Approve Start
- initiative readiness
- the evidence gate
- the dependency gate
- the blocking WWMD plan-advancement gate (`evaluateBuildStudioPlanAdvancementGate`)

`save_phase_handoff`, tagged for the plan phase, auto-advances to the next phase for every caller
except AGT-ORCH-300's internal handoff. It then writes `featureBuild.phase` directly after
`checkBuildPhaseGate` alone (`mcp/packs/build-evidence-extra-pack.ts` ~:232-313;
`resolveSavePhaseHandoffTransition` in `mcp-tools.ts:104-126`).

**Why it exists.** Not yet established. The task's first step is to read the git history of both
functions and record whether the WWMD gate was added to `advanceBuildPhase` after
`save_phase_handoff`'s auto-advance existed. The PR body will state the answer, not a guess.

**Regression test**, Phase 1:
- `save_phase_handoff` in plan phase with a passing evidence gate emits exactly one
  `gpp-c8-transition-gate-skipped` event and advances exactly as before.
- AGT-ORCH-300's internal handoff emits no event and does not auto-advance.
- Other phase transitions emit no event.

**Enforcement test**, written now and skipped until the separate enforcement decision:
plan→build via `save_phase_handoff` is refused when the WWMD gate refuses.

- In `save_phase_handoff` auto-advance, when the transition is `plan → build` and it is *not*
  `AGT-ORCH-300`'s internal handoff, append one `buildActivity` / room activity event
  `gpp-c8-transition-gate-skipped`. The event records `buildId`, `from`, `to`, and that the WWMD
  plan-advancement gate was not evaluated on this path.
- **No** gate call, **no** refusal, **no** change to the transition outcome.
- **Test:** the auto-advance path emits the event and still advances exactly as before. The internal
  handoff emits nothing.
- **Acceptance:**
  - Existing Build Studio tests pass unchanged.
  - The event appears in a unit-level run.
  - Two weeks of live counts decide the enforcement step, which is filed separately and needs its
    own approval.

### T5. Documentation

- GPP Annex A: cite the map, both ratchets and the C-8 shadow event. State the mode as **observe**.
- Spec §8: mark Phase 1 delivered when merged.

## Verification

- `pnpm --filter web exec vitest run` for the new tests and the touched Build Studio pack tests.
- `pnpm --filter web typecheck`.
- Production build through the normal gate. The local-CI gate is required, because runtime files
  change.
- UX: none. No surface changes.

## Rollback

Revert the PR. Ratchet tests and the activity event have no data migration and no behavioural
dependency.

## Explicitly out of scope

- Routing Build Studio's direct call sites through the monitor.
- Permits of any kind (Phase 2).
- Enforcing the WWMD gate on `save_phase_handoff`. That is a separate decision, made after T4
  evidence exists.
- Any change to read or internal-write tool behaviour.
