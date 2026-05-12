---
title: CSDM (Common Service Data Model)
pageKind: entity
status: draft
abstract: The canonical data model that connects what naturally happens across asset, dev, ops, ITSM, and CSM.
sources:
  - frameworks/csdm
---

## What it is

CSDM — the Common Service Data Model — is the canonical data spine that connects Asset, Dev (APM), Ops (SPM), ITSM, and CSM. It originated to solve the technical-debt reporting problem that didn&#39;t have a single source of truth. **The vision was to create a common model that connects what naturally happens. CSDM was born.**

CSDM is not a data lake. It is not a federated query layer. It is a *model* that names the entities and the relationships that already exist between them, and lets every product on the platform agree on which row means what.

Currently at v5.

## How DPF uses it

DPF treats CSDM as the canonical reference model for Digital Product structure. The Prisma `DigitalProduct`, `Portfolio`, and `Service` models map directly onto CSDM&#39;s hierarchy (Business Application → Application Service → CI). When agents reason about cross-product impact, dependency mapping, or rationalisation, they reason in CSDM terms.

## Relationships

- Describes: `[[entities/digital-product]]`, `[[entities/portfolio]]`.
- Substrate for: APM, SPM, DPM — all converge on CSDM as the data spine.
- Aligned with: `[[entities/it4it]]` — CSDM&#39;s entities populate the IT4IT functional-component lattice.

## Examples

A single "Customer Portal" Digital Product has one Business Application row (the product itself), multiple Application Service rows (auth, catalog, checkout), and many CI rows under each service. The same row IDs are used by APM (Dev), SPM (Ops), and CSM (Customer) — so a customer support ticket about a checkout failure traces back to the same CI that the Dev team is patching in the same pull request.

## See also

- Stance: `[[stances/trust-the-cmdb-or-rebuild-it]]`
- Heuristic: `[[heuristics/model-what-naturally-happens]]`
- Heuristic: `[[heuristics/auto-populate-or-its-wrong]]`
