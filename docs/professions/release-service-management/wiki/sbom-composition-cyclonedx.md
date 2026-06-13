---
title: SBOM composition (CycloneDX)
pageKind: entity
status: published
abstract: A CycloneDX BOM carries metadata, a component inventory, and explicit dependency relationships, with composition flags asserting completeness (complete / incomplete / first-party-only / unknown) so coverage gaps are explicit. Standardized as ECMA-424.
professionCompetencyLevel: expert
sources:
  - cyclonedx/spec
---

## Definition

A **CycloneDX** Bill of Materials carries:

- **Metadata** — supplier/manufacturer, the target component, and the tools that created the BOM.
- **A component inventory** — first- and third-party software, hardware, ML models, and configs, each with provenance and license data.
- **Explicit dependency relationships** — direct and transitive.
- **Compositions** — assertions of completeness (complete, incomplete, first-party-only, third-party-only, or **unknown**) that make coverage gaps explicit rather than silent.

It serializes to JSON, XML, or Protobuf and is standardized as **ECMA-424**.

## Why Composition Completeness Matters

For release management, a BOM that silently omits components is worse than none — it creates false confidence. The composition flag forces honesty: "unknown" or "incomplete" is a signal to investigate before release.

## How DPF Coworkers Use It

- Require a CycloneDX SBOM in the [[professions/release-service-management/release-gate-package]].
- Map fields to the [[professions/release-service-management/sbom-minimum-elements-ntia]] checklist.

## See Also

- [[professions/release-service-management/sbom-minimum-elements-ntia]]
- [[professions/release-service-management/release-gate-package]]
