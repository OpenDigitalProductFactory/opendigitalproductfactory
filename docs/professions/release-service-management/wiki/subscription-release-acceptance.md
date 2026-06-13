---
title: Subscription / release acceptance heuristic
pageKind: heuristic
status: published
abstract: Auto-accept PATCH and MINOR releases; require explicit review for MAJOR and pre-releases. Reject any release whose gate package is incomplete, and treat an "unknown"/"incomplete" SBOM composition as a hold signal. Map accepted releases to their catalogued service.
professionCompetencyLevel: expert
sources:
  - semver/spec
  - cyclonedx/spec
---

## Heuristic

Decide whether to accept an incoming release using version semantics plus gate completeness:

1. **Auto-accept PATCH and MINOR** releases (backward-compatible by SemVer contract).
2. **Require explicit review for MAJOR** (breaking) releases and any **pre-release** tag.
3. **Reject any release with an incomplete gate package** — missing SBOM, version, or license manifest (see [[professions/release-service-management/release-gate-package]]).
4. **Treat SBOM composition "unknown"/"incomplete" as a hold** — investigate coverage before accepting (see [[professions/release-service-management/sbom-composition-cyclonedx]]).
5. **Map the accepted release to its catalogued service** so consumers see what changed.

## Why

This converts the version contract and the gate artifacts into an automatable decision: most releases (patches, features) flow through, while the genuinely risky ones (breaking changes, incomplete provenance) stop for human judgment. It scales acceptance without rubber-stamping risk.

## How DPF Coworkers Use It

- Wire this as the default subscription-acceptance policy; tune which severities auto-accept per consumer risk tolerance.
- Pair with [[professions/release-service-management/release-versioning]] (the signal) and [[professions/release-service-management/service-catalog-management]] (the mapping).

## See Also

- [[professions/release-service-management/release-gate-package]]
- [[professions/release-service-management/release-versioning]]
- [[professions/release-service-management/service-catalog-management]]
- [[professions/release-service-management/sbom-composition-cyclonedx]]
