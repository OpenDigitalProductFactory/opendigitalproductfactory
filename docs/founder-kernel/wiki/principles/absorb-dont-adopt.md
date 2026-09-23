---
title: Absorb, Don't Adopt
pageKind: principle
status: published
abstract: When the platform needs a capability, absorb it into the platform's own substrate instead of running a third-party stack beside it, and keep the dependency surface shrinking. A bundled stack is an appendage, not a capability.
principleTier: commandment
principleDirection: Default to absorbing a capability into the platform spine and to shrinking the dependency surface. Adopting a third-party stack, service, image, package or subscription is the option that must justify itself against an absorption alternative, and a new dependency must retire more than it adds.
principleDimensionVector: {"operational_independence": 0.9, "long_term_maintainability": 0.8, "vendor_lock_in": -0.9, "speed_to_value": -0.3}
principleWeight: 2.0
principleWeightRationale: "Founder direction 2026-09-22 raised this from core (0.6, ring-2 only) to a universal commandment so every WWMD decision facing rent, adopt or absorb options is pulled the same way. Measured on the golden panel (49 commandments): at 1.0 an upstream option that is also faster, better proven and lower-blast still wins by 0.08, a near tie, because one commandment among 49 cannot outweigh the evidence and speed pull of the rest. At 2.0 absorption wins by 0.35 (floor 0.3), and the anti-maximalism guard (cheap-sound-vs-rebuild) holds at 3.20. It is the first commandment above 1.0; the weight is the founder's stated priority, not salience inflation."
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters choosing DPF are choosing a platform that hybridizes capability rather than assembling one from loosely coupled services; the allocation and the shrinking dependency surface are part of what they are buying.
---

## Rule

When DPF needs a capability an open-source project already implements, the answer is to **own it and blend the functionality into the platform**, not to run that project as a bundled service beside DPF.

**The dependency surface only shrinks.** Every package, container image, always-on service and vendor subscription is a dependency. A proposal that adds one must name what it retires, and should leave the platform with fewer dependencies than before. When an option adds a dependency and another option absorbs the capability into substrate the platform already owns, the absorbing option is the default. The adding option has to make its case.

The refactor budget follows from this. The standing convention was 80% feature work to 20% substrate refactor. **It is inverted: roughly 80% refactor and integration, 20% new feature.**

## Why

Founder direction, 2026-08-23: *"I would like to absorb, not use as delivered. This is the entire point of this platform, to absorb."* And on the budget: *"all the parts of the platform are here, but [need to be] well integrated / refactored to form the hybridized result I envision."*

Founder direction, 2026-09-22, on evaluating an office suite: *"We want absorption, and want to limit dependencies. WWMD should be clear on this direction when facing options."* At core tier, weight 0.6, scoped to one ring, this principle lost to other principles on exactly the decisions it exists for.

The platform's marginal value is no longer in adding parts. It is in hybridizing the parts that already exist.

A third-party stack beside the platform is an appendage. The failure this prevents is a second store beside a canonical model. For identity, that is a second user store beside the canonical principal, which breaks convergence and creates parallel truth: *"identity needs to be tied and integral with the agent and people, not separated by a loosely coupled software stack."* Every dependency is also a lever someone else controls: a release that breaks the build, a digest that rots, a licence or price change. The dependency-diet measurements behind EP-8DC217EB (a 4.17 GB image, 2,000 resolved packages) show what an unexamined surface costs.

## How to apply

- When planning an epic or slice, put most of the capacity into consolidating duplicate concepts, collapsing loosely coupled seams, and making capabilities native rather than adjacent.
- Treat "add a new subsystem beside the existing one" as the disfavoured option that needs justification. Treat "absorb it into the existing spine" as the default.
- When a capability cannot be absorbed as source, bring it into infrastructure the platform owns:
  - A DPF-built, pinned tool image that runs only when called, not an always-on third-party service.
  - It is invoked through a platform contract, so it can be replaced without touching callers.
  - It should retire other dependencies (for example, one document engine replacing several parsing packages).
- Rented services and subscriptions sit at the bottom of the ladder. Choose one only when there is no absorbable or self-hostable path, and record it as a gap to close.
- Licence terms travel with absorbed source. A permissive licence permits absorption and usually **requires attribution**, so carry the licence notice with the code.
- Update the stated allocation in design docs rather than carrying an older ratio forward silently.
- Federation and interoperability stay. The rule governs where functionality lives. It does not mean refusing to interoperate.

## Related

`prefer-self-hosted-infrastructure` · `architecture-over-shortcuts` · `verify-substrate-before-proposing-new` · `substrate-cleanup-before-substrate-addition` · `one-home-per-capability` · `single-source-of-truth`
