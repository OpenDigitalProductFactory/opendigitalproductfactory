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
- **Direct `executeTool(` call sites outside tests: 33 across 18 files.**
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
