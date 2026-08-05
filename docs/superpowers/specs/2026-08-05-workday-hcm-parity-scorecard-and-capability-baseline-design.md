# Workday HCM Parity — Scorecard, Capability Baseline, and Definition of Done

- **Date:** 2026-08-05
- **Status:** Draft — substrate-verified 2026-08-05
- **Author:** Claude (Enterprise Architect lens)
- **Epic:** EP-COMPANY-OPS-PARITY — "Company Operations Parity Map — Workday and QuickBooks capability roadmap"
- **Backlog item:** BI-COP-001 (reopened 2026-08-05 — see §2)
- **Domain epics:** EP-PEOPLE-HCM-CORE · EP-WORKFORCE-OPS · EP-PAYROLL-COMP-BENEFITS · EP-PLANNING-ANALYTICS · EP-EMPLOYEE-OCCUPATION
- **WWMD:** `principle_decide` 2026-08-05 (external_coding_agent) → `native-system-of-record-integrate-regulated-calculation`, composite 15.17 vs 6.15 / 4.70, margin 9.02, high confidence, no commandment conflict. Ledger `DI-C96E18158DE5`.
- **Founder direction:** 2026-08-05 — *"I want a design and plan that is full workday, backlog for the long tail of investments scoped that we can use to track, prioritize and budget for full parity."*

---

## 1. Purpose

Define **what Workday functional parity means for DPF, as a finite and checkable list**, record the current state of every capability in it against verified evidence, and convert the remainder into a scoped, sized, prioritizable backlog.

The deliverable is deliberately **not** another document that describes the gap. It is a **live measure**: the capability tree in `BusinessCapability` carries `currentMaturity` / `targetMaturity` per capability, `BusinessCapabilityTraceLink` connects each gap to the backlog item that closes it, and the burn-down renders at `/portfolio/architecture`. This document defines the ladder and the scoring rules; the database carries the score.

## 2. The failure this corrects

BI-COP-001 asked for exactly this scorecard on 2026-07-19. It was closed `done` on 2026-07-26 with a resolution citing `docs/superpowers/specs/2026-07-24-company-running-mvp-profile-design.md`.

That document disclaims being this deliverable, twice, in its own text:

> **Non-goals:** "This doc does not replace BI-COP-001 (the durable Workday/QuickBooks parity scorecard) — it is a narrower, operationally-focused cut for 'can I run my company today', while BI-COP-001 is the full competitive-parity map."

> **Method:** "BI-COP-001 (parity scorecard) is the durable place for functional evidence per capability; this doc should be read alongside it **once that scorecard exists**."

No scorecard file existed in the repo and BI-COP-001 carried no `specPlanFiles`. **The item was closed against an artifact that says the item's deliverable does not exist.**

The consequence is the operating complaint that produced this document: since 2026-07-26 the platform has had no parity baseline and no definition of done, so HCM work has proceeded as a series of locally-sensible increments with nothing to be measured against. BI-6AF732E3 (2026-08-05) is a partial hand re-derivation of this scorecard, which is the symptom.

BI-COP-001 is reopened. This document is its deliverable.

## 3. Research & Benchmarking (AGENTS.md §7)

### 3.1 What Workday actually is

Workday sells several products; "Workday parity" without qualification is ambiguous, which is part of why the target has been unmeasurable. The HCM-relevant surface:

| Workday product area | Core capability |
| --- | --- |
| **Core HCM** | Worker record, supervisory/matrix organizations, position & job management, staffing models, business processes (the workflow engine underneath every transaction) |
| **Absence Management** | Leave/absence plans, accrual rules, entitlement balances, requests and approvals |
| **Time Tracking** | Time entry, calculation rules, overtime/rounding, approvals, feeding payroll |
| **Compensation** | Compensation plans, grades and bands, **effective-dated** comp history, merit/bonus cycles |
| **Payroll** | Gross-to-net calculation, statutory tax, deductions, filings (native in a few countries; Payroll Connect elsewhere) |
| **Benefits** | Plan setup, open enrolment, life events, carrier exchange |
| **Recruiting** | Requisition, job posting, candidate pipeline, interview, offer, hire |
| **Talent & Performance** | Goals, reviews, feedback, calibration, succession, career profiles |
| **Learning** | Course catalogue, enrolment, completions, certifications |
| **Workforce Planning / Adaptive** | Headcount planning, scenario modelling |
| **People Analytics / Prism** | Cross-domain workforce reporting |

The architecturally load-bearing observations, independent of feature count:

1. **Effective dating is the spine.** In Workday nearly every worker attribute is a dated row, not a current value. "What was her salary in March" and "who reported to whom on 1 Jan" are first-class queries, and retroactive correction is a supported operation rather than a data fix. A platform can match Workday's screen inventory and still not be equivalent if its attributes are scalars.
2. **Business Processes are a shared engine.** Hire, promote, terminate and comp-change are all instances of one configurable approval/condition/notification engine, not bespoke per-transaction workflows.
3. **One worker object.** Employees, contingent workers and applicants resolve to a single identity across every module.

### 3.2 Open-source comparators (required by §7)

| System | What it gets right | What DPF takes / rejects |
| --- | --- | --- |
| **OrangeHRM** | Broad, conventional HR module coverage (PIM, leave, time, recruitment, performance) at SMB scale | **Adopt:** the pragmatic SMB module boundary — it maps closely to DPF's market. **Reject:** current-value-only records; it has no general effective-dating spine, which is the very thing that makes retro correction and history reporting possible. |
| **Odoo HR** | Clean model separation (`hr.employee`, `hr.contract`, `hr.leave`); contract as a distinct dated object | **Adopt:** the *contract/employment as a dated object distinct from the person* pattern — the cheapest route to effective-dated employment and compensation. **Reject:** its module-per-feature sprawl, which fragments the worker record across apps. |
| **Frappe/ERPNext HR** | Full HR + payroll in one schema, with salary structures and assignment history | **Adopt:** salary-structure-assignment-with-effective-date as the concrete shape for compensation history. **Reject:** its native payroll tax engine — see §4. |

**Anti-pattern avoided (all three, and DPF today):** storing compensation as scalar columns on the worker row. DPF currently does exactly this (`EmployeeProfile.payType/hourlyRate/annualSalary/standardAnnualHours`), which is why no compensation history exists.

### 3.3 What "parity" will and will not mean

DPF is not becoming Workday. Workday is a configurable enterprise HCM suite for large employers; DPF is an AI-coworker-native platform for SMB and vertical-services operators. Parity is therefore defined as: **for every capability in §6, DPF holds the system-of-record and the workflow that a coworker or a report needs, at the target maturity in §5** — not "DPF ships Workday's configuration surface".

Two exclusions are asserted, not deferred, and are recorded as decisions rather than gaps:
- **Enterprise org-design modelling** (matrixed multi-entity global mobility, headcount planning at enterprise scale) — out of market.
- **Configuration-as-product** (Workday's tenant configuration toolkit) — DPF's equivalent is archetype templates plus coworkers, which is a different and deliberate answer.

## 4. Decision — delivery posture (WWMD)

`principle_decide` ledger `DI-C96E18158DE5`:

| Option | Composite | Verdict |
| --- | --- | --- |
| **native-system-of-record-integrate-regulated-calculation** | **15.17** | **Recommended — high confidence, margin 9.02** |
| integrate-first-thin-native-shell | 6.15 | Rejected |
| native-everything-including-payroll-engine | 4.70 | Rejected |

**DPF natively owns every HCM system-of-record** — worker, org, position, absence, time, effective-dated compensation, performance, benefit *elections*, recruiting pipeline, learning records, documents, succession — because its coworkers cannot reason over an estate they do not hold.

**DPF integrates only the regulated calculation engines** — payroll gross-to-net and statutory filing, and benefits carrier exchange — behind a governed connector. Those carry per-jurisdiction statutory liability and continuous re-certification; owning them converts a bounded build into a permanent compliance obligation in every jurisdiction. This is consistent with the existing edge-adapter-to-native convergence doctrine (BI-COP-005) and with the ADP integration design already in the repo.

**Parity is therefore measured on the record and the workflow, not on owning a tax engine.** A capability whose target posture is `integrate` reaches its target maturity when the record, the workflow, the audit trail and the connector round-trip all work — not when DPF computes withholding itself.

## 5. The measure — maturity ladder and definition of done

`BusinessCapability` already carries `currentMaturity` and `targetMaturity` (1–5) and `BusinessCapabilityTraceLink` already links a capability to a `backlogItemId`. Neither has been used: at 2026-08-05 every one of the 34 capabilities sits at the seed default `current=1, target=3`, and there are **zero** trace links. This section defines what those numbers mean so they stop being defaults.

| Level | Meaning | Evidence required to claim it |
| --- | --- | --- |
| **1 — Absent** | No substrate | No Prisma model |
| **2 — Recorded** | The data model exists and is seeded | Model in `schema.prisma` + seed coverage |
| **3 — Governed** | A governed write path and a working UI surface | Server action wrapped in the governance/audit path (writes `AuthorizationDecisionLog`) + a reachable route + functional verification on the live install |
| **4 — Operated** | The full lifecycle: approvals, effective dating where the domain needs it, audit history, reporting, and self-service where the worker owns the action | Approval routing through the org chart, dated history queries, a report or grid, and role-appropriate self-service |
| **5 — Autonomous** | An AI coworker owns the routine path end-to-end, escalating by exception | Coworker service registered, golden-journey certification |

**Definition of done for Workday HCM parity:**

> **Zero capabilities in the People sub-tree below their `targetMaturity`.**

Checkable at any moment, by anyone, at `/portfolio/architecture` — no interpretation required and no agent's opinion involved. Target maturity is **4** for every capability in §6 unless the row says otherwise; level 5 is roadmap, not parity.

## 6. Capability baseline and scorecard

Current maturity below is **evidence-based as of 2026-08-05**. Rows marked ⚠ were verified functionally on the running portal this session; the rest are schema/code-level and must be functionally re-verified before their level is trusted (per the `structural-verification-is-not-functional` commandment).

| # | Capability | Workday benchmark | DPF current evidence | Cur | Tgt | Posture | Owning epic |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Worker record | Core HCM worker object | `EmployeeProfile`, `EmployeeAddress`, `EmploymentEvent`, `TerminationRecord`; governed CRUD + editable grid, audit rows verified ⚠ | **3** | 4 | native | EP-PEOPLE-HCM-CORE |
| 2 | Organization & reporting | Supervisory orgs | `Department`, org chart with governed reassignment, approval routing | **3** | 4 | native | EP-PEOPLE-HCM-CORE |
| 3 | Position & job management | Position management | `Position`, `EmploymentType`, `WorkLocation` | **2** | 4 | native | EP-PEOPLE-HCM-CORE |
| 4 | Employment lifecycle | Hire/transfer/terminate BPs | `EmploymentEvent` (dated), `OnboardingChecklist`/`OnboardingTask`, `TerminationRecord`, `validateLifecycleTransition` | **3** | 4 | native | EP-PEOPLE-HCM-CORE |
| 5 | **Effective-dated attributes** | The Workday spine | **Absent as a general mechanism.** `EmploymentEvent` is dated for lifecycle only | **1** | 4 | native | EP-PEOPLE-HCM-CORE |
| 6 | Absence / leave | Absence Management | `LeavePolicy`, `LeaveBalance`, `LeaveRequest` + approval authority | **3** | 4 | native | EP-WORKFORCE-OPS |
| 7 | Time tracking | Time Tracking | `TimesheetPeriod`, `TimesheetEntry`, approval panel, billable context | **3** | 4 | native | EP-WORKFORCE-OPS |
| 8 | Scheduling & staffing | Scheduling (Workday adjacent) | 11 `Staffing*` models, availability windows, preferences, solver | **3** | 4 | native | EP-WORKFORCE-OPS |
| 9 | **Compensation** | Comp plans, grades, dated history | **Scalar columns on `EmployeeProfile`** — no history, no effective dating, no bands | **2** | 4 | native | EP-PAYROLL-COMP-BENEFITS |
| 10 | Payroll | Gross-to-net + filings | `lib/hr/payroll.ts`, `labor-service.ts`; ADP integration design exists; `Tax*` substrate present | **2** | 4 | **integrate** | EP-PAYROLL-COMP-BENEFITS |
| 11 | **Benefits** | Benefits Administration | **Absent** — no plan, enrolment, election, dependant or carrier model | **1** | 4 | native record + integrate carrier | EP-PAYROLL-COMP-BENEFITS |
| 12 | Performance & goals | Talent & Performance | `ReviewCycle`, `ReviewInstance`, `ReviewGoal` | **2** | 4 | native | EP-EMPLOYEE-OCCUPATION |
| 13 | **Recruiting / ATS** | Recruiting | **Absent** — no requisition, applicant, stage, interview or offer model. A person can only be created already-hired | **1** | 4 | native | EP-PEOPLE-HCM-CORE |
| 14 | **Learning & certification** | Learning | **Absent** for workers. `SkillDefinition`/`SkillAssignment` exist but serve agent capability, not worker learning | **1** | 4 | native | EP-EMPLOYEE-OCCUPATION |
| 15 | **Worker documents** | Worker documents | **Absent** — no worker-scoped document model (contracts, right-to-work, signed policy) | **1** | 4 | native | EP-PEOPLE-HCM-CORE |
| 16 | **Succession & talent pool** | Succession | **Absent** | **1** | 3 | native | EP-EMPLOYEE-OCCUPATION |
| 17 | Worker self-service | Employee experience | `/employee` My Policies, timesheets, leave requests | **3** | 4 | native | EP-EMPLOYEE-OCCUPATION |
| 18 | Workforce planning | Adaptive Planning | Partial via EP-PLANNING-ANALYTICS; no headcount plan model | **1** | 3 | native | EP-PLANNING-ANALYTICS |
| 19 | People analytics | People Analytics / Prism | Workbook grids + reporting substrate; no worker-domain report pack | **2** | 4 | native | EP-PLANNING-ANALYTICS |
| 20 | Worker search & bulk ops | Core HCM | Directory renders all cards; grid gives filter/sort. No faceted worker search, no mass action | **2** | 4 | native | EP-PEOPLE-HCM-CORE |

**Baseline score: 20 capabilities, aggregate current 41 / target 78 → 52.6% of target maturity.** Six capabilities are at level 1 (absent). That number is the burn-down, and it is the answer to "when are we done".

## 7. The long tail — what gets filed

Each row below becomes a `BacklogItem` under the named epic, sized, and trace-linked to its capability. Sizes are t-shirt estimates for budgeting, not commitments.

| Capability | Work | Size |
| --- | --- | --- |
| 5 Effective dating | Dated-attribute mechanism (worker/job/comp), retro correction, as-of queries | **xlarge** |
| 9 Compensation | `CompensationAssignment` with effective dates, grades/bands, comp history UI, merit cycle | **large** |
| 11 Benefits | Plan/enrolment/election/dependant models, open enrolment + life events, carrier connector | **xlarge** |
| 13 Recruiting | Requisition → posting → applicant → interview → offer → hire, converting to `EmployeeProfile` | **xlarge** |
| 14 Learning | Course, enrolment, completion, certification + expiry alerting | **large** |
| 15 Worker documents | Worker-scoped documents with retention and access control | **medium** |
| 16 Succession | Successor/readiness/talent pool | **medium** |
| 3 Position mgmt | Position lifecycle, headcount-vs-filled, vacancy | **medium** |
| 10 Payroll | Governed payroll-provider connector + pay-run record and audit | **large** |
| 12 Performance | Calibration, continuous feedback, review→comp linkage | **large** |
| 18 Workforce planning | Headcount plan + scenario | **large** |
| 19 People analytics | Worker report pack + headcount/turnover/absence metrics | **medium** |
| 20 Worker search | Faceted worker search + bulk actions | **medium** |
| — | Wire the capability tree + trace links + maturity assessment (the measure itself) | **medium** |

**Rough budget shape:** 4 xlarge, 5 large, 5 medium. This is a multi-quarter program; the scorecard exists so it can be funded and sequenced in slices rather than estimated as a lump.

## 8. Prioritization and budgeting mechanism

DPF already has the funnel and it is unused — `get_backlog_item` on BI-COP-001 returns blockers *"Classify this demand before shaping it / Link at least one reviewed evidence source / Add score inputs: impact, confidence / Record who supplied the effort estimate / Choose an investment bucket."* That is a RICE-scored demand-activation pipeline with investment buckets, already built.

Every item filed from §7 runs that funnel: classify → link evidence → score impact/confidence → record effort estimate and its source → assign an investment bucket. Prioritization then falls out of the score rather than out of a conversation, and budget rolls up per bucket.

## 9. Phasing

1. **Phase 0 — arm the measure.** Populate the People capability sub-tree, set current/target from §6, trace-link existing open items. Nothing else can be tracked until this exists.
2. **Phase 1 — effective dating (capability 5).** The spine. Compensation history, org history and retro correction all depend on it; building comp history first would have to be redone.
3. **Phase 2 — compensation on the spine (9), then position management (3).**
4. **Phase 3 — the absent record domains**: benefits (11), recruiting (13), learning (14), documents (15), succession (16).
5. **Phase 4 — depth**: performance calibration (12), analytics (19), planning (18), search/bulk (20), payroll connector (10).

Ordering rationale: capability 5 is a prerequisite for 9 and for honest history in 1/2/4. Everything in phase 3 is independent and can run in parallel or be funded selectively.

## 10. Risks

- **The measure decays if maturity is self-assessed.** Level 3+ requires functional verification on the live install; a structural pass must not be recorded as a level. This session produced a worked example of why: the People grid passed every gate and unit test while the Edit form could not save any of the three workers with a blank last name (BI-E0982FB7).
- **Trace links rot.** A capability whose linked BIs are all closed but which is still below target must show as such.
- **`integrate` postures can hide an empty record.** A payroll connector that round-trips without a DPF-side pay-run record is not level 4.
- **Scope creep from Workday's configuration surface** — §3.3 exclusions must be re-asserted when reviewing, not silently reopened.

## 11. Open questions

- Contingent workers / contractors: one worker object with a type discriminator (Workday's model), or a separate record? Affects capabilities 1, 3, 13.
- Multi-entity: does an SMB install ever need more than one legal employer, and does that land in capability 2 or in Organization?
- Does `EP-COMPANY-OPS-PARITY` remain the parent for HCM parity, or does HCM parity get its own epic with the domain epics beneath it?
