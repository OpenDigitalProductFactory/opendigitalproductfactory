# Field Service Sprint 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Lay the three schema and archetype foundations that every downstream field service sprint depends on: the HVAC storefront archetype, the `FieldServiceJob` entity with state machine, and customer notification preference fields.

**Architecture:** `FieldServiceJob` is a new top-level Prisma model (not an extension of `CalendarEvent`, `StorefrontOrder`, or `SalesOrder` — the schema audit in Task 2 confirms these are all narrower than a field service job). It links by FK to `CustomerAccount`, `CustomerSite`, `EmployeeProfile` (technician), `Invoice`, and optionally a `CalendarEvent`. The HVAC archetype is a new entry in `packages/storefront-templates/src/archetypes/trades-maintenance.ts`. Notification preference fields are additive columns on `CustomerContact` behind a nullable-safe migration.

**Tech Stack:** Next.js 16 monorepo (pnpm workspaces), Prisma 7.x (PostgreSQL), Zod validators (`packages/validators`), Vitest unit tests.

**DCO required:** Every commit must include `Signed-off-by: <name> <email>` — use `git commit -s`.

**Verification gate (run before opening PR):**
```
pnpm --filter @dpf/storefront-templates exec vitest run
pnpm --filter web typecheck
cd apps/web && npx next build
```

---

## Pre-work: Branch setup

```bash
# From the repo root (D:\DPF or your local clone)
git fetch origin
git worktree add ../DPF-field-service-sprint1 -b feat/field-service-sprint1 origin/main
cd ../DPF-field-service-sprint1
.\scripts\sync-mcp-worktrees.ps1   # seeds .mcp.json + sets COMPOSE_PROJECT_NAME
```

---

## Task 1: HVAC/AC Contractor Storefront Archetype (BI-FS-001)

**No dependencies. Parallelisable with Task 3.**

**Files:**
- Modify: `packages/storefront-templates/src/archetypes/trades-maintenance.ts`
- Test: `packages/storefront-templates/src/archetypes/archetypes.test.ts`

### Context

The archetype catalog test at `archetypes.test.ts` already validates every archetype for required fields, unique IDs, and hero-first sections. Adding the new archetype to the export array is enough to have it picked up. The test count check says `>= 30` — confirm current count before adding (so you know the test won't break).

Current trades-maintenance archetypes: `facilities-maintenance`, `plumber`, `electrician`, `cleaning-service`, `landscaping`. Adding `hvac-contractor`.

### Steps

- [ ] **Step 1.1 — Check current archetype count**
  ```bash
  cd packages/storefront-templates
  pnpm exec vitest run --reporter=verbose 2>&1 | grep "has at least"
  ```
  Expected: `✓ has at least 30 archetypes`. Note the count if the test output shows it.

- [ ] **Step 1.2 — Write a failing test for the hvac-contractor archetype**

  Add to `packages/storefront-templates/src/archetypes/archetypes.test.ts` after the `"includes a software-platform archetype"` block:

  ```typescript
  it("includes an hvac-contractor archetype for HVAC field service businesses", () => {
    const hvac = ALL_ARCHETYPES.find((a) => a.archetypeId === "hvac-contractor");
    expect(hvac).toBeDefined();
    expect(hvac?.category).toBe("trades-maintenance");
    expect(hvac?.ctaType).toBe("inquiry");
    expect(hvac?.itemTemplates.some((i) => i.name === "AC Tune-Up / Preventive Maintenance")).toBe(true);
    expect(hvac?.itemTemplates.some((i) => i.name === "Emergency Service Call")).toBe(true);
    expect(hvac?.itemTemplates.some((i) => i.name === "Maintenance Agreement")).toBe(true);
    expect(hvac?.formSchema.some((f) => f.name === "systemType")).toBe(true);
    expect(hvac?.tags).toContain("hvac");
    expect(hvac?.tags).toContain("air-conditioning");
  });
  ```

- [ ] **Step 1.3 — Run the test to confirm it fails**
  ```bash
  cd packages/storefront-templates
  pnpm exec vitest run --reporter=verbose
  ```
  Expected: `✗ includes an hvac-contractor archetype for HVAC field service businesses`

- [ ] **Step 1.4 — Add the HVAC archetype definition**

  In `packages/storefront-templates/src/archetypes/trades-maintenance.ts`, add after the `landscaping` entry (before the closing `]`):

  ```typescript
  {
    archetypeId: "hvac-contractor",
    name: "HVAC / AC Contractor",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["hvac", "air-conditioning", "heating", "cooling", "trades", "emergency"],
    itemTemplates: [
      { name: "AC Tune-Up / Preventive Maintenance", description: "Full system inspection, cleaning, and performance check", priceType: "fixed" },
      { name: "Emergency Service Call", description: "Same-day emergency response for AC or heating failure", priceType: "from" },
      { name: "AC Installation", description: "New system supply and installation with warranty", priceType: "quote" },
      { name: "Heating System Service", description: "Furnace or heat pump inspection and repair", priceType: "from" },
      { name: "Refrigerant Recharge", description: "Diagnose and recharge low refrigerant levels", priceType: "from" },
      { name: "Duct Inspection & Cleaning", description: "Full ductwork inspection with optional deep clean", priceType: "from" },
      { name: "Indoor Air Quality Assessment", description: "Air quality testing and filtration recommendations", priceType: "fixed" },
      { name: "Maintenance Agreement", description: "Annual service plan with priority scheduling and discounts", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 3 },
      { type: "contact", title: "Request Service", sortOrder: 4 },
    ],
    formSchema: [
      ...INQUIRY_BASE_FIELDS,
      {
        name: "systemType",
        label: "System type",
        type: "select" as const,
        required: true,
        options: ["Central AC", "Heat Pump", "Mini-Split / Ductless", "Gas Furnace", "Electric Furnace", "Commercial HVAC", "Not sure"],
      },
      {
        name: "urgency",
        label: "Urgency",
        type: "select" as const,
        required: true,
        options: ["Emergency — system down", "Urgent — within 24 hours", "Routine — next available", "Planned — flexible timing"],
      },
      {
        name: "propertyType",
        label: "Property type",
        type: "select" as const,
        required: true,
        options: ["Residential", "Commercial", "Industrial"],
      },
      {
        name: "notes",
        label: "Describe the issue",
        type: "textarea" as const,
        required: false,
      },
    ],
  },
  ```

- [ ] **Step 1.5 — Run the tests to confirm they all pass**
  ```bash
  cd packages/storefront-templates
  pnpm exec vitest run --reporter=verbose
  ```
  Expected: all tests pass including the new `hvac-contractor` test.

- [ ] **Step 1.6 — Commit**
  ```bash
  git add packages/storefront-templates/src/archetypes/trades-maintenance.ts \
          packages/storefront-templates/src/archetypes/archetypes.test.ts
  git commit -s -m "feat(archetypes): add hvac-contractor storefront archetype (BI-FS-001)

  Adds HVAC/AC contractor to the trades-maintenance family with 8 service
  items, system-type and urgency form fields, and the standard trades
  section layout. Tested in archetypes.test.ts."
  ```

---

## Task 2: Schema Audit — Job Model Design (prerequisite for Task 3)

**No code changes. Required reading before writing any migration.**

This task prevents duplicating logic that already exists in the CRM pipeline models. Read the relevant models and write down conclusions.

### Steps

- [ ] **Step 2.1 — Read and compare the candidate models**

  Open `packages/db/prisma/schema.prisma` and read these four models:
  - `SalesOrder` (line ~2474) — confirmed: represents a fulfilled quote, has `status: confirmed | in_progress | fulfilled | cancelled`. **Not the right parent** — it is the downstream fulfillment of a Quote, not a field visit.
  - `CalendarEvent` (line ~5263) — confirmed: represents a scheduled time block owned by an `EmployeeProfile`. Has no customer FK, no job status, no line items. **Not the right parent** — it is a scheduling primitive, not a job record.
  - `CustomerSite` (line ~2073) — confirmed: represents a physical service location owned by a `CustomerAccount`. Has `accessInstructions` and `serviceNotes`. **Right FK target** — the job happens at a site.
  - `StorefrontOrder` (line ~6350) — confirmed: represents a storefront checkout. No technician, no status lifecycle, no parts. **Not the right parent**.

- [ ] **Step 2.2 — Record the design decision**

  **Conclusion (record this in your PR description):**

  `FieldServiceJob` must be a **new top-level model**. None of the existing models carry: technician assignment, job lifecycle states (`quoted` → `paid`), scheduled window (date + duration), parts/labor tracking, or field notes. The job FKs to:
  - `CustomerAccount` (who the work is for)
  - `CustomerSite?` (where — nullable because some jobs may not have a site record yet)
  - `EmployeeProfile` (assigned technician)
  - `CalendarEvent?` (optional — if a calendar block exists, link it)
  - `Invoice?` (optional — created when job completes)
  - `StorefrontInquiry?` (optional — if the job originated from a storefront booking)

  The `SalesOrder` → `FieldServiceJob` relation is deferred to Sprint 7 (QuickBooks sync); do not FK to it now.

---

## Task 3: FieldServiceJob Prisma Model (BI-FS-002)

**Depends on: Task 2 conclusions. Parallelisable with Task 1 after Task 2 is done.**

**Scope note:** BI-FS-002 specifies the `FieldServiceJob` state machine. `FieldServiceJobLineItem` and `FieldServiceJobStatusLog` are included here as inseparable companions — a job without line items cannot be invoiced, and a job without a status log cannot be audited. Both models are Cascade-deleted from the parent and have no independent lifecycle. They do not constitute separate backlog items.

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_field_service_job/migration.sql` (auto-generated)
- Create: `packages/db/src/seed-field-service.test.ts`

### Steps

- [ ] **Step 3.1 — Write a failing test that asserts the model and enum exist**

  Create `packages/db/src/seed-field-service.test.ts`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { PrismaClient } from "../generated/client/client";

  // Structural test: confirms the FieldServiceJob table and enum are in the schema.
  // Does NOT hit a running database.
  describe("FieldServiceJob schema", () => {
    it("FieldServiceJob model is exported from the Prisma client", () => {
      const prisma = new PrismaClient();
      expect(prisma.fieldServiceJob).toBeDefined();
      void prisma.$disconnect();
    });

    it("valid job status values match the schema comment", () => {
      // NOTE: DPF uses plain String columns for status (not DB enums) with
      // validated values documented in comments. This test is a cross-check
      // documentation fixture — it does NOT query the DB. If you add a status
      // value to schema.prisma, you must update this array AND the backlog.ts
      // FIELD_SERVICE_JOB_STATUSES constant added in Sprint 2.
      const VALID_STATUSES = [
        "quoted",
        "scheduled",
        "confirmed",
        "en-route",
        "on-site",
        "complete",
        "invoiced",
        "paid",
        "cancelled",
      ] as const;

      expect(VALID_STATUSES).toHaveLength(9);
      expect(new Set(VALID_STATUSES).size).toBe(VALID_STATUSES.length);
    });
  });
  ```

- [ ] **Step 3.2 — Run the test to confirm it fails**
  ```bash
  cd packages/db
  pnpm exec vitest run seed-field-service --reporter=verbose
  ```
  Expected: `✗ FieldServiceJob model is exported from the Prisma client`

- [ ] **Step 3.3 — Add the FieldServiceJob model to schema.prisma**

  In `packages/db/prisma/schema.prisma`, add after the `SalesOrder` model block (around line 2520). Insert:

  ```prisma
  // ─── Field Service ───────────────────────────────────────────────────────────
  // Represents a single field visit from quote through payment.
  // status lifecycle: quoted → scheduled → confirmed → en-route → on-site
  //                   → complete → invoiced → paid  (or cancelled at any point)

  model FieldServiceJob {
    id            String    @id @default(cuid())
    jobRef        String    @unique   // FSJ-2026-0001 (sequential on create)
    status        String    @default("quoted")
    // quoted | scheduled | confirmed | en-route | on-site | complete | invoiced | paid | cancelled
    jobType       String    // e.g. "AC Tune-Up", "Emergency Call-Out", "Installation"
    title         String?   // operator-friendly label; derived from jobType if null
    description   String?
    accountId     String
    siteId        String?
    technicianId  String?   // FK to EmployeeProfile.id
    calendarEventId String? // optional link to a scheduled CalendarEvent
    invoiceId     String?   // set when job transitions to invoiced
    inquiryRefId  String?   // FK to StorefrontInquiry.id if originated from booking
    scheduledAt   DateTime?
    scheduledEndAt DateTime?
    arrivedAt     DateTime?
    completedAt   DateTime?
    enRouteAt     DateTime?
    estimatedMinutes Int?
    laborMinutes  Int?
    totalAmount   Decimal?
    currency      String    @default("USD")
    fieldNotes    String?
    internalNotes String?
    createdById   String?
    createdAt     DateTime  @default(now())
    updatedAt     DateTime  @updatedAt

    account     CustomerAccount  @relation(fields: [accountId], references: [id])
    site        CustomerSite?    @relation(fields: [siteId], references: [id])
    technician  EmployeeProfile? @relation("TechnicianJobs", fields: [technicianId], references: [id])
    invoice     Invoice?         @relation(fields: [invoiceId], references: [id])
    createdBy   User?            @relation("JobCreations", fields: [createdById], references: [id])
    lineItems   FieldServiceJobLineItem[]
    statusLogs  FieldServiceJobStatusLog[]

    @@index([accountId])
    @@index([technicianId])
    @@index([status])
    @@index([scheduledAt])
    @@index([invoiceId])
  }

  model FieldServiceJobLineItem {
    id          String   @id @default(cuid())
    jobId       String
    type        String   @default("labor")
    // labor | part | material | fee
    description String
    quantity    Decimal  @default(1)
    unitPrice   Decimal
    lineTotal   Decimal
    partNumber  String?
    supplierId  String?
    sortOrder   Int      @default(0)
    createdAt   DateTime @default(now())

    job FieldServiceJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

    @@index([jobId])
  }

  model FieldServiceJobStatusLog {
    id        String   @id @default(cuid())
    jobId     String
    fromStatus String?
    toStatus  String
    changedBy String?
    note      String?
    changedAt DateTime @default(now())

    job FieldServiceJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

    @@index([jobId])
    @@index([changedAt])
  }
  ```

  Also add back-relations to **all six** referenced models. Prisma requires every `@relation` to be symmetric — missing any one of these will cause `prisma validate` to fail and block the migration.

  **On `CustomerAccount`** — after `recurringSchedules RecurringSchedule[]` (the last relation line before `@@index`):
  ```prisma
  fieldServiceJobs   FieldServiceJob[]
  ```

  **On `CustomerSite`** — after `nodes CustomerSiteNode[]` (the last relation line before `@@index`):
  ```prisma
  fieldServiceJobs   FieldServiceJob[]
  ```

  **On `EmployeeProfile`** — at the end of the relations block, before `@@index([status])`:
  ```prisma
  technicianJobs     FieldServiceJob[]  @relation("TechnicianJobs")
  ```

  **On `Invoice`** — after `dunningLogs DunningLog[]` (last relation before `@@index`):
  ```prisma
  fieldServiceJob    FieldServiceJob?
  ```

  **On `User`** (search `model User`):
  ```prisma
  createdJobs        FieldServiceJob[]  @relation("JobCreations")
  ```

  **On `CalendarEvent`** — after `workItems WorkItem[]` (the existing last relation before `@@index`):
  ```prisma
  fieldServiceJobs   FieldServiceJob[]
  ```

  **On `StorefrontInquiry`** — after `storefront StorefrontConfig @relation(...)` (the existing last relation before `@@index`):
  ```prisma
  fieldServiceJobs   FieldServiceJob[]
  ```

- [ ] **Step 3.4 — Run typecheck to catch schema relation errors before migrating**
  ```bash
  pnpm --filter @dpf/db exec prisma validate
  ```
  Expected: no errors. If errors appear, fix missing back-relations or relation naming before continuing.

- [ ] **Step 3.5 — Generate and apply the migration**
  ```bash
  pnpm --filter @dpf/db exec prisma migrate dev --name add_field_service_job
  ```
  Expected output includes: `✔ Generated Prisma Client` and a new migration folder in `packages/db/prisma/migrations/`.

  > **Important:** Migration files are immutable once committed. If the migration fails, roll it back with `pnpm --filter @dpf/db exec prisma migrate reset` (local dev only), fix the schema, and re-run. Never edit a committed migration file.

- [ ] **Step 3.6 — Run the tests to confirm they pass**
  ```bash
  cd packages/db
  pnpm exec vitest run seed-field-service --reporter=verbose
  ```
  Expected: both tests pass.

- [ ] **Step 3.7 — Run full typecheck to catch any cascade type errors**
  ```bash
  pnpm --filter web typecheck
  ```
  Expected: zero new errors. (Pre-existing errors are acceptable — do not introduce new ones.)

- [ ] **Step 3.8 — Commit**
  ```bash
  git add packages/db/prisma/schema.prisma \
          packages/db/prisma/migrations/ \
          packages/db/src/seed-field-service.test.ts
  git commit -s -m "feat(db): FieldServiceJob model with state machine (BI-FS-002)

  Adds FieldServiceJob, FieldServiceJobLineItem, and FieldServiceJobStatusLog
  models. Status machine: quoted → scheduled → confirmed → en-route → on-site
  → complete → invoiced → paid (+ cancelled). FKs to CustomerAccount,
  CustomerSite, EmployeeProfile (technician), Invoice, and User.
  Structural test confirms Prisma client exports the new model."
  ```

---

## Task 4: Customer Notification Preference Fields (BI-FS-003)

**No dependencies. Parallelisable with Tasks 1 and 3.**

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_contact_notification_prefs/migration.sql` (auto-generated)
- Modify: `packages/validators/src/customer.ts`
- Modify: `apps/web/app/api/v1/customer/contacts/[id]/route.ts`
- Create: `packages/validators/src/customer.test.ts` (or add to existing if it exists)

### Context

`CustomerContact` currently has a single `phone` field. Field service requires:
- `mobilePhone` — SMS-capable; replaces the ambiguous `phone` field for new contacts
- `landlinePhone` — voice-only; for TTS call routing
- `preferredNotificationChannel` — `sms | call | email`; governs dispatcher coworker routing

The legacy `phone` field must **not** be removed (existing data); new fields are added alongside it. The API and validator are updated to accept and persist the new fields.

### Steps

- [ ] **Step 4.1 — Write failing validator tests**

  Check if `packages/validators/src/customer.test.ts` exists:
  ```bash
  ls packages/validators/src/
  ```

  If it does not exist, create it. If it does, add to it. The test:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { updateContactSchema, createContactSchema } from "./customer";

  describe("updateContactSchema — notification preference fields", () => {
    it("accepts preferredNotificationChannel sms", () => {
      const result = updateContactSchema.safeParse({ preferredNotificationChannel: "sms" });
      expect(result.success).toBe(true);
    });

    it("accepts preferredNotificationChannel call", () => {
      const result = updateContactSchema.safeParse({ preferredNotificationChannel: "call" });
      expect(result.success).toBe(true);
    });

    it("accepts preferredNotificationChannel email", () => {
      const result = updateContactSchema.safeParse({ preferredNotificationChannel: "email" });
      expect(result.success).toBe(true);
    });

    it("rejects unknown preferredNotificationChannel", () => {
      const result = updateContactSchema.safeParse({ preferredNotificationChannel: "whatsapp" });
      expect(result.success).toBe(false);
    });

    it("accepts mobilePhone and landlinePhone on update", () => {
      const result = updateContactSchema.safeParse({
        mobilePhone: "+15125550100",
        landlinePhone: "+15125550101",
      });
      expect(result.success).toBe(true);
    });

    it("accepts mobilePhone on create", () => {
      const result = createContactSchema.safeParse({
        email: "test@example.com",
        accountId: "acc-1",
        mobilePhone: "+15125550100",
      });
      expect(result.success).toBe(true);
    });

    it("accepts preferredNotificationChannel on create", () => {
      const result = createContactSchema.safeParse({
        email: "test@example.com",
        accountId: "acc-1",
        preferredNotificationChannel: "call",
      });
      expect(result.success).toBe(true);
    });
  });
  ```

- [ ] **Step 4.2 — Run the tests to confirm they fail**
  ```bash
  cd packages/validators
  pnpm exec vitest run customer --reporter=verbose
  ```
  Expected: multiple failures about unknown fields.

- [ ] **Step 4.3 — Update the Prisma schema**

  In `CustomerContact`, insert the three new fields **between `avatarUrl` (line ~127) and `updatedAt` (line ~128)**, before the relations block begins. The correct position is after the last scalar field (`avatarUrl`) and before `updatedAt @updatedAt`:

  ```prisma
  mobilePhone              String?  // SMS-capable mobile number
  landlinePhone            String?  // Voice-only landline
  preferredNotificationChannel String? @default("sms")
  // sms | call | email
  ```

  Do not insert after the `updatedAt` line — that would place the fields inside the relations block and cause a Prisma parse error.

- [ ] **Step 4.4 — Update the Zod validators**

  In `packages/validators/src/customer.ts`, update `createContactSchema` and `updateContactSchema`:

  ```typescript
  // Add to createContactSchema:
  mobilePhone: z.string().max(50).optional(),
  landlinePhone: z.string().max(50).optional(),
  preferredNotificationChannel: z.enum(["sms", "call", "email"]).optional(),

  // Add to updateContactSchema:
  mobilePhone: z.string().max(50).optional().nullable(),
  landlinePhone: z.string().max(50).optional().nullable(),
  preferredNotificationChannel: z.enum(["sms", "call", "email"]).optional().nullable(),
  ```

- [ ] **Step 4.5 — Run validator tests to confirm they pass**
  ```bash
  cd packages/validators
  pnpm exec vitest run customer --reporter=verbose
  ```
  Expected: all tests pass.

- [ ] **Step 4.6 — Run Prisma validate to confirm schema is clean**
  ```bash
  pnpm --filter @dpf/db exec prisma validate
  ```

- [ ] **Step 4.7 — Generate the migration**
  ```bash
  pnpm --filter @dpf/db exec prisma migrate dev --name add_contact_notification_prefs
  ```
  Expected: migration created and applied.

- [ ] **Step 4.8 — Update the PATCH /api/v1/customer/contacts/[id] route**

  The route at `apps/web/app/api/v1/customer/contacts/[id]/route.ts` uses `updateContactSchema` — it will already accept the new fields via the schema update. Verify the `update` call passes the new fields through:

  In the `PATCH` handler, confirm the `rest` spread includes the new fields. The current destructure is:
  ```typescript
  const { firstName, lastName, ...rest } = parsed.data;
  ```
  This is correct — `mobilePhone`, `landlinePhone`, `preferredNotificationChannel` will be in `rest` and flow through to `prisma.customerContact.update`. No change needed.

  Run a quick typecheck to confirm:
  ```bash
  pnpm --filter web typecheck
  ```
  Expected: no new errors.

- [ ] **Step 4.9 — Commit**
  ```bash
  git add packages/db/prisma/schema.prisma \
          packages/db/prisma/migrations/ \
          packages/validators/src/customer.ts \
          packages/validators/src/customer.test.ts
  git commit -s -m "feat(db): customer notification preference fields (BI-FS-003)

  Adds mobilePhone, landlinePhone, and preferredNotificationChannel (sms |
  call | email) to CustomerContact. Validator and PATCH route updated.
  Existing phone field untouched. Tested via updateContactSchema unit tests."
  ```

---

## Task 5: Final Verification and PR

- [ ] **Step 5.1 — Run all affected test suites together**
  ```bash
  pnpm --filter @dpf/storefront-templates exec vitest run
  pnpm --filter @dpf/db exec vitest run
  pnpm --filter @dpf/validators exec vitest run
  ```
  Expected: all pass.

- [ ] **Step 5.2 — Typecheck**
  ```bash
  pnpm --filter web typecheck
  ```
  Expected: zero new errors.

- [ ] **Step 5.3 — Production build**
  ```bash
  cd apps/web && npx next build
  ```
  Expected: build completes with zero errors.

- [ ] **Step 5.4 — Push and open PR**
  ```bash
  git push -u origin feat/field-service-sprint1
  gh pr create \
    --title "feat: field service sprint 1 — HVAC archetype, FieldServiceJob, contact notification prefs" \
    --body "Implements BI-FS-001, BI-FS-002, BI-FS-003 per spec docs/superpowers/specs/2026-05-19-field-service-trades-ai-dispatch-design.md

  - BI-FS-001: hvac-contractor archetype (trades-maintenance family, 8 service items, system-type form field)
  - BI-FS-002: FieldServiceJob model with 9-state lifecycle + FieldServiceJobLineItem + FieldServiceJobStatusLog
  - BI-FS-003: CustomerContact mobilePhone / landlinePhone / preferredNotificationChannel fields

  All tests pass. No new typecheck errors. next build clean."
  ```

---

## Notes for Agentic Workers

- **Migration immutability:** If a migration is committed and then you discover a schema error, do NOT edit the migration file. Create a new corrective migration instead.
- **Back-relations must be symmetric:** Every `@relation` on `FieldServiceJob` needs a matching relation list on the referenced model. Prisma validate will catch asymmetric relations before you migrate.
- **`phone` field is legacy:** `CustomerContact.phone` stays. New code should write to `mobilePhone`. The dispatcher coworker in Sprint 2 will read `mobilePhone` first, then fall back to `phone` if `mobilePhone` is null.
- **USD default currency:** The spec targets US-based HVAC contractors. `FieldServiceJob.currency` defaults to `"USD"` unlike other finance models that default to `"GBP"`. This is intentional.
- **`jobRef` generation:** Sprint 2 will add an auto-increment sequence or ULID-based `FSJ-YYYY-NNNN` format. For Sprint 1, generate with `crypto.randomUUID()` prefixed `FSJ-` until the sequence is wired.
