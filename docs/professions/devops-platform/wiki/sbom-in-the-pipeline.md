---
title: SBOM in the pipeline (CycloneDX)
pageKind: entity
status: published
abstract: Generate a Software Bill of Materials as a pipeline artifact. CycloneDX is a modular framework (ECMA-424) inventorying first- and third-party components, dependencies, licenses, and vulnerabilities — the basis for supply-chain assurance at deploy time.
professionCompetencyLevel: expert
sources:
  - cyclonedx/spec
---

## Definition

A **Software Bill of Materials (SBOM)** is a complete inventory of the first-party and third-party components in a build. Generating it as a **pipeline artifact** is what makes supply-chain risk tractable at deploy time.

**CycloneDX** is "a highly modular and extensible framework" for supply-chain information, standardized as **ECMA-424**. It captures components and services, direct and transitive dependencies, licenses, pedigree/provenance, and known vulnerabilities, and serializes to JSON, XML, or Protocol Buffers.

## Why It Belongs in the Pipeline

Generating the SBOM during the build (not after) ties it to the exact bytes shipped, and lets the pipeline drive vulnerability and license assurance automatically — every deploy carries an inventory a consumer can audit.

## How DPF Coworkers Use It

- Emit a CycloneDX SBOM as a build artifact in every [[professions/devops-platform/deployment-pipeline-and-rollback]].
- Pair it with [[professions/devops-platform/infrastructure-as-code]] so both app and infra dependencies are enumerable.

## See Also

- [[professions/devops-platform/deployment-pipeline-and-rollback]]
- [[professions/devops-platform/infrastructure-as-code]]
