# Archetype-Aware Workspace Implementation Plan

> This plan implements [Archetype-Aware Workspace Design](../specs/2026-05-31-archetype-aware-workspace-design.md), which itself extends the two anchor specs from 2026-05-24: [Vertical Workspace Home Design](../specs/2026-05-24-vertical-workspace-home-design.md) and [Workspace-home primitive registry](../specs/2026-05-24-workspace-home-primitive-registry-design.md). It composes the canonical `WorkspaceHomeContribution` + 11 `WorkspaceHomePrimitiveKey` substrate and adds layered configuration + audited explanations on top. It does NOT build a parallel "block" registry, a dashboard builder, or a new `WorkspaceBlock*` type family.

## Substrate Alignment (architect-revised 2026-05-31)

Before any slice runs, the implementer reads the anchor specs and grounds work in the existing substrate:

- Resolver / contribution / setup-activation substrate already exists in [apps/web/lib/workspace-home/](../../../apps/web/lib/workspace-home) (`types.ts`, `registry.ts`, `activation-summary.ts`, `platform-loader.ts`).
- The 11 canonical primitive keys (`decision-queue`, `geo-map`, `capacity-lanes`, `health-board`, `inventory-watch`, `case-board`, `service-period-board`, `communication-exceptions`, `handoff-queue`, `appointment-schedule`, `volunteer-program-board`) are the unit of reuse — not a new "block" enum.
- WWWD lever today is `recallWikiContext` against org-overlay `WikiPage` rows (`apps/web/lib/actions/agent-coworker.ts`); `DecisionPerspectiveProfile.ownerOrganizationId` is unread and gated on BI-230C9EF7.
- Signal source is `loadWorkspaceHomeSignals(...)` (BI-3E8D2CF5) unifying GearInterface + Calibrator + Governor; block components MUST NOT read `prisma.gearInterface` directly.
- Banned-copy lint and ring-scope discipline (BI-4AA1074B) apply.
- Match key is `StorefrontArchetype.archetypeId` semantic slug — never the FK.

## Goal

Make `/workspace` meaningfully archetype-aware by composing a small, prioritized set of canonical primitive slots from the active `StorefrontConfig -> StorefrontArchetype` (matched on semantic slug), while keeping the platform workspace as the fallback and making missing data actionable. Layer configuration through DPF-seed → category → exact-archetype → org → role → coworker → user, and carry an audit trail for every resolved slot.

## Backlog Positioning

Do not create a new epic. Link or create implementation BIs under existing epics after owner review:

- Primary parent: `EP-REDUCTION-GEAR-ARCH` for workspace-home substrate and MSP/home composition.
- Related: `EP-CORPUS-BOOTSTRAP` for WWWD/corpus guidance and gap detection.
- Related: `EP-COWORKER-INTERACTIVITY` for coworker proposals and action envelopes.
- Related: `EP-TRADES-FIELD-SERVICE` for field-service/HVAC first exact archetype.
- Related: `EP-AI-OPSMAP` for integration/service-health signal reuse.

Existing overlap to link:

- `BI-FE002675` - MSP workspace-home research/design.
- `BI-89C19AAF` - Vertical workspace home design.
- `BI-5B8FE5C1` - Workspace-home primitive registry contract.
- `BI-1CCC6264` - Workspace-home substrate follow-up from prior vertical home work.
- `BI-3E8D2CF5` - Vertical workspace home projections from GearInterface, Calibrator, and Governor signals.
- `BI-CE6AF925` - HVAC dispatcher workspace home implementation.
- `BI-5656E9C3` - Dale's AC Repair workspace-home research/design.

Backlog routing after review:

| Plan slice | Existing BI to use | Notes |
| --- | --- | --- |
| Resolver, contribution, layering audit, setup-activation summary | `BI-1CCC6264` | Extend `apps/web/lib/workspace-home/registry.ts` + `types.ts` (and the proposed `contributions/` boundary from parent §9). Add audit fields (`omittedSlots`, `explanations`, `sourceLayers`) onto the existing `WorkspaceHomeResolution`. Do NOT introduce a parallel resolver union. |
| Compose canonical primitives + per-slot priority/zone metadata | `BI-5B8FE5C1` | BI-5B8FE5C1 is the **typed primitive registry contract** (11 primitive specs, applicability metadata) — not a "block registry". This plan slice contributes new slot bindings + applicability rows where category sweeps reveal gaps. Primitive-key additions (e.g. a potential `kpi-strip`) are filed as parent-spec amendments. |
| Signal/projection-driven states | `BI-3E8D2CF5` | Reuse `loadWorkspaceHomeSignals(...)` (GearInterface + Calibrator + Governor unified). Forbid direct `prisma.gearInterface` reads from block components. |
| WWWD/coworker explanations via WikiPages | `EP-CORPUS-BOOTSTRAP` items plus `EP-COWORKER-INTERACTIVITY` PUC items | Consume `recallWikiContext` with `principleRingScope = worker`. The `DecisionPerspectiveProfile` chain remains a forward-looking input — gated on **BI-230C9EF7** (per-org profile resolver). File a narrow BI only if explanation persistence cannot fit existing corpus/coworker work. |
| First exact HVAC composition | `BI-CE6AF925` plus completed `BI-5656E9C3` | Research is done; implementation should consume it. Reuse [Dale's AC Repair visual design](../specs/2026-05-24-dales-ac-repair-workspace-home-visual-design.md) + [docs/personas/dale-hvac.md](../../personas/dale-hvac.md). |
| MSP composition | `BI-FE002675` | Keep MSP-specific research/design in the existing item. |

Do not create duplicate BIs for these slices. A new BI is justified only after a focused substrate sweep proves the gap is not covered by the items above. Concrete candidates the implementer may surface as separate narrow BIs after the sweep: (a) a `kpi-strip` primitive amendment under BI-5B8FE5C1's parent spec, (b) a `WorkspacePreference` schema BI for org/user overrides if no existing store fits.

## Sequenced Slices

### Slice 1 - Extend Resolver With Layering Audit

**Outcome:** the existing `resolveWorkspaceHomeContribution` returns the canonical `WorkspaceHomeResolution` extended with an `audit: WorkspaceCompositionAudit` carrying `sourceLayers`, `omittedSlots`, and per-slot explanations. No new resolution type.

Files likely to change:

- `apps/web/lib/workspace-home/types.ts` (extend, do not replace existing types)
- `apps/web/lib/workspace-home/registry.ts`
- `apps/web/lib/workspace-home/activation-summary.ts`
- `apps/web/lib/workspace-home/index.ts`
- `apps/web/app/(shell)/workspace/page.tsx`
- `apps/web/lib/workspace-home/registry.test.ts`
- `apps/web/lib/workspace-home/activation-summary.test.ts`
- `apps/web/app/(shell)/workspace/page.test.tsx`

Implementation notes:

- Add `WorkspaceCompositionAudit` and a typed `AuditedWorkspaceHomeResolution = WorkspaceHomeResolution & { audit }` alias. Do NOT introduce a parallel union.
- Preserve existing `WorkspaceHomeContribution` shape. If `WorkspaceHomeSlotSpec` needs `priority`, `zone`, `explanationPolicy`, prefer adding them as optional fields on the parent type (parent-spec amendment) over duplicating the slot shape.
- Match exact semantic `StorefrontArchetype.archetypeId` slug before category fallback. `StorefrontConfig.archetypeId` is the FK read path, never the match key.
- Return explainable omitted slots with reasons (`permission-hidden`, `missing-required-source`, `archetype-mismatch`, etc.).
- Keep production registry empty or minimal until Slice 2 wires actual contributions.

Tests:

- Exact slug match beats category fallback.
- Category fallback applies when exact match is absent.
- Missing config returns unconfigured/platform fallback.
- Role/capability hidden slot is omitted with reason recorded in audit.
- Re-resolution after archetype change returns a new composition (parent §5.4 — no cached resolution).
- Slot covenant (today/now, exceptions/needs-review, coworker-handoffs) is enforced at registration time and at resolution time.

### Slice 2 - Register Concrete Slot Components Against Canonical Primitives

**Outcome:** V1 component registry binds concrete renderers (`TechnicianLoadSlot`, `CustomerUpdatesSlot`, …) to the 11 canonical primitive keys. Contributions compose by `(primitiveKey, componentKey, dataRef, vocabulary)`. No new "block" enum.

Files likely to change:

- `apps/web/lib/workspace-home/types.ts` (extend `WorkspaceHomePrimitiveKey` only if a parent-spec amendment lands)
- `apps/web/lib/workspace-home/registry.ts`
- `apps/web/lib/workspace-home/primitives/registry.ts` (new — per parent §9; implements primitive-registry-spec §5 typed contract)
- `apps/web/lib/workspace-home/primitives/data-loaders.ts` (new — `WorkspaceHomeCanonicalLoaderId` enum)
- `apps/web/lib/workspace-home/primitives/signals.ts` (new — `WorkspaceHomeSignalKindId` enum)
- `apps/web/lib/workspace-home/primitives/lint/banned-copy.ts` (new — per primitive-registry spec §7)
- `apps/web/components/workspace-home/slots/*` (concrete renderers)
- `apps/web/components/ui/report-kit/statusColors.ts` if new status mappings are needed
- Tests under `apps/web/lib/workspace-home/**.test.ts`

Conceptual block ↔ canonical primitive mapping (per design spec §"Workspace Block ↔ Primitive Mapping"):

| Conceptual block | Canonical primitive |
| --- | --- |
| `work-queue`, `next-best-actions`, `open-decisions` | `decision-queue` |
| `schedule` | `appointment-schedule` |
| `coworker-briefing` | `handoff-queue` (covenant slot) |
| `communication-exceptions` | `communication-exceptions` |
| `inventory-supplier-risk` | `inventory-watch` |
| `integration-health`, `service-health` | `health-board` |
| `customer-activity` | `case-board` or `decision-queue` |
| `revenue-snapshot`, `kpi-strip` | parent-spec amendment proposal (file as separate BI before adding) |
| `wwwd-guidance` | signal overlay on top of any primitive (not its own primitive) |
| `setup-gaps` | the missing-data state of each primitive |

Implementation notes:

- Each slot binds: primitive key, concrete component key (from typed `WorkspaceHomeComponentRegistry`), `dataRef`, vocabulary tokens, priority, mobileCollapse — exactly the parent-spec `WorkspaceHomeSlotSpec` shape.
- New optional slot fields (`zone`, `explanationPolicy`) ride on `WorkspaceHomeSlotSpec` as a parent-spec amendment, not in a parallel type.
- Data display components compose report-kit.
- Banned-copy lint runs at build time over resolved copy values.
- Do not add a Prisma table in this slice.

Tests:

- Registry rejects unknown primitive/component key (fail-closed per parent §5.5).
- Every registered slot has an empty/loading/stale/misconfigured state per primitive contract.
- Slot covenant enforced at contribution registration.
- Required covenant slots cannot be disabled by org/user preference.
- Status rendering uses report-kit intents.
- Banned-copy lint passes on every slot's rendered output.

### Slice 3 - Archetype Category Contributions

**Outcome:** common archetype categories ship as code-owned `WorkspaceHomeContribution` manifests with materially different first-screen slot priorities.

Files likely to change:

- `apps/web/lib/workspace-home/contributions/registry.ts` (new — per parent §9)
- `apps/web/lib/workspace-home/contributions/trades-maintenance.ts` (new)
- `apps/web/lib/workspace-home/contributions/msp.ts` (new)
- `apps/web/lib/workspace-home/contributions/retail-goods.ts` (new)
- `apps/web/lib/workspace-home/contributions/restaurant-hospitality.ts` (new)
- `apps/web/lib/workspace-home/contributions/professional-services.ts` (new)
- `apps/web/lib/workspace-home/contributions/software-platform.ts` (new)
- `apps/web/lib/onboarding/archetype-business-context.ts`
- `apps/web/components/storefront-admin/ArchetypeActivationSummary.tsx`
- `apps/web/components/storefront-admin/SetupWizard.tsx`
- Related tests

Category contributions:

- Trades / field service
- MSP / IT services
- Retail / ecommerce
- Hospitality / restaurant
- Professional services
- SaaS / software operator

Implementation notes:

- Contributions bind canonical primitive keys to slot positions, zones, and priorities. Composition is by primitive (not by inventing new primitives).
- Setup activation summaries enumerate the resolved primitive widgets and required canonical data per the parent primitive-registry spec §8 aggregation.
- Load `StorefrontArchetype` through the `StorefrontConfig.archetypeId` FK; match contributions on `StorefrontArchetype.archetypeId` semantic slug.

Tests:

- Each contribution satisfies the slot covenant (today/now, exceptions/needs-review, coworker-handoffs).
- Each contribution has critical-strip / next-best-action equivalent coverage.
- Setup activation summary reflects exact / category / no-home outcomes.

### Slice 4 - Missing-Data and Degraded States

**Outcome:** configured businesses see useful prompts rather than blank slots — driven by each primitive's declared empty/loading/stale/misconfigured contract.

Files likely to change:

- `apps/web/lib/workspace-home/signals/load-workspace-home-signals.ts` (new — per parent §5.7 and §9; unifies GearInterface raw stream + Calibrator + Governor)
- `apps/web/lib/workspace-home/signals/translate-gear-signal.ts` (new — per parent §9)
- `apps/web/components/workspace-home/SetupGapTile.tsx` (new)
- `apps/web/components/workspace-home/WorkspaceSlotFrame.tsx` (new)
- Existing slot components from Slice 2
- Tests for state helpers

Implementation notes:

- Reuse the primitive-level states (`empty`, `loading`, `stale`, `misconfigured`) declared in the primitive-registry spec §5. The four conceptual missing-data modes (`positive-empty`, `setup-action`, `degraded`, `hide`) map to those states per the primitive's `dataContract.rendersWhenEmpty` flag and the contribution's `missingDataBehavior`.
- Admin users see setup CTAs; non-admin workers see concise "not configured yet" copy.
- Source freshness and connector state route through `loadWorkspaceHomeSignals` (BI-3E8D2CF5). Slots MUST NOT call `prisma.gearInterface` or `getSlipByReason` directly.

Tests:

- Missing required source produces a setup-action state.
- Optional empty source hides or shows positive-empty per the slot's primitive contract.
- Stale data marks slot degraded but still renders available facts.
- Non-admin users do not see admin-only setup actions.

### Slice 5 - WWWD and Coworker Explanations (via `recallWikiContext`)

**Outcome:** slots can explain why they are present and what missing context should be captured, citing org-overlay `WikiPage` rows retrieved by `recallWikiContext` with `principleRingScope = worker`.

Files likely to change:

- `apps/web/lib/workspace-home/explanations.ts` (new — read-only wrapper around `recallWikiContext`)
- `apps/web/lib/actions/agent-coworker.ts` for route context only if needed
- `apps/web/components/workspace-home/slots/CoworkerBriefingSlot.tsx` (new — bound to `handoff-queue` primitive, covenant slot)
- Tests under `apps/web/lib/workspace-home/explanations.test.ts`

Implementation notes:

- Start read-only. Canonical lever today: `recallWikiContext({ organizationId, preferredPageKinds: ["stance","heuristic","principle","decision"] })` against `WikiPage` rows with `status="published"` + Qdrant embedding (`apps/web/lib/wiki/embeddings.ts`).
- `DecisionPerspectiveProfile` / `PerspectiveMaterial` / `DecisionInteraction` are **forward-looking** — gated on BI-230C9EF7 landing a per-org profile resolver. Until then, do not assume `resolveProfileMaterial` is wired per-org.
- Ring-scope discipline: all recall/decide calls from workspace slots scope by `principleRingScope = worker` (BI-4AA1074B).
- A coworker recommendation is **proposed**, not applied. Persist proposals through `CoworkerActionEnvelope`; mutate only on user acknowledgement (PAR — Propose → Acknowledge → Reassign).
- If `recallWikiContext` returns no published WikiPages for the archetype's expected stance keys, surface a setup/corpus gap rather than render a fake answer. Once the perspective chain is wired, a `defer` outcome also routes to gap creation.

Tests:

- Explanation output cites `WikiPage` id(s) returned by `recallWikiContext` when present.
- Missing WWWD material returns a gap explanation, not silent omission.
- Recall calls assert `principleRingScope = worker`.
- Coworker recommendations do not mutate layout without `CoworkerActionEnvelope` acknowledgement.
- Recommendation confidence and status are serializable.

### Slice 6 - First Exact Archetype Composition

**Outcome:** one archetype demonstrates the layered model end to end against canonical primitives.

Recommended first exact archetype:

- **HVAC / field service** (preferred) — paired with `EP-TRADES-FIELD-SERVICE`, `BI-CE6AF925`, persona [docs/personas/dale-hvac.md](../../personas/dale-hvac.md), and visual design [Dale's AC Repair workspace-home](../specs/2026-05-24-dales-ac-repair-workspace-home-visual-design.md).
- MSP if paired with `BI-FE002675` and customer-estate/service-health data.

Files likely to change:

- `apps/web/lib/workspace-home/contributions/trades-maintenance.ts` (add `hvac-contractor` exact match)
- `apps/web/lib/workspace-home/signals/load-workspace-home-signals.ts`
- `apps/web/components/workspace-home/slots/*` (concrete renderers for primitive bindings)
- Domain loaders for the chosen archetype, reusing existing records
- Tests for exact archetype composition

HVAC first-slice slot composition (mapping conceptual block → canonical primitive):

- **Critical strip:** `decision-queue` (next-best-actions binding) + `communication-exceptions`.
- **Primary:** `appointment-schedule` (schedule), `decision-queue` (work-queue binding), `inventory-watch` (parts/truck stock), `handoff-queue` (coworker briefing — covenant slot).
- **Secondary:** `case-board` (customer activity), setup-gap state aggregation.

MSP first-slice slot composition:

- **Critical strip:** `health-board` (service-health binding) + `decision-queue` (open-decisions binding).
- **Primary:** `health-board` (integration-health binding), `decision-queue` (work-queue), `handoff-queue`, `case-board` (customer activity).
- **Secondary:** setup-gap state aggregation.

Tests:

- Exact archetype resolves to exact contribution; category fallback never wins when an exact match exists.
- Slots render from available canonical data or the primitive's empty/setup/degraded state.
- No slot uses hardcoded colors.
- Banned-copy lint passes on every rendered slot.
- Snapshot/render tests cover desktop and mobile ordering where practical.

### Slice 7 - Bounded Overrides and Preferences

**Outcome:** admins and users can tune the Workspace without page-builder scope.

Files likely to change:

- Existing preference/config store if available, or new plan/spec before adding schema.
- `apps/web/lib/workspace-home/preferences.ts` (new)
- `apps/web/components/workspace-home/WorkspaceCustomizePanel.tsx` (new, only if approved)
- Tests for preference application

Implementation notes:

- No existing general-purpose workspace preference store is approved for V1. `CommunicationChannelBinding.preferences` is channel-specific, and `BuildPhaseHandoff.userPreferences` is build-evidence context, not portal UI state.
- V1 may ship server-rendered defaults and ephemeral client collapse state only.
- Durable org/user overrides require a separate substrate sweep and schema-backed BI before adding `WorkspacePreference`.
- Admin authority uses existing grants: `manage_business_models` for org/archetype composition choices, `manage_platform` for registry/primitive definitions and platform fallback behavior.
- Coworker recommendations route through `CoworkerActionEnvelope` and then the same admin override command path; until a durable override store exists, they can open setup tasks or explain gaps but cannot persist layout changes.

Tests:

- Preferences cannot remove required blocks.
- Preferences cannot reveal permission-hidden blocks.
- User preference is lower priority than org override and role projection.

## UX Verification Path

Run against the production-path **Live portal** at the install URL from `.env` (`AUTH_URL` / `APP_URL`, normally `http://localhost:3000`) — not a stale dev server, not `127.0.0.1`, not the LAN IP (per `project_portal_address` and the parent spec §10).

Verify on the Live portal (desktop AND mobile viewports):

- `/login` as `admin@dpf.local` using `ADMIN_PASSWORD` from repo-root `.env`.
- `/workspace` with no archetype/configured fallback: setup notice + platform fallback render.
- `/storefront/setup`: archetype choices show workspace activation summary (resolved primitive widgets + required canonical data).
- Configure/select the first tested archetype.
- `/workspace`: archetype-specific slot order renders with the slot covenant present (today/now, exceptions, coworker-handoffs).
- Admin user sees setup prompts; non-admin worker does not see admin-only setup actions.
- Missing integration/data produces the primitive's declared empty/setup/degraded state.
- Coworker briefing explains at least one slot or gap with a cited `WikiPage` reference (or honest "no WWWD material yet" gap state).
- Mobile viewport preserves priority order and avoids overlapping text.

Submit a structured dynamic-analysis report (per `feedback_dynamic_analysis_is_evidence` and parent §10): **drove X → observed Y → signed off Z**. Screenshots are evidence, not the report.

## Build Gate Requirements

Per DPF rulebook, implementation is not done until:

- Unit tests for affected files pass with `pnpm --filter web exec vitest run <affected tests>`.
- Typecheck passes with `pnpm --filter web typecheck`.
- Production build passes with `cd apps/web && pnpm exec next build` or the repository-standard build command for the current branch.
- UX verification path above is exercised against the Live portal.
- If any migration is added later, it applies cleanly through Prisma and includes inline backfill SQL when moving data.

## Non-Goals for V1

- No general drag-and-drop dashboard builder.
- No custom user-authored React/HTML blocks.
- No hidden AI-generated layout mutations.
- No new dashboard/widget Prisma table unless a later plan proves the existing stores cannot carry bounded preferences.
- No replacement of the existing platform workspace fallback.

## Acceptance Checklist

- [ ] Existing `WorkspaceHomeContribution` + 11-primitive substrate is extended, not duplicated. No new `WorkspaceBlock*` types or parallel resolver union introduced.
- [ ] Every contribution satisfies the parent-mandated slot covenant (today/now, exceptions/needs-review, coworker-handoffs).
- [ ] Composition matches on `StorefrontArchetype.archetypeId` semantic slug; the `StorefrontConfig.archetypeId` FK is never the match key.
- [ ] Category contributions produce materially different first-screen compositions.
- [ ] At least one exact archetype composition works end to end on the Live portal, with the parent's structured dynamic-analysis report shape.
- [ ] Setup activation summaries name resolved primitive widgets and required canonical data per primitive-registry spec §8.
- [ ] WWWD/coworker explanations cite `WikiPage` ids via `recallWikiContext` with `principleRingScope = worker`. Profile-chain consumption is deferred until BI-230C9EF7 lands.
- [ ] Signals route through `loadWorkspaceHomeSignals(...)` (BI-3E8D2CF5). No direct `prisma.gearInterface` or `getSlipByReason` reads from slot components.
- [ ] Coworker recommendations require `CoworkerActionEnvelope` acknowledgement (PAR) before changing configuration.
- [ ] All data-display UI uses report-kit and DPF tokens.
- [ ] Banned-copy lint passes on every rendered slot fixture (parent primitive-registry spec §7 token list).
- [ ] Unit/type/build/UX gates are recorded before handoff. Build = `pnpm --filter web typecheck` + `cd apps/web && pnpm exec next build`; UX = Live portal verification with desktop AND mobile viewport sign-off.
