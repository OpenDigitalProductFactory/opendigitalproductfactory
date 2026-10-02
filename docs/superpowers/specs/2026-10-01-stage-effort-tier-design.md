---
status: active
---

# Effort tier per work-shape stage (Phase G)

- **Backlog:** BI-B3BBF9AD · parent BI-7AE90091
- **Design source:** [Proactivity and capacity allocation §6.1](2026-09-15-proactivity-and-capacity-allocation-design.md)
- **Plan:** [2026-10-01-stage-effort-tier.md](../plans/2026-10-01-stage-effort-tier.md)

## 1. Problem

Every Workroom stage runs at whatever effort `deriveEffortWarrant` guesses. A
stage declares no effort, so the guess falls back to a message-length proxy. A
stage that lists open pull requests is sized like a governed architecture
decision, and the weekly AI pool is spent on reasoning those stages do not need.

§6.1 of the parent design sets the rule: the shape declares the tier, and the
run does not guess. The tier is a capability floor, not a cost target. A
governed decision is never demoted.

## 2. What already exists

| Need | Substrate | Use |
|---|---|---|
| An effort level and its precedence | `deriveEffortWarrant` (`tak/effort-warrant.ts`): `minimal`…`high`, from reasoning depth, task type, or a length proxy | The declared tier becomes the highest-precedence base. Length and heavy-tool rules may still raise it, never lower it. |
| Stage → run hand-off | `taskConfig.workroomStage` (`scheduling/workroom-stage-task-config.ts`, BI-43C3E914), already carrying the stage's declared tools | The effort rides the same record. There is one record and one home. |
| Spend-aware routing | `spendAwareBudgetClass` (`inference/spend-aware-routing.ts`) | Takes a `neverDemote` flag for a high-effort turn. |
| Binding classification | `diffWorkShapeBinding` (GPP §2.1.1, BI-CB5C0DCE) | Effort is routing metadata, not reach, so it is not a binding row. Declaring tiers needs no version bump. |

## 3. Research & Benchmarking

| System | How effort is chosen | DPF adopts | DPF rejects |
|---|---|---|---|
| **OpenAI Responses API `reasoning.effort`** | The caller sets `minimal`/`low`/`medium`/`high` per request. | The same four-level vocabulary, which matches `EffortLevel`, set by the declaring party (the shape). | Leaving it to each caller ad hoc. In DPF the work shape is the caller of record. |
| **Anthropic extended thinking `budget_tokens`** | The caller sets a per-request thinking budget. | The budget as a floor on capability per call. | A token number in the shape. Shapes declare intent (a tier) and routing maps it to a model. |
| **RouteLLM (LMSYS)** | A learned router sends each query to a strong or a weak model by predicted difficulty. | Routing cheap work to cheaper models. | A learned, opaque router. It can demote a governed decision on a prediction. DPF's rule is declarative and never demotes a governed stage. |

**Standard followed:** OpenAI-style four-level reasoning effort as the
vocabulary. **Deviation:** governed-decision stages are pinned to `high`
whatever the shape declares (parent §6.1). That is a governance rule, not a
cost rule.

## 4. Design

1. `WorkShapeStage.effort?: EffortLevel`. `resolveStageEffort(stage)` returns
   `high` for a `governed-decision` stage, the declared tier otherwise, and
   `null` when undeclared.
2. The drive writes the resolved tier into `taskConfig.workroomStage.effort`,
   beside the stage's tools. An undeclared stage carries no effort, and a stale
   effort from an earlier stage is dropped.
3. The scheduler derives the warrant with `declaredEffort`. The declared tier
   sets the base level (signal `declared:<tier>`); length and heavy-tool rules
   may raise it, never lower it.
4. `tak/stage-effort-routing.ts` applies the tier after the coworker's model
   config resolves:
   - `low`/`minimal` → `minimize_cost`, keeping the coworker's capability floor;
   - `medium` → unchanged;
   - `high` → minimum dimensions raised to at least frontier.

   `spendAwareBudgetClass` never demotes a high turn.
5. Tiers are declared on every agent-principal status-change stage of the
   standing, coworker and orchestration shapes. Delivery shapes and
   `external-build-handoff` stay undeclared.

## 5. Objectives and acceptance

**OBJ-DECLARE:** A work-shape stage declares its effort tier, and the declared tier beats the message-length proxy.

**OBJ-NEVER-DEMOTE:** A governed-decision stage always runs at high effort and is never demoted by tier or spend pressure.

**OBJ-UNCHANGED:** An undeclared stage behaves exactly as before Phase G.

**OBJ-ROUTE:** The tier reaches model routing: low stages route cost-first above the coworker's floor, high stages to frontier capability.

| ID | Objectives | Acceptance statement |
|---|---|---|
| AC-G1 | OBJ-DECLARE | `deriveEffortWarrant({ declaredEffort })` sets the base level with signal `declared:<tier>`; length and heavy-tool rules may raise it, never lower it (effort-warrant tests). |
| AC-G2 | OBJ-NEVER-DEMOTE | `resolveStageEffort` returns high for every governed-decision stage whatever it declares, and `spendAwareBudgetClass` never demotes a high turn (work-shapes and spend-aware-routing tests). |
| AC-G3 | OBJ-UNCHANGED | An undeclared stage writes no effort to `taskConfig.workroomStage` and the scheduler derives today's warrant (workroom-stage-effort, drive-dispatch and scheduler tests). |
| AC-G4 | OBJ-ROUTE | `stage-effort-routing` maps low/minimal to minimize_cost with the floor kept, medium to unchanged, high to frontier minimums (stage-effort-routing and agentic-loop tests). |
| AC-G5 | OBJ-DECLARE, OBJ-NEVER-DEMOTE | Every agent-principal stage of every standing (cadence) shape declares a tier, and no governed-decision stage is declared below high in source (registry guard test in work-shapes tests). |
| AC-G6 | OBJ-ROUTE, OBJ-NEVER-DEMOTE | Live: after deploy, scheduled stage runs for declared-low stages record a declared warrant and cost-first routing, and governed-decision stages keep high effort. |

## 6. Out of scope

- **Board report.** The board's spend-per-stage-against-declared-tier report depends on the parent's Phase A board.
- **Loop envelope.** Most stage briefs exceed the 1,500-character long-input threshold, so a `low` stage's warrant is raised to `medium` in the loop envelope. The saving comes from routing, not from that envelope.
