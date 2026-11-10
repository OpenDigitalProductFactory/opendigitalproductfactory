---
status: active
---

# Pet Rescue exact-served acceptance repair

**Backlog item:** `BI-24FDCB9D`
**Parent initiative:** `BI-7A38F667`
**Canonical parent design:**
`docs/superpowers/specs/2026-08-25-pet-rescue-operating-system-and-help-recovery-design.md`
§§5.1, 7.1, 7.4, and 7.5
**Implementation plan:**
`docs/superpowers/plans/2026-09-05-pet-rescue-served-acceptance-repair.md`

This document is the child scope manifest for the two exact-served defects in
`BI-24FDCB9D`. It projects the already-recorded repair in parent-design §7.5
without expanding or replacing the Pet Rescue operating-system design. The
parent remains authoritative for animal identity, housing allocation, and the
Rescue cockpit and Help. This child is authoritative only for the roster and
responsive-navigation repair described below.

## Problem and observed evidence

Exact-served acceptance on commit
`4e48b40a727b9a1bf02b355c69a2c661ab4af275` exposed two contradictions:

1. `/workspace/ward` reported no animals in care whenever no housing Resource
   existed, even though the same organization had canonical `AnimalProfile`
   rows in the `in_care` or `placement_ready` lifecycle.
2. At 390×844 the seven-link Rescue operations navigation retained a
   shrinkable horizontal row, causing labels to collide or overflow their
   targets and making the navigation itself horizontally scrollable.

The first-failing regressions added by the repair named both failures directly:
`loadWardWorkspace` had to retain the canonical roster with an empty Resource
query, and `RescueCockpit` had to render a non-scrolling three-column narrow
layout with seven explicit 44px targets. The protected implementation merged as
PR #5087 at `3283349bad5f3d6f0d74e46ffa5e184b37ee1b10` after 40 affected tests,
web typecheck, deterministic guards, DCO, and every protected check passed.
Those are implementation facts, not a substitute for a child scope baseline or
live acceptance.

## Authority and non-goals

- `AnimalProfile` remains the operational animal identity. `AdoptableAnimal`
  remains a public-listing projection and is not a fallback roster authority.
- `Resource` and `ResourceCapacityAllocation` remain the housing and occupancy
  authorities. No-housing and no-animals are distinct states.
- The existing Rescue route family, route order, and desktop navigation remain
  authoritative. This repair changes only the narrow layout contract.
- No schema, migration, route, write path, custody rule, allocation semantic,
  public-listing rule, or alternate animal identity is introduced.
- This child cannot claim the parent initiative's intake, care, adoption,
  stewardship, Help, or full cockpit acceptance.

## Objectives

**OBJ-RESCUE-SERVED-REPAIR:** Restore exact-served Pet Rescue acceptance by preserving the canonical in-care roster without housing records and keeping Rescue navigation usable at 390×844, with completion bound to first-failing regressions, protected delivery, and exact-served verification.

## Acceptance manifest

| Acceptance | Objectives | Required outcome |
| --- | --- | --- |
| AC-RESCUE-SERVED-01 | OBJ-RESCUE-SERVED-REPAIR | With zero housing Resources, the Ward retains the organization-scoped `in_care` and `placement_ready` `AnimalProfile` roster by stable reference/name, keeps no-housing distinct from an empty roster, and never substitutes `AdoptableAnimal`; the named regression, DCO/protected delivery, and exact-served acceptance prove the outcome. |
| AC-RESCUE-SERVED-02 | OBJ-RESCUE-SERVED-REPAIR | At 390×844, all seven Rescue destinations remain legible and non-overlapping in source/keyboard order, every target is at least 44px high, focus and `aria-current` remain intact, navigation does not scroll horizontally, desktop stays compact, and the named regression plus exact-served desktop/narrow verification prove the outcome. |

## Design

### Canonical roster projection

One Ward workspace read loads housing Resources and the eligible
organization-scoped `AnimalProfile` roster together. The existing Ward board is
a compatibility projection over that read, not a second roster authority. The
page therefore renders the truthful no-housing state independently while still
supplying canonical animals to the Housing action. When housing exists, the
existing allocation and capacity behavior is unchanged.

### Responsive navigation

Below the existing `sm` breakpoint, the seven destinations use a wrapping
three-column grid. Each link retains the shared tap-target class and an explicit
minimum 44px height; labels remain inside their own targets and the navigation
does not use horizontal scrolling. At and above `sm`, the prior compact flex row
is restored. DOM order remains route, keyboard, and screen-reader order, and the
existing focus and `aria-current` behavior is unchanged.

### Ordered fix sequence

1. Reproduce both exact-served contradictions and add first-failing Ward and
   Rescue navigation regressions.
2. Reconnect the Ward page to the canonical combined workspace read, preserving
   the no-housing state and existing board compatibility projection.
3. Replace only the narrow navigation layout with the bounded three-column
   contract and retain the desktop row.
4. Run affected tests, typecheck, documentation/style guards, DCO, and every
   protected PR and merge-group check. An unavailable local lane is recorded
   `INCONCLUSIVE`, never passed.
5. Verify the released immutable merge on the live install at desktop and
   390×844, then record acceptance and objective reconciliation for this child.

## Existing substrate and architectural alignment

| Substrate | Reused contract | Explicitly rejected |
| --- | --- | --- |
| Parent Pet Rescue design §§5.1 and 7.1 | `AnimalProfile` is the single operational identity and Ward consumes canonical housing capacity. | A second roster, a public-listing fallback, or a new housing model. |
| Parent design §7.4 and shared UI primitives | Theme-aware tokens, 44px controls, stable semantics, keyboard/focus order, and bounded desktop/narrow layouts. | Page-local colors, reordered DOM, clipped labels, or scroll as the navigation contract. |
| Existing Ward workspace and Rescue cockpit | One read projection and the existing seven routes. | A new route, write path, navigation registry, or parallel state. |

The data model remains normalized: animal identity stays in `AnimalProfile` and
housing occupancy stays in the delivered Resource substrate. Both reads are
organization bounded. The roster query is bounded by one organization's active
care population, and navigation remains a fixed seven-item set; this repair adds
no unbounded collection, cross-install fan-out, or new scale ceiling. The parent
initiative owns any future expansion of those sets.

## Traceability

The implementation plan records one atomic deliverable with:

- requirement `OBJ-RESCUE-SERVED-REPAIR`;
- contracts `AC-RESCUE-CAPACITY-02` and `AC-RESCUE-HOME-02` from the
  parent design;
- flows `Phase 1 — RED and authority boundary`,
  `Phase 2 — GREEN and bounded refactor`, and
  `Phase 3 — guards, protected CI, and live acceptance` from the plan;
- verification `AC-RESCUE-SERVED-01` and `AC-RESCUE-SERVED-02`.

## Risks and rollback

- **Roster omission:** an overly narrow lifecycle filter could hide a legitimate
  in-care animal. The closed values and organization boundary are asserted in
  the loader regression.
- **Public/operational identity drift:** falling back to `AdoptableAnimal` would
  restore an apparent list while violating the authority model. The child
  contract forbids that fallback.
- **Narrow-layout regression:** wrapping could add bounded vertical height or
  disrupt focus order. The component regression verifies the fixed item count,
  grid contract, target height, DOM order, and accessibility budget.
- **Rollback:** revert PR #5087 to restore the prior runtime behavior and leave
  both this child and the parent initiative open. This governance artifact is
  independently revertible and makes no data or runtime mutation.
