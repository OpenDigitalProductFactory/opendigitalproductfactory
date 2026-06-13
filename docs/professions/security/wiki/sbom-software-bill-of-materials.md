---
title: Software Bill of Materials (SBOM)
pageKind: entity
status: published
abstract: An SBOM is a structured, machine-readable inventory of the components and dependencies in a piece of software. CycloneDX is a modular BOM standard (ECMA-424) used to make the supply chain auditable.
professionCompetencyLevel: expert
sources:
  - cyclonedx/spec
  - owasp/top-ten
---

## Definition

A **Software Bill of Materials (SBOM)** is a structured inventory of the software components and dependencies that make up an application — the ingredient list that makes the supply chain auditable. Without one, you cannot answer "are we affected by this CVE?" with confidence.

## CycloneDX

**CycloneDX** is a highly modular and extensible framework for representing supply-chain information, governed by the OWASP Foundation with Ecma International and standardized as **ECMA-424** (TC54). Beyond classic SBOMs it can represent related BOM varieties — SaaSBOM, hardware BOM (HBOM), and even cryptographic assets and ML models.

## Why It Matters

The OWASP Top 10:2025 elevates **Software Supply Chain Failures (A03)**. An SBOM is the inventory that makes supply-chain risk tractable: every dependency is enumerable, so a new CVE can be matched against what you actually ship.

## How DPF Coworkers Use It

- Maintain an SBOM so every dependency is enumerable for [[professions/security/cve-cvss-triage]].
- Use it as the evidence base for [[professions/security/vulnerability-and-supply-chain-auditing]].

## See Also

- [[professions/security/vulnerability-and-supply-chain-auditing]]
