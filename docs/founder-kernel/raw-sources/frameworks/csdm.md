---
sourceType: framework
title: "Common Service Data Model (CSDM)"
authors:
  - ServiceNow
url: https://www.servicenow.com/csdm
license: third-party
abstract: |
  ServiceNow's Common Service Data Model — the unified data spine connecting
  Asset, Dev, Ops, ITSM, and CSM. Originated to solve the technical-debt
  reporting problem that didn't have a single source of truth. Mark's framing:
  "The vision was to create a common model that connects what naturally
  happens. CSDM was born." Currently at v5. ServiceNow product documentation;
  abstract + locator per RAW-SOURCES-LICENSE.md.
---

## Why it's cited

Backs the **trust the CMDB or rebuild it** stance and the **model what naturally happens** heuristic. The "shared data foundation" position rests on CSDM as the substrate that makes Digital Product, Portfolio, and Service-Now-the-platform self-consistent.

## Key claims

- Connect what naturally happens across asset/dev/ops/ITSM/CSM — don't aggregate into a data lake.
- The CMDB is only useful if it's trusted; trust is built via Ingestion + Insight + Governance.
- CSDM is the canonical model; everything else is a projection.

## See also

- Stance: `[[stances/trust-the-cmdb-or-rebuild-it]]`
- Heuristic: `[[heuristics/model-what-naturally-happens]]`
- Heuristic: `[[heuristics/auto-populate-or-its-wrong]]`
- Entity: `[[entities/csdm]]`
