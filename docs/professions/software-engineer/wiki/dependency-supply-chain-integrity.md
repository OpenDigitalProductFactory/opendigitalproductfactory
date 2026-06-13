---
title: Secure the software supply chain
pageKind: principle
status: published
abstract: Dependencies, build systems, and artifacts are part of the attack surface. Verify integrity and generate provenance per SLSA build levels; supply-chain and integrity failures are top OWASP risks.
principleTier: core
principleDirection: Treat dependencies and the build pipeline as attack surface — pin, verify integrity, and produce signed provenance.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"public_safety": 0.8, "blast_radius": 0.8, "governance_compliance": 0.7}
professionCompetencyLevel: expert
sources:
  - owasp/top-ten
  - slsa/framework
---

## Rule

The software supply chain — third-party dependencies, the build platform, and the produced artifacts — is part of the system's attack surface. Verify the integrity of what you consume and produce, and emit provenance describing how each artifact was built.

## Why

The OWASP Top 10:2025 elevates **Software Supply Chain Failures (A03)**, expanding the earlier "vulnerable components" category to cover dependencies and build systems, and lists **Software or Data Integrity Failures (A08)** separately. A compromised dependency or build step bypasses every control in the application itself.

**SLSA (Supply-chain Levels for Software Artifacts)** is a checklist of controls to prevent tampering across packages and infrastructure, expressed as build levels:

- **Build L1** — provenance exists, describing the build platform, process, and inputs.
- **Build L2** — adds signed provenance produced by a hosted build platform.
- **Build L3** — adds a hardened, isolated build platform resistant to tampering.

## How To Apply

1. **Pin and verify** dependencies; check integrity (hashes/signatures), not just version strings.
2. **Generate provenance** for build artifacts; target a SLSA build level appropriate to the artifact's blast radius.
3. **Sign and verify** at L2+ so a consumer can confirm an artifact came from the expected pipeline.
4. **Test the integrity path** — see [[professions/software-engineer/automated-testing-verification]].

## See Also

- [[professions/software-engineer/owasp-top-ten]]
- [[professions/software-engineer/secure-coding-no-injection-validate-input]]
