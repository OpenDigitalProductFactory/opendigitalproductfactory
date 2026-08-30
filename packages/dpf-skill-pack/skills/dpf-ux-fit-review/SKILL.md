---
# Single fields shared by both surfaces
name: dpf-ux-fit-review
description: "Use before code or PR handoff for UI-impacting DPF work — any route, viewport, dashboard, metric, card, button, empty state, navigation, or admin/settings/config screen, form, or field. Config forms are UI surfaces."
# Agent Skills standard fields (Surface A - Claude Code / Codex)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob Bash mcp__dpf__search_specs_and_plans mcp__dpf__search_design_intelligence mcp__dpf__wiki_query mcp__dpf__list_epics mcp__dpf__list_backlog_items

# DPF coworker fields (Surface B - in-portal seed loader)
category: governance
assignTo: ["ea-architect", "build-specialist", "platform-engineer"]
capability: null
taskType: review
triggerPattern: "UX fit|UI fit|design fit|feature fit|new route|new tab|first viewport|guided work|dashboard|cockpit|metric tile|KPI|status badge|card|button|link|disclosure|coworker launcher|empty state|navigation change|portal UX|customer surface|workspace surface|business surface|platform surface|config(uration)? (screen|form|ux|tab)|settings (page|screen|form|ux)|admin (screen|panel|form|ux)|preference|form field|input field|number input|numeric input|text field|operator.configurable|per-model|per-provider|context window|token (count|limit|window)|toggle|wizard|setup screen|credential (matrix|picker|source)"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob", "Bash", "mcp__dpf__search_specs_and_plans", "mcp__dpf__search_design_intelligence", "mcp__dpf__wiki_query", "mcp__dpf__list_epics", "mcp__dpf__list_backlog_items"]
composesFrom: ["dpf-architecture-review", "dpf-verify-substrate-first"]
contextRequirements: ["AGENTS.md readable; docs/platform-usability-standards.md readable; portal UX simplification spine readable when present"]
riskBand: low

# Kernel principle enforcement
enforces:
  - kernel/principles/architecture-over-shortcuts
  - kernel/principles/single-source-of-truth
  - kernel/principles/no-hardcoded-colors
  - kernel/principles/compose-report-kit-for-reporting-ux
  - kernel/principles/design-research-required
---

# DPF UX Fit Review

Use this skill before UI-impacting work adds surface area. Its job is to stop the portal from growing into unrelated dashboards, tab rows, one-off metric widgets, and unclear coworker launch points.

This is a fit review, not a visual taste review. Decide where the feature belongs, which persona it serves, which navigation layer changes, what existing component or route family it should reuse, and what evidence proves the UX did not become harder to remember.

## When To Use

- A feature plan adds or changes a route, tab, dashboard band, KPI, metric tile, status badge, empty state, card group, button, link, disclosure trigger, local navigation, or coworker launcher.
- A reviewer asks whether a feature fits the portal architecture.
- A Build Studio plan or external contributor plan touches Workspace, Business, Customer, Products, Platform, Knowledge, Storefront, or Portal UX.
- User-facing labels might train the wrong mental model.
- A plan proposes new UI components that may duplicate report-kit, Customer CRM primitives, Finance patterns, or workspace-home primitives.

## When Not To Use

- The request is a pure code correctness review with no UX surface change.
- The work is a backend-only model/service change and no UI plan exists yet.
- The question is a broad architecture review with no UI or navigation concern; use `dpf-architecture-review`.
- The work is an already-approved implementation task and the fit gate is already captured in the plan; execute and verify instead.

## Read First

| Source | Path or tool | What to extract |
| --- | --- | --- |
| Rulebook | `AGENTS.md` | Portal routes, UI theme rules, Build Studio/verification doctrine |
| Usability standards | `docs/platform-usability-standards.md` | Theme tokens, progressive disclosure, setup/empty-state expectations |
| Portal UX spine | `docs/superpowers/plans/2026-05-26-portal-ux-simplification-spine.md` | Current target areas, persona gates, UX feature fit gate |
| Feature spec/plan | User-provided path or Build Studio artifact | Proposed route, component, data, AI, and verification changes |
| Existing specs/plans | `mcp__dpf__search_specs_and_plans` | Prior design decisions the feature should extend |
| Design intelligence | `mcp__dpf__search_design_intelligence` | Current UX/reporting/chart/product recommendations to compare against the proposed pattern |
| Existing components | `rg` / `Grep` over `apps/web/components` and `apps/web/app` | Reuse candidates, duplicate patterns, and route families |
| Report-kit | `apps/web/components/ui/report-kit/README.md` | Canonical reporting components for status badges, tables, KPI cards, filters, charts |

## Enforces

- `kernel/principles/architecture-over-shortcuts` - choose the route/component shape that can grow without local hacks.
- `kernel/principles/single-source-of-truth` - do not create duplicate route homes, status maps, metric components, or UX rules.
- `kernel/principles/no-hardcoded-colors` - all UI must use DPF theme variables.
- `kernel/principles/compose-report-kit-for-reporting-ux` - reporting/data-display UI composes report-kit unless a domain primitive is explicitly justified.
- `kernel/principles/design-research-required` - user-facing feature specs include research and benchmarking before finalization.

## Review Steps

1. **Name the feature and proposed surface.** Capture the exact route(s), component(s), and user-facing labels in the spec or plan.

2. **Assign the owning area.** Choose one: Workspace, Business, Products, Platform, Knowledge, customer-facing Portal, or internal Storefront management. If the feature needs two homes, identify the canonical home and the secondary shortcut.

3. **State the primary persona.** Name who benefits in the first viewport and what they should not need to remember. Examples: founder/operator, dispatcher, retail/service worker, contributor/platform operator, external customer.

4. **Classify the navigation layer.** Use one layer by default:
   - Global nav: durable product areas only.
   - Section nav: sibling views inside one product area.
   - Local page nav: filters, tabs, anchors, or panel toggles for this page only.
   - Contextual actions: commands, create buttons, launchers, and quick actions.

5. **Check component convergence.** Search existing UI before approving new primitives:
   ```
   rg -n "MetricTile|StatusBadge|StatCard|DataTable|FilterBar|Chart|KPI|Badge|Launcher|TabNav" apps/web/components apps/web/app
   ```
   Prefer report-kit for reporting/data-display UI. Prefer existing domain primitives when the feature lives inside a domain family. A new component must retire or converge duplication, not add another visual dialect.

6. **Check source truth.** Name the model, service, read model, or route contract that owns each visible status, metric, or count. If the source truth is unclear, return `defer` until the data seam is resolved.

7. **Check empty, failure, and permission states.** A fresh install, missing permission, unavailable provider, or missing route should show an honest next action or recovery path. Empty dashboards full of zeros fail the gate.

8. **Check AI/coworker action boundary.** Informational cards, metric tiles, tabs, and topic choices must not send prompts. Any coworker-starting action needs preview, expected next step, context summary, and explicit confirmation.

9. **Check copy and mental model.** User-facing labels should describe the user's work, not the benchmark product, schema model, route name, or implementation phase. Avoid visible "Phase 2", "Phase 3", raw null/unknown states, or vendor-inspired labels unless the user truly needs them.

10. **Decide and write the guardrails.** Return one of:
   - `fits` - no required edits.
   - `fits-with-guardrails` - implementation may proceed after the named edits are folded into the plan.
   - `defer` - the feature needs data/source-truth/backlog/route work first.
   - `reject` - the feature duplicates an existing home or violates a durable UX rule.

11. **Store the review.** Put the fit decision where the next worker will actually see it: in the feature plan, linked audit, spec section, or PR body. Do not leave the result only in chat.

## Required Output

```
**UX fit review - <feature name>**

- Decision: fits | fits-with-guardrails | defer | reject
- Owning area: <Workspace | Business | Products | Platform | Knowledge | Portal | Storefront>
- Route family: <canonical route(s)>
- Primary persona: <persona and job>
- Navigation layer touched: <global | section | local | contextual action>
- Reuse/convergence: <existing pattern/component reused, or why a new one is justified>
- Source truth: <model/service/read model>
- Empty/failure behavior: <expected state>
- AI boundary: <no prompt send | preview + confirmation required>
- Required plan/spec edits:
  - <edit 1>
  - <edit 2>
- Evidence before merge:
  - <route tests, theme scan, browser route, viewport, data fixture>
- Captured in: <plan/audit/spec/PR path or section>
```

## Committing the gate evidence (BI-D967DEE0)

A UI-impacting change, including added buttons, links, disclosure triggers, and custom operator-facing controls, must land with a **measured** UX-fit manifest at
`docs/ux-fit/<date>-<slug>.ux-fit.json`. The `UX-Fit-Decision:` trailer is retired, and an
acknowledgement (`evidence.kind: "budgets-acknowledged"`) is rejected by name — it is
attestation theater with one extra row. Two kinds qualify:

- **`sweep-measurement`** — the route's real budget axes (`defaultVisibleWords`,
  `leadBandWords`, `primaryActions`, `visibleFields`, `maxChoicesPerControl`,
  `subLegibleControls`, `buriedPrimaryAction`, `axeViolations`). The gate adjudicates these
  against the *committed* `apps/web/lib/ux-budget/route-budget-baseline.json`, so a claimed
  improvement that actually regresses an axis fails. Set
  `evidence.baselineComparison: "new-route"` only for a route genuinely absent from it.
- **`propose-n-pick`** — a real recorded choice: `decisionInteractionId` plus
  `evidence.consideredOptions` with at least two entries, one of which is `decidedOption`.

`scope.files` must list exactly the UI-impacting files in the diff — an uncovered file
fails, and so does a stale or over-broad one. Measure with the UX route sweep, or
`auditUxBudget` from `lib/ux-budget` against the served DOM.

## Worked Example

The Pipedrive CRM Marketing Slice 1 plan proposed a scan-first revenue band on `/customer`, reusable metric/status components, and marketing tab cleanup.

**Decision:** `fits-with-guardrails`.

- Owning area: Business > Customer.
- Route family: `/customer` and `/customer/marketing`.
- Primary persona: founder/operator managing customer acquisition and revenue attention.
- Navigation layer touched: Customer section nav and local page links only.
- Reuse/convergence: CRM presentation metadata and Customer primitives are acceptable only if they converge repeated CRM semantics; reporting components must still use report-kit when they are generic reporting UI.
- Source truth: existing CRM and marketing models plus pure read helpers.
- AI boundary: metric and tab clicks navigate only; coworker launch stays in `AgentWorkLauncher` with preview and confirmation.
- Required edits: no global AppRail or Workspace cards, no user-facing "Pipedrive" copy, no disabled phase tabs, route assertions for every metric destination, mobile/no-overlap verification.

The plan was amended before implementation, which is the intended path: fit review changes the plan before code multiplies the problem.

## Guardrails

- Do not approve a new dashboard when a section home or filtered view would do.
- Do not approve a tab for a route that does not exist or has no meaningful read-only content.
- Do not approve new metric/status/card primitives until existing primitives have been searched.
- Do not hide data-source contradictions behind nicer UI.
- Do not treat screenshots as complete evidence. Require route tests, data-source checks, and at least one browser/viewport exercise for UI work.
