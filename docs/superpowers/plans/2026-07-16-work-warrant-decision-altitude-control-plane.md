# Work Warrant — decision-altitude control plane

**Epic:** EP-7B169558 · **Anchor BI:** BI-8AB0E66D
**Backlogged siblings:** BI-0A6B8B38 (per-phase token/cost metering), BI-EE211BFA (WWWD org-stance → evidence/reporting/AC-groups)

## Problem

The decision-governance ladder (WSID task · WWWD business · WWMD architectural) and
the shared execution substrate (the one sandbox) are **disconnected**: a decision's
altitude and its company/industry/location context don't flow down to change how
execution spends tokens, gathers evidence, or reports. So Build Studio applies
**uniform maximal rigor and unmetered spend to every job** — a 4-file badge and an
xlarge cross-channel report both run the same ideate→plan→(2 reviews)→build machinery,
and both record `cost=null`. Observed 2026-07-16: `BuildPhaseRun` token/cost were
0/null across all builds; completed builds ran identical phase sets regardless of size.

## Design: the Work Warrant

A `WorkWarrant`, computed once at promote/triage and read by every downstream consumer:

```
WorkWarrant {
  altitude:         WSID | WWWD | WWMD
  altitudeBasis:    structural | corpus | operator   // provenance
  confidence:       high | medium | low
  lane:             autonomous-bs | governed-interactive | direct-expert
  budget:           { tokenCeiling, modelTier, effortLevel, gateProfile }
  evidenceProfile:  minimal | standard | compliance | architectural
  reportingProfile: one-line | business | ledger
  contextScope:     { industry, jurisdiction, archetype }
}
```

Consumers: funnel admission/prioritization, lane router (governed-interactive runs on
the **same** sandbox — no proliferation), effort binder (activates the dormant
EP-27FD96BC knobs from `budget`), evidence collector (`evidenceProfile`), reporter
(`reportingProfile`).

## Cold-start: structure-first (kernel-ratified)

The hard constraint (operator): altitude must classify when the WWWD/WSID corpus is
**not yet established** on a fresh install. Routed through `principle_decide`
(WWMD-altitude platform decision):

- **Recommendation: `structure-first`** — composite **0.874**, margin **0.78**,
  confidence **high**; top positive contributor **Architecture Over Shortcuts**
  (read `corpus-required` / `operator-labeled` as shortcuts that defer the design and
  incur rework); governing profile: organization; no commandment conflict.

The classifier (`apps/web/lib/decision/work-warrant-altitude.ts`, this PR) is a pure,
corpus-free function over day-one structural signals. It works because of the ladder's
asymmetry:

- **WWMD** (expensive to mis-classify) — hard structural rules (decompose-required,
  xlarge, schema/routing/core-contract touch). Its corpus is *already* established
  (principle dimensions, AGENTS.md, golden decisions), so the must-be-right end is
  right on day one.
- **WSID** (cheap if wrong) — structural defaults (small + single-leaf + no cross-cutting).
- **WWWD** (thin corpus) — defers to `needsOperatorConfirm`; each confirmation **seeds**
  the corpus, so it sharpens from operation rather than blocking on it.
- **Ambiguous** — never silently WSID; defaults to the safer higher altitude + confirm.

`altitudeBasis` records provenance (structural → corpus → operator), so an auditor can
watch the classifier shift from structural to corpus-driven as the org matures and
never trust corpus it doesn't have.

## Phasing

1. **This PR** — corpus-free `classifyAltitude` core + unit tests (no DB/model/corpus).
   The de-risking artifact: proves the cold-start classification is decisive with zero corpus.
2. **BI-8AB0E66D cont.** — the `WorkWarrant` object + wiring into promote/triage;
   consumers read it (lane, budget→effort knobs, gate profile).
3. **BI-0A6B8B38** — populate `BuildPhaseRun` token/cost so `budget.tokenCeiling` is
   enforceable (until then it is advisory).
4. **BI-EE211BFA** — WWWD org stance parameterizes evidence/reporting/decomposition
   AC-groups by industry + jurisdiction (extends the compliance-archetype pattern).

## Update — `deriveWarrant` mapping core landed (Phase 2 partial)

`apps/web/lib/decision/work-warrant.ts`: the pure `deriveWarrant(verdict, blastRadius?, context?)`
→ `WorkWarrant` mapping — where the decision-end (altitude) and diff-end (blast radius)
meet. Design decisions baked in:

- **Altitude base map:** WSID → autonomous-bs / economical / collapsed gates / minimal
  evidence / one-line; WWWD → governed-interactive / standard / business; WWMD →
  governed-interactive / strong / full gates / architectural / ledger.
- **Blast radius only ESCALATES (monotonic).** A warrant is safe to compute from
  altitude alone; blast radius (a-priori from code-graph+EA, a-posteriori from the diff
  — BI-22250BA2) can raise lane/evidence but never relax them. A small WSID change with
  a large blast radius is pulled off the autonomous lane + flagged for confirm; a tiny
  blast radius never softens a WWMD warrant. This is the "risk = what could break"
  override, and it reconciles with EP-QUALITY-RIGHTSIZING (diff-end sensitivity).
- **Context overlay:** a WWWD industry/jurisdiction obligation raises evidence to
  `compliance` and carries `contextScope` for the evidence collector + reporter
  (BI-EE211BFA).
- `budget.tokenCeiling` is `null` (advisory) until metering lands (BI-0A6B8B38); the
  `effortLevel`/`gateProfile`/`modelTier` knobs deliver the immediate token win.

## Reuse (migration, not green-field)

Right-sizing matrix (`build-process-matrix.ts`), decision tables
(`DecisionShadowLedger`/`DecisionPerspectiveProfile`), dormant effort-warrant knobs
(EP-27FD96BC), archetype scoping (compliance). The warrant is the control object that
ties them to a single altitude signal.

Process-Spine-Decision: altitude-classifier approach ratified via principle_decide
(structure-first, composite 0.874, high confidence) — see above.

## Convergence with EP-QUALITY-RIGHTSIZING (bridge, feat/warrant-rightsizing-bridge)

Grounding review found the warrant must NOT run a parallel rigor engine: the existing
`build-process-matrix.ts` already escalates gate/review rigor monotonically via
`getProcessPolicy(type, size, RightsizingOpts{qualityFirst, sensitivity})`, already
derives a blast-radius `sensitivity` (`deriveDeliverableSensitivity`), and already picks
a `BuildModelTier` (`getModelTier`). The warrant's `budget.gateProfile`/`budget.modelTier`
are the SAME decisions viewed through altitude + blast-radius.

Decision: the warrant is the single **front door**; `warrant-rightsizing-bridge.ts` maps
it onto the one existing engine so `checkPhaseGate` stays the sole gate authority:
- `warrantToRightsizingOpts(warrant)` → `{qualityFirst, sensitivity}` (collapsed→inert base
  cell; standard→elevated; full→high). Monotonic — can only raise rigor above the matrix
  baseline, never relax below it.
- `resolveWarrantedPolicy(type, size, warrant)` → the one `LifecyclePolicy` a build runs.
- `warrantToModelTier(warrant)` → reconciles the 3-tier budget (economical|standard|strong)
  with the engine's 2-tier `BuildModelTier` (local|robust).

Consequence: **BI-22250BA2 (blast-radius signal provider) IS the already-planned
BI-CFEB2B22 (P3)** — the `deriveDeliverableSensitivity` header names it: "replaces the
heuristic with code-graph blast-radius." They should be consolidated: the code-graph + EA
blast-radius feeds `sensitivity` (verify) and the warrant's blast-radius (promote) through
one core, not two.

## Operator visibility slice (feat/work-warrant-visibility)

UX fit: fits-with-guardrails.

- Owning area: Platform > Build Studio.
- Route family: `/build`.
- Primary persona: founder/operator or contributor who needs to understand how much rigor a build will use without reading JSON or enum names.
- Navigation layer: no navigation change; existing active-build pane only.
- Reuse/convergence: compose report-kit `StatusBadge` and existing Build Studio status-band styling; no new route, dashboard, tab, or one-off badge palette.
- Source truth: `FeatureBuild.plan.workWarrant`.
- Empty/failure behavior: older builds without `plan.workWarrant` render no band, avoiding false certainty.
- AI boundary: informational only; no prompt-send or coworker action.

Implementation:

- Add a plain-language WorkWarrant band to the active-build pane:
  - “Architecture-level work — governed review, strong model, ledger evidence”
  - “Business-level work — operator-confirmed business review”
  - “Craft-level work — lightweight execution”
- Carry the warrant’s first concrete reason into the band as “Why: …” so the operator can see what caused the rigor level.

Evidence before merge:

```bash
pnpm --filter web exec vitest run components/build/BuildWorkWarrantBand.test.tsx components/build/BuildStudioHeaderLayout.test.tsx
pnpm --filter web typecheck
```

## Promote wiring (feat/warrant-promote-wiring) — the plane takes effect

Before this, `deliverableSensitivity` was never set on promoted builds, so
EP-QUALITY-RIGHTSIZING's blast-radius escalation was DORMANT — rigor keyed on
effort size alone.

- `warrant-for-item.ts` `warrantForBacklogItem({effortSize, workType, text, context})`
  is the pure, corpus-free promote-time entry: keyword sensitivity
  (`deriveDeliverableSensitivity`, interim blast radius) → `classifyAltitude` →
  `deriveWarrant` → `warrantToRightsizingOpts`. Returns `{warrant, opts}`.
- `governed-backlog-tee-up.ts` calls it and persists on the build plan:
  `plan.workWarrant` (full object) + `plan.deliverableSensitivity` +
  `plan.qualityFirst` (what the gate reads).
- The 4 `checkPhaseGate` evidence sites in `mcp-tools.ts` now thread
  `deliverableSensitivity`/`qualityFirst` from the plan (mirroring `processSize`),
  so `rightsizingOptsFromEvidence` escalates the policy by altitude + blast-radius.

Effect: a security/auth/schema BI or an xlarge feature gets thorough review even
when effort size is "small"; a small doc/chore stays light. Monotonic — can only
raise rigor above the matrix baseline. When the code-graph + EA provider
(BI-22250BA2) lands it swaps the interim keyword blast radius for the graph-derived
one behind the same `warrantForBacklogItem` seam; no gate-site changes.
