# HR Workforce Core Design

**Date:** 2026-03-13  
**Status:** Draft  
**Scope:** Define the first workforce-domain layer that sits on top of the unified identity, access, and agent-governance foundation.

---

## Overview

The identity-governance foundation now gives DPF a control plane for humans, teams, roles, delegation, and agent accountability. The next layer is the workforce domain itself: the platform needs a durable employee record, org structure, and employment lifecycle model so the employee portal can represent real people rather than just login accounts.

This spec treats HR workforce data as a domain overlay on top of:

- `User` as the authenticated internal account
- `Team` and `TeamMembership` as governance and operating-unit constructs
- `PlatformRole` and `UserGroup` as coarse application access
- agent governance as the downstream consumer of workforce reporting structure and accountable-human context

The workforce layer is not just "HR admin". It becomes the human operating model that AI coworkers will attach to. Employee identity and reporting structure are therefore product-critical, not back-office decoration.

Implementation slice 1 models:

- `EmployeeProfile`
- `Department`
- `Position`
- `EmploymentType`
- `WorkLocation`
- `EmploymentEvent`
- `TerminationRecord`

---

## Approved Working Assumptions

From the current conversation:

- employee profile is the first priority because it anchors the portal experience
- org structure is the second priority because it anchors the AI coworker authority model
- lifecycle must be designed now, but can be phased after profile and structure
- open-source HR systems should be used as references where helpful
- if a reference product's UX does not fit DPF, its data-model patterns may still be borrowed

---

## Design Goals

1. Add a durable workforce identity layer without overloading `User` with HR-specific fields.
2. Separate governance teams from HR org structure so operating authority and reporting structure can evolve independently.
3. Represent primary reporting lines clearly enough for AI coworker accountability.
4. Make employee profile data useful both to human portal UX and agent runtime context.
5. Support employment lifecycle transitions without forcing payroll or full HRIS scope immediately.
6. Remain compatible with future external HR imports or sync from another system.
7. Keep the first slice focused on small-to-mid-sized business needs.

---

## Non-Goals

- payroll and tax calculation
- benefits administration
- recruiting ATS implementation
- deep leave/attendance scheduling workflows
- learning management
- performance-review systems
- replacing the identity-governance foundation
- customer-contact HR semantics

These may come later, but they should not distort the first workforce slice.

---

## OSS Reference Research

### Reference systems reviewed

- **Frappe HR / ERPNext HR**
  - Strongest reference for employee master data plus lifecycle fields.
  - Official docs show broad HR coverage including onboarding, transfers, promotions, exits, payroll, expense, attendance, and performance.
  - Repo structure shows an employee master that includes `user_id`, `department`, `designation`, `reports_to`, `date_of_joining`, `contract_end_date`, `holiday_list`, and `relieving_date`, with explicit validation around reporting and status transitions.

- **OrangeHRM Starter**
  - Best reference for SMB-oriented HR decomposition and employee-detail APIs.
  - Source structure shows a clean split between personal details, job details, supervisors/subordinates, termination, attachments, qualifications, and work shifts.
  - The API model split is especially useful for DPF because it separates the employee core record from job detail, reporting relationships, and termination records.

- **IceHrm**
  - Useful as a process reference for employee management, hierarchy, documents, and audit logs.
  - Better as a secondary reference than as the primary design model for DPF.

- **Odoo / OCA HR**
  - Strong modular reference for departments, equipment, certifications, contracts, and offboarding extensions.
  - Best used as an ecosystem reference, not as the direct product model for DPF.

### What to borrow

From those systems, the strongest recurring patterns are:

- employee identity is separate from the login account
- job and org placement are modeled explicitly, not inferred from app roles
- reporting hierarchy is first-class data
- employment status and termination records are separate from authentication flags
- dates are validated as a coherent lifecycle timeline
- employee portal needs both self-service data and manager-facing org context

### What not to borrow wholesale

- giant monolithic HR suites
- payroll-first schema design
- broad country-specific compliance tables
- UX assumptions built around legacy HR admin software instead of an operator platform

The right move for DPF is to **build a targeted workforce core in DPF using these systems as references**, not to import an entire external HR product model.

---

## Approaches Considered

### 1. Full external HRMS adoption

Run something like Frappe HR or OrangeHRM as the primary workforce system and integrate DPF against it.

Pros:

- fastest path to broad HR feature coverage
- mature workflows already exist
- lower greenfield modeling risk

Cons:

- creates UX and data-ownership fragmentation
- weak fit for DPF-specific governance and AI coworker requirements
- likely pushes the product toward integration work instead of platform-native capability

### 2. External-schema mimic

Use a reference system's schema as the direct template for DPF's workforce design.

Pros:

- reduces domain-model guesswork
- benefits from mature concepts

Cons:

- imports baggage that DPF does not need yet
- makes the model feel like someone else's product
- can still miss DPF-specific agent-accountability concepts

### 3. Targeted DPF-native workforce core

Build a small, platform-native workforce model that explicitly borrows proven concepts from Frappe HR and OrangeHRM but is shaped around DPF's portal, governance, and AI coworker requirements.

Pros:

- best fit for the portal and agent model
- keeps schema lean
- supports future integration rather than depending on it

Cons:

- more greenfield design work now
- some advanced HR features remain deferred

**Recommendation: option 3.**

---

## Chosen Scope

This workforce spec covers three layers, intentionally phased:

### Layer 1: Employee profile core

The portal-facing workforce identity record.

### Layer 2: Org structure and reporting

The operating hierarchy needed for manager views and AI coworker accountability.

### Layer 3: Employment lifecycle

The status model and lifecycle dates needed for onboarding, active employment, leave, and offboarding.

The implementation order should still be:

1. profile
2. org structure
3. lifecycle workflows

But the data model should be designed together so the pieces do not conflict later.

---

## Domain Boundaries

### `User` remains the auth account

`User` should continue to represent:

- authentication
- password and login state
- coarse platform access
- system-level active/inactive account semantics

It should not become the full HR profile.

### New workforce layer owns:

- employee identity and personnel record
- job placement
- reporting line
- department assignment
- employment relationship and lifecycle dates
- manager and directory context for the portal

### Governance layer still owns:

- team ownership
- governed access
- delegation and agent accountability
- platform authority resolution

### Key design rule

**Department and manager hierarchy are not the same as governance teams.**

Examples:

- a person may belong to the `People Operations` department but still be in a governance team that owns `HR Agent` workflows
- a manager may supervise employees in the org chart but not own the same agent operating team

This distinction is required for the AI coworker model to stay clear.

---

## Proposed Data Model

### New: `EmployeeProfile`

Primary workforce record, linked one-to-one with `User` when the employee has a platform account.

Suggested shape:

```prisma
model EmployeeProfile {
  id                    String   @id @default(cuid())
  employeeId            String   @unique
  userId                String?  @unique
  firstName             String
  middleName            String?
  lastName              String
  displayName           String
  workEmail             String?
  personalEmail         String?
  phoneNumber           String?
  status                String   // onboarding | active | leave | suspended | offboarding | inactive
  employmentTypeId      String?
  departmentId          String?
  positionId            String?
  managerEmployeeId     String?
  dottedLineManagerId   String?
  workLocationId        String?
  timezone              String?
  startDate             DateTime?
  confirmationDate      DateTime?
  endDate               DateTime?
  terminationRecordId   String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}
```

Purpose:

- keeps workforce data separate from auth
- gives the portal a first-class person record
- gives agent flows a durable accountable-human record even if access changes later

### New: `Department`

Org structure node for business hierarchy.

Suggested shape:

```prisma
model Department {
  id                 String   @id @default(cuid())
  departmentId       String   @unique
  name               String
  slug               String   @unique
  parentDepartmentId String?
  headEmployeeId     String?
  status             String   @default("active")
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

Purpose:

- gives the portal and directory a business org tree
- supports department heads separate from line managers
- keeps org semantics out of governance `Team`

### New: `Position`

Normalized job placement record.

Suggested shape:

```prisma
model Position {
  id              String   @id @default(cuid())
  positionId      String   @unique
  title           String
  jobFamily       String?
  jobLevel        String?
  status          String   @default("active")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

Purpose:

- allows job title reuse across employees
- gives lifecycle and approval flows a consistent role anchor
- avoids storing job metadata only in free text

### New: `EmploymentType`

Lookup for relationship type.

Suggested shape:

```prisma
model EmploymentType {
  id               String   @id @default(cuid())
  employmentTypeId String   @unique
  name             String   // full_time | part_time | contractor | intern | advisor
  status           String   @default("active")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

Purpose:

- supports workforce segmentation without building payroll
- useful for authority policies and future lifecycle flows

### New: `WorkLocation`

Optional normalized location model.

Suggested shape:

```prisma
model WorkLocation {
  id             String   @id @default(cuid())
  locationId     String   @unique
  name           String
  locationType   String   // office | remote | hybrid | customer_site
  timezone       String?
  status         String   @default("active")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

Purpose:

- supports timezone-aware workflow routing
- helps AI coworkers know operational context
- avoids hard-coding location strings into profiles

### New: `EmploymentEvent`

Append-only lifecycle log.

Suggested shape:

```prisma
model EmploymentEvent {
  id                 String   @id @default(cuid())
  eventId            String   @unique
  employeeProfileId  String
  eventType          String   // hired | onboarded | transferred | promoted | leave_started | leave_ended | offboarding_started | terminated | reactivated
  effectiveAt        DateTime
  reason             String?
  actorUserId        String?
  metadata           Json?
  createdAt          DateTime @default(now())
}
```

Purpose:

- separates current state from lifecycle history
- gives the portal and audits a timeline
- avoids encoding every status change only in mutable columns

### New: `TerminationRecord`

Separate termination/offboarding detail.

Suggested shape:

```prisma
model TerminationRecord {
  id                 String   @id @default(cuid())
  terminationId      String   @unique
  employeeProfileId  String   @unique
  terminationDate    DateTime
  terminationReason  String?
  notes              String?
  exitInterviewDone  Boolean  @default(false)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

Purpose:

- follows OrangeHRM's useful pattern of a separate termination concept
- keeps offboarding detail out of the base employee row
- supports future offboarding workflow without overloading `status`

---

## Runtime Relationships

### `User` to `EmployeeProfile`

- one `User` may map to zero or one `EmployeeProfile`
- one `EmployeeProfile` may exist before a `User` account exists

This is important for:

- pre-start onboarding
- inactive employees with retained history
- future imports from another HR source

### `EmployeeProfile` to manager

- `managerEmployeeId` should point to another `EmployeeProfile`
- `dottedLineManagerId` is optional and should not replace the primary manager

For slice 1, only the primary manager relationship must drive approval and visibility behavior.

### `EmployeeProfile` to `Department`

- department is business placement
- not a substitute for governance `Team`

### `EmployeeProfile` to agent governance

The workforce layer should later feed:

- accountable human selection
- manager approval routing
- department-aware AI coworker behavior
- worker directory context for agent selection

---

## Portal Experience Requirements

The workforce portal should eventually provide three views:

### 1. Self profile

For the employee:

- identity details
- job placement
- manager
- department
- employment status
- start/confirmation/end dates

### 2. Manager view

For a manager:

- direct reports
- org placement
- lifecycle actions on reports
- future agent delegation context

### 3. HR operations view

For HR/admin users:

- workforce directory
- employment changes
- organizational assignment changes
- lifecycle timeline visibility

The first slice should prioritize self profile plus HR operations. Manager views can start simple if the data model supports them.

---

## AI Coworker Implications

The org structure is not just for chart rendering. It should support agent context such as:

- who the accountable human is
- who the manager approver is
- which department the user belongs to
- whether a manager is authorized to request elevated AI work for a report
- which AI coworkers should appear by default in a person's workspace

This means the workforce model should later expose stable runtime context like:

```ts
type WorkforceContext = {
  employeeId: string;
  departmentId?: string;
  managerEmployeeId?: string;
  employmentStatus: string;
  workLocationId?: string;
  timezone?: string;
};
```

That runtime context should be assembled alongside `PrincipalContext`, not inside it.

---

## Lifecycle Model

The first slice should define the lifecycle states now even if not all workflows are implemented immediately.

Recommended current-state field:

- `onboarding`
- `active`
- `leave`
- `suspended`
- `offboarding`
- `inactive`

Recommended event types:

- `hired`
- `onboarding_started`
- `activated`
- `manager_changed`
- `department_changed`
- `position_changed`
- `leave_started`
- `leave_ended`
- `offboarding_started`
- `terminated`
- `reactivated`

Validation rules to borrow from Frappe-style lifecycle modeling:

- start date cannot be after end date
- confirmation date cannot be before start date
- termination requires a termination date
- inactive or terminated managers should not retain active reports

---

## Suggested Slice Order

### Slice A: Workforce identity core

- `EmployeeProfile`
- `EmploymentType`
- `Position`
- `WorkLocation`
- lightweight employee directory and profile panel
- `User` linkage

### Slice B: Org structure

- `Department`
- `managerEmployeeId`
- department heads
- basic org tree and manager relationships
- downstream AI coworker context hooks

### Slice C: Lifecycle

- `EmploymentEvent`
- `TerminationRecord`
- lifecycle transitions and validations
- HR/admin workflow surfaces

This keeps the initial portal useful quickly while preserving room for the rest of the domain.

---

## Recommended Borrowing Strategy

### Borrow from Frappe HR / ERPNext

- employee master data breadth
- user-to-employee mapping
- manager hierarchy via `reports_to`
- lifecycle date validation
- status rules around leaving/offboarding

### Borrow from OrangeHRM

- separation between personal detail, job detail, supervisors, and termination
- employee API/view decomposition
- subunit and employment-status normalization

### Borrow selectively from Odoo / OCA

- department and contract modularization
- extension strategy for later certifications, equipment, and offboarding

### Do not copy from references

- payroll-heavy schema
- product-specific naming that clashes with DPF
- legacy HR admin navigation patterns

---

## Recommended Architecture

For DPF, the cleanest architecture is:

1. keep the governance layer as the control plane
2. add workforce records as a separate business domain
3. map workforce context into governed actions and AI coworker routing
4. keep optional future import/sync boundaries open

That means the first implementation should **not** attempt to make HR the master for authentication or for governance teams. It should remain a domain consumer of those systems.

---

## Testing Expectations For The Future Plan

The eventual implementation plan should cover:

- employee profile creation and update validation
- manager self-reference and cycle checks
- lifecycle date validation
- status transition validation
- user-to-employee uniqueness
- employee directory and profile rendering
- governed HR actions tied to lifecycle changes

---

## Summary

The next correct slice is a DPF-native workforce core.

It should:

- create a first-class `EmployeeProfile`
- normalize departments, positions, employment types, and work locations
- model manager hierarchy explicitly
- separate lifecycle events and termination details from the base employee row
- feed future AI coworker accountability and routing

The best reference pattern is a blend:

- **Frappe HR** for employee master and lifecycle semantics
- **OrangeHRM** for profile/job/supervisor/termination decomposition
- **Odoo/OCA** for long-term modular extension ideas

This gives DPF a workforce model that fits the portal and the AI coworker architecture without becoming a monolithic HR suite.

---

## Reference URLs

- Frappe HR docs: https://docs.frappe.io/hr/introduction
- Frappe employee lifecycle overview: https://frappe.io/hr/employee-lifecycle
- Frappe HR GitHub: https://github.com/frappe/hrms
- OrangeHRM open-source overview: https://www.orangehrm.com/open-source
- OrangeHRM starter overview: https://www.orangehrm.com/assets/Documents/pdf/Starter-Overview.pdf
- OrangeHRM GitHub: https://github.com/orangehrm/orangehrm
- IceHrm site: https://icehrm.org/
- IceHrm employee management docs: https://icehrm.github.io/docs/employees/
- IceHrm audit log docs: https://icehrm.github.io/docs/auditlog/
- Odoo Employees docs: https://www.odoo.com/documentation/19.0/applications/hr/employees.html
- Odoo Departments docs: https://www.odoo.com/documentation/18.0/applications/hr/employees/departments.html
- OCA HR repository: https://github.com/OCA/hr
