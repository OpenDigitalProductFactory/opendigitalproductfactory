---
title: Email consent — CAN-SPAM (US, opt-out)
pageKind: principle
status: published
abstract: US CAN-SPAM is an opt-out model — commercial email is permitted without prior consent if you use accurate headers, non-deceptive subject lines, identify the message as an ad, include a valid postal address, and honor opt-outs. The structural opposite of GDPR opt-in.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: For US commercial email, follow CAN-SPAM — accurate headers, ad identification, postal address, and a working, promptly-honored opt-out; never assume EU opt-in applies.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 1.0, "data_privacy": 0.6}
professionJurisdiction:
  - us
professionCompetencyLevel: practitioner
sources:
  - cookieyes/can-spam
---

## Jurisdiction & Competency

**Jurisdiction:** United States. The EU counterpart is the opposite model — see [[professions/marketing/email-consent-gdpr]]. **Competency:** practitioner.

## The US Model Is Opt-Out

Under CAN-SPAM you **may send commercial email without prior consent**, provided you honor the Act's disclosure and unsubscribe rules. This is the structural opposite of the EU's opt-in.

## Mandatory Requirements

- **Accurate routing/header and "From" information**; the message must not mislead about its origin.
- **Non-deceptive subject lines.**
- **Clear identification that the message is an advertisement.**
- **A valid physical postal address.**
- **A clear opt-out mechanism**, honored promptly (within ~10 business days) and kept live for a period after sending.
- **Liability for third parties** — you remain responsible for email an agency sends on your behalf.

> Source note: the FTC primary page blocked the fetcher; this is distilled from a secondary compliance guide. Confirm the exact opt-out timing against the FTC original before treating as legal advice.

## Contrast With GDPR

A CAN-SPAM-compliant opt-out flow does **not** satisfy GDPR's opt-in consent. When a recipient could fall under both regimes, apply the stricter rule (GDPR opt-in) — see [[professions/marketing/email-consent-gdpr]].

## See Also

- [[professions/marketing/email-consent-gdpr]]
- [[professions/marketing/marketing-ethics]]
