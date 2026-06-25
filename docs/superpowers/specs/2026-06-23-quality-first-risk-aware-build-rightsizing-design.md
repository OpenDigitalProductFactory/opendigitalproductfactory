# Quality-first, risk-aware Build Studio right-sizing

*Design — 2026-06-23. Epic: EP-QUALITY-RIGHTSIZING. Status: approved direction (WWMD HIGH-confidence, composite 11.19 / margin 4.62).*

> **Provenance note (2026-06-25):** this spec was reconstructed from the BI bodies
> (BI-163B4D28 / BI-9AF9595A / BI-CFEB2B22) and the live code after the original
> file was lost in the 2026-06-23 disk/DB revert. The design is unchanged; the
> reconstruction is grounded in the current `build-process-matrix.ts`,
> `govern/risk-posture.ts`, the golden-triangle compiler, and `integrate/change-impact.ts`.

## Problem

Build Studio right-sizes a build by **(work-type, size)** only
(`apps/web/lib/explore/build-process-matrix.ts`). Two gaps:

1. **Size is not risk.** A *small* change to authentication, billing, customer
   data, security, or the decision kernel is far higher-stakes than a *large*
   cosmetic refactor — but today both are sized purely by effort, so the risky
   small change gets the *least* ceremony. There is no sensitivity/risk axis.
2. **The default leans cheap, not quality.** `getModelTier` routes small/medium
   work to the local model and only large/xlarge to the robust tier; the review
   matrix tops out at "standard" for the dominant feature cell. For an
   owner-operated factory where correctness dominates cost, the default should be
   **quality-first** — robust model + meaningful review for substantive work —
   with the cheap local tier reserved for the trivial tail (small doc/chore).

## Doctrine

- **Quality-first defaults.** Substantive work gets the robust tier and real
  review by default; the local/minimal path is the explicit exception for the
  trivial tail, not the default.
- **Risk is a second axis, monotonic.** A `deliverableSensitivity` (low |
  elevated | high) rides alongside size. It can only ever **raise** process
  (more review, deeper tier, fuller phases) — never lower it. A HIGH-sensitivity
  deliverable (auth / billing / customer-data / security / kernel / governance)
  escalates to the deepest policy **regardless of size**.
- **One dial on top.** The golden-triangle Cost/Quality/Time posture is the
  operator's everyday lever; it compiles into the same knobs (tier, review,
  deliberation) but is **floored by the risk axis** — Cost/Speed can never
  discount a HIGH-sensitivity deliverable below its sensitivity floor.
- **Flag-gated, byte-identical off-flag.** Every change is gated behind
  `DPF_BUILD_QUALITY_FIRST_RIGHTSIZING`; with the flag off and no sensitivity
  supplied, the matrix is byte-identical to today (the existing contract test
  on the default `(feature, medium)` cell still holds).

## §4.1 — Quality-first defaults (P1: BI-163B4D28)

- **`getModelTier` flip (flag-on):** robust for all substantive work; `local`
  **only** for the trivial tail (`doc`/`chore` × `small`). A HIGH-sensitivity
  deliverable is always robust. Flag-off → today's size-based routing, unchanged.
- **Review-intensity bump (flag-on):** the dominant cells move toward quality
  (e.g. `feature`/`medium` standard → thorough). Implemented as a *monotonic
  escalation transform* over the existing matrix cell, not a second matrix — so
  off-flag is provably the base cell.

## §4.2 — Sensitivity axis (P1 heuristic; P3 proper)

- **`deriveDeliverableSensitivity(text, workType, riskPosture)`** → low | elevated
  | high. P1 uses a **path/keyword heuristic** over the BI title/body + brief
  (auth, credential, token, billing, payment, card/PCI, customer-data/PII,
  security, encryption, kernel, governance, RBAC/permission → **high**;
  database/migration/schema/integration/outbound/federation/edge → **elevated**;
  else **low**). The org **risk posture** (`govern/risk-posture.ts`,
  conservative|balanced|progressive) is a *floor*: a conservative org raises the
  baseline (low → elevated). The result is `max(keyword, posture-floor)` —
  monotonic.
- **Escalation is monotonic.** Given the base `(type, size)` policy, HIGH raises
  reviewIntensity → thorough, phases → full, model tier → robust, and pulls the
  strict gate set; it never removes a phase or relaxes a gate the base already
  required.

## §4.3 — Golden-triangle live dial (P2: BI-9AF9595A)

Wire an OrchestrationBudget-style Cost/Quality/Time setting — **global default in
PlatformConfig + per-deliverable override** — that compiles (via the existing
golden-triangle compiler + `inferContract`) into model-tier + review-intensity +
deliberation depth for a build. **Default pinned to Quality.** Cost/Speed are
**capped by the §4.2 risk axis**: the compiled policy is `max(dial, sensitivityFloor)`,
so the dial can raise rigor but never discount a HIGH-sensitivity deliverable
below its floor. Threads the derived sensitivity through the gate evidence so the
phase gates escalate per-deliverable, completing the wiring P1 lands as pure
capability. Depends on P1.

## §6 — Blast-radius sensitivity (P3: BI-CFEB2B22)

Replace P1's path/keyword heuristic with **code-graph blast-radius derivation**
(`apps/web/lib/integrate/change-impact.ts`): sensitivity is a function of *what
the change actually reaches* — the set of downstream modules/contracts impacted —
not a keyword guess. Satisfies Architecture-Over-Shortcuts: the heuristic is an
honest interim that lets P1 ship; this is the accurate version.

**Design constraint discovered during P2 (2026-06-25):** `analyzeChangeImpact()`
computes blast-radius **from a git diff**, which only exists *after* codegen. At
build-sizing time (dispatch — where P1's keyword heuristic runs) there is **no
diff yet**. So P3 is **not** a drop-in swap at sizing time; it is a **two-phase**
design:

1. **Pre-codegen (size):** keep P1's keyword heuristic — the best signal before any
   code exists. Unchanged.
2. **Post-codegen (verify):** at the review/ship gate, where the build's diff
   exists, run `analyzeChangeImpact(diff)`, map its `riskLevel`
   (`critical|high → high`, `medium → elevated`, `low → low`) plus route/schema
   counts via a pure `changeImpactToSensitivity(report): DeliverableSensitivity`,
   and **monotonically raise** the build's process if the *actual* reach exceeds
   the keyword guess (`max(keywordSensitivity, blastSensitivity)`). This catches the
   "small styling tweak that actually edits a shared util imported by auth + billing"
   case: keyword said low, the diff reveals high reach → escalate review before ship.

So the `DeliverableSensitivity` output contract is preserved (the pure mapper drops
in behind the same callers), but the *integration point* is the verify gate, not
dispatch — a more involved wiring than P1/P2 (find the review-time diff, thread the
monotonic escalation into the review intensity / gate). Depends on P1; should land
on merged P2 (which calls `deriveDeliverableSensitivity`).

## Implementation status

- **P1 (BI-163B4D28)** — shipped (#2386). Matrix capability + flag + live model-tier
  flip + heuristic sensitivity.
- **P2 (BI-9AF9595A)** — engine shipped: `build-rightsizing-dial.ts` composes the
  golden-triangle compiler with the sensitivity floor (`resolveBuildSizing`,
  `sensitivityToTierFloor`, `coerceBuildPosture`), `getBuildGoldenTrianglePosture`
  reads the global default (pinned Quality) from PlatformConfig, and the build
  dispatch resolves the dial (per-build plan override → global default), floored by
  sensitivity. Same `DPF_BUILD_QUALITY_FIRST_RIGHTSIZING` flag; off-flag unchanged.
  *Follow-up (P2.1):* the operator UI to set the global default / per-build override
  (reuses `GoldenTrianglePriorityPanel` on the Priority & Models surface) + threading
  the dial's `reviewIntensity` into the build-orchestrator's deliberation choice.
- **P3 (BI-CFEB2B22)** — pending: blast-radius sensitivity behind the same
  `deriveDeliverableSensitivity` contract.

## Sequencing

P1 (matrix capability + flag + live model-tier flip + heuristic sensitivity) →
P2 (live dial + per-deliverable gate threading, floored by sensitivity) →
P3 (blast-radius sensitivity replaces the heuristic). Each is flag-gated and
independently shippable; off-flag is byte-identical throughout.
