---
title: Treat licence and vetting currency as a deployment gate, not a personnel record
pageKind: heuristic
status: published
abstract: An unlicensed or unvetted officer on a post is a contractual and regulatory breach the moment the shift starts; currency must be checked before assignment, not audited afterwards.
professionCompetencyLevel: practitioner
professionArchetype:
  - security-services
sources:
  - bsi/bs-7858-screening
  - bsi/bs-7499-static-and-mobile
---

## Heuristic

Hold licence and screening state per officer as dated facts with an explicit expiry, and evaluate them at the moment of assignment. A roster that fills a post from a list of names, rather than from a list of officers currently cleared for that post, will eventually place someone unlicensed on site.

Record separately, because they expire on different clocks:

- the individual licence or permit, with issuing authority, number, class, and expiry;
- screening and background checks, with the date completed and the period they cover;
- site-specific clearances, inductions, and any customer-imposed vetting;
- training and competency records the deployment depends on, such as first aid, conflict management, or a physical-intervention qualification;
- restrictions attached to any of the above.

Deployment is a chain, and the weakest dated fact governs it:

- officer licensed for the *class* of work the post requires;
- screening current and unbroken across the period claimed;
- site clearance granted and not withdrawn by the customer;
- required competencies in date;
- working-time and rest position permitting the shift.

Expiries are scheduled work, not alerts. A licence lapsing in six weeks is a rostering constraint now, because the replacement must be cleared before the gap opens. Warn on the lead time the *remedy* needs, not on the expiry date.

Never infer currency from a previous shift. Presence on last week's roster is evidence of past deployment, not of present eligibility.

## Interoperability posture

Keep officers, licences, screening records, competencies, site clearances, and assignments as separate linked records with stable identifiers, so licence-authority checks, screening providers, and customer vetting portals can be reconciled without rewriting the deployment history.

## Source

- BSI BS 7858 — screening of individuals working in a secure environment
- BSI BS 7499 — static site guarding and mobile patrol services
