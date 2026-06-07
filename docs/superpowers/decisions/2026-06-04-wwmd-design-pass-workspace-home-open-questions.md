# ADR: WWMD design pass on 15 open workspace-home architect questions

**Date:** 2026-06-04
**Standing rule established:** Every architect-default question filed in a DPF spec or plan PR is run through `mcp__dpf__principle_decide` before being treated as resolved. WWMD verdict is the audit record; operator may override with documented evidence in the same PR that overrides.
**Epic:** EP-REDUCTION-GEAR-ARCH
**Status:** Accepted

## Procedure

Operator direction 2026-06-04:

> "Run all the quests by WWMD, this should be procedure."

For each open question across the workspace-home governance PRs (#1442, #1452, #1453, #1462, #1464), a real `principle_decide` MCP call was made with structured dimension features so commandments scored (not just semantic fallback). The verdict + margin + confidence is captured below; the contribution ledger is preserved in the audit log.

## Verdicts summary

| # | PR | Question | WWMD verdict | Composite | Margin | Confidence | Vs default |
|---|---|---|---|---|---|---|---|
| 1 | #1442 | Worker-mode shell-chrome switch — same PR or separate BI? | **separate-bi** | 5.66 | 0.53 | high | **diverges** |
| 2 | #1442 | HVAC fixture seed — admin-button or orchestrator-auto? | **delegate-to-orchestrator** | 6.17 | 2.78 | high | confirms post-BI-B14D6CF6 |
| 3 | #1452 | Caching boundary — none v1 / per-request / cross-request? | **no-caching-v1** | 5.54 | 0.97 | high | confirms |
| 4 | #1452 | Severity conflict — surface both vs hide one? | **surface-both** | 6.02 | 2.29 | high | confirms |
| 5 | #1452 | Decision-interaction join — batch-fetch vs N+1? | **batch-fetch** | 5.86 | 2.32 | high | confirms |
| 6 | #1452 | PAR queue source — CoworkerActionEnvelope+Governor join vs new table? | **envelope-governor-join** | 6.05 | 2.60 | high | confirms |
| 7 | #1453 | Map widget — Leaflet vs Mapbox vs SVG? | **leaflet-osm** | 5.82 | 1.62 | high | confirms |
| 8 | #1453 | Barrel structure — per-family vs single index? | **per-family-barrels** | 5.42 | 1.18 | high | confirms |
| 9 | #1453 | VerticalWorkspaceHome ownership — first-PR-wins vs separate BI? | **separate-bi** | 5.50 | 0.41 | high | **diverges** |
| 10 | #1453 | Phase 9 UX — synthetic-fixture vs wait-for-Dale? | **synthetic-fixture** | 5.33 | 0.24 | high | confirms |
| 11 | #1462 | BI-B14D6CF6 shape — universal orchestrator vs per-archetype? | **universal-orchestrator** | 6.15 | 3.57 | high | confirms |
| 12 | #1464 | Setup-task model — PlatformNotification/WorkItem vs new model? | **verify-substrate-pick-existing** | 6.03 | 2.92 | high | confirms |
| 13 | #1464 | Telemetry placement — same module or separate? | **same-module** | 6.09 | 2.44 | high | confirms |
| 14 | #1464 | Reconciliation cadence — daily / hourly / weekly? | **daily** | 5.43 | 0.45 | high | confirms |
| 15 | #1464 | Wizard outcome surface — inline vs banner? | **inline-success** | 5.44 | 1.24 | high | confirms |

Highest-margin verdict: Q11 (universal-orchestrator, margin 3.57). Lowest-margin verdict: Q10 (synthetic-fixture, margin 0.24, still high confidence per the kernel's 0.20 tieMargin threshold).

## The three divergences

The kernel inverted my proposed defaults on three questions. Each requires a downstream action:

### Q1 — Shell-chrome switch as a separate BI

**Original default (my proposal):** land in PR #1442 Phase 2 alongside `VerticalWorkspaceHome` wiring.
**Kernel verdict:** separate BI focused on the `(shell)` layout chrome contract; gate before BI-CE6AF925 sign-off.

**Action:** file a new BI for the worker-mode shell-chrome switch. Update PR #1442 plan to remove the in-PR shell-chrome wiring and reference the new BI as a Phase 2 dependency. The new BI body: "Establish the worker-mode shell-chrome contract — `(shell)/layout.tsx` reads `WorkspaceHomeResolution.mode` and swaps chrome (hide `INTERNAL COCKPIT` chip, swap nav-group filter, define role-authorized operator switching) when `mode === 'vertical'`."

### Q2 — HVAC fixture seed delegated to orchestrator

**Original default (my proposal at draft time):** admin-button manual seed.
**Kernel verdict (and self-corrected): delegate to BI-B14D6CF6 orchestrator.

**Action:** PR #1442 Phase 9 (HVAC fixture seed) deletes; the universal orchestrator from BI-B14D6CF6 (PR #1464 plan) owns auto-seed gated by `DPF_SEED_DEMO_DATA=true`. This was already self-corrected when BI-B14D6CF6 was filed and the orchestrator plan landed. PR #1442 plan needs a follow-on amendment to remove Phase 9.

### Q9 — `VerticalWorkspaceHome` as a separate BI

**Original default (my proposal):** first-PR-wins coordination between PR #1442 and PR #1453.
**Kernel verdict:** separate BI for `VerticalWorkspaceHome`; both PRs depend on it shipping first.

**Action:** file a new BI for `VerticalWorkspaceHome` as an explicit substrate component. Update PR #1442 Phase 2 + PR #1453 Phase 7 to reference it. The new BI body: "Ship the `VerticalWorkspaceHome` React component that reads a resolved contribution + activation plan + signal streams and renders each slot through the registered primitive registry, falling back to `UnknownPrimitiveComponent` on unknown keys."

## Confirmed verdicts — applied without change

12 of 15 verdicts confirmed the plan/spec defaults. Applied to each PR's body via comment linking back to this ADR; no plan-doc amendments required for confirmation cases.

## Standing procedure going forward

For every architect-default question that surfaces in a spec or plan PR under EP-REDUCTION-GEAR-ARCH (or any DPF epic):

1. Call `mcp__dpf__principle_decide` with the question framed as 2-4 options, each supplied with structured `features` covering at minimum: `governance_compliance`, `speed_to_value`, `blast_radius`, `evidence_density`, `schema_grounding`, `long_term_maintainability`, `human_cognitive_load`, `public_safety`.
2. Use `callingPopulation: "in_platform_coworker"` for agent-driven design-pass calls.
3. Set `ringScope` to the rings the decision binds (workspace-home work typically `["ring-2-workflow", "ring-3-archetype"]`).
4. Record the verdict + composite + margin + confidence in the affected PR description or as a PR comment linking back to a decision-record ADR like this one.
5. When verdict diverges from the proposed default, EITHER act on the verdict OR document operator override + evidence in the same PR that overrides.
6. When verdict confirms the default, no action beyond the audit record.

## Memory entry candidate

This ADR is candidate material for a kernel-tier memory entry:

> **"WWMD verdicts before architect defaults"** — operator-stated procedure 2026-06-04. Architect defaults in spec/plan PRs are not resolved until `mcp__dpf__principle_decide` returns a verdict, recorded in an ADR or PR comment. Even when the kernel confirms the default, the audit record is what makes the decision durable.

## Affected PRs / BIs

- PR #1442 — Dale HVAC plan: amend to (a) remove Phase 9 (orchestrator owns it), (b) reference the new shell-chrome BI as a dependency for Phase 2.
- PR #1452 — Projection spec: 4 confirmed verdicts; no amendment needed.
- PR #1453 — Primitive registry plan: amend Phase 7 to reference the new `VerticalWorkspaceHome` BI as a dependency.
- PR #1462 — Roster amendment: 1 confirmed verdict; no amendment needed.
- PR #1464 — Orchestrator plan: 4 confirmed verdicts; no amendment needed.
- **BI-8D9CA348** — worker-mode shell-chrome switch (filed 2026-06-04).
- **BI-683C0B9A** — `VerticalWorkspaceHome` component (filed 2026-06-04).
