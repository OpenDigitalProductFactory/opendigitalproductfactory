---
title: Manage production flow by operation state, constraint, and quality disposition
pageKind: heuristic
status: published
abstract: A manufacturing queue is only actionable when each released job shows its current operation, material and equipment constraints, quality disposition, and last trustworthy observation.
professionCompetencyLevel: practitioner
professionArchetype:
  - manufacturing
sources:
  - isa/isa-95-overview
  - nist/sp-800-82r3
---

## Heuristic

Organize work using the ISA-95 hierarchy and job-control boundary: enterprise, site, area, work center or line, work unit or cell, and equipment. A production order should resolve to its current operation and resource; do not collapse the plant into a flat list of machines or treat a sales order as proof that physical work has started.

For each released job, show the planned and actual quantity, current operation, material readiness, assigned work center, equipment availability, quality disposition, and the time and quality of the latest observation. Separate `blocked` from `starved`: blocked work cannot move its output downstream, while starved work lacks an input required to proceed. Preserve both states because their remedies are different.

A failed inspection creates an explicit hold. The system may summarize evidence and recommend containment, but a qualified person owns disposition, rework authorization, deviation approval, and release. Never infer a pass from missing telemetry, an old reading, or the absence of a recorded failure.

Industrial telemetry is evidence, not authority. Keep source-observed and platform-received timestamps separate, show stale or uncertain quality plainly, and refuse to present a disconnected machine as healthy. Business software may observe and coordinate; writes to PLCs, robots, safety controllers, or other operational technology require a separately engineered safety and authorization boundary.

## Human authority

Operators confirm physical completion and material movement. Quality personnel control inspection disposition and release. Engineering controls product and process revisions. Maintenance controls equipment return-to-service. The platform must preserve these distinct authorities and their evidence trail.

## Sources

- International Society of Automation, *ISA-95 Standard: Enterprise-Control System Integration*: https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard
- NIST, *SP 800-82 Rev. 3 — Guide to Operational Technology (OT) Security*: https://csrc.nist.gov/pubs/sp/800/82/r3/final
