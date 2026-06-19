---
title: EU Cloud and AI Development Act (CADA) — four sovereignty assurance levels
pageKind: summary
status: published
abstract: CADA (proposed 3 June 2026) is the EU's binding cloud/AI sovereignty framework. It defines four "Union assurance levels" for public-sector cloud procurement, gating the top tiers on EU ownership and the absence of third-country interference — not on data location. Mandatory for public bodies; cascades to critical-sector and supplier organisations.
professionJurisdiction:
  - eu
professionCompetencyLevel: expert
sources:
  - eu/cada
---

## Jurisdiction & Competency

**Jurisdiction:** EU. CADA governs cloud and AI infrastructure used by EU public bodies and (via risk assessment and future sectoral legislation) NIS2 essential entities. **Competency:** expert — mapping a service or estate to an assurance level is specialist legal-compliance work.

> Status note: CADA is a Commission **proposal** (published 3 June 2026), not yet binding law. It now goes through Parliament, Council, and trilogue; realistic application is 2027–2028. Tier criteria may shift. Treat assurance-level classification of a specific service as requiring the primary text and qualified review.

## The four Union assurance levels

The decisive axis is **ownership and control of the operating entity, not where data is stored** — the kernel principle "data sovereignty follows control, not location."

1. **Level 1 — residency.** Infrastructure, assets, and customer data in the EU. Third-country-controlled providers must guarantee non-disclosure of unexploited vulnerabilities to third-country authorities.
2. **Level 2 — independence + transparency.** All personnel, infrastructure, and assets in the EU; EU cloud certification; measures preventing third-country data access; full software bill of materials (SBOM); source-code audits for third-country components; separation from non-EU subsidiaries.
3. **Level 3 — ownership.** The provider must be owned and controlled in the EU. Derogation only where the Commission recognises a third country meets conditions (GDPR adequacy, no compelled service degradation, open market access).
4. **Level 4 — no third-country interference.** No derogations; European cybersecurity certificate at "high"; effective control over all software components; no third-country entity holds effective control over software design, development, maintenance, or evolution.

## Countries affected

CADA binds the **27 EU member states** (Austria, Belgium, Bulgaria, Croatia, Cyprus, Czechia, Denmark, Estonia, Finland, France, Germany, Greece, Hungary, Ireland, Italy, Latvia, Lithuania, Luxembourg, Malta, Netherlands, Poland, Portugal, Romania, Slovakia, Slovenia, Spain, Sweden). The **Level 1 residency** test is satisfied across the EEA, which adds the three EEA-EFTA states (Iceland, Liechtenstein, Norway). Any provider or entity ultimately controlled from outside this set is a **"third country"** for the Level 3/4 ownership and interference tests — notably the US (CLOUD Act, FISA 702) and the UK (post-Brexit). The machine-usable list lives in `packages/db/src/eu-jurisdictions.ts`.

## How DPF's posture maps

- **Level 1** is satisfied by construction when a self-hosted DPF install runs on EU infrastructure.
- **Level 4's** "no AI-inference-data egress" is the literal behaviour of local-only inference (`residencyPolicy: "local_only"`, no silent cloud fallback).
- **Level 2's** supply-chain transparency and the **Level 3/4** vendor-control objection are answered by DPF being open source (run, audit, fork) — with a signed SBOM and an EU steward posture as the build-out to fully close Level 4.

## How DPF Coworkers Use It

- Treat any EU public-sector, financial (pairs with DORA), healthcare/critical-infrastructure (NIS2), or "sovereign cloud" context as triggering an assurance-level question early — it is a design-time and procurement-time gate, not a bolt-on.
- When assessing a customer's estate or an external application, score it on the ownership/control axis, not just data location.
- The AI-system dimension pairs with [[professions/legal-compliance/eu-ai-act-risk-tiers]]; the data-protection baseline with [[professions/legal-compliance/gdpr-lawful-basis-and-consent]].

## See Also

- [[professions/legal-compliance/eu-ai-act-risk-tiers]]
- [[professions/legal-compliance/gdpr-data-subject-rights]]
