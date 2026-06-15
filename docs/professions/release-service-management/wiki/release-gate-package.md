---
title: Release gate package
pageKind: principle
status: published
abstract: A release must not pass the gate without its accompanying artifacts — an SBOM (with components and dependencies), a declared SemVer version, and a license manifest. These make vulnerability, compatibility, and license obligations auditable at acceptance time.
principleTier: core
principleDirection: Block any release that lacks its SBOM, a SemVer version, and a license manifest; the gate reads evidence, not promises.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.8, "blast_radius": 0.6, "evidence_density": 0.6}
professionCompetencyLevel: expert
sources:
  - ntia/sbom-minimum-elements
  - semver/spec
  - cyclonedx/spec
  - spdx/spec
---

## Rule

A release **must not pass the gate** without its accompanying artifacts:

1. An **SBOM** naming every component and dependency.
2. A declared **version** (SemVer).
3. A **license manifest**.

The gate reads these as evidence; "trust me, it's fine" is not a release artifact.

## Why Each Is Required

- **SBOM** (per [[professions/release-service-management/sbom-minimum-elements-ntia]] / CycloneDX) lets consumers manage vulnerabilities and license compliance — you cannot patch what you cannot enumerate.
- **Version** — a SemVer string communicates the compatibility impact of the release, driving the consumer's accept/hold decision (see [[professions/release-service-management/release-versioning]]).
- **License manifest** — SPDX expressions / CycloneDX license fields make the obligation surface auditable at acceptance, not after distribution.

## How To Apply

1. **Make the three artifacts a hard gate** in the release pipeline; fail the release if any is missing.
2. **Check SBOM composition completeness** — treat "unknown"/"incomplete" as a hold.
3. Feed the acceptance decision in [[professions/release-service-management/subscription-release-acceptance]].

## See Also

- [[professions/release-service-management/sbom-composition-cyclonedx]]
- [[professions/release-service-management/sbom-minimum-elements-ntia]]
- [[professions/release-service-management/release-versioning]]
- [[professions/release-service-management/subscription-release-acceptance]]
