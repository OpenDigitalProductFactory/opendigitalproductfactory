---
title: The site, not the contract, is the unit of operational truth
pageKind: heuristic
status: published
abstract: A guarding contract is sold per customer but delivered per site, and every access code, escalation path, and post order belongs to the site rather than to the account that pays for it.
professionCompetencyLevel: practitioner
professionArchetype:
  - security-services
sources:
  - bsi/bs-7499-static-and-mobile
---

## Heuristic

Hold sites as first-class records beneath the customer, because one customer routinely has many, and almost nothing an officer needs is true across all of them. Coverage, billing, and instructions are each scoped differently, so an account-level model forces guesswork at the gate.

Per site, keep what an officer arriving at 03:00 must have without phoning anyone:

- access route, gate and door specifics, parking, and safe approach;
- alarm codes and key or fob custody, held under stated authority;
- post orders — what to patrol, what to check, what to leave alone;
- hazards, dogs, occupancy, and lone-working constraints;
- escalation path with names and hours, and what the customer wants done before they are called;
- what counts as an incident *here*, which is rarely the generic definition.

Post orders decay. They are written once at mobilisation and then diverge from the site as codes rotate, contacts leave, and layouts change. Give them a review date and an owner, and treat an officer's report of a stale instruction as a defect to fix rather than a note to file.

Separate what the customer is buying from what the site needs. Contracted hours, rates, and recurring agreements sit with the account; the operational truth sits with the site. Conflating them makes it impossible to answer either "what are we owed?" or "what happens tonight?" without reconstructing the other.

## Interoperability posture

Model customer, site, post order, assignment, and recurring agreement as separate linked records with stable identifiers, so billing systems, workforce scheduling, and field applications can each read the slice they need without duplicating the site record.

## Source

- BSI BS 7499 — static site guarding and mobile patrol services
