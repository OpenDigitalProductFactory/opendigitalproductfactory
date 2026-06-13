---
title: SBOM minimum elements (NTIA)
pageKind: summary
status: published
abstract: The NTIA minimum SBOM elements are seven data fields — supplier, component name, version, other unique identifiers, dependency relationship, SBOM author, and timestamp — in a machine-readable format (SPDX or CycloneDX), with all top-level components and their transitive dependencies, and explicit known-unknowns.
professionCompetencyLevel: practitioner
sources:
  - ntia/sbom-minimum-elements
---

## The Seven Minimum Fields

The US NTIA minimum elements for an SBOM specify seven required data fields per component:

1. **Supplier name**
2. **Component name**
3. **Version**
4. **Other unique identifiers**
5. **Dependency relationship**
6. **Author of the SBOM data**
7. **Timestamp**

## Format, Depth, and Honesty

- **Machine-readable format** — use a predictable format (SPDX or CycloneDX) so the SBOM supports automation.
- **Depth** — list all top-level components with their transitive dependencies.
- **Known unknowns** — explicitly mark where the dependency graph cannot be fully enumerated, rather than implying completeness.

> Source note: distilled from the open SPDX restatement of the NTIA minimum elements (the NTIA primary page blocked the fetcher).

## How DPF Coworkers Use It

- Treat the seven fields as the floor for any SBOM accompanying a release.
- The container format is [[professions/release-service-management/sbom-composition-cyclonedx]]; the gate that requires it is [[professions/release-service-management/release-gate-package]].

## See Also

- [[professions/release-service-management/sbom-composition-cyclonedx]]
- [[professions/release-service-management/release-gate-package]]
