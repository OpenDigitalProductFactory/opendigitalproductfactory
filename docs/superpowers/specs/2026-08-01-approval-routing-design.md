# Accountable-Approver Routing — Design

- **Date:** 2026-08-01
- **Backlog item:** BI-HCM-004 — Organization chart, manager scope, and approval routing
- **Status:** implemented (service + first consumer)
- **Depends on:** [`2026-07-30-interactive-org-chart-design.md`](2026-07-30-interactive-org-chart-design.md)

## Why this exists

BI-HCM-004 asks that "workforce/payroll/expense approvals can ask the org service for the correct
accountable manager." Today no such service exists. Each domain hand-rolls a single hop:

- **Leave** reads `request.employeeProfile.managerEmployeeId` directly (`lib/actions/leave.ts`).
- **Timesheets** query `where: { managerEmployeeId }` for direct reports only
  (`lib/workforce/timesheet-data.ts`).

`EffectiveAuthContext.managerScope` already computes `directReportIds` / `indirectReportIds`, but
it is consumed only for record *access* (`canAccessEmployeeScope` → `canAccessEmployeeRecord`).
Nothing routes approvals through it.

None of these handle the cases that actually strand work: manager unset, manager unable to act, or
a reporting loop.

## The defect this surfaced

While wiring the first consumer it became clear that `approveLeaveRequest` and
`rejectLeaveRequest` had **no authorization beyond an authenticated session**. Both loaded the
requester's `managerEmployeeId` and never compared it to anything, so any signed-in user could
approve or reject anyone's leave — deducting their balance — with `approverEmployeeId` recording
whoever clicked, or `null` when they had no employee profile.

That is fixed here, and it is the reason this slice ships with a consumer rather than as a
standalone service.

## Design

`apps/web/lib/workforce/approval-routing.ts` — pure, DB-free, callers supply rows.

```
resolveAccountableApprover(rows, employeeProfileId) -> ApprovalRouting
```

Two operator decisions are encoded deliberately.

### 1. Fail loudly; never invent an approver

An unresolvable chain returns `resolved: false` with a typed reason — `no-manager-set`,
`chain-exhausted`, `reporting-loop`, `employee-not-found` — never a fallback approver.

A role backstop (e.g. route to HR-000 when nobody is found) was considered and rejected: it keeps
work moving by quietly landing decisions on someone with no relationship to the person, and it
makes a broken reporting structure *invisible* because the backstop keeps absorbing it. The org
chart's "No manager" count only stays meaningful if the gap is felt somewhere.

`describeUnresolvedRouting` renders plain-language operator copy that names the fix, e.g.
"Kofi Wolfe has no manager set, so there is nobody to approve this. Set their manager on the org
chart."

### 2. Skipping an on-leave manager is transient, not a handoff

Statuses that cannot act: `inactive`, `offboarding`, `suspended`, `leave`, `offer`, `onboarding`.
The last two because someone who has not started cannot be accountable.

`leave` is the only *transient* reason, and it drives `onBehalfOf`: the first absent manager the
walk passes is recorded, so the approval stays attributable to them rather than silently becoming
the deputy's decision. When several are away it attributes to the first. A permanent departure
leaves `onBehalfOf: null` — no false attribution.

This refines the raw "skip on-leave managers" decision. Skipping alone would let a one-day absence
permanently reassign a decision, because nothing routes it back on return.

### Reporting loops resolve when a member can act

A loop terminates the walk rather than hanging. It does **not** automatically block approval: in a
mutual A↔B loop, B really is A's manager and really can act, so refusing would strand work over a
data problem the chart already surfaces as "Reporting loop detected". The loop decides the outcome
only when nobody in it can act, and a loop *above* a working manager never blocks people below it.

Two unit tests initially asserted the opposite; they were wrong and were corrected rather than the
code being bent to match them.

Cycle safety comes from reusing `collectAncestorIds` (shipped with the chart), which is why the
chart's cycle guard is a prerequisite for routing rather than a nicety — a detached branch has no
path to anyone accountable.

## Not in this slice

- **Timesheets still route single-hop.** `getPendingTimesheetsForManager` queries direct reports
  only, so an on-leave manager's reports are invisible to anyone else. Next consumer.
- **Delegated approval** (an explicit deputy, distinct from an inferred one) is not modelled.
  `onBehalfOf` is the attribution primitive it would build on.
- **Expenses and other approval surfaces have not been swept.** Given `leave.ts` had zero
  authorization checks, they should not be assumed sound.

## Verification

- `apps/web/lib/workforce/approval-routing.test.ts` — 22 tests: each blocking status, on-leave
  attribution (single, multiple, and permanent-departure cases), all four unresolved reasons, loop
  handling, and the operator copy.
- Typecheck clean; 150 tests green across the affected suites.

## Addendum — same day: second consumer, and the same hole again

Timesheets were the planned next consumer. Sweeping the approval surfaces first (because
`leave.ts` having *zero* authorization meant none could be assumed sound) found
`approveTimesheet` and `rejectTimesheet` carrying the **identical defect**: no authorization
beyond an authenticated session, `approvedById` recording whoever clicked or `null`. Timesheets
feed payroll.

Both now route through the org chart. The authority check moved out of `leave.ts` into
`apps/web/lib/workforce/approval-authority.ts` so the two surfaces share ONE rule — writing a
second private copy is how the codebase arrived at two surfaces with no rule at all.

### Sweep result, for whoever picks this up next

Counting authorization references across the action files that export `approve*`/`reject*`:

| Zero references | Has references |
| --- | --- |
| `civic-governance`, `compliance-proposals`, `crm`, `research-proposals` | `build`, `change-management`, `decomposition-actions`, `edge-nodes`, `federation-links`, `federation-proposals`, `finance`, `organization-join`, `promotions`, `proposals`, `skill-proposal-actions` |

`leave` and `timesheet` were in the left column and are now fixed. **A zero count is a signal to
look, not proof of a hole** — some surfaces may authorize by another route. The four remaining
have not been read and are not claimed to be defective; they are the next place to look.

## Addendum 2 — the four remaining surfaces, read (BI-1017777D)

All four were read. **Two were clean, two were defective**, which is the point of the caveat
above: the grep is a search heuristic, not a verdict.

| Surface | Verdict | Authority |
| --- | --- | --- |
| `civic-governance` | **Clean** | Every action opens with `requireManageCompliance()` |
| `compliance-proposals` | **Clean** | `requireViewCompliance()` to propose, `requireManageCompliance()` to approve/reject — the propose/approve split was already deliberate |
| `crm` | **Defective — fixed** | `acceptQuote` / `rejectQuote` had *no* check at all, not even a session read |
| `research-proposals` | **Defective — fixed** | `approve*`/`decline*` checked `session.user.id` and nothing else |

### The regex was the weakest part of the sweep

`requireManageCompliance` matches none of the alternatives in the original pattern, so both clean
surfaces scored zero. Worse, **`leave` and `timesheet` still score zero after being fixed** —
`authorizeApprovalDecision` doesn't match either. A zero is worth roughly one thing: read the file.
Do not build a gate on this count.

### Authority chosen per surface, and why not the org chart

Neither fix uses `approval-authority.ts`. That helper resolves an *accountable manager* by walking
the org chart, which is the right question for leave and timesheets and a meaningless one for a
customer's quote or a market-research question — neither has an employee subject to walk up from.
Both fixes instead use the shared capability primitive:

- **`crm.acceptQuote` / `rejectQuote` → `requireCapability("operate_customer")`** (via the existing
  `lib/actions/shared/guards.ts`). Accepting is not a draft edit: it creates a `SalesOrder`, closes
  the opportunity WON, and auto-generates an invoice. `operate_customer` shares a role set with
  `view_customer`, so no user who can see the button loses it.
- **`research-proposals` → `can(..., "manage_business_models")`**, kept inline because these actions
  contract for an `{ ok, error }` result rather than a throw — the case `shared/guards.ts` explicitly
  documents as not routing through `requireCapability`. Proposals are scoped to a digital product /
  product line / business product, so product-direction authority is the right source.

### Every entry point carries its own authority

`crm.ts` had three callers, and only guarding the action would have broken one of them:

- `/api/v1/customer/quotes/[id]` — authenticates separately via `authenticateRequest`. Unchanged.
- `QuoteLifecycleActions.tsx` — the internal portal button. Now guarded.
- `quote-accept-public.ts` — the PUBLIC `/s/quote/[token]` flow, where a signed-out customer accepts
  their own quote. Token possession *is* the authority. It now calls `acceptQuoteImpl` directly
  rather than the guarded action, so the internal guard cannot lock out the customer it was never
  aimed at. `logSystemActivity` moved to `lib/crm/crm-activity.ts` so both paths share one writer.

There is **no Next.js middleware in `apps/web`**, so a page-level or layout-level guard does not
protect a server action — the action body runs before any render-time redirect. Every exported
`"use server"` function is its own endpoint and must carry its own check. That is the structural
reason these holes keep appearing.

### Still open

- `crm.ts` and `customer-sites.ts` have **zero authorization across every action**, not just the
  quote decisions — `createCustomerAccount`, `closeOpportunity`, `sendQuote` and ~15 others remain
  unguarded. Out of scope here (this BI is the approval surfaces); worth its own item.
- `listPendingResearchProposalsAction` still gates on session alone, leaking pending research topics
  to any signed-in user. Lower severity than the decision actions, not fixed here.
