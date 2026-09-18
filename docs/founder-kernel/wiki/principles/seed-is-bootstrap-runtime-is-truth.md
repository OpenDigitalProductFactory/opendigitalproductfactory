---
title: Seed Is Bootstrap, Runtime Is Truth
pageKind: principle
status: published
abstract: Seed data exists to make an install start, not to make decisions. Anything load-bearing for routing or selection is populated by real probes at configuration time and corrected by observed behaviour at runtime.
principleDirection: Keep seed values minimal and non-load-bearing; populate capability and quality scores from probes at activation and from observed outcomes at runtime.
principleTier: core
principleDimensionVector: {"evidence_density": 0.9, "long_term_maintainability": 0.7, "schema_grounding": 0.5, "speed_to_value": -0.3}
principleWeight: 0.7
principleWeightRationale: A recurring root cause across provider routing, model catalogues and capability profiles; weighted high enough to settle those designs, below the safety commandments.
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters inherit whatever was true at install time unless the platform corrects itself from observation; this states that it does.
---

## Rule

**Seed is the bootstrap floor. Configuration is the calibration source of truth. Runtime is the feedback.**

1. **Seed is just enough to make the system installable.** Rows exist, inactive. A catalogue carries at most one safe default per provider. Nothing in seed is load-bearing for a routing or selection decision.
2. **At configuration time**, run real probes against the platform's own harness rather than trusting a vendor's self-report, and populate capability and dimension scores from probe outcomes. Block the high-risk routing classes for anything unprobed.
3. **At runtime**, every call writes telemetry. Guards that detect failure decrement the responsible score; success increments it slowly. The score is always a function of recent observed behaviour, never of a seeded value.
4. **Anything calling itself an evaluation must write scores backed by a structured outcome.** A score that cannot be traced to a specific run with a specific result should not be written.

## Why

This has failed repeatedly under different names: fabricated capability scores, stale model catalogues, empty capability profiles, requirement tables never populated, providers seeded active with no clearance data. Each time the response was to patch the seed; the seed went stale again; the cycle repeated.

The recurring symptom is a provider routed to work it cannot do because a seeded score said it could, while observed behaviour said otherwise.

**The counter-pattern to avoid is "we will make the seed values more accurate."** That treats the symptom. The seed will always go stale. The fix is to make seed irrelevant to the decision by pushing the source of truth to activation and runtime.

## How to apply

- When adding any closed catalogue of capabilities, ask whether discovery at activation can replace the static list. A static list is a cold-start fallback, never the source of truth once a real source is live.
- A reconciliation script that re-applies a static catalogue over probe data is an anti-pattern; it overwrites observation with assumption.
- This does not retire `fix-the-seed-not-the-runtime`. If seed must be touched, still fix the seed rather than patching the running system. This principle is about shrinking how much depends on seed at all.

## Related

`fix-the-seed-not-the-runtime` · `no-provider-pinning` · `evidence-before-diagnosis` · `zero-click-provider-setup` · `make-silent-failures-observable`
