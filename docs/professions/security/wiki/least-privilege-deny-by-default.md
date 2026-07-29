---
title: Least privilege, deny by default
pageKind: principle
status: published
abstract: Every user, service, and credential is granted the minimum access required, and access is denied unless explicitly allowed. Broken access control is the top web application security risk.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: Grant the minimum access required and deny by default; never provision broad standing access for convenience.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 1.0, "public_safety": 0.9, "blast_radius": -0.8}
professionCompetencyLevel: foundational
sources:
  - owasp/secrets-management
  - owasp/top-ten
---

## Rule

Grant every user, service account, and credential the **minimum access required** to do its job, and **deny access by default** — a request is permitted only when an explicit grant allows it. Scope grants narrowly and revoke them when no longer needed.

## Why

The OWASP Top 10:2025 ranks **Broken Access Control (A01)** as the most critical web application security risk. Over-broad grants are how a single compromised account or service becomes a full breach. The OWASP Secrets Management guidance applies the same rule to secrets: use fine-grained access controls on each object rather than broad grants, so exposure of one credential does not unlock everything.

Least privilege is a containment control — it does not prevent the initial compromise, it bounds the blast radius.

## How To Apply

1. **Default deny.** New principals get no access until a grant is justified.
2. **Scope to the task.** A service that reads one table gets read on one table, not the database.
3. **Time-box and review.** Remove standing access; prefer just-in-time elevation with audit.
4. **Apply to secrets.** Each secret is reachable only by the principals that need it — see [[professions/security/never-hardcode-secrets]].

## See Also

- [[professions/security/never-hardcode-secrets]]
- [[professions/security/nist-csf-2-six-functions]]
- [[professions/security/threat-modeling]]
