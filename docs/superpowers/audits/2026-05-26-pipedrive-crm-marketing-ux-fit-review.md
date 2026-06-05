# Pipedrive CRM Marketing UX Fit Review

| Field | Value |
| ----- | ----- |
| Date | 2026-05-26 |
| Status | Fit review for circulation; source plan amended; generalized by `dpf-ux-fit-review` |
| Reviewed source | `docs/superpowers/plans/2026-05-26-pipedrive-crm-marketing-slice-1.md` in concurrent branch `doc/pipedrive-crm-marketing` |
| Related design | `docs/superpowers/specs/2026-05-26-pipedrive-inspired-crm-marketing-operations-design.md` |
| UX governance anchor | `docs/superpowers/specs/2026-04-25-customer-marketing-coworker-led-ux-correction.md` |

## 1. Verdict

The Slice 1 plan fits the portal simplification direction if it stays a Business > Customer enhancement, not a new global dashboard or navigation layer.

It is aligned in four important ways:

1. It keeps the work under `/customer`, where accounts, engagements, pipeline, quotes, orders, funnel, and marketing already live.
2. It uses existing CRM and marketing models before proposing new schema.
3. It removes visible Phase 2 / Phase 3 marketing tabs instead of presenting future work as disabled product.
4. It treats UI refactoring as product work: shared CRM presentation metadata, theme-aware status handling, and reusable summary components are part of the slice.

The fit is conditional. The implementation must not introduce vendor-branded language, a duplicate command center, a parallel KPI component family, or click targets that look informational but trigger coworker work.

## 2. Fit Map

| Planned element | UX home | Fit assessment | Required guardrail |
| --------------- | ------- | -------------- | ------------------ |
| `/customer` "Today in revenue" band | Business > Customer section home | Fits as a scan-first local decision surface for customer work | Must remain below the portal shell and inside Customer. Do not promote to global nav or Workspace. Visible label should be product-native, not "Pipedrive" or "cockpit". |
| Revenue metric tiles | Local page navigation from Customer home | Fits if every tile drills into a valid Customer route or renders inert with explanation | Add route assertions and browser checks for `/customer`, `/customer/engagements`, `/customer/opportunities`, `/customer/quotes`, `/customer/sales-orders`, `/customer/funnel`, and `/customer/marketing`. |
| `CustomerMetricTile` and `CustomerStatusBadge` | Customer component family | Fits if these converge repeated CRM presentation logic | Before creating new primitives, search existing KPI/stat/status/badge components and document why reuse is insufficient or how the new components will become the Customer standard. |
| CRM presentation metadata | Shared Customer/CRM presentation substrate | Strong fit; reduces hardcoded colors and duplicated status semantics | Keep labels, tones, open stages, and fallback behavior in one tested module. No raw hex or inline color semantics. |
| Marketing tab cleanup | Customer Marketing section navigation | Strong fit; removes fake choices and memory burden | Show only real routes. Future Campaigns/Funnel/Automation tabs appear only when backed by meaningful read-only pages. |
| Marketing work-product attention item | Link from revenue context to marketing workspace | Fits if it routes to the existing strategy-first marketing workspace | It must be a navigation link, not a prompt send. Coworker launch remains inside `AgentWorkLauncher` with preview and confirmation. |
| Later signal-to-engagement work | Customer acquisition workflow | Fits later, not Slice 1 | Keep as a later slice through backlog/Build Studio. Do not add an `AcquisitionSignal` table until repeated lifecycle/audit pressure proves the need. |

## 3. Required Amendments Before Implementation

These constraints were added to the Slice 1 implementation plan after review, and should remain required before work starts:

1. Add a `UX Architecture Fit Gate` task after worktree setup and before first code edits.
2. State that the feature belongs to Business > Customer and must not add global AppRail items, Workspace cards, or Platform nav entries.
3. Search existing component families before adding `CustomerMetricTile` and `CustomerStatusBadge`; record whether the new components replace, wrap, or intentionally differ from existing metric/status components.
4. Treat "Pipedrive-inspired" as research language only. User-facing UI should say "Today in revenue", "Pipeline", "Engagements", "Quotes", "Orders", and "Marketing".
5. Require every metric tile to have a valid destination and a clear drill-down meaning. If a metric cannot drill down, render it as non-clickable status with explanation.
6. Preserve the no-surprise-AI rule: no metric, card, topic, or tab click sends a coworker prompt.
7. Add first-run and empty-data acceptance: a fresh install should show a calm setup/next-action state, not a wall of zeros.
8. Add mobile/no-overlap checks for metric values, status badges, stage labels, and attention items.
9. Keep the deferred hardcoded-color cleanup tracked before Slice 2 starts; do not let `[id]`, quotes, and sales-orders remain indefinite debt.

## 4. UX Fit Gate Template

Every future UI feature plan should answer this before implementation:

```text
Feature:
Owning area:
Primary route family:
Primary persona:
Job the first viewport helps complete:
Navigation layer touched: global / section / local / contextual action
Existing component or pattern reused:
New component justified because:
Source-of-truth model or service:
Empty state behavior:
Failure / unavailable behavior:
AI or coworker action boundary:
Theme and layout checks:
Routes to verify:
Evidence required before merge:
```

## 5. Future Skill / Feature Direction

The platform needs a durable `dpf-ux-fit-review` capability, either as a DPF platform skill or as a governed feature-planning checklist surfaced by Build Studio and contributor workflows.

Expected behavior:

- Trigger before any UI-impacting feature plan, especially when adding a route, tab, dashboard band, metric tile, coworker launcher, or workflow entry point.
- Compare the proposed work against the current portal simplification spine.
- Produce a short fit decision: fits, fits with guardrails, defer, or reject.
- Require route-family ownership, persona, navigation layer, component convergence, empty-state behavior, source truth, AI action boundary, and verification evidence.
- Store the output as a design artifact or plan section so review does not depend on chat memory.

This is now implemented as `packages/dpf-skill-pack/skills/dpf-ux-fit-review/SKILL.md`. Use the skill before incoming UI plans add routes, tabs, dashboard bands, metric tiles, status badges, empty states, or coworker launchers.
