# Coworker Work Orchestration — one control, a rigor ladder, fewer surfaces

*Design note — 2026-06-25. Status: approved direction (founder /goal), implementing in slices.*

## Problem

Managing "how an AI coworker does work" is spread across competing surfaces, and the
rigor patterns we already have (review, debate) are not leveraged by the everyday control:

1. **Two surfaces set the same knobs.** The Golden Triangle per-coworker posture compiles to
   `minimumTier` + `budgetClass` (among others); the **Assignments** page (`AgentModelConfig`)
   *also* sets `minimumTier` + `budgetClass` per agent. At dispatch they collide with no owner:
   - `budgetClass`: `AgentModelConfig` (defaults `balanced`, always sent) **silently overrides**
     the posture → the triangle's Cost/Quality budget lever is dead for configured agents.
   - `minimumTier`: stricter-of-the-two wins via per-dimension max; the compiler's
     `policyConstraints.minimumTierFloor` exists but is **never fed** from `AgentModelConfig`.
2. **Review/debate are invisible to coworkers.** The compiler emits `deliberationPattern: "review"`
   for the quality posture, but **nothing consumes it** on a coworker turn — review/debate only
   run inside Build Studio. So "more rigor at higher effort" doesn't happen where you'd expect it.
3. **Too many surfaces.** `/platform/ai` carries Priority, Assignments, Prompts, Skills, Providers,
   … to manage one thing — how a coworker works. The operator shouldn't hunt across tabs.

## Doctrine

**One everyday control; one expert backstop; effort buys a ladder of rigor.**

- **Golden Triangle = the everyday, high-level control** (per coworker). Cost/Quality/Time → the
  full ladder below. This is what an operator touches.
- **`AgentModelConfig` = the expert guardrail/floor**, not a competing everyday control. It holds
  what the triangle *can't* express and what must *bound* it: a hard **tier floor**, a **pinned
  provider/model**, **capability** and **context-window** floors. Precedence is the design's
  existing rule: **hard policy > AgentModelConfig floor > posture > model availability.**
- **Effort buys rigor, in a ladder** — the Quality/effort axis doesn't just pick a bigger model,
  it escalates *how hard the coworker checks its own work*:

  | Posture (Quality/effort) | Model tier | Reasoning effort | Verification | Deliberation |
  |--------------------------|-----------|------------------|--------------|--------------|
  | Fast / Frugal (low)      | adequate  | low              | none         | none |
  | Balanced                 | default   | default          | none         | none |
  | Assured (high)           | frontier  | high             | shallow→deep | **review** (reviewer ≠ author) |
  | Assured · max (top)      | frontier  | max              | deep         | **debate** (multi-perspective) |

## Execution context decides the mechanism (the key constraint)

The full deliberation engine (`startDeliberation`) runs in **minutes** (review ~5–15, debate
~10–30) — appropriate for build artifacts, **not** an interactive chat reply. So effort picks the
*rigor*; the run context picks the *mechanism*:

- **Interactive chat turn** → a **lightweight inline review**: one reviewer-persona pass (distinct
  from the author) that critiques the draft and revises it, bounded to a single extra model call.
  Debate is *not* run inline (too slow); a high-stakes chat answer can offer "escalate to a full
  review" rather than blocking the reply.
- **Autonomous / long-running coworker work** (and builds) → the **full deliberation engine**
  (`startDeliberation`, review/debate, multi-branch), which already exists and is the precedent.

Both are **fail-open**: if the review pass errors or times out, the original draft is returned.
Both are **off unless the posture asks for them** (Balanced and below = today's behaviour exactly).

## Surface reduction

Collapse the per-coworker "how it works" management into **one surface with two layers**:

- **Priority (everyday)** — the Golden Triangle, primary. Shows the compiled ladder in plain
  language (tier, effort, verification, review/debate) so the operator sees what each posture buys.
- **Advanced (expert)** — the former Assignments controls, reframed as **guardrails**: tier *floor*,
  pinned model, capability/context floors. Not a second everyday control.

Net: the operator manages a coworker's work from the **triangle at the composer** + one Advanced
backstop, instead of hunting across Priority + Assignments (+ scattered deliberation buried in builds).

## Slices

1. **Compiler ladder** *(pure, tested)* — extend `OrchestrationBudget` so deliberation escalates
   none → review → **debate** by Quality/effort intensity (debate at the top); keep Balanced inert.
2. **Reconcile the overlap** *(additive, tested)* — feed `AgentModelConfig.minimumTier` into the
   compiler as `minimumTierFloor`; let the posture own `budgetClass`; record the precedence so it's
   never a silent override.
3. **Leverage review (interactive)** *(supervised)* — a lightweight inline reviewer-pass on the
   coworker turn when the posture calls for review; fail-open, single extra call, off by default.
4. **Leverage review/debate (autonomous)** — route autonomous/long-running coworker work to the
   full deliberation engine, mirroring the build precedent.
5. **Surface consolidation** *(UI)* — fold Assignments into the Priority surface as the Advanced
   guardrail layer; show the rigor ladder on the triangle.
