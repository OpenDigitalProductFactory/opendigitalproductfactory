---
title: CIS Controls and implementation groups
pageKind: summary
status: published
abstract: The CIS Critical Security Controls are 18 prioritized controls (153 safeguards) organized into three implementation groups — IG1 (essential cyber hygiene) through IG3 — so an organization adopts a defensible baseline matched to its risk.
professionCompetencyLevel: practitioner
sources:
  - cis/controls
---

## What This Source Is

The **CIS Critical Security Controls** (v8.1) are a prioritized set of **18 controls** comprising **153 safeguards**, published by the Center for Internet Security. They translate high-level risk frameworks into concrete, ordered actions.

> Licensing note: the CIS Controls are free to download (with registration) but the fetched pages carried no explicit open license; this page uses the control structure (counts and group definitions) as facts, not licensed prose.

## Implementation Groups

The safeguards are tiered into three **Implementation Groups (IGs)** so an organization adopts a level matched to its resources and risk:

- **IG1** — the foundational set every enterprise should apply: essential cyber hygiene (56 safeguards).
- **IG2** — builds on IG1 for more complex environments handling sensitive data or under regulatory obligations.
- **IG3** — all 153 safeguards, for organizations facing sophisticated threats or heavy regulation.

The controls span asset inventory, data protection, secure configuration, continuous vulnerability management, audit logging, incident response, and penetration testing.

## How DPF Coworkers Use It

- Treat **IG1** as the non-negotiable baseline; escalate to IG2/IG3 by data sensitivity and threat exposure.
- Continuous Vulnerability Management (Control 7) is operationalized in [[professions/security/cve-cvss-triage]].
- Service-provider management (Control 15) feeds [[professions/security/vulnerability-and-supply-chain-auditing]].
- Map controls onto the [[professions/security/nist-csf-2-six-functions]] for executive reporting.

## See Also

- [[professions/security/nist-csf-2-six-functions]]
- [[professions/security/cve-cvss-triage]]
