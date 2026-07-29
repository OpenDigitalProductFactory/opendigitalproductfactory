---
title: Never hardcode secrets
pageKind: principle
status: published
abstract: Secrets must never live in source code or config files. Centralize them in a managed store, encrypt at rest and in transit, rotate automatically, and detect leaks before commit.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: Keep secrets out of source and config; centralize, encrypt, rotate, and scan for leaks pre-commit.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"public_safety": 1.0, "governance_compliance": 0.9, "blast_radius": -0.8}
professionCompetencyLevel: foundational
sources:
  - owasp/secrets-management
  - owasp/top-ten
---

## Rule

**Eliminate hardcoded secrets** from source code and configuration files. Secrets — API keys, tokens, passwords, private keys — live in a managed secrets store, are injected at runtime, and never enter version control.

## Why

The OWASP Secrets Management guidance is direct: eliminate hardcoding secrets in source and config; centralize and standardize a secrets-management solution; encrypt secrets at rest and in transit, keeping encryption keys separate from the secrets they protect; and automate rotation, because manual maintenance increases the risk of leakage. A leaked secret is a credential compromise that bypasses every other control — related to **Cryptographic Failures (A04:2025)** in the OWASP Top 10.

## How To Apply

1. **Externalize.** Read secrets from a managed store or injected environment, never a literal in code.
2. **Encrypt and separate.** Encrypt at rest and in transit; store key material apart from the secrets.
3. **Rotate automatically.** Short-lived, rotated credentials limit the value of any single leak.
4. **Shift detection left.** Pre-commit hooks and CI scanners catch secrets before they land.
5. **Scope access** per [[professions/security/least-privilege-deny-by-default]].

## See Also

- [[professions/security/least-privilege-deny-by-default]]
- [[professions/security/vulnerability-and-supply-chain-auditing]]
