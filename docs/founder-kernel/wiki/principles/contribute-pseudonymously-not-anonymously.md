---
title: Contribute Pseudonymously, Not Anonymously
pageKind: principle
status: published
abstract: An install contributing upstream carries a stable, distinguishable public identifier. Real names and machine names stay private; a contributor the community cannot tell apart from every other is not privacy, it is a broken commons.
principleDirection: Give every contributing install a stable per-install pseudonym in both the author name and the email, and never let a hostname, machine name or personal identifier reach a public surface.
principleTier: core
principleDimensionVector: {"governance_compliance": 0.7, "data_sovereignty": 0.6, "long_term_maintainability": 0.4}
principleWeight: 0.6
principleWeightRationale: Governs outbound identity on every contribution surface; weighted to settle identity design without competing with the safety commandments.
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-5-hive
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Anyone contributing from an install needs to know exactly what of their identity becomes public and what never does.
---

## Rule

Contributions to the shared upstream are **pseudonymous, not anonymous**. Each contributing install carries a stable, distinguishable public identifier. Real name, company name and machine name stay private.

Two failures are equally wrong, and they fail in opposite directions.

- **Leaking identity.** A branch, commit, pull-request title or trailer that carries a hostname, machine name, address or personal username exposes the operator on a public surface.
- **Collapsing identity.** Every install contributing under one identical author name makes all contributors an indistinguishable blob.

## Why

Attribution matters without exposing a person. A stable pseudonym is what makes repeat contribution recognizable, lets a maintainer thread a conversation to one contributor, lets reputation accrue, and makes abuse handling possible at all. Fully anonymous contribution makes community stewardship impossible.

The leak side is a straightforward privacy violation: a platform that promises pseudonymous contribution must not publish the contributor's desktop name in git history.

## How to apply

- Any git author identity used for a public operation carries the per-install discriminator in the **name** field, not only in the email.
- Carry the same pseudonym into issue bodies, pull-request metadata and comments, so a maintainer can thread replies to one contributor.
- Never place a hostname, machine name, address or username in a branch name, commit message or pull-request metadata that reaches a public surface. Derive the branch name from a stable install identifier instead.
- Keep an opt-in attributed mode where an operator can connect their own account and contribute under their real handle. It is an alternative, never the default.
- This applies to every outbound path, not only the one most recently built.

## Related

`data-sovereignty-follows-control` · `install-is-the-tenant` · `governance-approves-evidence-not-provenance`
