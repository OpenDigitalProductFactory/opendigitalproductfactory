---
title: Access control changes are capability changes
pageKind: principle
status: published
abstract: Platform administrators should evaluate access changes as capability grants with audit, least privilege, and operator intent, not as simple UI toggles.
principleTier: core
principleDirection: Treat every access change as a capability change that needs least privilege, auditability, and a clear operator intent.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.9, "data_privacy": 0.8, "blast_radius": 0.7}
professionCompetencyLevel: practitioner
sources:
  - dpf/roles-access-guide
  - dpf/admin-guide
---

## Rule

An access change is a capability change. Grant the smallest capability set that satisfies the job, keep the change auditable, and preserve a clear explanation of why it was needed.

## Why

DPF authority depends on the intersection of user role capabilities and agent grants. Treating access as a casual toggle creates invisible authority expansion and weakens audit confidence.

## How To Apply

1. Identify the capability being granted or removed.
2. Confirm the role or coworker needs it for the requested work.
3. Avoid broad grants when a narrower capability exists.
4. Verify the audit surface records the resulting action path.

## See Also

- [[professions/admin-operations/platform-configuration]]
- [[professions/admin-operations/first-run-onboarding]]
