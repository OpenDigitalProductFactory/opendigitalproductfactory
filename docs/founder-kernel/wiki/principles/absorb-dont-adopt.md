---
title: Absorb, Don't Adopt
pageKind: principle
status: published
abstract: When an open-source project already implements a capability DPF needs, own the source and blend the functionality in. A third-party stack running beside the platform is an appendage, not a capability.
principleTier: core
principleDirection: Default to absorbing a capability into the platform spine; running a third-party stack alongside DPF requires justification, and the refactor-to-feature budget is roughly 80/20 in favour of integration.
principleDimensionVector: {"long_term_maintainability": 0.8, "architectural_coherence": 0.9, "speed_to_value": -0.5, "vendor_lock_in": -0.4}
principleWeight: 0.6
principleWeightRationale: Strategic allocation doctrine rather than a safety rule; weighted below the commandments so it shapes planning without perturbing safety decisions.
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters choosing DPF are choosing a platform that hybridizes capability rather than assembling one from loosely coupled services; the allocation is part of what they are buying.
---

## Rule

When DPF needs a capability an open-source project already implements, the answer is to **own the source and blend the functionality into the platform**, not to run that project as a bundled service beside DPF.

The refactor budget follows from this. The standing convention was 80% feature work to 20% substrate refactor. **It is inverted: roughly 80% refactor and integration, 20% new feature.**

## Why

Founder direction, 2026-08-23: *"I would like to absorb, not use as delivered. This is the entire point of this platform, to absorb."* And on the budget: *"all the parts of the platform are here, but [need to be] well integrated / refactored to form the hybridized result I envision."*

The platform's marginal value is no longer in adding parts. It is in hybridizing the parts that already exist.

A third-party stack sitting alongside the platform is an appendage. The target is a result where the capability is native. The concrete failure this prevents is a second store beside a canonical model — for identity, a second user store beside the canonical principal, which breaks convergence and creates parallel truth. In the founder's words: *"identity needs to be tied and integral with the agent and people, not separated by a loosely coupled software stack."*

## How to apply

- When planning an epic or a slice, allocate the majority of capacity to consolidating duplicate concepts, collapsing loosely-coupled seams, and making capabilities native rather than adjacent.
- Treat "add a new subsystem beside the existing one" as the disfavoured option that needs justification. Treat "absorb it into the existing spine" as the default.
- Licence terms travel with absorbed source. A permissive licence permits absorption and usually **requires attribution**, so carry the licence notice with the code.
- Update the stated allocation in design docs rather than carrying an older ratio forward silently.
- Federation and interoperability are retained. The rule is about where the functionality lives, not about refusing to interoperate.

## Related

`architecture-over-shortcuts` · `verify-substrate-before-proposing-new` · `substrate-cleanup-before-substrate-addition` · `one-home-per-capability` · `single-source-of-truth`
