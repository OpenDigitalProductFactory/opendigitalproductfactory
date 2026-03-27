# Interactive Business Model Test Plan

**Date:** 2026-03-26
**Updated:** 2026-03-26 — Phases 1–3 complete; gap checks replaced with real UI flows; 2 new suites added.
**Status:** Active
**Augments:** `docs/superpowers/specs/2026-03-17-agent-test-harness-design.md`
**Scope:** End-to-end interactive portal testing for five real-world business model scenarios using Playwright + AI Coworker, validating EP-BIZ-ROLES data layer, UI assignment flows, admin builder, and custom model creation.

---

## Overview

Five organisations, each a distinct business model archetype. Tests run against the live Docker stack at `http://localhost:3000`.

| # | Organization | Location | Business Model | Custom? | File |
|---|---|---|---|---|---|
| 1 | TeamLogicIT | Round Rock, TX | `bm-services` | No | `01-teamlogicit.spec.ts` |
| 2 | ManagingDigital | Online | `bm-media` | No | `02-managingdigital.spec.ts` |
| 3 | Brushy Creek HOA | Cedar Park, TX | `bm-hoa-custom` | Yes | `03-brushycreek-hoa.spec.ts` |
| 4 | Taylor Pet Rescue | Taylor, TX | `bm-nonprofit-rescue` | Yes | `04-taylor-pet-rescue.spec.ts` |
| 5 | Round Rock Pool Pros | Round Rock, TX | `bm-services` | No — shares with TLI | `05-pooltime-round-rock.spec.ts` |

---

## Test Principles

- **Non-blocking:** Each test step uses soft assertions (`expect.soft`). Failures are logged and execution continues.
- **Reset between runs:** A reset helper wipes all test-created entities before each suite.
- **AI Coworker:** Each scenario includes at least one AI Coworker interaction to validate agent routing in context.
- **Gap logging:** Steps that require unbuilt UI (Phase 2-3 features) are marked `TODO` and logged as observations, not failures.

---

## Reset Strategy

Before each suite, the reset helper deletes any records whose name starts with the test org prefix:

```sql
DELETE FROM "DigitalProduct" WHERE name LIKE 'TLI-%' OR name LIKE 'MD-%' OR name LIKE 'BCHOA-%';
DELETE FROM "ProductBusinessModel" WHERE "productId" NOT IN (SELECT id FROM "DigitalProduct");
```

The 6 platform roles, 8 built-in business models, and 32 BMR roles are **never touched** by reset.

---

## Suite 1 — TeamLogicIT (IT Managed Services)

**Organization:** TeamLogicIT, Round Rock TX — franchise managed IT service provider
**Business model:** `bm-services` (Professional Services / Consulting)
**Expected BMR roles:** Engagement Manager, Resource & Capacity Planner, Service Delivery Manager, Knowledge Manager

### Test Steps

| Step | Action | Expected | Gap? |
|------|--------|----------|------|
| 1.1 | Login as admin@dpf.local | Redirect to /workspace | — |
| 1.2 | Navigate to portfolio: Products & Services Sold | Portfolio page loads | — |
| 1.3 | Open AI Coworker, ask: "What service delivery roles does a managed IT service provider need?" | Agent responds with relevant roles | — |
| 1.4 | Create digital product: "TLI-IT Support Services" | Product created, appears in inventory | — |
| 1.5 | Create digital product: "TLI-Network Infrastructure Management" | Product created | — |
| 1.6 | Create digital product: "TLI-Cybersecurity Advisory" | Product created | — |
| 1.7 | Navigate to product detail for TLI-IT Support Services | Detail page loads | — |
| 1.8 | Look for Business Model selector on product page | Selector not yet present | **GAP: BI-BIZ-ROLES-010** |
| 1.9 | Verify via API: GET /api/v1/business-models returns bm-services | 200 with bm-services in list | **GAP: BI-BIZ-ROLES-007** |
| 1.10 | Open AI Coworker on product page, ask: "What SLA framework suits a managed IT engagement model?" | Agent responds in context | — |
| 1.11 | Navigate to /platform/ai/authority | Authority Matrix loads | — |
| 1.12 | Verify Business Model Roles section absent (not yet built) | Section not present | **GAP: BI-BIZ-ROLES-014** |

### AI Coworker Prompts

1. `"What service delivery roles does a managed IT service provider need?"`
   — Expected: mentions Service Delivery Manager, Engagement Manager, SLA accountability
2. `"What SLA framework suits a managed IT engagement model?"`
   — Expected: mentions ITIL, response-time tiers, escalation paths

---

## Suite 2 — ManagingDigital (Training Organization)

**Organization:** ManagingDigital — digital transformation training and advisory
**Business model:** `bm-media` (Media / Content / Publishing)
**Expected BMR roles:** Content Strategy Manager, Audience Development Manager, Rights & Licensing Manager, Editorial Operations Manager

### Test Steps

| Step | Action | Expected | Gap? |
|------|--------|----------|------|
| 2.1 | Login (session reused or re-login) | Auth session valid | — |
| 2.2 | Navigate to portfolio: For Employees | Portfolio page loads | — |
| 2.3 | Open AI Coworker, ask: "What roles does a digital training organization need to manage content products?" | Agent responds with content/editorial roles | — |
| 2.4 | Create product: "MD-Digital Leadership Programme" | Product created | — |
| 2.5 | Create product: "MD-AI Readiness Assessment" | Product created | — |
| 2.6 | Create product: "MD-Executive Coaching" | Product created | — |
| 2.7 | Navigate to product detail for MD-Digital Leadership Programme | Detail page loads | — |
| 2.8 | Look for Business Model selector | Not present | **GAP: BI-BIZ-ROLES-010** |
| 2.9 | Open AI Coworker, ask: "How should we structure audience development for a digital leadership programme?" | Agent responds with distribution/growth advice | — |
| 2.10 | Navigate to /ops backlog, verify EP-BIZ-ROLES-008 and -009 are open | Items present in backlog | — |

### AI Coworker Prompts

1. `"What roles does a digital training organization need to manage content products?"`
   — Expected: mentions Content Strategy Manager, Audience Development, Editorial Operations
2. `"How should we structure audience development for a digital leadership programme?"`
   — Expected: mentions channels, cohort tracking, subscriber growth, completion metrics

---

## Suite 3 — Brushy Creek HOA (Custom Business Model Gap)

**Organization:** Brushy Creek HOA — residential homeowners association
**Business model:** None of the 8 built-ins fit — drives requirement for custom model
**Custom model needed:** `bm-hoa-custom` with roles: Community Operations Manager, Resident Relations Coordinator, Facilities & Amenities Manager, Governance & Compliance Lead

### Test Steps

| Step | Action | Expected | Gap? |
|------|--------|----------|------|
| 3.1 | Login | Auth session valid | — |
| 3.2 | Open AI Coworker on /workspace, ask: "Which business model best describes a homeowners association?" | Agent identifies no exact match; suggests Professional Services or custom | — |
| 3.3 | Navigate to /admin — look for Business Models section | Section not present | **GAP: BI-BIZ-ROLES-011** |
| 3.4 | Create product: "BCHOA-Community Management Platform" | Product created | — |
| 3.5 | Create product: "BCHOA-Amenity Booking System" | Product created | — |
| 3.6 | Create product: "BCHOA-Resident Communications Portal" | Product created | — |
| 3.7 | Look for Business Model selector on any BCHOA product | Not present | **GAP: BI-BIZ-ROLES-010** |
| 3.8 | Open AI Coworker, ask: "What unique roles does an HOA need compared to a standard services organization?" | Agent responds with HOA-specific roles | — |
| 3.9 | Verify API: business models endpoint lists all 8 built-ins, none match HOA | Confirms extensibility need | **GAP: BI-BIZ-ROLES-007** |
| 3.10 | Document custom model definition: name, description, 4 roles | Written to test output | — |

### AI Coworker Prompts

1. `"Which business model best describes a homeowners association?"`
   — Expected: acknowledges unique nature, suggests closest match or custom
2. `"What unique roles does an HOA need compared to a standard services organization?"`
   — Expected: mentions governance, facilities, resident relations, community engagement

### Custom Model Definition (for BI-BIZ-ROLES-011 when built)

```json
{
  "model_id": "bm-hoa-custom",
  "name": "Community / HOA Management",
  "description": "Non-profit community associations managing shared amenities, governance, and resident services",
  "roles": [
    { "name": "Community Operations Manager", "authority_domain": "Day-to-day operations, vendor management, budget execution", "escalates_to": "HR-200" },
    { "name": "Resident Relations Coordinator", "authority_domain": "Resident communications, dispute resolution, satisfaction", "escalates_to": "HR-200" },
    { "name": "Facilities & Amenities Manager", "authority_domain": "Pool, clubhouse, green spaces — maintenance and scheduling", "escalates_to": "HR-500" },
    { "name": "Governance & Compliance Lead", "authority_domain": "CC&R enforcement, board resolutions, legal compliance", "escalates_to": "HR-400" }
  ]
}
```

---

## Gap Register (drives Phase 2-3 backlog)

| Gap ID | Description | Backlog Item | Phase |
|--------|-------------|--------------|-------|
| GAP-001 | No Business Model selector on product detail page | BI-BIZ-ROLES-010 | 3 |
| GAP-002 | No API route GET /api/v1/business-models | BI-BIZ-ROLES-007 | 2 |
| GAP-003 | No Business Model Roles section in Authority Matrix | BI-BIZ-ROLES-014 | 4 |
| GAP-004 | No /admin/business-models custom builder page | BI-BIZ-ROLES-011 | 3 |
| GAP-005 | No role assignment UI per product | BI-BIZ-ROLES-009 | 3 |

---

## Run Instructions

```bash
# From repo root
npx playwright test e2e/ --reporter=list --timeout=30000

# Run single suite
npx playwright test e2e/01-teamlogicit.spec.ts --headed

# Reset only (no tests)
npx playwright test e2e/helpers/reset.spec.ts
```
