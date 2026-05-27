---
title: Workspace-home primitive registry — typed contract + per-primitive specs
date: 2026-05-24
status: proposal — awaiting operator review
owner: Mark Bodman (CEO) — proposed by agent
backlog-item: BI-5B8FE5C1
epic: EP-REDUCTION-GEAR-ARCH
relates-to:
  - docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md (parent spec — primitive list + slot covenant + component registry)
  - docs/superpowers/specs/2026-05-24-dales-ac-repair-workspace-home-visual-design.md (sibling — Dale/HVAC reference composition)
  - PR #1117 (merged 2026-05-25, added the initial 9 primitive keys + setup-activation metadata)
extends:
  - docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md §5 (primitive library section)
---

# Workspace-home primitive registry

## 1. The question

BI-5B8FE5C1 (priority 4, medium, portfolio-type, EP-REDUCTION-GEAR-ARCH) asks for a **typed primitive registry contract** that defines what each primitive must declare so vertical workspace homes can compose against a stable surface. The merged parent spec (`docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md`, with PR #1117 follow-up) already names the primitive list and the general expectations; this spec adds the per-primitive contract and the missing entries.

This is an extension spec, not a replacement. The parent spec stays canonical for the contribution registry, slot covenant, and component fallback. This document fills in:

1. A typed `WorkspaceHomePrimitiveSpec` that each primitive must implement.
2. Per-primitive specs for the **11** primitives the BI names (parent spec listed 9 — adds `appointment-schedule` and `volunteer-program-board`).
3. Banned-copy protection rules made explicit (the parent spec asserts the rule; this spec encodes the token list).
4. Setup-activation metadata at the primitive level (parent spec covers the contribution level; primitives need their own data-requirement signals so setup can compose them).

## 2. What the parent spec already establishes (do not duplicate)

For the avoidance of doubt, these are already canonical in the parent spec and out of scope for this extension:

- `WorkspaceHomeContribution` shape and resolver flow (§5.3 of parent).
- `WorkspaceHomeSlotSpec` and `WorkspaceHomeDataRef` types (§5 of parent, lines 251–272).
- `WorkspaceHomeComponentRegistry` and the `UnknownSlotComponent` fail-closed render rule (§5, lines 302–315).
- The slot covenant (today/exceptions/handoffs) — type-level constraint enforced at the contribution level (§5).
- `WorkspaceHomeSetupActivation` at the contribution level (§5 of parent).
- The initial primitive list of 9 keys (§5 of parent, lines 277–289).

This extension does NOT change any of those. Anything in this doc that contradicts the parent is a bug.

## 3. Gap analysis (against BI acceptance criteria)

| BI acceptance bullet | Status today | This spec adds |
| --- | --- | --- |
| "Each primitive has a clear purpose, vertical-native labels, canonical data dependencies, interaction expectations, mobile behavior, and setup-activation metadata." | Purpose + example uses ✓ (9 of 11 listed). Other fields described generically. | Per-primitive spec entries (§6) for all 11. |
| "Queue and map primitives support common service-business workflows, while health/status primitives support MSP/customer-estate workflows." | Implicit in example uses. | Made explicit in each primitive's `applicability` field (§6). |
| "Business-archetype setup can report which primitive widgets will activate for exact/category workspace homes and what data is missing before a worker sees the home." | Contribution-level `WorkspaceHomeSetupActivation` exists. | Primitive-level `requiredCanonicalData` / `requiredSignals` declared in each primitive spec so setup can aggregate (§6 + §8). |
| "Vertical implementation BIs can compose primitives by manifest, vocabulary, data binding, and layout without manually wiring dashboard tiles after setup." | The contribution registry pattern is established. | The typed `WorkspaceHomePrimitiveSpec` (§5) makes "compose by manifest" mechanically enforceable. |
| "No worker-facing primitive exposes gear/ring/torque/slip/cockpit terminology." | Rule asserted in parent. | Token list + lint rule encoded in §7. |
| "The result updates or extends the vertical workspace home spec before broad implementation begins." | This document is that extension. | The follow-on substrate BI (`BI-1CCC6264` per parent §11) references this spec. |

## 4. The 11 primitives — final list

The parent spec listed 9. BI-5B8FE5C1 names 11. The 2 additions:

- **`appointment-schedule`** — time-slotted appointments / classes per day, distinct from `service-period-board` (which is time-bounded production / service windows, not per-attendee slots).
- **`volunteer-program-board`** — volunteer / program participant roster, distinct from `case-board` (which is per-case / per-matter / per-resident long-running threads).

Why these are not merges of existing primitives:

- An appointment grid (10am bookings vs 2pm bookings) has different sort, density, and action semantics than a service-period card (Dinner Service 5–11pm).
- A volunteer program (recurring shift sign-ups, hour-tracking, role pairing) has different data dependencies than a long-running case file.

Final list (canonical for this spec):

1. `decision-queue`
2. `geo-map`
3. `capacity-lanes`
4. `health-board`
5. `inventory-watch`
6. `case-board`
7. `service-period-board`
8. `communication-exceptions`
9. `handoff-queue`
10. `appointment-schedule` (new)
11. `volunteer-program-board` (new)

The parent spec's `WorkspaceHomePrimitiveKey` union type must expand to include the two new keys when the substrate BI lands.

## 5. The typed `WorkspaceHomePrimitiveSpec` contract

Each primitive must declare its contract via a typed spec. The contract is the registry's source of truth and the test target for "does this primitive satisfy what the registry promises."

```ts
// apps/web/lib/workspace-home/primitives/primitive-spec.ts (proposed — NOT in this PR)

export type WorkspaceHomePrimitiveSpec = {
  /** The stable key. Matches the parent spec's WorkspaceHomePrimitiveKey union. */
  key: WorkspaceHomePrimitiveKey;

  /** One-sentence purpose in worker-facing language (NOT platform/gear language). */
  purpose: string;

  /** Concrete vertical examples drawn from the parent spec's "Example vertical uses".
   *  Required to be non-empty — primitives without at least one concrete use are not registered. */
  exampleUses: ReadonlyArray<{ archetype: string; usage: string }>;

  /** Canonical data contract — the `dataRef` shapes this primitive accepts. */
  dataContract: {
    /** Loaders this primitive can be bound to. At least one must be declared. */
    acceptedLoaders: ReadonlyArray<WorkspaceHomeCanonicalLoaderId>;
    /** Signal kinds this primitive subscribes to, if any. */
    acceptedSignals?: ReadonlyArray<WorkspaceHomeSignalKindId>;
    /** Whether this primitive can render with empty data (true) or must show a setup task (false). */
    rendersWhenEmpty: boolean;
  };

  /** Visual density contract — desktop vs. mobile. */
  density: {
    desktop: {
      defaultColumnSpan: 1 | 2 | 3 | 4 | 6 | 12;   // 12-col grid
      defaultRowSpan: 1 | 2 | 3 | 4;
      minWidthPx: number;                          // below this the primitive must collapse
    };
    mobile: {
      defaultPriorityBand: "above-fold" | "below-fold" | "behind-more";
      collapseBehavior: "summary-card" | "title-only" | "hide";
    };
  };

  /** Allowed states the primitive must implement renderers for. */
  states: {
    empty: { copyKey: string; cta?: string };
    loading: { strategy: "skeleton" | "spinner" | "stable-shell" };
    stale: { thresholdSeconds: number; copyKey: string };
    misconfigured: { adminCopyKey: string; workerCopyKey: string };
  };

  /** Allowed actions a worker can take on this primitive. Each action declares
   *  its disabled-state copy and the role + capability required. */
  actions: ReadonlyArray<{
    actionId: string;
    label: string;
    requiredCapability: string;
    disabledStateCopyKey: string;
  }>;

  /** Vocabulary inputs the contribution provides at composition time. The
   *  contract names the token slots; the contribution fills them. */
  vocabulary: {
    /** Tokens the primitive expects (e.g. ["singular_unit", "plural_unit", "today_label"]).
     *  Each contribution provides values per archetype. */
    expectedTokens: ReadonlyArray<string>;
  };

  /** Banned-copy protection (§7) is enforced platform-wide, but the spec
   *  declares the primitive's exposure surface so the lint can scope.
   *  exposedSurfaces enumerates the surfaces where worker-facing strings appear. */
  bannedCopy: {
    exposedSurfaces: ReadonlyArray<"title" | "labels" | "actions" | "empty-state" | "tooltip">;
  };

  /** Applicability metadata — which archetypes / categories may use this primitive. */
  applicability: {
    /** Categories where this primitive is expected to fit cleanly. */
    suggestedCategories: ReadonlyArray<string>;
    /** Categories where this primitive should NOT be used (negative space matters). */
    notForCategories?: ReadonlyArray<string>;
    /** Replacement-candidate primitives if the operating model differs slightly. */
    relatedPrimitives?: ReadonlyArray<WorkspaceHomePrimitiveKey>;
  };
};

export type WorkspaceHomePrimitiveRegistry = Readonly<
  Record<WorkspaceHomePrimitiveKey, WorkspaceHomePrimitiveSpec>
>;
```

The registry is a single typed module — adding or removing a primitive is a code change with type-system enforcement (mirrors the parent spec's `WorkspaceHomeComponentRegistry` pattern). No runtime sandbox.

## 6. Per-primitive specs

Each entry summarizes the spec fields. The follow-on substrate BI implements the typed values; this section is the design ground truth for that implementation.

### 6.1 `decision-queue`

- **Purpose:** "Work waiting on you, in the order you should pick it up."
- **Example uses:** HVAC emergency jobs (dispatcher), dental missing forms (front-desk), legal filing deadlines (paralegal).
- **Data contract:** loaders `work-queue-by-role`, `priority-tasks`; renders when empty (showing "all caught up").
- **Density:** desktop col-span 6, row-span 2, min-width 360px. Mobile above-fold, summary-card on collapse.
- **States:** empty "all caught up", loading skeleton (3 rows), stale 60s "data >1min old", misconfigured tells admin to bind a loader.
- **Actions:** `claim` (capability `workqueue.claim`), `defer` (capability `workqueue.defer`), `open-detail` (no capability).
- **Vocabulary:** `singular_unit`, `plural_unit`, `urgent_label`.
- **Banned-copy surfaces:** title, labels, actions, empty-state.
- **Applicability:** suggestedCategories include `service`, `professional-services`, `healthcare`, `legal`, `field-service`. Not for retail-merchandising-only.

### 6.2 `geo-map`

- **Purpose:** "Where the day's work is, on a map you can route from."
- **Example uses:** HVAC customer map (dispatch), dog-walking route (provider), property-management unit map (manager).
- **Data contract:** loaders `customer-sites-with-jobs`, `route-plan`, `asset-locations`; rendersWhenEmpty `false` (a map with no points is an honest setup gap, not an idle state).
- **Density:** desktop col-span 6, row-span 3, min-width 480px. Mobile below-fold (heavy renderer), title-only collapse.
- **States:** empty "no locations to show — add a customer with a site address" with admin CTA, loading stable-shell, stale 5min, misconfigured.
- **Actions:** `open-location` (no capability), `compose-route` (capability `dispatch.compose-route`), `share-location` (capability `dispatch.share-location`).
- **Vocabulary:** `location_singular`, `location_plural`, `route_verb`.
- **Banned-copy surfaces:** title, labels, actions, tooltip.
- **Applicability:** suggestedCategories `field-service`, `delivery`, `transport`, `real-estate-mgmt`. Not for desk-only `professional-services` or `retail-online`.

### 6.3 `capacity-lanes`

- **Purpose:** "Who has room today, and who is full."
- **Example uses:** Technician lanes (field service), practitioner load (clinic), instructor/room capacity (studios), driver shifts (transport).
- **Data contract:** loaders `capacity-by-resource-role`, `shift-roster`; rendersWhenEmpty `false`.
- **Density:** desktop col-span 4, row-span 2, min-width 320px. Mobile above-fold.
- **States:** empty "no roster for today", loading skeleton, stale 60s, misconfigured.
- **Actions:** `reassign` (capability `dispatch.reassign`), `flag-overbooked` (capability `dispatch.flag`).
- **Vocabulary:** `resource_singular`, `resource_plural`, `capacity_unit`.
- **Banned-copy surfaces:** title, labels.
- **Applicability:** suggestedCategories `field-service`, `healthcare`, `fitness-instruction`, `personal-services`. Not for `retail-merchandising`, `online-only`.

### 6.4 `health-board`

- **Purpose:** "Health of the customers, sites, or systems you manage."
- **Example uses:** MSP customer IT health, facilities asset health, software-platform service health.
- **Data contract:** loaders `managed-estate-health`, `customer-site-health`, `service-uptime`; rendersWhenEmpty `false`.
- **Density:** desktop col-span 6, row-span 2, min-width 360px. Mobile below-fold, summary-card collapse.
- **States:** empty "no managed customers yet — add one to start tracking health", loading stable-shell, stale 60s, misconfigured.
- **Actions:** `open-customer` (no capability), `acknowledge-alert` (capability `health.ack`), `escalate` (capability `health.escalate`).
- **Vocabulary:** `entity_singular`, `entity_plural` (customer / site / service).
- **Banned-copy surfaces:** title, labels, actions, tooltip.
- **Applicability:** suggestedCategories `msp`, `facilities`, `software-platform`. Not for `retail`, `restaurant`, `personal-services`.

### 6.5 `inventory-watch`

- **Purpose:** "Stock or supplies that can block work today."
- **Example uses:** Truck stock (field service), retail low stock, bakery ingredients, salon supplies.
- **Data contract:** loaders `stock-low-by-item`, `inventory-on-hand`; rendersWhenEmpty `true` (empty = "everything is stocked", a positive state).
- **Density:** desktop col-span 4, row-span 2, min-width 320px. Mobile below-fold.
- **States:** empty "all items are above reorder point", loading skeleton, stale 5min, misconfigured.
- **Actions:** `reorder-draft` (capability `inventory.draft-po`), `silence` (capability `inventory.silence`).
- **Vocabulary:** `item_singular`, `item_plural`, `unit_label`.
- **Banned-copy surfaces:** title, labels, actions.
- **Applicability:** suggestedCategories `retail`, `restaurant`, `field-service`, `personal-services`. Not for `software-platform`, `online-only`.

### 6.6 `case-board`

- **Purpose:** "Long-running cases, matters, or relationships needing attention."
- **Example uses:** Legal matters, rescue-animal cases, tutoring learners, HOA resident issues.
- **Data contract:** loaders `cases-active`, `cases-stale`, `cases-by-stage`; rendersWhenEmpty `true` ("no active cases — quiet day").
- **Density:** desktop col-span 6, row-span 3, min-width 360px. Mobile below-fold, title-only collapse.
- **States:** empty positive, loading skeleton, stale 5min, misconfigured.
- **Actions:** `open-case` (no capability), `add-note` (capability `case.note`), `change-stage` (capability `case.stage`).
- **Vocabulary:** `case_singular`, `case_plural`, `stage_labels`.
- **Banned-copy surfaces:** title, labels, actions.
- **Applicability:** suggestedCategories `legal`, `animal-rescue`, `tutoring`, `residential-mgmt`, `social-services`, `accounting-firm`. Not for `retail`, `restaurant`.

### 6.7 `service-period-board`

- **Purpose:** "Time-bounded service or production windows — what's happening this period."
- **Example uses:** Restaurant dinner service, bakery bake schedule, catering event prep, performance call-sheet.
- **Data contract:** loaders `service-periods-today`, `prep-tasks-by-period`; rendersWhenEmpty `false` ("no service period configured" is a setup gap).
- **Density:** desktop col-span 6, row-span 2, min-width 360px. Mobile above-fold during service hours, below-fold off-hours.
- **States:** empty + admin CTA, loading skeleton, stale 60s, misconfigured.
- **Actions:** `start-period` (capability `service-period.start`), `close-period` (capability `service-period.close`), `flag-issue` (capability `service-period.flag`).
- **Vocabulary:** `period_singular`, `period_plural`, `prep_verb`.
- **Banned-copy surfaces:** title, labels, actions, empty-state.
- **Applicability:** suggestedCategories `restaurant`, `bakery`, `catering`, `event-production`. Not for `professional-services`, `software-platform`.

### 6.8 `communication-exceptions`

- **Purpose:** "Customer updates that failed to deliver or need a follow-up."
- **Example uses:** HVAC ETA texts that bounced, patient reminders not opened, owner updates that failed, donor outreach pending.
- **Data contract:** loaders `comm-failures`, `comm-pending-followup`; rendersWhenEmpty `true` ("no exceptions" is a healthy state).
- **Density:** desktop col-span 4, row-span 2, min-width 320px. Mobile below-fold.
- **States:** empty positive, loading skeleton, stale 60s, misconfigured.
- **Actions:** `retry-send` (capability `comm.retry`), `mark-resolved` (capability `comm.resolve`), `escalate` (capability `comm.escalate`).
- **Vocabulary:** `comm_singular`, `comm_plural`, `recipient_label`.
- **Banned-copy surfaces:** title, labels, actions.
- **Applicability:** suggestedCategories all categories that use outbound customer communication. Not for archetypes with no outbound channel binding.

### 6.9 `handoff-queue`

- **Purpose:** "Decisions an AI coworker is waiting on from you."
- **Example uses:** Dispatcher approvals, clinic scheduler approvals, MSP escalation handoffs, finance threshold approvals.
- **Data contract:** loaders `par-handoffs-pending`, `agent-proposals-pending`; rendersWhenEmpty `true` ("no pending handoffs" is healthy).
- **Density:** desktop col-span 4, row-span 2, min-width 320px. Mobile above-fold (PAR is the slot covenant's third required slot).
- **States:** empty positive, loading skeleton, stale 30s (PAR is time-sensitive), misconfigured.
- **Actions:** `acknowledge` (capability `par.acknowledge`), `reassign-back` (capability `par.reassign`), `defer` (capability `par.defer`), `escalate` (capability `par.escalate`).
- **Vocabulary:** `handoff_singular`, `handoff_plural`, `acknowledge_verb`.
- **Banned-copy surfaces:** title, labels, actions, tooltip.
- **Applicability:** ALL archetypes — this is a slot-covenant primitive (parent spec §5).

### 6.10 `appointment-schedule` (NEW)

- **Purpose:** "Today's appointments / classes, in time order."
- **Example uses:** Salon bookings, clinic appointment slots, fitness class schedule, tutoring sessions, vet visits.
- **Data contract:** loaders `appointments-today`, `class-roster-today`, `bookings-by-provider`; rendersWhenEmpty `false` (an empty schedule is a setup gap or genuinely-quiet day; primitive must show admin disambiguation).
- **Density:** desktop col-span 6, row-span 3, min-width 360px. Mobile above-fold.
- **States:** empty + admin CTA "no appointments configured for today", loading skeleton, stale 60s, misconfigured.
- **Actions:** `open-appointment` (no capability), `reschedule` (capability `appointment.reschedule`), `mark-arrived` (capability `appointment.checkin`), `mark-no-show` (capability `appointment.noshow`).
- **Vocabulary:** `appointment_singular`, `appointment_plural`, `time_label`.
- **Banned-copy surfaces:** title, labels, actions, empty-state.
- **Applicability:** suggestedCategories `healthcare`, `personal-services`, `fitness-instruction`, `tutoring`, `veterinary`, `salon`. Not for `field-service` (use `capacity-lanes` + `geo-map`), `restaurant` (use `service-period-board`).
- **Related primitives:** `capacity-lanes` (capacity view of same data), `service-period-board` (period view of same data).

### 6.11 `volunteer-program-board` (NEW)

- **Purpose:** "Volunteers, shifts, hours, and program participation."
- **Example uses:** Food bank volunteer shifts, animal-shelter dog-walker roster, community-org program participants, nonprofit campaign teams.
- **Data contract:** loaders `volunteers-active`, `volunteer-shifts-today`, `program-participants`; rendersWhenEmpty `false`.
- **Density:** desktop col-span 6, row-span 2, min-width 360px. Mobile below-fold.
- **States:** empty + admin CTA, loading skeleton, stale 5min, misconfigured.
- **Actions:** `assign-shift` (capability `volunteer.assign`), `record-hours` (capability `volunteer.record-hours`), `send-thanks` (capability `volunteer.thanks`).
- **Vocabulary:** `volunteer_singular`, `volunteer_plural`, `program_label`, `shift_label`.
- **Banned-copy surfaces:** title, labels, actions.
- **Applicability:** suggestedCategories `nonprofit`, `animal-rescue`, `food-bank`, `community-org`. Not for commercial archetypes.

## 7. Banned-copy protection

The parent spec asserts the rule: "No worker-facing primitive exposes gear/ring/torque/slip/cockpit terminology." This section encodes the token list and the enforcement surface.

**Banned token list (worker-facing only — diagnostic/admin/dev-tools surfaces are exempt):**

- `gear`, `gears`
- `ring`, `rings`, `concentric-ring`, `ring-0`, `ring-1`, `ring-2`
- `torque`
- `slip`, `slip-rate`
- `cockpit`
- `reduction-gear`
- `GearInterface`
- Any architecture-loop language (e.g. "outer loop", "inner loop") as worker-facing copy

**Enforcement surface:**

- The `WorkspaceHomePrimitiveSpec.bannedCopy.exposedSurfaces` field declares where the primitive may emit worker-facing strings.
- A lint rule (recommended new addition: `apps/web/lib/workspace-home/lint/banned-copy.ts`) scans contribution + primitive spec values and fails build if any banned token appears in `title`, `labels`, `actions[].label`, `empty-state.copyKey` resolutions, or `tooltip` content.
- The lint runs against resolved copy values, NOT the source code itself — so platform-development docs and code comments referencing "gear" stay legal.

**Out of scope:** banning at runtime in the renderer (defense in depth). The build-time lint is the single enforcement point; if a banned token reaches render, the lint regressed and should be fixed at lint level, not the renderer.

## 8. Setup-activation metadata (primitive level)

The parent spec's `WorkspaceHomeSetupActivation` lives at the contribution level. Primitives need their own data-requirement signals so a contribution can aggregate the union and the setup flow can compute:

- Required canonical data (union of all primitive `dataContract.acceptedLoaders` actually bound by the contribution's slots).
- Required signals (union of `dataContract.acceptedSignals` referenced by slots that use `dataRef.kind === "signal"`).
- Missing-data behavior per slot — driven by the primitive's `dataContract.rendersWhenEmpty`:
  - `true` → contribution may use `missingDataBehavior: "empty-state"` for that slot.
  - `false` → contribution must use `"seed-demo-data"` (in test installs) or `"setup-task"` (in real installs).

Setup activation thus becomes:

```ts
// Pseudo-code
function aggregateSetupRequirements(
  contribution: WorkspaceHomeContribution,
  registry: WorkspaceHomePrimitiveRegistry,
) {
  return contribution.slots.flatMap((slot) => {
    const primitive = registry[slot.primitive];
    return {
      loaderIds: collectLoaderIds(slot.dataRef),
      signalKindIds: collectSignalKindIds(slot.dataRef),
      missingDataBehavior: primitive.dataContract.rendersWhenEmpty
        ? contribution.setupActivation.missingDataBehavior
        : "setup-task", // primitive forces setup-task if it can't render empty
    };
  });
}
```

## 9. Registry module shape

```text
apps/web/lib/workspace-home/primitives/
  primitive-spec.ts          # WorkspaceHomePrimitiveSpec type, registry type
  registry.ts                # WorkspaceHomePrimitiveRegistry instance (11 entries)
  registry.test.ts           # type-level + value-level coverage (every key has a spec, every spec satisfies contract)
  data-loaders.ts            # WorkspaceHomeCanonicalLoaderId enum
  signals.ts                 # WorkspaceHomeSignalKindId enum
  lint/
    banned-copy.ts           # token list + scan implementation
    banned-copy.test.ts
```

The substrate BI (`BI-1CCC6264` per parent §11) is the natural home for this module. This spec is the design input for that BI's primitive-library subsection.

## 10. Open decisions

1. **Approve the 2 new primitives (`appointment-schedule`, `volunteer-program-board`)?** Recommendation: yes — distinct operating models from existing primitives (§4 rationale).
2. **Approve the typed `WorkspaceHomePrimitiveSpec` shape (§5)?** Recommendation: yes — mirrors the parent spec's `WorkspaceHomeComponentRegistry` pattern (type-system enforcement, no runtime sandbox).
3. **Approve the banned-token list (§7)?** Recommendation: yes — extend if other architecture nouns leak. The lint should be a code change, not a runtime check.
4. **Should `acceptedSignals` be `ReadonlyArray<WorkspaceHomeSignalKindId>` (required) or optional?** Recommendation: optional — many primitives are loader-only.
5. **Should the registry module live under `apps/web/lib/workspace-home/primitives/` (proposed §9) or `apps/web/lib/build/workspace-home/primitives/`?** Recommendation: `apps/web/lib/workspace-home/primitives/` — parallel to `apps/web/lib/finance/accountant-work-lane.ts` etc.
6. **Should this spec edit the parent `2026-05-24-vertical-workspace-home-design.md` to add the 2 new primitives to the primitive table (lines 277–289), or does the extension reference stand on its own?** Recommendation: leave the parent table alone in this PR; let the substrate BI add the table rows when it lands the code. Avoids divergence-between-PRs risk.

## 11. Definition of done

- This extension spec is reviewed and accepted or revised.
- BI-5B8FE5C1 acceptance criteria all met:
  - Each primitive has a clear purpose, vertical-native labels, canonical data dependencies, interaction expectations, mobile behavior, and setup-activation metadata ✓ (§6, all 11 primitives).
  - Queue and map primitives support common service-business workflows; health/status primitives support MSP/customer-estate workflows ✓ (§6 applicability fields).
  - Business-archetype setup can report which primitive widgets will activate ✓ (§8 aggregation pseudo-code).
  - Vertical implementation BIs can compose primitives by manifest ✓ (§5 typed contract).
  - No worker-facing primitive exposes banned terminology ✓ (§7 token list + lint).
  - Result extends the vertical workspace home spec ✓ (this document, referenced as a sibling).
- BI-5B8FE5C1 closes on merge of this spec; the substrate BI (`BI-1CCC6264`) then references this spec when implementing the primitive registry module.
