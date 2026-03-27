# Business Model Roles — Design Spec

**Date:** 2026-03-26
**Status:** Implemented
**Epic:** EP-BIZ-ROLES
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Scope:** Introduce business-model-specific roles as an extensible layer above the six immutable platform governance roles, enabling role templates per business model type with support for custom business models created later.

**Depends on:**
- `packages/db/data/role_registry.json` (6 platform governance roles — unchanged)
- `docs/superpowers/specs/2026-03-21-digital-product-unified-ontology-design.md` (ontology anchor)
- `packages/db/data/portfolio_registry.json` (four-portfolio archetype)
- `packages/db/data/digital_product_registry.json` (product classification dimensions)

---

## Problem Statement

The platform defines six **platform governance roles** (HR-000 through HR-500) that map to IT4IT value stream authority domains: CDIO, Portfolio Manager, Digital Product Manager, Enterprise Architect, ITFM Director, and Operations Manager. These roles govern the platform itself and do not change.

However, the digital products managed by the platform serve radically different markets and operate under different business models. A SaaS subscription product needs a Customer Success Manager and a Growth Lead. A marketplace needs a Vendor Relations Manager and a Trust & Safety Lead. An internal developer platform needs a Developer Experience Lead. These **business model roles** do not exist today.

Without business-model-specific roles:
1. Product teams cannot define the right organizational structure for their product's operating model
2. Agent orchestration cannot route decisions to the correct domain expert (e.g., pricing decisions on a SaaS product should route to a Subscription Revenue Analyst, not the platform-level ITFM Director)
3. The platform cannot scale to manage diverse product portfolios where each product has a different go-to-market model

## Design Summary

A two-tier role architecture:

| Tier | Scope | Mutability | Examples |
|------|-------|------------|----------|
| **Platform Governance Roles** | Platform-wide | Immutable (6 roles, HR-000..HR-500) | CDIO, Portfolio Manager, Enterprise Architect |
| **Business Model Roles** | Per-product | Extensible (pre-defined templates + custom) | Customer Success Manager, Vendor Relations Manager |

Business model roles are defined as **templates** on a `BusinessModel` entity. When a digital product is associated with a business model, the template's roles become available for assignment to users on that product.

---

## Section 1: Pre-Defined Business Models & Roles

The platform ships with eight business model templates. Each template defines a set of roles appropriate for that operating model. Role IDs use the prefix `BMR-` followed by the business model code and a sequence number.

### 1.1 SaaS / Subscription (`bm-saas`)

| Role ID | Role Name | Authority Domain | IT4IT Alignment |
|---------|-----------|------------------|-----------------|
| BMR-SAAS-010 | Customer Success Manager | Retention strategy, renewal management, health scoring | Consume (SS5.6), Operate (SS5.7) |
| BMR-SAAS-020 | Growth & Acquisition Manager | Acquisition funnels, trial conversion, expansion revenue | Release (SS5.5), Consume (SS5.6) |
| BMR-SAAS-030 | Subscription Revenue Analyst | MRR/ARR tracking, churn analysis, pricing optimization | Evaluate (SS5.1) |
| BMR-SAAS-040 | Technical Account Manager | Enterprise customer technical advisory, integration support | Consume (SS5.6), Operate (SS5.7) |

### 1.2 Marketplace / Platform (`bm-marketplace`)

| Role ID | Role Name | Authority Domain | IT4IT Alignment |
|---------|-----------|------------------|-----------------|
| BMR-MKT-010 | Vendor Relations Manager | Supplier onboarding, partner quality, vendor lifecycle | Evaluate (SS5.1), Release (SS5.5) |
| BMR-MKT-020 | Trust & Safety Manager | Content moderation, fraud prevention, dispute resolution | Operate (SS5.7) |
| BMR-MKT-030 | Marketplace Operations Analyst | GMV tracking, take-rate optimization, liquidity metrics | Evaluate (SS5.1) |
| BMR-MKT-040 | Community Manager | Buyer/seller community engagement, feedback loops | Consume (SS5.6) |

### 1.3 E-commerce / Retail (`bm-ecommerce`)

| Role ID | Role Name | Authority Domain | IT4IT Alignment |
|---------|-----------|------------------|-----------------|
| BMR-ECOM-010 | Merchandising Manager | Product catalog curation, category management, assortment | Explore (SS5.2), Release (SS5.5) |
| BMR-ECOM-020 | Fulfillment Operations Manager | Order fulfillment, logistics coordination, returns | Deploy (SS5.4), Operate (SS5.7) |
| BMR-ECOM-030 | Customer Experience Manager | Shopping journey optimization, support escalation | Consume (SS5.6) |
| BMR-ECOM-040 | Pricing & Promotions Analyst | Dynamic pricing, campaign management, margin analysis | Evaluate (SS5.1) |

### 1.4 Professional Services / Consulting (`bm-services`)

| Role ID | Role Name | Authority Domain | IT4IT Alignment |
|---------|-----------|------------------|-----------------|
| BMR-SVC-010 | Engagement Manager | Client delivery ownership, scope management, satisfaction | Consume (SS5.6), Operate (SS5.7) |
| BMR-SVC-020 | Resource & Capacity Planner | Staffing allocation, utilization tracking, bench management | Evaluate (SS5.1) |
| BMR-SVC-030 | Service Delivery Manager | Milestone tracking, quality assurance, SLA adherence | Integrate (SS5.3), Deploy (SS5.4) |
| BMR-SVC-040 | Knowledge Manager | IP capture, methodology governance, reuse library | Explore (SS5.2) |

### 1.5 Media / Content / Publishing (`bm-media`)

| Role ID | Role Name | Authority Domain | IT4IT Alignment |
|---------|-----------|------------------|-----------------|
| BMR-MED-010 | Content Strategy Manager | Editorial calendar, content-market fit, format decisions | Explore (SS5.2) |
| BMR-MED-020 | Audience Development Manager | Distribution channels, SEO/discovery, subscriber growth | Release (SS5.5), Consume (SS5.6) |
| BMR-MED-030 | Rights & Licensing Manager | IP rights, syndication agreements, usage compliance | Evaluate (SS5.1) |
| BMR-MED-040 | Editorial Operations Manager | Production workflow, quality review, publishing cadence | Integrate (SS5.3), Deploy (SS5.4) |

### 1.6 Hardware + Software / IoT (`bm-iot`)

| Role ID | Role Name | Authority Domain | IT4IT Alignment |
|---------|-----------|------------------|-----------------|
| BMR-IOT-010 | Hardware Program Manager | BOM management, manufacturing coordination, certifications | Integrate (SS5.3) |
| BMR-IOT-020 | Firmware & OTA Release Manager | Firmware lifecycle, OTA deployment strategy, rollback | Deploy (SS5.4), Release (SS5.5) |
| BMR-IOT-030 | Field Service Manager | Device fleet health, warranty, on-site repair coordination | Operate (SS5.7) |
| BMR-IOT-040 | Supply Chain Coordinator | Supplier management, lead time optimization, inventory | Evaluate (SS5.1) |

### 1.7 Internal Platform / Developer Tools (`bm-devplatform`)

| Role ID | Role Name | Authority Domain | IT4IT Alignment |
|---------|-----------|------------------|-----------------|
| BMR-DEV-010 | Developer Experience Lead | DX metrics, onboarding friction, tooling decisions | Explore (SS5.2), Consume (SS5.6) |
| BMR-DEV-020 | Platform Reliability Engineer | SLO definition, incident response, capacity planning | Operate (SS5.7) |
| BMR-DEV-030 | Internal Adoption Manager | Migration planning, rollout communication, feedback | Release (SS5.5), Consume (SS5.6) |
| BMR-DEV-040 | Documentation Lead | API docs, runbooks, architecture decision records | Explore (SS5.2) |

### 1.8 API / Data-as-a-Service (`bm-api`)

| Role ID | Role Name | Authority Domain | IT4IT Alignment |
|---------|-----------|------------------|-----------------|
| BMR-API-010 | API Product Manager | API versioning strategy, deprecation policy, roadmap | Explore (SS5.2), Release (SS5.5) |
| BMR-API-020 | Developer Relations Manager | SDK maintenance, partner integrations, developer community | Consume (SS5.6) |
| BMR-API-030 | Usage Analytics Analyst | Consumption metering, rate-limit tuning, abuse detection | Operate (SS5.7) |
| BMR-API-040 | Integration Partner Manager | Partner certification, co-development, ecosystem strategy | Evaluate (SS5.1), Release (SS5.5) |

---

## Section 2: Role Relationship to Platform Governance

Business model roles do **not** replace or override platform governance roles. The relationship is hierarchical:

```
Platform Governance (immutable, platform-wide)
  HR-000  CDIO / Executive Sponsor
  HR-100  Portfolio Manager
  HR-200  Digital Product Manager         <-- escalation target for all BMR roles
  HR-300  Enterprise Architect
  HR-400  ITFM Director                   <-- escalation target for financial BMR roles
  HR-500  Operations Manager              <-- escalation target for operational BMR roles
    |
    v
Business Model Roles (extensible, per-product)
  BMR-SAAS-010  Customer Success Manager
  BMR-SAAS-020  Growth & Acquisition Manager
  ...
```

**Escalation rules:**
- All business model roles escalate to their product's assigned `Digital Product Manager` (HR-200) by default
- Financial authority domains (pricing, revenue, chargeback) escalate to `ITFM Director` (HR-400)
- Operational authority domains (incident, SLA, deployment) escalate to `Operations Manager` (HR-500)
- Custom escalation paths can be configured per business model

**HITL implications:**
- Business model roles operate at HITL tier 2 by default (agent can act, human reviews async)
- Platform governance roles retain their existing tier assignments (tier 0 or 1)
- A business model role holder can approve agent actions within their authority domain for their assigned product(s)

---

## Section 3: Data Model

### 3.1 New Prisma Models

```prisma
model BusinessModel {
  id                String                @id @default(cuid())
  modelId           String                @unique       // e.g. "bm-saas", "bm-marketplace"
  name              String                              // e.g. "SaaS / Subscription"
  description       String?
  isBuiltIn         Boolean               @default(false) // true for pre-defined, false for user-created
  status            String                @default("active") // active | deprecated | retired
  createdAt         DateTime              @default(now())
  updatedAt         DateTime              @updatedAt
  roles             BusinessModelRole[]
  products          ProductBusinessModel[]
}

model BusinessModelRole {
  id                String                          @id @default(cuid())
  roleId            String                          @unique  // e.g. "BMR-SAAS-010"
  name              String                                   // e.g. "Customer Success Manager"
  authorityDomain   String?                                  // free-text description
  it4itAlignment    String?                                  // e.g. "Consume (§5.6), Operate (§5.7)"
  hitlTierDefault   Int                             @default(2)
  escalatesTo       String?                                  // platform role ID (e.g. "HR-200")
  isBuiltIn         Boolean                         @default(false)
  status            String                          @default("active")
  businessModelId   String
  businessModel     BusinessModel                   @relation(fields: [businessModelId], references: [id], onDelete: Cascade)
  assignments       BusinessModelRoleAssignment[]

  @@index([businessModelId])
}

model ProductBusinessModel {
  id                String        @id @default(cuid())
  productId         String
  businessModelId   String
  assignedAt        DateTime      @default(now())
  product           DigitalProduct @relation(fields: [productId], references: [id], onDelete: Cascade)
  businessModel     BusinessModel  @relation(fields: [businessModelId], references: [id], onDelete: Cascade)

  @@unique([productId, businessModelId])
  @@index([businessModelId])
}

model BusinessModelRoleAssignment {
  id                    String            @id @default(cuid())
  userId                String
  businessModelRoleId   String
  productId             String
  assignedAt            DateTime          @default(now())
  revokedAt             DateTime?
  user                  User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  businessModelRole     BusinessModelRole @relation(fields: [businessModelRoleId], references: [id], onDelete: Cascade)
  product               DigitalProduct    @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([userId, businessModelRoleId, productId])
  @@index([productId])
  @@index([userId])
}
```

### 3.2 Modified Models

Add relations to existing models:

```prisma
// Add to DigitalProduct model:
  businessModels          ProductBusinessModel[]
  businessModelRoleAssignments  BusinessModelRoleAssignment[]

// Add to User model:
  businessModelRoleAssignments  BusinessModelRoleAssignment[]
```

### 3.3 Entity Relationship Summary

```
BusinessModel 1──M BusinessModelRole
BusinessModel M──M DigitalProduct       (via ProductBusinessModel)
BusinessModelRole M──M User             (via BusinessModelRoleAssignment, scoped to Product)
BusinessModelRole M──1 PlatformRole     (escalation path, via escalatesTo → roleId)
```

---

## Section 4: Seed Registry

A new file `packages/db/data/business_model_registry.json` provides the pre-defined business models and their roles. Structure:

```json
{
  "version": "1.0.0",
  "generated_at": "2026-03-26",
  "business_models": [
    {
      "model_id": "bm-saas",
      "name": "SaaS / Subscription",
      "description": "Recurring-revenue software products delivered as a hosted service",
      "is_built_in": true,
      "roles": [
        {
          "role_id": "BMR-SAAS-010",
          "name": "Customer Success Manager",
          "authority_domain": "Retention strategy, renewal management, health scoring",
          "it4it_alignment": "Consume (§5.6), Operate (§5.7)",
          "hitl_tier_default": 2,
          "escalates_to": "HR-200"
        }
      ]
    }
  ]
}
```

The seed function reads this registry and upserts all built-in business models and roles, following the same pattern as `role_registry.json` seeding in `packages/db/src/seed.ts`.

---

## Section 5: Extensibility — Custom Business Models

Users can create custom business models through the UI or API when their product's operating model does not match a pre-defined template.

### 5.1 Creation Rules

| Rule | Detail |
|------|--------|
| Custom model IDs | Auto-generated with prefix `bm-custom-` + slugified name |
| Custom role IDs | Auto-generated with prefix `BMR-CUST-` + sequence |
| `isBuiltIn` | Always `false` for user-created models and roles |
| Minimum roles | A custom business model must define at least one role |
| Role limit | Maximum 20 roles per business model (prevents abuse) |
| Cloning | Users can clone a built-in model and modify it, creating a custom variant |

### 5.2 Lifecycle

| Status | Meaning |
|--------|---------|
| `active` | Available for assignment to products |
| `deprecated` | No new assignments; existing assignments remain valid |
| `retired` | All assignments revoked; model hidden from selection |

Deprecation requires reassignment of any active role holders to an alternative model. Retirement is only allowed when no active assignments remain.

---

## Section 6: Agent Routing Integration

Business model roles enable more precise agent-to-human routing:

1. **Agent action proposals** can specify a required `authorityDomain` (e.g., "pricing")
2. The routing engine resolves the authority domain against the product's assigned business model roles
3. If a matching BMR role holder is assigned, they receive the approval request
4. If no BMR role holder is assigned, escalation falls through to the platform governance role

This replaces the current pattern where all product-level decisions route to the platform-wide HR-200 (Digital Product Manager), which does not scale.

---

## Section 7: UI Components

### 7.1 Business Model Assignment (Product Detail Page)

- Dropdown selector on the product detail page: "Business Model" field
- Shows all active business models (built-in + custom)
- Selecting a model reveals the role template with assignment slots
- Each role slot shows: role name, authority domain, assigned user (or "Unassigned")

### 7.2 Role Assignment Panel

- Accessible from product detail page when a business model is assigned
- Lists all roles in the business model template
- Each role has an "Assign User" action (user picker scoped to active platform users)
- Shows escalation path for each role

### 7.3 Custom Business Model Builder (Admin)

- Accessible from Settings > Business Models
- Form: name, description, roles (add/remove/reorder)
- Each role: name, authority domain, HITL tier, escalation target (dropdown of platform roles)
- Clone action on built-in models

### 7.4 Governance Dashboard Enhancement

- Authority Matrix visualization gains a new "Business Model Roles" section
- Shows per-product role assignments alongside platform governance roles
- Delegation chain visualizer shows BMR → Platform Role escalation paths

---

## Section 8: Migration

```sql
-- CreateTable: BusinessModel
CREATE TABLE "BusinessModel" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BusinessModelRole
CREATE TABLE "BusinessModelRole" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authorityDomain" TEXT,
    "it4itAlignment" TEXT,
    "hitlTierDefault" INTEGER NOT NULL DEFAULT 2,
    "escalatesTo" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "businessModelId" TEXT NOT NULL,
    CONSTRAINT "BusinessModelRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProductBusinessModel
CREATE TABLE "ProductBusinessModel" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "businessModelId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductBusinessModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BusinessModelRoleAssignment
CREATE TABLE "BusinessModelRoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessModelRoleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "BusinessModelRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessModel_modelId_key" ON "BusinessModel"("modelId");
CREATE UNIQUE INDEX "BusinessModelRole_roleId_key" ON "BusinessModelRole"("roleId");
CREATE INDEX "BusinessModelRole_businessModelId_idx" ON "BusinessModelRole"("businessModelId");
CREATE UNIQUE INDEX "ProductBusinessModel_productId_businessModelId_key" ON "ProductBusinessModel"("productId", "businessModelId");
CREATE INDEX "ProductBusinessModel_businessModelId_idx" ON "ProductBusinessModel"("businessModelId");
CREATE UNIQUE INDEX "BusinessModelRoleAssignment_userId_businessModelRoleId_productId_key" ON "BusinessModelRoleAssignment"("userId", "businessModelRoleId", "productId");
CREATE INDEX "BusinessModelRoleAssignment_productId_idx" ON "BusinessModelRoleAssignment"("productId");
CREATE INDEX "BusinessModelRoleAssignment_userId_idx" ON "BusinessModelRoleAssignment"("userId");

-- AddForeignKey
ALTER TABLE "BusinessModelRole" ADD CONSTRAINT "BusinessModelRole_businessModelId_fkey" FOREIGN KEY ("businessModelId") REFERENCES "BusinessModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductBusinessModel" ADD CONSTRAINT "ProductBusinessModel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductBusinessModel" ADD CONSTRAINT "ProductBusinessModel_businessModelId_fkey" FOREIGN KEY ("businessModelId") REFERENCES "BusinessModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessModelRoleAssignment" ADD CONSTRAINT "BusinessModelRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessModelRoleAssignment" ADD CONSTRAINT "BusinessModelRoleAssignment_businessModelRoleId_fkey" FOREIGN KEY ("businessModelRoleId") REFERENCES "BusinessModelRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessModelRoleAssignment" ADD CONSTRAINT "BusinessModelRoleAssignment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## Section 9: Backlog Items

### Phase 1 — Data Foundation (High Priority, no UI dependencies)

#### BI-BIZ-ROLES-001: Add Prisma schema models

Type: Feature | Priority: P0 | Status: Planned

Add four new models: `BusinessModel`, `BusinessModelRole`, `ProductBusinessModel`, `BusinessModelRoleAssignment`.

- Modify: `packages/db/prisma/schema.prisma`
- Add four new models per Section 3.1
- Add `businessModels` and `businessModelRoleAssignments` relations to `DigitalProduct` model (line ~486)
- Add `businessModelRoleAssignments` relation to `User` model (line ~56)
- Generate migration via `pnpm --filter @dpf/db exec prisma migrate dev --name add-business-model-roles`

Acceptance criteria:

- [ ] `BusinessModel` model with `modelId` unique key, `isBuiltIn` flag, `status` lifecycle
- [ ] `BusinessModelRole` model with `roleId` unique key, FK to `BusinessModel`, `escalatesTo` field
- [ ] `ProductBusinessModel` junction with unique constraint on `[productId, businessModelId]`
- [ ] `BusinessModelRoleAssignment` junction with unique constraint on `[userId, businessModelRoleId, productId]`
- [ ] Migration applies cleanly on fresh and existing databases
- [ ] `prisma generate` succeeds with no type errors

#### BI-BIZ-ROLES-002: Create business_model_registry.json seed data

Type: Feature | Priority: P0 | Status: Planned

- Create: `packages/db/data/business_model_registry.json`
- 8 business models (bm-saas, bm-marketplace, bm-ecommerce, bm-services, bm-media, bm-iot, bm-devplatform, bm-api)
- 4 roles per model = 32 roles total
- Follow same JSON structure conventions as `role_registry.json` and `digital_product_registry.json`
- Each role includes: `role_id`, `name`, `authority_domain`, `it4it_alignment`, `hitl_tier_default`, `escalates_to`

Acceptance criteria:

- [ ] Valid JSON, schema version 1.0.0
- [ ] All 8 models with `is_built_in: true`
- [ ] All 32 role IDs follow `BMR-{CODE}-{SEQ}` pattern
- [ ] Every `escalates_to` references a valid HR-xxx platform role ID

#### BI-BIZ-ROLES-003: Add seedBusinessModels() function to seed.ts

Type: Feature | Priority: P0 | Status: Planned

- Modify: `packages/db/src/seed.ts`
- Add `seedBusinessModels()` async function following the established pattern:
  - `readJson("business_model_registry.json")`
  - Outer loop: upsert `BusinessModel` records by `modelId`
  - Inner loop: upsert `BusinessModelRole` records by `roleId`, linking to parent `BusinessModel`
  - Console log count of seeded models and roles
- Insert call in `main()` after `seedPortfolios()` (line ~896) and before `seedDigitalProducts()`

Acceptance criteria:

- [ ] Idempotent — re-running seed does not create duplicates
- [ ] `isBuiltIn` set to `true` for all registry entries
- [ ] Console output: `Seeded 8 business models with 32 roles`
- [ ] Full `docker compose up` succeeds with portal-init seeding these records

---

### Phase 2 — Server Actions & API (Medium Priority, depends on Phase 1)

#### BI-BIZ-ROLES-004: Server actions for business model assignment to products

Type: Feature | Priority: P1 | Status: Planned

- Create: `apps/web/lib/actions/business-model.ts`
- Actions:
  - `assignBusinessModelToProduct(productId, businessModelId)` — creates `ProductBusinessModel` record
  - `removeBusinessModelFromProduct(productId, businessModelId)` — deletes junction record (cascades revoke assignments)
  - `getProductBusinessModels(productId)` — returns assigned models with their roles and current assignments
- Validation: product must exist, business model must be `active`, no duplicate assignment

Acceptance criteria:

- [ ] Assign/remove works correctly
- [ ] Removing a model revokes all role assignments for that model on that product
- [ ] Returns full role template with assignment status per role

#### BI-BIZ-ROLES-005: Server actions for business model role assignment to users

Type: Feature | Priority: P1 | Status: Planned

- Create or extend: `apps/web/lib/actions/business-model.ts`
- Actions:
  - `assignUserToBusinessModelRole(userId, businessModelRoleId, productId)` — creates `BusinessModelRoleAssignment`
  - `revokeUserFromBusinessModelRole(userId, businessModelRoleId, productId)` — sets `revokedAt` timestamp
  - `getProductRoleAssignments(productId)` — returns all role assignments for a product grouped by business model
  - `getUserBusinessModelRoles(userId)` — returns all BMR assignments for a user across products
- Validation: user must be active, role must be `active`, product must have the role's business model assigned

Acceptance criteria:

- [ ] Unique constraint prevents duplicate active assignments
- [ ] Revocation is soft-delete (sets `revokedAt`, does not remove row)
- [ ] Query returns both active and revoked assignments with clear status

#### BI-BIZ-ROLES-006: Server actions for custom business model CRUD

Type: Feature | Priority: P1 | Status: Planned

- Create or extend: `apps/web/lib/actions/business-model.ts`
- Actions:
  - `createCustomBusinessModel(name, description, roles[])` — creates model with `bm-custom-` prefix, `isBuiltIn: false`
  - `updateCustomBusinessModel(modelId, name, description)` — only for non-built-in models
  - `addRoleToBusinessModel(businessModelId, name, authorityDomain, escalatesTo)` — adds role with `BMR-CUST-` prefix
  - `removeRoleFromBusinessModel(roleId)` — only if no active assignments exist
  - `cloneBusinessModel(sourceModelId, newName)` — deep copies model + roles as custom variant
  - `deprecateBusinessModel(modelId)` — sets status to `deprecated`
  - `retireBusinessModel(modelId)` — sets status to `retired` only if no active assignments
- Validation: built-in models cannot be edited/deleted, max 20 roles per model, at least 1 role required

Acceptance criteria:

- [ ] Built-in models are read-only (update/delete blocked)
- [ ] Clone creates new model with `isBuiltIn: false` and new role IDs
- [ ] Role limit enforced at 20
- [ ] Retirement blocked if active assignments exist

#### BI-BIZ-ROLES-007: API route for business model data

Type: Feature | Priority: P1 | Status: Planned

- Create: `apps/web/app/api/v1/business-models/route.ts`
- `GET` — list all active business models with role counts
- Create: `apps/web/app/api/v1/business-models/[modelId]/route.ts`
- `GET` — single model with full role list
- Used by product detail page and custom builder for data fetching

Acceptance criteria:

- [ ] Filterable by `isBuiltIn` and `status`
- [ ] Includes role count and product assignment count per model
- [ ] Auth-gated to logged-in users

---

### Phase 3 — UI Components (Medium Priority, depends on Phase 2)

#### BI-BIZ-ROLES-008: BusinessModelSelector component for product detail page

Type: Feature | Priority: P1 | Status: Planned

- Create: `apps/web/components/product/BusinessModelSelector.tsx`
- Dropdown showing all active business models (built-in first, then custom, grouped)
- On select: calls `assignBusinessModelToProduct()` server action
- Shows currently assigned model(s) with remove button

Acceptance criteria:

- [ ] Groups built-in vs. custom models in dropdown
- [ ] Shows model name + role count in option label
- [ ] Optimistic UI update on assign/remove

#### BI-BIZ-ROLES-009: BusinessModelRolePanel component

Type: Feature | Priority: P1 | Status: Planned

- Create: `apps/web/components/product/BusinessModelRolePanel.tsx`
- Displays role template for assigned business model(s)
- Each role row: role name, authority domain, IT4IT alignment tag, assigned user (or "Unassigned" button)
- User picker (modal or inline dropdown) scoped to active platform users
- Shows escalation path: BMR role → Platform Role name

Acceptance criteria:

- [ ] Renders all roles for each assigned business model
- [ ] User assignment calls `assignUserToBusinessModelRole()` server action
- [ ] Shows escalation target as linked badge (e.g., "Escalates to: HR-200 Digital Product Manager")
- [ ] Revoke action available for assigned users

#### BI-BIZ-ROLES-010: Integrate BusinessModel components into product detail page

Type: Feature | Priority: P1 | Status: Planned

- Modify: product detail page (currently storefront-focused; may need a new admin product detail route)
- Add BusinessModelSelector and BusinessModelRolePanel as collapsible sections
- Data loading via server component pattern (fetch business models + assignments, pass to client components)

Acceptance criteria:

- [ ] Business model section visible on product admin/detail view
- [ ] Collapses cleanly when no business model is assigned
- [ ] Responsive layout consistent with existing admin panels

#### BI-BIZ-ROLES-011: Custom Business Model Builder page (admin)

Type: Feature | Priority: P2 | Status: Planned

- Create: `apps/web/app/(shell)/admin/business-models/page.tsx`
- Create: `apps/web/components/admin/BusinessModelBuilder.tsx`
- List view: all business models (built-in shown as read-only, custom editable)
- Create form: name, description, add roles (dynamic list), each role has name/authority domain/HITL tier/escalation dropdown
- Clone button on built-in models → pre-fills form with cloned data
- Edit/deprecate/retire actions for custom models

Acceptance criteria:

- [ ] Built-in models display as read-only cards with "Clone" action
- [ ] Custom model form validates: name required, at least 1 role, max 20 roles
- [ ] Escalation target dropdown populated from 6 platform roles
- [ ] Deprecation/retirement flows with confirmation dialog

---

### Phase 4 — Governance Integration (Medium Priority, depends on Phase 2)

#### BI-BIZ-ROLES-012: Extend governance resolver to consider BMR authority domains

Type: Feature | Priority: P1 | Status: Planned

- Modify: `apps/web/lib/governance-resolver.ts`
- When resolving `humanAllowed` for a product-scoped action:
  1. Check if the product has a business model assigned
  2. If yes, check if the acting user holds a BMR role whose `authorityDomain` covers the action
  3. If BMR role match found, grant authority at HITL tier from the BMR role
  4. If no BMR match, fall through to existing platform role resolution

Acceptance criteria:

- [ ] BMR authority checked before platform role fallback
- [ ] HITL tier from BMR role (default 2) applied correctly
- [ ] Actions without a product context skip BMR resolution entirely
- [ ] Governance decision log records which tier resolved the decision

#### BI-BIZ-ROLES-013: Extend agent proposal routing for BMR role holders

Type: Feature | Priority: P2 | Status: Planned

- Modify: `apps/web/app/api/v1/agent/proposals/route.ts` and related routing logic
- When an agent proposal is product-scoped, route to the BMR role holder whose authority domain matches
- If no BMR holder assigned, escalate to the platform governance role per `escalatesTo` field

Acceptance criteria:

- [ ] Product-scoped proposals routed to matching BMR holder
- [ ] Fallback to platform role when no BMR holder assigned
- [ ] Proposal includes `resolvedTo` metadata showing which role/user was targeted

#### BI-BIZ-ROLES-014: Extend Authority Matrix to show BMR roles

Type: Enhancement | Priority: P2 | Status: Planned

- Modify: `apps/web/app/(shell)/platform/ai/authority/page.tsx`
- Modify: `apps/web/components/platform/AuthorityMatrixPanel.tsx`
- Add a "Business Model Roles" tab or section below the existing platform roles heatmap
- Shows per-product: assigned business model, role holders, escalation paths

Acceptance criteria:

- [ ] New section renders below existing Authority Matrix
- [ ] Grouped by product, shows business model name + assigned roles
- [ ] Escalation path visualization: BMR role → Platform Role with arrow/line

#### BI-BIZ-ROLES-015: Extend Delegation Chain panel for BMR escalation paths

Type: Enhancement | Priority: P2 | Status: Planned

- Modify: `apps/web/components/platform/DelegationChainPanel.tsx`
- Add BMR roles as child nodes under their escalation target platform role
- Show: role name, assigned user, product scope, HITL tier badge

Acceptance criteria:

- [ ] BMR roles appear as expandable children under platform roles
- [ ] Each BMR node shows product scope and assigned user
- [ ] HITL tier badge consistent with existing tier display (tier 2 default)

#### BI-BIZ-ROLES-016: Extend Effective Permissions panel for BMR context

Type: Enhancement | Priority: P3 | Status: Planned

- Modify: `apps/web/components/platform/EffectivePermissionsPanel.tsx`
- Add product selector: when a product is selected, show effective permissions including BMR role capabilities
- The effective permission is the union of platform role + BMR role for the selected product

Acceptance criteria:

- [ ] Product dropdown added alongside existing role/agent selectors
- [ ] When product selected, BMR authority domains shown as additional capability rows
- [ ] Clear visual distinction between platform-granted and BMR-granted permissions

---

### Phase 5 — Testing & Documentation (all phases)

#### BI-BIZ-ROLES-017: Integration tests for business model seed and CRUD

Type: Test | Priority: P1 | Status: Planned

- Test seed idempotency: run seed twice, verify no duplicates
- Test CRUD server actions: create, assign, clone, deprecate, retire
- Test validation: built-in immutability, role limits, assignment constraints

Acceptance criteria:

- [ ] Seed produces exactly 8 models and 32 roles
- [ ] Re-seed is idempotent
- [ ] Custom model CRUD lifecycle passes end-to-end
- [ ] Edge cases: retire with active assignments blocked, duplicate assignment blocked

#### BI-BIZ-ROLES-018: Update platform setup and onboarding documentation

Type: Docs | Priority: P2 | Status: Planned

- Update any onboarding flows that reference roles to mention business model roles
- Add business model selection to product creation wizard if one exists

Acceptance criteria:

- [ ] Docs reference the two-tier role model
- [ ] Admin guide covers custom business model creation

---

## What This Does Not Include

- **Modifying the 6 platform governance roles** — these remain immutable
- **Business model impact on financial models** — pricing/chargeback per business model is a separate concern (see EP-FINOPS)
- **Automated business model detection** — AI-suggested model assignment based on product attributes is a future enhancement
- **Cross-product role aggregation** — a user holding the same BMR role across multiple products sees each assignment independently; aggregate views are deferred
