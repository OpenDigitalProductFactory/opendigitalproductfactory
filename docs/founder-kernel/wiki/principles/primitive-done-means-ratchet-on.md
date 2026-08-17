---
title: A Primitive Is Not Done Until Its Adoption Ratchet Is On
pageKind: principle
status: published
abstract: Shipping a canonical primitive without a CI adoption ratchet leaves adoption voluntary, and voluntary adoption loses to drift at agent velocity. The primitive, its spec, and the guard that blocks new hand-rolled competitors land in the same motion, or the work is not done.
principleTier: core
principleDirection: Ship every canonical primitive together with the CI ratchet that blocks new hand-rolled competitors; treat a primitive without its ratchet as unfinished work.
principleDimensionVector: {"long_term_maintainability": 1.0, "governance_compliance": 0.7, "reusability": 0.8, "evidence_density": 0.4, "speed_to_value": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters benefit from knowing the platform converges on canonical primitives mechanically rather than by convention.
---

## Rule

A canonical primitive — a component, a result type, a schema pattern, a registry — is **done** only when three things land together: the primitive itself, the spec/README that names when to use it, and the **adoption ratchet**: a CI guard that fails when new code hand-rolls what the primitive provides. Shipping the primitive alone and hoping for adoption is not done; it is the first half of the work, and the half that decays.

## Why

The 2026-08-16 architecture pass measured the outcome of voluntary adoption at AI-agent velocity: `ActionResult` adopted by 6 files against 1,590 hand-rolled sites; the form contract 17 against 235; the `PageShell` reading contract 1 route in 350; the retention registry 19 models against ~39 unenrolled growth tables. The one success — `report-kit`, 193 importing files — shipped with a spec, a README, named components, and a ratchet culture. The difference is not quality of the primitive; it is whether adoption was mechanical or voluntary. At the platform's production rate, every unratcheted primitive becomes a fourth pattern beside the three it was meant to replace.

## Applies To

Everyone who ships a primitive: in-platform coworkers, external coding agents, and humans reviewing their PRs. Symmetric across code (components, types, helpers), schema (patterns, enums, registries), and process (doc conventions, evidence formats).

## How To Apply

Before calling primitive work complete, answer: *what guard fails when someone hand-rolls this tomorrow?* If the answer is "none", the work is not done. The repo's ratchet pattern is established — baseline file + `check-*.mjs` guard that blocks **new** occurrences while the backlog burns down (module-size baseline, boundary guard, status-color guard). Reuse it: count today's violations into a baseline, fail CI on any increase, shrink the baseline as cohorts migrate. A new primitive's PR is the cheapest possible moment to add its guard; retrofitting one later costs a full sweep. When a genuine exception exists, it gets a named, owned entry in the baseline — never a silent pass.

## Decision Dimensions

- `long_term_maintainability: 1.0` — the ratchet is what makes the primitive's benefit compound instead of erode.
- `reusability: 0.8` — mechanical adoption is what turns a primitive into actual reuse.
- `governance_compliance: 0.7` — converts a documented discipline into an enforced gate, the platform's stated drift answer.
- `speed_to_value: -0.3` — costs the primitive author the guard-writing hour; pays it back on every avoided divergence.

## Examples

- **Positive:** `report-kit` — spec + README + named components + ratchet culture → 193 adopters, `StatusBadge` in 145 files.
- **Negative:** `lib/shared/action-result.ts`, whose own header says it replaces "~700 hand-inlined return sites" — shipped without a ratchet, adopted by 6 files while 1,590 `ok: true` sites and 9 competing local aliases accumulated.

## Related

- [[principles/supersession-is-a-mechanical-act]] — the ratchet's sibling: new patterns must also retire their predecessors.
- [[principles/architecture-over-shortcuts]] — the ratchet is the sound fix; "adopt it later" is the quick one.
