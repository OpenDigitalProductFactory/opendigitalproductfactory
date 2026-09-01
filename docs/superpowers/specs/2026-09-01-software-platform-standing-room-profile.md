---
status: active
---

# Software-platform standing-room profile

**Backlog item:** `BI-7E7B93DF`

**Canonical design:** [Proactive Workrooms](2026-08-29-proactive-workrooms-design.md), especially §§4–5

**Implementation plan:** [Phase E plan](../plans/2026-09-01-software-platform-standing-room-profile.md)

## Objective

Ship the reusable Layer 2 standing-room profile for every `software-platform` archetype leaf. The
profile contains five portfolio rooms and thirteen independently meaningful sub-rooms. It is a pure
projection from the leaf's canonical Operational Value Stream Model (OVSM), and contains no
customer-0 repository coordinates, people, credentials, suppliers, or numeric operating
thresholds. Those are Layer 3 configuration owned by `BI-A967717A`.

## Existing substrate and boundary

This slice extends, rather than replaces:

- `deriveOperationalValueStream`, the pure archetype-to-OVSM projection;
- the `WorkShapeDefinition` registry and `validateWorkShape` safety contract;
- the shipped Workroom shape claim, runner, participant, budget, and relation substrate.

`packages/storefront-templates/src/standing-rooms.ts` owns only an archetype-derived catalogue:
portfolio placement, stable room keys, titles, objectives, OVSM source-stage references, and the
work-shape key for each sub-room. It does not create Workroom rows. The web work-shape registry owns
the executable stage, trigger, stop, budget, measure, review, and human-decision declarations.

## Required profile

The five top rooms and thirteen sub-rooms are the canonical set from the parent design:

1. `foundational/source-custody-and-assurance`: dependency/advisory watch, repository-policy drift,
   secret/credential hygiene.
2. `manufactureAndDeliver/contribution-flow`: pull-request flow, issue triage, release readiness.
3. `productsAndServicesSold/adopter-and-inquiry-desk`: inquiry response, adopter health.
4. `forEmployees/contributor-relations`: contributor intake, coworker fitness.
5. `foundational/business-administration`: payables, vendor/subscription review.

The reusable profile retains the design's proposed `foundational` placement for Business
Administration. Activating that placement on the operator install remains a human-ratified Layer
3 decision; deriving the catalogue does not enact it.

Each sub-room references at least one OVSM stage key available on every software-platform leaf. The
derivation validates those references against the supplied OVSM and refuses an incomplete profile;
it never accepts instance inputs or falls back to authored per-leaf data.

## Work-shape safety

Every sub-room gets one versioned shape. Each shape declares:

- at least one closed trigger class;
- ordered agent work followed, where consequential, by a `role:` human-owned
  `governed-decision` stage;
- success, failure, and budget stops;
- grants, measures, a numeric budget, and a review point;
- an existing collaboration shape where a consequential handoff occurs.

Outbound sends, money movement, credential rotation, contributor admission, policy changes,
release cuts, merges, and grant changes remain human-owned. Shape definitions name roles and work
kinds, never customer-0 people or connector bindings.

## Conformance gates

Tests fail before implementation and prove:

1. storefront templates contain no forge URL, foreign organization slug, or credential-shaped
   value;
2. the profile derives from OVSM alone and resolves for every software-platform leaf;
3. work-management modules do not import archetype source modules;
4. the exact room count, containment shape, unique keys, and OVSM references are valid;
5. all thirteen work shapes pass `validateWorkShape` and retain their human boundaries.

## Research and benchmarking

The parent design's current comparison is the controlling research record: Kubernetes reconcile
loops supply bounded, level-triggered reconciliation; Prefect/Dagster supply schedule-versus-work
separation and evidence freshness; Renovate/Dependabot supply generic machinery with instance
bindings and propose-never-commit behavior. DPF adopts those properties and rejects unbounded
retries, per-repository source-of-truth configuration, and autonomous consequential completion.
NIST AI RMF Manage remains the standards basis for declared stops and review points.

## Documentation impact

Add a catalogue section documenting the software-platform room set and explicitly separating the
reusable Layer 2 profile from per-install Layer 3 bindings. No UX surface changes in this slice.
