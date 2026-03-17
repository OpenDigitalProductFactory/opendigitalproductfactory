# EP-HR-FULL-001: Full HR Lifecycle Management — Design Spec

**Date:** 2026-03-16
**Goal:** Complete HR lifecycle management: bootstrap identity, staged hiring pipeline, onboarding checklists, org chart visualization, hybrid performance reviews, AI-assisted leave management, and manager self-service. Follows established HRIS patterns (BambooHR, Personio, Workday).

---

## 1. Bootstrap & Identity

**Problem:** First login after fresh install has no EmployeeProfile linked to the User. The employee page can't find the current user.

**Solution:** In the shell layout, before any page renders:
- Check if the authenticated User has a linked EmployeeProfile
- If not, auto-create one:
  - Parse name from User email (or use "Admin" as default)
  - Set status to `active`, employmentType to `full-time`
  - Create a `hired` EmploymentEvent with effectiveAt = now
  - Link EmployeeProfile.userId to User.id
- This ensures the first admin always appears in the employee directory immediately

**Location:** `apps/web/app/(shell)/layout.tsx` — runs once per session, not on every render.

**Bootstrap details:**
- Check: `prisma.employeeProfile.findUnique({ where: { userId } })` — if null, create
- EmploymentType handling: bootstrap first calls `seedWorkforceReferenceData()` if no EmploymentType records exist (fresh install). This ensures `emp-full-time` is available before creating the profile.
- Cache: Set a `dpf-employee-bootstrapped` cookie (httpOnly, 24h TTL) after successful check so the DB query only runs once per day, not every page load. Cookie is cleared on logout.
- Race condition: uses `prisma.employeeProfile.upsert` with `where: { userId }` to handle concurrent requests safely.

---

## 2. Hiring Pipeline (Staged Lifecycle)

Following BambooHR/Personio patterns, hiring flows through defined stages with lifecycle events at each transition.

### Stages

| Stage | Status | Trigger | What Happens |
|-------|--------|---------|-------------|
| Offer | `offer` | HR or manager creates new employee | Basic record: name, email, position, department, manager, start date, type, location |
| Onboarding | `onboarding` | Offer accepted | Onboarding checklist auto-generated from template. IT setup, paperwork, training items |
| Active | `active` | All required checklist items done | Confirmation date set. Employee is fully operational |
| Leave | `leave` | Leave request approved (extended) | Employee on extended leave. LeaveRequest record tracks details. |
| Suspended | `suspended` | HR action | Temporary suspension. Access restricted but employment continues. |
| Offboarding | `offboarding` | Manager or HR initiates | Offboarding checklist generated. Access revocation, equipment return, exit interview |
| Terminated | `inactive` | Offboarding complete | TerminationRecord created. Employee removed from active views |

### State Transition Matrix

```
offer → onboarding (offer_accepted)
offer → inactive (offer_withdrawn)
onboarding → active (onboarding_completed)
active → leave (leave_started) — triggered by extended leave approval
active → suspended (suspended)
active → offboarding (offboarding_started)
leave → active (leave_ended) — return from leave
suspended → active (reactivated)
suspended → offboarding (offboarding_started)
offboarding → inactive (offboarding_completed)
inactive → onboarding (reactivated) — rehire scenario
```

Note: Short-term leave (vacation, sick days) does NOT change employee status — it's tracked purely through `LeaveRequest` records. Only extended/indefinite leave (e.g., sabbatical, long-term medical) transitions status to `leave`.

### New EmploymentEvent Types

- `offer_created` — initial record creation
- `offer_accepted` — transition from offer to onboarding
- `offer_withdrawn` — offer rescinded or declined
- `onboarding_completed` — all required tasks done, transition to active
- `offboarding_completed` — all offboarding tasks done, transition to inactive

### Modified Type: WorkforceStatus

`apps/web/lib/workforce-types.ts` must add `"offer"` to the `WorkforceStatus` union type. The existing `buildLifecycleCreateEvent` switch in `actions/workforce.ts` must add a `case "offer"` returning `offer_created`.

### Permission Model

- **HR** (manage_user_lifecycle): Create offers, force any transition, edit checklists
- **Managers** (via HITL proposal): Request a new hire (creates offer pending HR approval), initiate offboarding for their reports
- **Employee**: Mark their own onboarding tasks as complete

---

## 3. Onboarding & Offboarding Checklists

### Schema

```prisma
model OnboardingChecklist {
  id              String   @id @default(cuid())
  checklistId     String   @unique
  name            String
  checklistType   String   // "onboarding" | "offboarding"
  departmentId    String?
  positionId      String?
  isDefault       Boolean  @default(false)
  items           Json     // Array of { title, description, assigneeRole, required, dueOffsetDays }
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([checklistType])
}

model OnboardingTask {
  id                String   @id @default(cuid())
  taskId            String   @unique
  employeeProfileId String
  checklistType     String   // "onboarding" | "offboarding"
  title             String
  description       String?
  assigneeRole      String?  // "hr" | "manager" | "it" | "employee"
  required          Boolean  @default(true)
  dueDate           DateTime?
  status            String   @default("pending") // pending | completed | skipped
  completedAt       DateTime?
  completedById     String?
  createdAt         DateTime @default(now())

  employeeProfile   EmployeeProfile @relation(fields: [employeeProfileId], references: [id], onDelete: Cascade)

  @@index([employeeProfileId])
  @@index([status])
}
```

### Required EmployeeProfile Back-Relations (all new models)

Add to `EmployeeProfile` in schema.prisma:

```prisma
  // Onboarding
  onboardingTasks     OnboardingTask[]
  // Reviews
  reviewInstances     ReviewInstance[]   @relation("ReviewsAsEmployee")
  reviewsAsReviewer   ReviewInstance[]   @relation("ReviewsAsReviewer")
  // Feedback
  feedbackGiven       FeedbackNote[]     @relation("FeedbackFrom")
  feedbackReceived    FeedbackNote[]     @relation("FeedbackTo")
  // Leave
  leaveBalances       LeaveBalance[]
  leaveRequests       LeaveRequest[]
  leaveApprovals      LeaveRequest[]     @relation("LeaveApprovals")
```

### Behavior

- When status transitions to `onboarding`: find matching OnboardingChecklist (by department/position, or default) and generate OnboardingTask instances
- When status transitions to `offboarding`: same pattern with `offboarding` type
- Required tasks must all be completed before the next stage transition
- Tasks can be assigned to different roles (HR handles paperwork, IT handles access, employee handles training)

---

## 4. Reporting Hierarchy & Org Chart

### Directory Enhancements

- Group/indent by manager in the existing directory panel
- Direct report count badge next to each manager's name
- "My team" filter for managers (shows directs + dotted-line reports)
- Sort options: name, department, status, manager

### Org Chart View

- New tab on employee page: "Directory | Org Chart | Leave Calendar"
- Tree layout with CSS grid/flexbox (no heavy charting library)
- Each node: name, position title, department, status dot
- Click node → selects employee in profile panel
- Expand/collapse subtrees
- Root nodes: employees with no manager
- Dotted-line relationships shown as dashed connectors
- Department heads highlighted with badge

### Department Hierarchy

- Departments with parentDepartmentId render as nested groups
- Toggle between "by manager" (reporting lines) and "by department" (org structure) views

### Data Queries

New query: `getOrgTree()` — returns all active employees with manager relationships as a tree structure. Uses recursive CTE or application-level tree building from flat list.

---

## 5. Performance Management (Hybrid Model)

### Review Cycles

```prisma
model ReviewCycle {
  id          String   @id @default(cuid())
  cycleId     String   @unique
  name        String                        // "2026 Q1 Review", "2026 Annual Review"
  cadence     String                        // "quarterly" | "semi_annual" | "annual"
  periodStart DateTime
  periodEnd   DateTime
  status      String   @default("draft")    // draft | active | completed
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  instances   ReviewInstance[]
}

model ReviewInstance {
  id                String   @id @default(cuid())
  reviewId          String   @unique
  cycleId           String
  employeeProfileId String
  reviewerEmployeeId String                 // manager
  status            String   @default("pending") // pending | self_review | manager_review | finalized
  overallRating     String?                 // configurable scale
  managerNarrative  String?  @db.Text
  employeeNarrative String?  @db.Text
  finalizedAt       DateTime?
  sharedAt          DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  cycle             ReviewCycle       @relation(fields: [cycleId], references: [id])
  employeeProfile   EmployeeProfile   @relation("ReviewsAsEmployee", fields: [employeeProfileId], references: [id])
  reviewerEmployee  EmployeeProfile   @relation("ReviewsAsReviewer", fields: [reviewerEmployeeId], references: [id])

  goals             ReviewGoal[]

  @@unique([cycleId, employeeProfileId])
  @@index([cycleId])
  @@index([employeeProfileId])
  @@index([status])
}

model ReviewGoal {
  id               String   @id @default(cuid())
  reviewInstanceId String
  title            String
  description      String?  @db.Text
  weight           Float?                   // optional weighting
  status           String   @default("active") // active | achieved | missed | deferred
  selfAssessment   String?  @db.Text
  managerAssessment String? @db.Text
  rating           String?                  // per-goal rating
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  reviewInstance   ReviewInstance @relation(fields: [reviewInstanceId], references: [id], onDelete: Cascade)

  @@index([reviewInstanceId])
}
```

### Review Flow

1. **Goal setting** — Manager and employee set goals at cycle start
2. **Self-review** — Employee writes self-assessment against goals
3. **Manager review** — Manager writes assessment, rates goals, provides overall rating
4. **Calibration** (optional) — HR views all reviews in a cycle for consistency
5. **Finalization** — Manager shares final review with employee. Becomes read-only

### Continuous Feedback

```prisma
model FeedbackNote {
  id               String   @id @default(cuid())
  feedbackId       String   @unique
  fromEmployeeId   String
  toEmployeeId     String
  content          String   @db.Text
  feedbackType     String                   // "praise" | "constructive" | "observation"
  visibility       String   @default("private") // "private" | "shared" | "public"
  createdAt        DateTime @default(now())

  fromEmployee     EmployeeProfile @relation("FeedbackFrom", fields: [fromEmployeeId], references: [id])
  toEmployee       EmployeeProfile @relation("FeedbackTo", fields: [toEmployeeId], references: [id])

  @@index([toEmployeeId])
  @@index([fromEmployeeId])
}
```

- From anyone to anyone (peer, manager, skip-level)
- Private by default, can be shared with manager or made public
- Shows on employee profile timeline alongside lifecycle events
- Managers see all feedback for their direct reports

### Configuration

- Review cadence stored in PlatformConfig: `review_cadence` = "quarterly" | "semi_annual" | "annual"
- Rating scale stored in PlatformConfig: `review_rating_scale` (e.g., ["Exceeds", "Meets", "Below"] or ["1","2","3","4","5"])
- Customer configures during platform setup or in admin settings

---

## 6. Leave Management with AI-Assisted Policy

### Schema

```prisma
model LeavePolicy {
  id                   String   @id @default(cuid())
  policyId             String   @unique
  leaveType            String                        // "vacation" | "sick" | "personal" | "parental" | "unpaid"
  name                 String
  annualAllocation     Float                         // days per year
  accrualRule          String   @default("annual")   // "annual" | "monthly" | "none"
  carryoverLimit       Float?                        // max days carried over (null = unlimited)
  requiresApproval     Boolean  @default(true)
  probationDays        Int      @default(0)          // days before eligible
  locationPattern      String?                       // regex or country code for AI suggestions
  isDefault            Boolean  @default(false)
  status               String   @default("active")
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([leaveType])
  @@index([status])
}

model LeaveBalance {
  id                String   @id @default(cuid())
  employeeProfileId String
  leaveType         String
  year              Int
  allocated         Float
  used              Float    @default(0)
  carriedOver       Float    @default(0)
  adjustments       Float    @default(0)
  updatedAt         DateTime @updatedAt

  employeeProfile   EmployeeProfile @relation(fields: [employeeProfileId], references: [id], onDelete: Cascade)

  @@unique([employeeProfileId, leaveType, year])
  @@index([employeeProfileId])
}

model LeaveRequest {
  id                  String    @id @default(cuid())
  requestId           String    @unique
  employeeProfileId   String
  leaveType           String
  startDate           DateTime
  endDate             DateTime
  days                Float
  reason              String?
  status              String    @default("pending") // pending | approved | rejected | cancelled
  approverEmployeeId  String?
  approvedAt          DateTime?
  rejectionReason     String?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  employeeProfile     EmployeeProfile  @relation(fields: [employeeProfileId], references: [id])
  approver            EmployeeProfile? @relation("LeaveApprovals", fields: [approverEmployeeId], references: [id])

  @@index([employeeProfileId])
  @@index([status])
  @@index([startDate, endDate])
}
```

### Request Flow

1. Employee submits leave request (via form or HR agent)
2. Manager gets approval card (HITL pattern)
3. Manager approves or rejects with optional reason
4. Balance auto-deducted on approval
5. Team calendar shows who's out

### AI-Assisted Policy Setup

When a new employee is created with a work location:
- HR agent recommends leave policies based on location/country context
- Example: Germany → 20 vacation days, unlimited sick, 14 weeks parental
- Example: US → 15 vacation, 5 sick, 12 weeks FMLA
- Agent calls `propose_leave_policy` tool with recommendations
- HR approves via approval card
- Not a compliance engine — agent uses general knowledge for sensible defaults. Admin can override.

### Team Calendar

- View on employee page showing approved leave for department or manager's team
- Day-level granularity, color-coded by leave type
- Filters: department, team, date range

---

## 7. Manager Self-Service

### Direct Actions (no approval needed)

- View direct reports and dotted-line reports
- View leave calendar for their team
- Submit feedback notes for their reports
- Complete performance reviews (assessments, ratings)
- View lifecycle history and onboarding progress for reports

### Proposals (HR approves via HITL)

- Request a new hire for their team (creates offer)
- Approve/reject leave requests from direct reports
- Initiate offboarding for a direct report
- Request department/position/location change for a report
- Request manager reassignment (transfer a report)

### How It Works

- `managerEmployeeId` relationship determines manager authority
- HR agent detects manager context from authenticated user's EmployeeProfile
- Manager views automatically filter to their reports
- Proposals go through AgentActionProposal approval flow — approver is HR
- All actions create EmploymentEvent entries for audit trail
- No new capability/role needed — authority derived from reporting relationship

---

## 8. HR Agent Enhancements

### New MCP Tools

| Tool | Mode | Description |
|------|------|------------|
| `create_employee` | proposal | Create a new employee (offer stage) |
| `transition_employee_status` | proposal | Move employee through lifecycle stages |
| `propose_leave_policy` | proposal | Suggest leave policies for an employee's location |
| `submit_feedback` | immediate | Log a feedback note for an employee |

### Updated Skills

- "Hire someone" — walks through creating an offer
- "Start onboarding" — transitions offer to onboarding
- "Team overview" — shows manager's direct reports with status
- "Set up leave policies" — AI-recommended policies based on location
- "Start a review cycle" — create and activate a review period

---

## 9. Files Affected

### New Files (13)

| File | Responsibility |
|------|---------------|
| `apps/web/lib/onboarding-data.ts` | Checklist/task queries |
| `apps/web/lib/review-data.ts` | Review cycle and feedback queries |
| `apps/web/lib/leave-data.ts` | Leave policy, balance, request queries |
| `apps/web/lib/actions/onboarding.ts` | Checklist and task server actions |
| `apps/web/lib/actions/reviews.ts` | Review cycle and feedback server actions |
| `apps/web/lib/actions/leave.ts` | Leave request and policy server actions |
| `apps/web/components/employee/OrgChartView.tsx` | Interactive org chart tree |
| `apps/web/components/employee/OnboardingPanel.tsx` | Onboarding/offboarding checklist UI |
| `apps/web/components/employee/ReviewPanel.tsx` | Performance review UI |
| `apps/web/components/employee/LeavePanel.tsx` | Leave requests and balance UI |
| `apps/web/components/employee/LeaveCalendarView.tsx` | Team leave calendar (day-level, color-coded) |
| `apps/web/components/employee/EmployeeFormPanel.tsx` | Create/edit employee form |
| `apps/web/components/employee/EmployeeTabNav.tsx` | Directory / Org Chart / Leave Calendar tabs |

### Modified Files (9)

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | 9 new models, `offer` status, EmployeeProfile back-relations |
| `apps/web/app/(shell)/employee/page.tsx` | Tab nav, hiring button, manager views |
| `apps/web/app/(shell)/layout.tsx` | Bootstrap employee profile check |
| `apps/web/lib/mcp-tools.ts` | 4 new HR tools |
| `apps/web/lib/agent-routing.ts` | HR agent skills and tool awareness |
| `apps/web/lib/workforce-types.ts` | Add `offer` to WorkforceStatus, new event types |
| `apps/web/lib/workforce-data.ts` | Org tree query, manager team query |
| `apps/web/lib/actions/workforce.ts` | Bootstrap auto-link, `buildLifecycleCreateEvent` for `offer` |
| `apps/web/components/employee/EmployeeDirectoryPanel.tsx` | Hierarchy indicators, grouping |

---

## 10. Implementation Order (7 Chunks)

**Migration strategy:** All 9 new models are added in a single Prisma migration. Since they all add back-relations to `EmployeeProfile`, a single migration avoids dependency chains and is simpler to manage. The migration runs in Chunk 1.

1. **Schema + Bootstrap** — Single migration with all 9 new models + EmployeeProfile back-relations. Update `WorkforceStatus` type and event types. Bootstrap auto-create employee on first login. Seed reference data guard.
2. **Hiring pipeline + form** — Create employee form. Offer → onboarding → active flow. State transition validation matrix.
3. **Onboarding checklists** — Template management. Auto-generate tasks on status transition. Task completion UI.
4. **Org chart + directory** — Tab navigation. Org tree query. OrgChartView component. Directory hierarchy enhancements. (No schema dependency — can run early.)
5. **Performance reviews** — Review cycle CRUD. Goal setting + self/manager review flow. Continuous feedback. Review configuration in PlatformConfig.
6. **Leave management** — Leave policy CRUD. Request/approval flow. Balance tracking. AI-assisted policy setup. Team calendar view.
7. **Manager self-service + HR agent** — Manager-filtered views. Leave approval via manager authority (resolved through EmployeeProfile → User link). New MCP tools. HR agent skills update.

### Manager Authority for Leave Approval

Managers approve leave for their direct reports. The resolution chain:
1. Find the employee's `managerEmployeeId`
2. Look up the manager's EmployeeProfile
3. Resolve the linked User via `EmployeeProfile.userId`
4. The manager's User must have a linked EmployeeProfile with userId set (guaranteed by bootstrap)
5. Leave approval is a manager-level action, not a platform capability — it's derived from the reporting relationship, not from HR role assignments
6. If a manager's EmployeeProfile has no linked User (edge case), the leave request escalates to HR (manage_user_lifecycle holders)

---

## 11. Access Control Rules

| Data | Employee (self) | Manager (of employee) | HR (manage_user_lifecycle) |
|------|----------------|----------------------|---------------------------|
| EmployeeProfile | Read own | Read direct reports | Read/write all |
| OnboardingTask | Complete own tasks | View report tasks | Manage all |
| ReviewInstance | Self-review, read finalized | Write assessment, read all for reports | Read all, calibrate |
| ReviewGoal | Self-assess | Manager-assess, rate | Read all |
| FeedbackNote (private) | Read received | Not visible | Read all |
| FeedbackNote (shared) | Read received | Read for reports | Read all |
| FeedbackNote (public) | Read all | Read all | Read all |
| LeaveBalance | Read own | Read for reports | Read all |
| LeaveRequest | Create own, read own | Approve/reject for reports | Approve/reject all |

Query functions enforce these filters based on the authenticated user's EmployeeProfile and reporting relationships.

---

## 12. Not In Scope (v1)

- Payroll integration
- Benefits administration
- Attendance/time tracking
- Competency framework / skill matrix
- Succession planning workflows
- Country-specific compliance engine (AI suggests, doesn't enforce)
- Recruitment/applicant tracking (starts at offer, not at job posting)
