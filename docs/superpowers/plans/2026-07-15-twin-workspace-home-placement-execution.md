# Operational Twin → Workspace Home Placement (EP-LIVING-BUSINESS-VIZ P3, increment 2)

- **Status:** in progress
- **Date:** 2026-07-15
- **Epic:** EP-LIVING-BUSINESS-VIZ
- **Parent spec:** [`docs/superpowers/specs/2026-07-11-living-business-workforce-visualization-design.md`](../specs/2026-07-11-living-business-workforce-visualization-design.md) §9 (Open questions → Home placement)
- **Sibling spec:** [`docs/superpowers/specs/2026-07-12-operational-twin-framework-design.md`](../specs/2026-07-12-operational-twin-framework-design.md) (the twin grammar + `deriveTwinProfile` + `TwinView`)
- **Sibling execution (owned by another thread — NOT edited here):** `docs/superpowers/plans/2026-07-12-operational-twin-framework-execution.md`

## 1. Goal

Put the operational twin onto the **real** `/workspace` home so the operational
twin becomes the main workspace view — the original goal of the epic. Build only
on the already-merged pieces:

- `deriveTwinProfile(archetype)` and `ALL_ARCHETYPES` (`@dpf/storefront-templates`).
- `TwinView` + `buildDemoTwinSnapshot(profile)` (`apps/web/components/twin/`).

Render **demo data** for now behind **one clean seam** so the sibling thread's real
`LivingBusinessSnapshot` projection (parent spec P4) — which fills the same
`TwinSnapshot` shape — is a one-line swap later. This plan does **not** build the
projection.

## 2. The placement decision (governed)

§9 of the parent spec left home placement open. Three candidates:

- **(a)** twin as hero body of `VerticalWorkspaceHome`, `OperatorCockpit` folded into its HUD rail (spec leaning);
- **(b)** twin above `OperatorCockpit`;
- **(c)** a dedicated `/workspace` hero with the cockpit folded in as its HUD.

**Governance trail (guard-off branch → routed by hand):**

1. `dpf-ux-fit-review` → **fits-with-guardrails** (see §4 guardrails). Owning area
   Workspace; no new route; reuses `TwinView`/`deriveTwinProfile` verbatim.
2. `principle_decide` (`callingPopulation=external_coding_agent`,
   `human_cognitive_load` + maintainability/reuse/blast-radius/speed features) →
   **recommended (a)**, composite 7.92, margin 2.25, **confidence high**, no
   commandment conflict. `human_cognitive_load` is a *cost* axis; (b) scored
   highest load (two attention surfaces).
3. `AskUserQuestion` (task-required confirmation) → **operator chose (c)**, a
   dedicated hero. The operator owns the final placement call; the kernel ledger
   was surfaced first (consult-then-defer order held).

**Decision: (c) — a dedicated `/workspace` twin hero, cockpit folded in as its
HUD.** The hard guardrail from the ux-fit review + `principle_decide` survives the
choice: **exactly one attention surface** on the home.

## 3. The single-attention-surface constraint (BI-8C3EB52C)

`OperatorCockpit` is the ONE live "what needs you now" surface on the workspace
home. `TwinView` carries its *own* attention/decision surfaces — `NeedsYouQuests`
(self-described as "the single what-needs-you-now surface") and the `CogBanner`
HITL confirm. Rendering both live would re-introduce the exact two-framings
problem BI-8C3EB52C closed, and the demo cog would present a **fake** confirm
control on the main home.

Resolution: on the workspace-home mount, **suppress the twin's `quests` and `cog`**
so the cockpit HUD is the only attention/decision surface. The twin body then
shows the operational picture — capacity chips, presence, zones of resource
units, work-in-flight, queues, activity feed, utility band. `TwinView` is **not
edited** (sibling-owned); suppression happens in this surface's own seam.

## 4. UX-fit guardrails (folded into this plan)

- Cockpit stays the single attention surface, rendered as the hero's HUD; no
  second attention count.
- Twin demo `cog` + `quests` suppressed on the home mount.
- Panel labelled **"Demo data — live business projection pending"** until the
  sibling projection lands.
- Platform tiles/launcher **demote** (heading "All workspace areas", simple
  density) below the hero — reachable navigation, not a rival dashboard stacked
  beside the twin.
- One demo→real seam (single function). No hardcoded colors (TwinView is already
  token-compliant). No new report-kit dialect.

## 5. Files (all inside the ALLOWED zone)

| File | Kind | Role |
| --- | --- | --- |
| `apps/web/lib/workspace-home/twin-panel-data.ts` | new | The seam. `resolveWorkspaceTwinPresentation(archetypeId, name)`: slug → `ALL_ARCHETYPES` → `deriveTwinProfile` → `produceWorkspaceTwinSnapshot` (**the one demo→real line**) → `condenseForWorkspaceHome` (drops `cog`+`quests`). Total, never throws, returns `null` when no definition resolves. |
| `apps/web/components/workspace-home/WorkspaceTwinPanel.tsx` | new | Renders the demo badge + `<TwinView profile snapshot />`. |
| `apps/web/components/workspace-home/WorkspaceTwinHero.tsx` | new | The dedicated hero: identity header + cockpit HUD (passed in) + `WorkspaceTwinPanel` body, with the demoted platform body below. |
| `apps/web/app/(shell)/workspace/page.tsx` | edit | Resolve the twin presentation; when present, render `WorkspaceTwinHero` (cockpit folded in) instead of the standalone cockpit + `VerticalWorkspaceHome`/`PlatformWorkspaceHome`. Unchanged fallback otherwise. |
| `apps/web/lib/workspace-home/twin-panel-data.test.ts` | new | Seam unit tests: profile resolves for a real archetype slug; snapshot condensed (`cog` undefined, `quests` empty); `null` for unknown/empty slug; determinism. |

**Not edited (sibling-owned):** `apps/web/components/twin/**`, `apps/web/lib/twin/**`,
the sibling execution plan.

## 6. Data seam (demo → real)

`twin-panel-data.ts` isolates the swap to a single function body:

```ts
// THE DEMO→REAL SEAM — swap this one body when LivingBusinessSnapshot lands.
function produceWorkspaceTwinSnapshot(profile) {
  return { snapshot: buildDemoTwinSnapshot(profile), demo: true };
}
```

`condenseForWorkspaceHome` (drop `cog`/`quests`) is a *separate* concern from the
data source, so it persists across the swap: the cockpit remains the single
attention surface whether the snapshot is demo or live.

## 7. Verification

- `pnpm --filter web typecheck`.
- `pnpm --filter web exec vitest run` for `twin-panel-data.test.ts` and the
  workspace-home suite (`registry`, `profiles`, `activation-summary`,
  `VerticalWorkspaceHome`, `OperatorCockpit`, `page`).
- No new route (no `build:route-manifest` needed).
- Browser exercise of `/workspace` (desktop + mobile) on a leased runtime /
  canonical install: one attention surface, twin hero renders, platform launcher
  demoted, demo badge present.

## 8. Research & benchmarking

Operational-twin "single pane over live operations with one action queue" mirrors
NOC/ops-console patterns (Datadog/Grafana single-pane dashboards, Salesforce
Service Cloud omni-channel "what needs you" list) where a persistent attention
rail sits above a live operational canvas rather than beside a rival dashboard.
The rejected pattern is the multi-dashboard portal (stacked KPI boards each with
its own alert list) — precisely the cognitive-load cost the `human_cognitive_load`
scoring penalised in option (b). The adopted pattern keeps one attention rail
(cockpit) + one operational canvas (twin), consistent with the DPF single-
attention-surface decision (BI-8C3EB52C).
