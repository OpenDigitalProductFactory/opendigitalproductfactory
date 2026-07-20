---
title: "Setup And First Login"
area: getting-started
order: 5
---

## Use This Doc For

- `/setup`

## Workflow

1. Create the owner account and enter the company's business context, including location, markets, customers, risk posture, and data-residency needs.
2. Review AI providers only after that context is captured. Personal, consumer, and unknown hosted connections remain limited to public or synthetic material until their business terms are reviewed.
3. Use the COO's provider guidance when the decision is unclear. The COO consults the Data Governance Agent and returns validated source links, explicit unknowns, and one safest next action without sending customer data or secrets to obtain advice. If the available evidence is stale, mismatched, or incomplete, DPF says it cannot confirm the claim and keeps the safer provider posture.
4. If you are not ready to choose, select **Skip safely** or **Review later**. Skipping does not approve a hosted provider: company and customer data remain restricted until the missing review is complete.
5. Confirm the first internal user can authenticate and reach the internal shell.
6. Move into the relevant operational area only after setup and first-login checks succeed.

## Help Visibility Policy

- `/setup` should expose a visible help link because it is still an internal operator workflow.
- `/login`, `/forgot-password`, `/reset-password`, `/welcome`, and `/sandbox-restricted` should not expose internal docs links directly.
- `/portal/*`, `/customer-login`, `/customer-signup`, `/customer-complete-profile`, `/customer-link-account`, and public storefront `/s/*` routes should not expose internal docs links.
- Public, portal, auth, and token-action surfaces still need explicit documentation coverage decisions, but those decisions do not automatically mean a visible internal Docs button.
