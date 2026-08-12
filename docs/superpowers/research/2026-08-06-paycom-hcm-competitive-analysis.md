# Paycom — HCM/Payroll Competitive Analysis & Absorption Design

| Field | Value |
| ----- | ----- |
| Status | Research / benchmarking / absorption design (doc-only) |
| Date | 2026-08-06 |
| Author | Agent (for Mark Bodman) |
| Scope | What Paycom does, what delights its users, where DPF has gaps, and how to absorb the distinctive parts into DPF's AI-native substrate |
| Anchors | [HR full-lifecycle design](../specs/2026-03-16-hr-full-lifecycle-design.md), [HR/workforce core design](../specs/2026-03-13-hr-workforce-core-design.md), epics `EP-PEOPLE-HCM-CORE`, `EP-WORKFORCE-OPS`, `EP-PAYROLL-COMP-BENEFITS`, `EP-TALENT-SKILLS-PERFORMANCE`, `EP-COMPANY-OPS-PARITY` |
| Why now | Paycom is the clearest market expression of "employee-driven, single-database, decision-automating HCM." Its three signature bets (Beti, GONE, IWant) are *exactly* the kind of AI-native delight DPF is architecturally positioned to leapfrog — but none is captured in the current HCM backlog. This grounds the gap and seeds the BI long-tail. |
| Companion | Gap analysis + BI seed table in §7–§9 below (single doc — no separate file, mirrors the FSM research pattern). |

---

## 1. What Paycom is, in one paragraph

Paycom (NYSE: PAYC) is a US-market HCM/payroll SaaS whose entire identity is **one truly single database** spanning the full employee lifecycle — recruit, hire, onboard, pay, time, benefits, performance, learning, offboard — accessed through **one app with one login**, where **the employee is the primary data-entry point and the last line of QA**. Its marketing line: "Set your HR and payroll software to automatic." The moat is architectural (single record, no inter-module integration, no re-keying), and the delight/frustration is the same fact seen from two sides: work is **relocated to the employee**, then **measured** to prove it saved money.

The four principles that define Paycom (from its own product pages + synthesized review sentiment):

1. **One database, no double-entry.** Every module is a view on the same record; a change entered once appears everywhere. Root of nearly all the praise.
2. **Employee-driven data entry (Beti).** The person closest to the data — their own pay, hours, address — is the cheapest, most accurate place to catch errors, so payroll verification is pushed *to the employee* before the run.
3. **Automation of decisions, not just tasks (GONE).** A policy engine that *approves/denies* time-off outright — decisioning, not just workflow routing.
4. **Measured ROI (Direct Data Exchange).** Paycom instruments its own adoption and dollarizes it, to *prove* the self-service model saves money — and implicitly to pressure customers into pushing work to employees.

The through-line: **automate by relocating the labor (to the employee), then measure that you did.**

---

## 2. Product taxonomy (the parity checklist)

Paycom's modules, grouped by pillar. One line each = what it does / the user problem it solves. This is the parity surface DPF is measured against in §6.

### Talent Acquisition (recruit → hire → onboard)
- **Applicant Tracking** — auto-distributes postings, pulls candidate data systemwide; fixes fragmented recruiting across job boards.
- **Candidate Tracker** — one-view candidate stage pipeline; fixes losing track of candidate status.
- **Onboarding** — new hires complete paperwork/tasks before day one; fixes the paper-heavy unproductive first day.
- **Tax Credits (WOTC)** — generates Work Opportunity Tax Credit documentation; fixes leaving hiring tax credits on the table.
- **Enhanced Background Checks** — in-platform candidate screening; removes a third-party screening vendor.
- **E-Verify** — automated employment-eligibility confirmation; fixes manual I-9 verification.
- **Enhanced ACA** — tracks ACA eligibility, generates 1094/1095 filings; fixes complex ACA compliance.

### Time & Labor Management
- **Time & Attendance** — auditable hours feeding payroll directly; fixes manual timekeeping/transcription errors.
- **Time Clocks & Terminals** — physical punch hardware; fixes buddy-punching.
- **Scheduling / Schedule Exchange** — auto-builds schedules to demand, employee shift swaps; fixes manual scheduling and coverage gaps.
- **Time-Off Requests** — automated PTO routing/decisioning per policy (home of GONE); fixes slow, inconsistent approvals.
- **Labor Allocation** — labor dollars tracked to departments/jobs as spent; fixes not knowing true labor cost by cost center.
- **Labor Management Reports** — analytics on spend/overtime/utilization.
- **Geofencing & Microfence** — location/beacon punch restriction; fixes off-site/unauthorized clock-ins.

### Payroll
- **Beti (Automated Payroll)** — *signature.* System builds each check, flags errors, and has the **employee** preview/verify/approve their own pay before submission; fixes costly post-payroll corrections, voids, reversals. (See §4.)
- **Everyday (Daily/On-Demand Pay)** — earned-wage access daily, no third-party fee; fixes the EWA gap without an outside vendor.
- **Vault Payroll Card** — Visa payroll card + app, pay up to 2 days early; fixes paying unbanked employees and check-cashing fees.
- **Paycom Pay** — check-clearing against a Paycom account; fixes reconciliation burden on the employer's bank.
- **Expense Management (+ Mileage Tracker & FAVR)** — in-app expense/mileage → payroll reimbursement; fixes paper expense reports.
- **Garnishment Administration** — manages/remits wage garnishments; fixes error-prone, legally sensitive handling.
- **Payroll Tax Management** — calculates, files, remits payroll taxes; fixes multi-jurisdiction filing risk.
- **GL Concierge** — mapped GL file for direct accounting import; fixes manual journal-entry mapping.

### Talent Management
- **Performance Management** — reviews with auto-assigned follow-up training; fixes disconnected review cycles.
- **Compensation Budgeting** — merit/comp planning bounded by budget; fixes spreadsheet raise cycles that blow budget.
- **Position Management** — org structured by position (not person) to drive automation; fixes org-structure drift.
- **My Analytics / Retention Dashboard** — workforce/attrition-risk metrics; fixes seeing attrition only after it happens.
- **Paycom Learning (LMS) + Content Marketplace + Certification Management** — deliver/track/certify training; removes a separate LMS.
- **Career & Succession Planning** — development paths and successors; fixes no bench plan for key roles.
- **Employee Self-Service** — 24/7 employee self-management; the backbone that makes single-database work.

### HR Management
- **Documents & Checklists** — auto-scheduled/stored HR docs/tasks; fixes lost paperwork and missed steps.
- **Government & Compliance** — maintains employment-regulation compliance.
- **Benefits Administration (+ Benefits to Carrier, Enrollment Service)** — self-service enrollment → payroll → carriers; fixes double-entry across benefits/payroll/carriers.
- **COBRA Administration** — COBRA notices/compliance; fixes a high-penalty manual process.
- **Personnel Action Forms (PAFs)** — status changes sync systemwide; fixes change requests that don't propagate.
- **Paycom Surveys** — structured employee feedback.
- **Direct Data Exchange (DDX)** — *signature.* Measures self-service adoption and dollarizes ROI; fixes the inability to prove automation saves money. (See §4.)
- **Manager on-the-Go** — mobile approvals/tasks for managers.
- **Ask Here** — in-app HR help desk that routes employee questions with an audit trail; fixes untracked "quick HR questions."

### Signature AI / automation layer (the crux)
- **Beti** — automates payroll *processing* by relocating verification to the employee.
- **GONE** — automates time-off *decisions* via a customizable engine (staffing needs, consecutive days, seniority, hours worked) that approves/denies without manager intervention.
- **IWant** — command-driven AI over the single database; type a natural-language request to retrieve any employee datum/insight without navigating menus ("before you navigate, ask IWant").
- **Direct Data Exchange** — the ROI-measurement layer scoring adoption and dollarizing the self-service model.

---

## 3. What delights users (and the WHY) — verbatim themes from review corpora

Sentiment synthesized across Capterra (4.4/5, ~1,376 reviews), G2, GetApp, BBB. Delight first, because that is what we are trying to absorb.

1. **Single database / no double-entry** — the top praise, repeatedly. Change entered once appears everywhere; eliminates external integrations and reconciliations.
2. **Employee self-service depth** — employees manage pay, benefits, PTO, documents, expenses 24/7; manual checks decrease, satisfaction rises once staff can see their check before payroll closes.
3. **Beti's error-catching** — even skeptics concede it works: employees catch their own errors pre-submission, cutting voids/reversals. Admins move from firefighting corrections to oversight.
4. **The dedicated-specialist model** — a named specialist for implementation and ongoing service. Best case: "the most organized, easiest transition I have ever experienced." (Also the #1 complaint — §5.)
5. **Reporting & customization power** — Report Center scores highly (G2 ~9.6 reporting); deep customizable insight *if* you invest configuration time.
6. **Clean, centralized UI** — "visually clean, easy to navigate"; everything in one place.
7. **GONE / time-off automation** — managers relieved of repetitive PTO decisions; approvals become instant and policy-consistent.
8. **Mobile self-service for the rank-and-file** — viewing pay, requesting PTO, clocking in are genuinely convenient on the app.

---

## 4. The three signature bets, in detail (the parts worth absorbing)

**Beti (employee-driven payroll).** The system pre-builds every employee's check from live inputs (hours, expenses, deductions, benefits), then **routes it to the employee** to preview, verify, and approve *before* the run. The employee — closest to their own pay — finds and fixes errors while they are still cheap to fix (pre-run), instead of HR discovering them as voids/reversals after. Company-commissioned studies claim ~85% less error-correction time and ~90% less payroll-processing labor. The insight is not "a self-service payslip"; it is **making the employee the QA gate on their own paycheck, pre-commit.**

**GONE (automated time-off decisioning).** A customizable decision engine evaluates each PTO request against policy inputs — staffing needs, consecutive days, seniority, hours worked, blackout coverage — and **approves or denies it outright**, no manager in the loop. Paycom's framing: "50% of requests aren't decided until after the time off has been taken." The insight is **decisioning, not routing** — removing the human from routine judgment calls, with an auditable policy behind each verdict.

**IWant (command-driven data access).** Instead of navigating menus/reports, the user types a natural-language request ("before you navigate, ask") and an AI engine searches the single database — employee profiles + management dashboards — and returns the answer directly. Because it reads employee-entered data, results are real-time and comprehensive. The insight is **retrieval-by-intent over a governed single record**, collapsing "where is that buried" into a question.

**Direct Data Exchange (measured ROI).** Uniquely, Paycom instruments adoption of its own self-service and **dollarizes** it in-product — proving (and pressuring) that customers actually push work to employees. The insight is **a product that measures and reports its own ROI**, closing the automation loop.

---

## 5. Recurring frustrations (the anti-patterns to NOT absorb)

These are the failure modes of Paycom's model — the design boundaries DPF should respect while absorbing the good parts.

- **"Forcing work onto employees/admins."** The flip side of Beti/self-service: employees and thin HR teams resent doing verification/entry that used to be HR's. The model assumes engaged employees; low adoption undercuts the ROI — which is *why DDX exists* (to pressure adoption). **DPF lesson: relocation of labor must feel like help, not offloading — the AI does the work, the human confirms.**
- **Support inconsistency & specialist turnover (~6-month rotation).** The most damaging theme — clients re-explain their setup repeatedly; experience swings entirely on which specialist you get. **DPF lesson: the "dedicated specialist" should be an AI coworker with perfect, persistent memory of the account — turnover-proof by construction.**
- **Implementation is hard / oversold.** Steep back-end setup; limitations "not disclosed during the viewing phase" surface during implementation.
- **Cost & pricing opacity.** No published rates; ~25% renewal increases, per-payroll fees, à-la-carte feature pricing.
- **Unannounced updates land in production.** Rollouts with little notice, sometimes introducing issues.
- **Requires internal expertise/manpower.** "Great if you have the time, skillset, and manpower to customize"; one reviewer felt "beginner level after 2 years."
- **Mobile friction for admin-grade tasks;** module gaps (e.g. ATS can't bulk-decline; some payment methods unsupported).

---

## 6. How this doc relates to the Workday HCM parity scorecard (READ FIRST)

DPF **already has** a rigorous, live HCM parity baseline: [Workday HCM Parity — Scorecard, Capability Baseline, and Definition of Done](../specs/2026-08-05-workday-hcm-parity-scorecard-and-capability-baseline-design.md) (2026-08-05, `EP-COMPANY-OPS-PARITY` / BI-COP-001). It defines **20 People capabilities** on a 1–5 maturity ladder, scores DPF at **52.6% of target** (aggregate current 41 / target 78), links each gap to a backlog item in `BusinessCapability` / `BusinessCapabilityTraceLink`, and renders the burn-down at `/portfolio/architecture`. It also records the delivery-posture WWMD decision (`DI-C96E18158DE5`): **DPF natively owns every HCM system-of-record, integrates only the regulated calculation engines** (payroll gross-to-net + statutory filing, benefits carrier exchange) behind a governed connector.

**This document does not re-derive that.** The record-and-workflow parity surface (worker, org, position, absence, time, compensation, benefits records, recruiting, learning, documents, performance, analytics) is *already* scoped there. Re-filing it would be a duplicate — exactly the trap the scorecard §2 was written to correct.

The one observation that makes Paycom worth a *separate* study is this: **the Workday scorecard sets a target maturity of 4 ("Operated") for every capability and explicitly calls level 5 ("Autonomous — an AI coworker owns the routine path end-to-end, escalating by exception") "roadmap, not parity."** Paycom's entire delight layer — Beti, GONE, IWant, DDX — *lives at level 5.* Because DPF is AI-coworker-native, level 5 is not a distant roadmap; it is DPF's actual product wedge. **Paycom is the market proof of what the level-5 layer looks like, and the evidence that it is where the delight (and the ROI claims) actually come from.**

So the division of labor between the two docs:

| | Workday scorecard (exists) | This Paycom doc (new) |
| --- | --- | --- |
| Question | Do we hold the record + workflow a coworker/report needs? | Does an AI coworker *own the routine path* and delight the human? |
| Target maturity | **4 — Operated** | **5 — Autonomous** |
| Deliverable | 20-capability burn-down to parity | The distinctive autonomous overlay + a few net-new records it rides on |
| Relationship | Prerequisite | The layer on top |

---

## 7. DPF substrate today (evidence-based, reconciled with the scorecard)

Grouped by Paycom's pillars, with concrete anchors. Maturity uses the scorecard's ladder (1 Absent → 5 Autonomous).

- **Core HR / HRIS — RICH (level 3).** `EmployeeProfile`, `Department` (tree + head), `Position`, `EmploymentType`, `WorkLocation`, `EmployeeAddress`, `EmploymentEvent` (dated lifecycle), `TerminationRecord` in `packages/db/prisma/schema.prisma`; governed CRUD + editable grid + **org chart with governed reassignment** at [apps/web/app/(shell)/employee/page.tsx](apps/web/app/(shell)/employee/page.tsx), `lib/workforce/org-chart-model.ts`, `lib/actions/workforce.ts` (writes `AuthorizationDecisionLog`). **Load-bearing gap: no effective-dating spine** — compensation is scalar columns on `EmployeeProfile`; no history, grades/bands, or retro-correction (scorecard capability 5, the deepest gap).
- **Time & Attendance — RICH (level 3, best-developed).** `TimesheetPeriod`/`TimesheetEntry` (overtime, breaks, billable), `BillableRate`, `WorkSchedule`, `LeavePolicy`/`LeaveBalance`/`LeaveRequest`, and an 11-model `Staffing*` subsystem with a constraint solver in `apps/web/lib/workforce/staffing/**`. Approval via `lib/workforce/approval-authority.ts` + `approval-routing.ts`; UI `LeavePanel.tsx`, `TimesheetGrid`, `TimesheetApprovalPanel`. **Gaps:** no hardware punch/geofencing; accrual is a policy field with no scheduled accrual-run engine.
- **Payroll — PARTIAL (level 2, integrate posture).** Pure gross-to-net `computePayslip()` in [apps/web/lib/hr/payroll.ts](apps/web/lib/hr/payroll.ts) (earnings, pre/post-tax deductions, pluggable statutory tax, employer-cost roll-up); earnings assembly from approved timesheets + comp in `lib/hr/labor-service.ts`; read-only **ADP connector** at `services/adp/**`. **Gaps:** no `PayRun`/`Payslip` persistence, no GL posting, no employee-facing payslip, **no Beti equivalent (100% absent).**
- **Talent Acquisition / ATS — PARTIAL (schema+backend landed, no UI).** Native models `JobRequisition`→`Application`→`Offer` + EEO `DemographicResponse` (schema ~16421–16650, PR #4053); backend `apps/web/lib/recruiting/**` (`promote-hire.ts` → native `EmployeeProfile`). **Gaps:** no UI route, no offer-letter generation, no candidate portal.
- **Performance — PARTIAL (level 2).** `ReviewCycle`/`ReviewInstance`/`ReviewGoal`/`FeedbackNote` in schema; **no HR-review route** (the `(shell)/performance` page is business results). No calibration, 1:1s, succession, or review→comp linkage.
- **Learning — ABSENT for workers.** Existing `CourseProduct`/`CourseInstance` are a **course-selling archetype** (Stripe, VAT); `SkillDefinition`/`SkillAssignment` serve **AI-agent capability**, not employee training/certification.
- **Benefits — ABSENT.** No plan/enrolment/election/dependant/carrier model. Zero.
- **Worker documents — ABSENT.** Generic `Document` model exists but is not worker-scoped; no contracts/I-9/signed-policy store.
- **Self-service / mobile — PARTIAL.** Web `/employee` gives timesheet/leave/My-Policies; `ExpenseClaim`/`ExpenseItem` cover expense→approve→pay. **The mobile app is a field-ops app** (jobs, visits, evidence, invoices — `apps/mobile/src/features/**`), **not an HR self-service app**: no mobile pay-stub, W-2, benefits, or PTO self-service.
- **Compliance & reporting — PARTIAL.** Rich GRC substrate (`Regulation`/`Obligation`/`Control`/`ComplianceEvidence`/`RegulatorySubmission`, `AuthorizationDecisionLog` audit spine) + org-level `Tax*` filing artifacts. **Gaps:** no ACA (1095-C), EEO-1, or employee W-2/1099 wage statements; no worker analytics report pack.
- **AI-native substrate DPF uniquely has (the level-5 enablers):** the **decision kernel** (`principle_decide` / WWMD, contribution ledger) for governed auto-decisioning; **AI coworkers** with persistent identity (EP-COWORKER-IDENTITY-360) and an `hr-specialist` route persona (`prompts/route-persona/hr-specialist.prompt.md`); a **unified graph/ontology** (the single-database analog); `query_employees` MCP tool for governed employee-data retrieval; and an AI **capacity-continuity** surface (`apps/web/app/(shell)/platform/ai/capacity-continuity/page.tsx`) already reasoning about staffing continuity.

---

## 8. Capability matrix — Paycom feature × DPF state × leapfrog vector

Legend: ● native/strong · ◐ partial/backend-only · ○ absent · ◆ designed-not-built. "Tracked" = already scoped in the Workday scorecard (do **not** re-file).

| Paycom feature | Delight? | DPF today | Scorecard cap | Leapfrog vector (why DPF can beat, not match) |
| --- | :-: | :-: | --- | --- |
| Single database / no double-entry | ★★★ | ● unified graph | (architecture) | **Already DPF's architecture** — parity by construction, not a gap |
| Employee self-service (web) | ★★ | ◐ | 17 (tracked) | Extend to pay/benefits/tax; coworker-assisted |
| **Beti — employee-driven payroll pre-run review** | ★★★ | ○ | 10 + net-new | **AI pre-builds & pre-audits the check; employee *confirms* (not does the work)** |
| **GONE — automated time-off decisioning** | ★★ | ◐ record only | 6 (tracked) | **Decision kernel (`principle_decide`) auto-decides leave with an audited policy ledger** |
| **IWant — command-driven NL data access** | ★★ | ◐ coworker+`query_employees` | 20 (tracked) | **Governed, permission-scoped NL retrieval over the single record — WWWD-aware** |
| **Direct Data Exchange — measured ROI** | ★★ | ◐ cost/telemetry | 19 (tracked) | **Measure coworker+self-service adoption ROI in-product; honest, not adoption-pressure** |
| Dedicated specialist service | ★★ | ◐ coworkers | (service) | **AI specialist with persistent account memory — turnover-proof (fixes Paycom's #1 complaint)** |
| Time & attendance | ★ | ● | 7 (tracked) | Parity; add punch/geofence |
| Scheduling / Schedule Exchange | ★ | ● solver | 8 (tracked) | Parity-plus (constraint solver) |
| Onboarding | ★ | ● checklists | 4 (tracked) | Coworker-driven |
| Applicant Tracking / ATS | — | ◐ backend | 13 (tracked) | UI + recruiting coworker |
| Performance management | — | ◐ | 12 (tracked) | Calibration + review→comp |
| Compensation budgeting / bands | — | ○ scalar | 9 (tracked) | Effective-dated comp (cap 5 prereq) |
| Benefits administration | — | ○ | 11 (tracked) | Native record + carrier connector |
| Everyday / on-demand pay (EWA) | ★ | ○ | net-new | Earned-wage-access on the pay-run record |
| Expense management + mileage | ★ | ◐ ExpenseClaim | net-new | Add mileage/per-diem policy + card feed |
| Learning / LMS + certification | — | ○ workers | 14 (tracked) | Native worker LMS + expiry alerts |
| Worker documents (contracts/I-9) | — | ○ | 15 (tracked) | Worker-scoped doc vault |
| ACA / EEO-1 / W-2 / 1099 | — | ○ | net-new | Employee wage-statement + statutory report pack |
| Ask Here (HR help desk) | ★ | ○ | net-new | Subsumed by the HR coworker (IWant + Ask Here in one) |
| Manager on-the-Go (mobile approvals) | ★ | ○ HR | net-new | HR self-service in the mobile app |
| COBRA / garnishment / tax credits (WOTC) | — | ○ | net-new | Depth items on the benefits/payroll records |

**Reading:** Everything marked "tracked" is already in the Workday scorecard's burn-down — the Paycom study *confirms* its priority but adds no new BI. The rows worth a **net-new, Paycom-distinctive BI** are the ★★/★★★ delight features and the handful of net-new records those features ride on. That is §10.

---

## 9. Absorption design — the four signature bets on DPF's AI substrate

The design principle throughout, and DPF's answer to Paycom's two worst reviews ("forcing work onto employees" and "specialist turnover"):

> **Paycom relocates the labor to the employee and then measures/pressures adoption. DPF relocates the labor to the AI coworker; the human only confirms.** Same accuracy win (the person closest to the data is the QA gate), without the resentment — and the "dedicated specialist" is an AI with perfect, persistent account memory, so it never rotates.

### 9.1 Beti → "AI-built payroll, employee-confirmed" (the flagship absorption)

**What Paycom does:** pre-builds each check, the employee previews/verifies/approves before the run, errors caught pre-commit.

**DPF design:** DPF already assembles earnings (approved timesheets + comp → `getEmployeePayrollEarnings` in `lib/hr/labor-service.ts`) and computes gross-to-net (`computePayslip` in `lib/hr/payroll.ts`). The missing pieces, in order:
1. **Persist the run** — net-new `PayRun` + `Payslip` models (the scorecard's capability-10 payroll-connector BI already calls for a "pay-run record"; Beti extends it with a per-employee review state machine: `built → in_review → confirmed → submitted`).
2. **Employee-facing payslip + pre-run review surface** — the worker sees their draft check on `/employee` and in the mobile app, with each line traceable to its source (hours, expense, deduction).
3. **The inversion:** an **AI payroll coworker pre-audits** every draft check against the prior period and policy, and surfaces *only the anomalies* to the employee ("your overtime is 0 this period — expected?"). The employee confirms or flags; the coworker does the reconciliation. This is Beti's accuracy gate **without** making the employee do payroll's job.
4. **Respect the WWMD:** the actual gross-to-net/statutory calc and filing stay behind the governed connector (`services/adp/**`); DPF owns the record, the review workflow, the audit trail, and the confirm gate — *not* the tax engine.

### 9.2 GONE → kernel-decided time-off

**What Paycom does:** a policy engine approves/denies PTO outright (staffing needs, consecutive days, seniority, hours worked).

**DPF design:** DPF has the request record (`LeaveRequest` + `LeaveBalance` + `LeavePolicy`), the approval spine (`approval-authority.ts`/`approval-routing.ts`), an AI **capacity-continuity** surface, **and the decision kernel** (`principle_decide`). GONE is literally a decision engine — DPF's kernel is the native, *auditable* substrate for it. Design: register a **leave-decisioning coworker** that, on each request, calls the kernel with the policy inputs (coverage from the staffing solver, balance, seniority, blackout windows) and returns approve/deny **with a contribution-ledger rationale** attached to the `LeaveRequest`. Auto-decide the routine; escalate the exceptional to the manager (level-5 "escalate by exception"). DPF's edge over GONE: **every verdict carries an explainable, replayable decision record** — not a black-box policy.

### 9.3 IWant → governed natural-language HR/payroll access

**What Paycom does:** type a request, AI searches the single database, returns the datum — "before you navigate, ask."

**DPF design:** DPF has the `hr-specialist` route persona, the `query_employees` MCP tool, faceted worker search, and the unified graph. IWant is retrieval-by-intent over a governed record. Design: expose an **HR coworker "ask" affordance** on the People/employee surfaces (and mobile) that answers NL questions ("who's on leave next week", "show me everyone whose cert expires this quarter", "what did I earn YTD") by planning over `query_employees` + the graph — **permission-scoped and WWWD-aware**, so an employee sees only their own data and a manager only their scope. This *also subsumes Paycom's "Ask Here"* (routed HR Q&A with audit trail) into one coworker. DPF's edge: the answer is governed and audited by construction, and the same coworker can *act* (file the PTO, update the address), not just retrieve.

### 9.4 Direct Data Exchange → honest adoption-ROI, not adoption-pressure

**What Paycom does:** instruments self-service adoption and dollarizes ROI in-product (implicitly to pressure customers into pushing work to employees).

**DPF design:** DPF has cost/telemetry substrate (`TokenUsage`, `AdapterRunTelemetry`, budget events). Design: a **workforce adoption-ROI panel** that measures how much of the routine HR/payroll path the coworkers + self-service now own vs. human-handled, and the time/cost delta. DPF's edge and its **ethical differentiation**: because DPF's model is "the AI does the work," the ROI story is "look how much the coworker absorbed," **not** "look how much work your employees are doing for you." Same measurement loop, inverted incentive — and it avoids the resentment that Paycom's DDX-driven adoption pressure creates.

### 9.5 The turnover-proof dedicated specialist

Paycom's single biggest reputational liability is **~6-month specialist rotation** forcing clients to re-explain their setup. DPF's HR/payroll coworkers carry **persistent account memory** (EP-COWORKER-IDENTITY-360, WSID corpus). The "dedicated specialist who knows your account" becomes true *by construction* and never rotates — a direct, marketable answer to Paycom's worst reviews. No new record needed; this is a positioning + coworker-memory design consequence, called out so it is not lost.

---

## 10. The BI long-tail (FILED 2026-08-06 under epic EP-F7BD23BB)

> **Status update (2026-08-06):** epic **`EP-F7BD23BB` — "HCM Autonomous Delight — the level-5 coworker overlay on the HCM record"** was created beneath `EP-COMPANY-OPS-PARITY`, with this doc attached as its spec. All ten P-items below are **filed and linked** (BI IDs in the table). They sit at `triaging`/Captured — the next step is running each through the demand funnel (classify → score impact/confidence → effort estimate + source → investment bucket) and trace-linking to its `BusinessCapability`; that scoring is deliberately left for the prioritization pass rather than fabricated here.

Two buckets. **Do not re-file the "tracked" record-and-workflow items** — reference the scorecard. The **net-new Paycom-distinctive** items are filed below, each as a level-5 (Autonomous) promotion or a net-new record the delight layer rides on.

### 10a. Already tracked by the Workday scorecard — reference, do not duplicate
Effective dating (cap 5), compensation on the spine (9), benefits (11), recruiting UI (13), learning (14), worker documents (15), performance depth (12), analytics (19), worker search (20), payroll-connector + pay-run record (10). These are the *prerequisites*; the Paycom layer sits on top of them.

### 10b. Net-new, Paycom-distinctive (this study's contribution)

All ten are filed under **EP-F7BD23BB** (the "Owning epic" column names the *domain* epic whose record each rides on; the delivery home is EP-F7BD23BB).

| # | BI | Seed BI | Domain epic / prereq | Rides on (prereq) | Level | Size |
| --- | --- | --- | --- | --- | :-: | :-: |
| P1 | `BI-69F90E42` | **Beti-style employee-confirmed payroll** — `PayRun`/`Payslip` review state machine + employee-facing pre-run payslip + AI pre-audit-anomaly surface + confirm gate | EP-PAYROLL-COMP-BENEFITS | cap 10 pay-run record | 5 | xlarge |
| P2 | `BI-4D030159` ★lead | **Kernel-decided time-off (GONE analog)** — leave-decisioning coworker calling `principle_decide` with staffing/balance/seniority inputs; auto-approve/deny with contribution-ledger rationale; escalate-by-exception | EP-WORKFORCE-OPS | cap 6 leave (have) | 5 | large |
| P3 | `BI-E0781A9E` | **Governed NL HR/payroll access (IWant + Ask Here analog)** — HR coworker "ask" affordance on People/employee/mobile; plans over `query_employees` + graph; permission-scoped + WWWD-aware; can retrieve *and* act | EP-PEOPLE-HCM-CORE (+ EP-COWORKER-IDENTITY-360) | cap 20 search (partial) | 5 | large |
| P4 | `BI-84E69E14` | **Workforce adoption-ROI panel (DDX analog, inverted)** — measure coworker + self-service share of the routine HR/payroll path and the time/cost delta; framed as coworker-absorbed labor, not employee-offloaded | EP-PLANNING-ANALYTICS | cap 19 analytics | 5 | medium |
| P5 | `BI-70458424` | **Mobile HR self-service** — pay-stub, PTO, benefits, tax docs, manager approvals in `apps/mobile` (Beti confirm + Manager-on-the-Go analog) | EP-PEOPLE-HCM-CORE | P1, cap 11 benefits | 4→5 | large |
| P6 | `BI-7C19F370` | **Employee wage statements + statutory report pack** — W-2 / 1099 / ACA 1095-C / EEO-1 generation on the pay-run + demographic records | EP-PAYROLL-COMP-BENEFITS | cap 10, `DemographicResponse` (have) | 4 | large |
| P7 | `BI-39EC0901` | **On-demand / earned-wage access (Everyday analog)** — accrued-earnings draw against the pay-run record, no third-party fee | EP-PAYROLL-COMP-BENEFITS | P1 | 4 | medium |
| P8 | `BI-B5C9D416` | **Expense depth — mileage/per-diem policy engine + card-feed import (FAVR analog)** — extend `ExpenseClaim`/`ExpenseItem` | EP-PAYROLL-COMP-BENEFITS | ExpenseClaim (have) | 4 | medium |
| P9 | `BI-1BE64DFD` | **Turnover-proof AI HR specialist** — persistent-account-memory positioning for the HR/payroll coworkers; golden-journey cert as the "dedicated specialist" | EP-COWORKER-IDENTITY-360 | coworker memory (have) | 5 | small |
| P10 | `BI-CF6F66D7` | **Compliance depth — COBRA, garnishment admin, WOTC tax credits** — depth records on benefits/payroll (partial-parity, lower delight) | EP-PAYROLL-COMP-BENEFITS | cap 11, cap 10 | 4 | medium |

**Rough shape:** 1 xlarge, 4 large, 4 medium, 1 small — a single delight-layer slice fundable on top of the Workday record-and-workflow program. The three that carry nearly all the delight and the clearest DPF-beats-Paycom story are **P1 (Beti), P2 (GONE), P3 (IWant)** — and all three are *cheaper for DPF than for Paycom* because the decision kernel, coworkers, and unified graph already exist.

---

## 11. Open questions & next step

- **Epic home:** do P1–P10 attach to the existing HCM domain epics (as above), or does the delight layer get its own epic (e.g. `EP-HCM-AUTONOMOUS-DELIGHT`) beneath `EP-COMPANY-OPS-PARITY`, mirroring the scorecard's open question 11.3? Recommend a dedicated epic so the level-5 layer is fundable as a distinct slice.
- **Sequencing vs. the scorecard:** P1/P3/P5 depend on prerequisites still at level 1–2 (pay-run record, benefits). P2 (GONE) is the **cheapest high-delight win** — its record (leave) is already level 3 and the kernel exists, so it can lead.
- **The single-database claim:** DPF should *market* its unified graph as the "truly single database" — it is already the architecture Paycom charges a premium for. Worth a positioning note, not a BI.
- **Beti adoption ethics:** validate the "AI does the work, human confirms" framing with the founder before P1 scoping — it is the load-bearing difference from Paycom and the answer to Paycom's worst reviews.

**Next step (planning phase, when we move past doc-only):** file P1–P10 through the demand funnel (classify → link this doc as evidence → score impact/confidence → effort estimate + source → investment bucket), trace-link each to its `BusinessCapability`, and let priority fall out of the score — same mechanism the scorecard §8 defines. Lead with **P2 (GONE)** as the proof-of-concept for kernel-decided HCM.
