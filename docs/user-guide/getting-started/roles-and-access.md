---
title: "Roles & Access"
area: getting-started
order: 2
lastUpdated: 2026-03-26
updatedBy: Claude (COO)
---

## Two-Tier Role Architecture

The platform uses a **two-tier role model** to separate platform-wide governance from product-specific operating structures.

### Tier 1 — Platform Governance Roles

Six immutable roles (HR-000 through HR-500) map to IT4IT v3.0.1 value stream authority domains. These govern the platform itself and never change.

| Role ID | Name | Authority Domain |
| ------- | ---- | --------------- |
| HR-000 | CDIO / Executive Sponsor | Strategic direction, executive escalation |
| HR-100 | Portfolio Manager | Portfolio governance, investment allocation |
| HR-200 | Digital Product Manager | Product lifecycle, backlog, delivery |
| HR-300 | Enterprise Architect | Architecture guardrails, technology standards |
| HR-400 | ITFM Director | Financial governance, cost allocation |
| HR-500 | Operations Manager | SLA, incident, operational continuity |

Every user in the platform is assigned one of these platform governance roles via Admin > Access.

### Tier 2 — Business Model Roles

Business model roles (BMR) are product-scoped. They define the operating structure for a specific digital product based on its business model type (e.g., SaaS, Marketplace, IoT). Unlike platform governance roles, BMR roles:

- Are defined as templates on a **Business Model** (e.g., the SaaS template includes Product Owner, Customer Success Manager, Subscription Revenue Analyst, Growth Lead)
- Become active when a business model is **assigned to a product** in the product's detail page
- Are **assigned to users** per product — the same user may hold different BMR roles on different products
- Escalate to a platform governance role when a decision exceeds the BMR role holder's authority

To assign business model roles on a product, navigate to **Portfolio > [Product] > Role Assignments**.

## Platform Governance Role Access

Every user is assigned a platform governance role that determines what platform areas and capabilities they can access.

| Role | Access Level | Typical User |
| ---- | ------------ | ------------ |
| Admin (HR-000) | Full platform access including user management, branding, and governance settings | Platform administrator, CDIO |
| Manager (HR-100/200/300) | Access to portfolios, operations, HR, customers, and compliance | Portfolio managers, product managers, architects |
| Member (HR-400/500) | Access to workspace, assigned products, and relevant operational areas | Finance, operations team members |
| Viewer | Read-only access to assigned areas | Stakeholders, auditors |

## Superuser Status

Users with superuser status bypass all permission checks. This is intended for the initial platform setup and should be limited to one or two trusted administrators.

## Capabilities

Access is controlled by capabilities — specific permissions like `view_portfolio`, `manage_compliance`, or `manage_users`. Each platform governance role grants a set of capabilities. The admin can view the full capability matrix under Admin > Access.

The `manage_business_models` capability is granted to HR-000, HR-200, and HR-300, allowing them to create, clone, and manage business model templates.

## HITL (Human-in-the-Loop) Tiers

Both platform governance roles and business model roles carry a HITL tier that controls how much autonomy the AI agents have when acting within that role's authority domain:

| Tier | Label | Behaviour |
| ---- | ----- | --------- |
| 0 | Blocked | Agent cannot act — human must always decide |
| 1 | Approve before | Human must approve the proposal before execution |
| 2 | Review after | Agent acts immediately; human reviews asynchronously |
| 3 | Autonomous | Agent acts and logs; no human review required |

Business model roles default to HITL tier 2 (spot-check). Platform governance roles vary by risk profile.

## Customer Accounts

Customers who sign in through the storefront have a separate session type. They see the customer portal (not the internal shell) and can only access their own orders, bookings, and account information.
