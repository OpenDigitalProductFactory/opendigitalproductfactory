---
title: Always respect open-source license terms
pageKind: principle
status: published
abstract: Every dependency carries a license with obligations. Identify each license by its SPDX identifier, record license and copyright metadata in an SBOM, check compatibility before combining, and preserve attribution.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: Identify every dependency's license (SPDX), check compatibility before combining, and preserve required attribution and notices.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 1.0, "blast_radius": -0.6}
professionJurisdiction:
  - global
professionCompetencyLevel: foundational
sources:
  - spdx/license-list
  - spdx/spec
---

## Rule

Every dependency you consume or ship carries a license with obligations. **Identify** each license by its unambiguous [[professions/legal-compliance/spdx-license-identifier]], **record** license and copyright metadata in machine-readable form (an SBOM, per the SPDX specification), **check compatibility** before combining components, and **preserve attribution** so required notices survive redistribution.

## Why

License obligations are legally binding regardless of intent. Copyleft identifiers (for example `GPL-3.0-only`) impose obligations that permissive licenses (`MIT`, `Apache-2.0`) do not — combining them without checking can create an obligation the project cannot meet. The SPDX specification models attribution precisely (`attributionText`) so notices are not lost when code is redistributed.

## How To Apply

1. **Identify** — resolve every dependency to an SPDX identifier; no free-text guesses.
2. **Record** — capture license + copyright in the SBOM (this is the same SBOM security uses for [[professions/security/vulnerability-and-supply-chain-auditing]]).
3. **Check compatibility** before combining — copyleft vs permissive is the first question. *(Full dependency-graph compatibility analysis is expert-level.)*
4. **Preserve notices** on redistribution.

## See Also

- [[professions/legal-compliance/spdx-license-identifier]]
