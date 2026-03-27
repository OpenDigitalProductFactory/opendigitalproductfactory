---
title: "Business Model Roles"
area: products
order: 2
lastUpdated: 2026-03-26
updatedBy: Claude (COO)
---

## What are Business Model Roles?

Business Model Roles (BMR) define the operating structure for a digital product based on how it goes to market. While platform governance roles (HR-000 through HR-500) govern the platform itself, business model roles are product-scoped — different products may have different role holders even for equivalent authority domains.

For example, a SaaS product might have a **Subscription Revenue Analyst** responsible for pricing decisions, while a Marketplace product has a **Vendor Relations Manager** responsible for supplier governance. Both roles escalate to the ITFM Director (HR-400) for financial decisions that exceed their authority.

## Built-in Business Model Templates

The platform ships with eight pre-defined business model templates:

| Template | Focus | Key Roles |
| -------- | ----- | --------- |
| SaaS | Subscription software | Product Owner, Customer Success, Revenue Analyst, Growth Lead |
| Marketplace | Multi-sided platform | Marketplace Manager, Vendor Relations, Trust & Safety, Liquidity Lead |
| E-Commerce | Direct sales | E-Commerce Manager, Merchandising Lead, Fulfilment Manager, Revenue Analyst |
| Professional Services | Billable delivery | Engagement Manager, Delivery Lead, Practice Manager, Billing Manager |
| Media & Content | Content monetisation | Content Strategist, Audience Development, Monetisation Manager, Editorial Lead |
| IoT / Connected Products | Hardware + software | IoT Product Manager, Connectivity Lead, Field Operations, Revenue Lead |
| Developer Platform | Internal tooling | Developer Experience Lead, Platform Reliability, Adoption Lead, Monetisation Manager |
| API / Data Products | API-first products | API Product Manager, Data Governance Lead, Developer Relations, Monetisation Lead |

Each template is read-only. To customise, clone a template and adjust roles in Admin > Business Models.

## Assigning a Business Model to a Product

1. Navigate to **Portfolio > [your product]**
2. In the **Business Model** section, select from the dropdown labelled "+ Assign business model…"
3. The selected model and its roles appear as chips. You can assign multiple models to a product.
4. To remove an assignment, click the × on the model chip.

## Assigning Users to Roles

Once a business model is assigned to a product, its roles are available in the **Role Assignments** section below:

1. Find the role you want to fill
2. Use the "Assign user…" dropdown to select a user
3. The user's email appears next to the role — they now hold that authority domain for this product
4. To remove an assignment, click **Revoke**

Each role can only have one active assignment at a time. The assignment is effective immediately.

## HITL Tier

Each role carries a default HITL (Human-in-the-Loop) tier that controls AI agent autonomy for actions within that authority domain. All built-in roles default to **HITL tier 2** (spot-check):

- The agent acts immediately on proposals within the authority domain
- The assigned role holder receives an async notification to review
- No pre-approval is needed unless the action escalates to a platform governance role

## Escalation

If an agent's action exceeds the BMR role holder's authority, it escalates to the platform governance role indicated in the role's escalation path:

- Most roles escalate to **HR-200** (Digital Product Manager)
- Roles with financial authority escalate to **HR-400** (ITFM Director)
- Roles with operational authority escalate to **HR-500** (Operations Manager)

When no user is assigned to a BMR role, the action escalates directly to the platform governance role.

## Creating Custom Business Models

Users with the `manage_business_models` capability (HR-000, HR-200, HR-300) can:

- **Clone** a built-in template to create a custom variant
- **Create from scratch** with up to 20 custom roles
- **Edit** the name and description of custom models
- **Deprecate** a custom model (no new assignments; existing assignments continue)
- **Retire** a custom model (only when no active assignments remain)

Access the business model manager at **Admin > Business Models**.
