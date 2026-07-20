---
title: "Admin"
area: admin
order: 1
---

## Overview

The Admin area is the control centre for platform configuration. It is where administrators manage users, define access rules, configure branding, and maintain the reference data that underpins other areas. Most settings here apply platform-wide.

## Key Concepts

- **User Management** — Creating, editing, and deactivating user accounts. Each user has a role, optional superuser status, and profile information.
- **Role & Capability Matrix** — The mapping of roles to capabilities. Admins can review the full matrix and understand what each role can and cannot do.
- **Branding Configuration** — The organization's name, logo, colours, and display preferences. Applied across the internal shell and the customer-facing storefront.
- **Reference Data** — Lookup tables and configurable values used throughout the platform (e.g., product categories, status labels, regulation types). Changes here affect all areas.
- **Storefront Admin** — Configuration for the public-facing storefront, including domain routing, archetype selection, and presentation settings.

## What You Can Do

- Create and manage user accounts, set roles, and grant or revoke superuser status
- Review the capability matrix to understand and communicate access rules
- Update branding settings and preview how they appear across the platform
- Maintain reference data tables used by portfolios, compliance, HR, and other areas
- Configure storefront settings including domain routing and public storefront behaviour

## Hive result review

Open **Admin > Hive Contributions** to review result-only contributions received
from trusted reseller channels. The intake record is saved before any GitHub
operation. It may contain a code result, verification evidence, DCO/provenance,
attribution, and a review recommendation; source backlog items, priorities,
estimates, discussions, work capsules, and customer-private context are rejected
before persistence.

Choose **Accept** to approve the result and attempt delivery to the configured
forge, or **Reject** to retain the audit without delivery. A GitHub outage leaves
the accepted contribution intact and shows retry state in the ledger. Use
**Retry forge delivery** after credentials or connectivity recover.
