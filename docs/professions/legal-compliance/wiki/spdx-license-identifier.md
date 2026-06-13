---
title: SPDX license identifier
pageKind: entity
status: published
abstract: An SPDX identifier is a standardized short code (e.g. MIT, Apache-2.0, GPL-3.0-only) for an open-source license. The SPDX License List and specification make license and copyright metadata machine-readable.
professionJurisdiction:
  - global
professionCompetencyLevel: foundational
sources:
  - spdx/license-list
  - spdx/spec
---

## Definition

An **SPDX license identifier** is a standardized short code that unambiguously names an open-source license. The **SPDX License List** (maintained by the Linux Foundation, CC-BY-3.0) enables efficient and reliable identification of licenses and exceptions, providing each identifier alongside its full name, license text, and canonical URL.

Examples: `MIT`, `Apache-2.0`, `GPL-3.0-only`, `BSD-3-Clause`, `CC-BY-4.0`.

## In the SPDX Specification

The License List is an integral part of the **SPDX Specification** (v3.0.1), which carries SBOM data together with license metadata via its licensing modules, and captures attribution through `copyrightText` and `attributionText` properties. This makes "what license is this, and what does it require?" a machine-answerable question across a whole dependency graph.

## Why It Matters

A precise identifier is the prerequisite for license hygiene: you cannot check compatibility or preserve required notices for a dependency whose license you have only recorded as free text. The identifier is the stable key.

## See Also

- [[professions/legal-compliance/respect-open-source-license-terms]]
