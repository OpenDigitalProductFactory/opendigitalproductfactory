---
title: Main Portal Workspace Home Redesign — the company's day-to-day at-a-glance surface
date: 2026-06-06
status: draft — architect-authored, ready for founder review
owner: Mark Bodman (CEO)
author: Enterprise Architect persona (Claude, taking over the Codex effort)
scope: Redesign of the DEFAULT/fallback `/workspace` home (the surface every install lands on before — or instead of — a registered vertical contribution). Re-architects the command center, splits the schedule, and wires every zone to real loaders using the report-kit palette.
out_of_scope:
  - The per-archetype vertical worker homes (owned by the contribution roster + Dale visual specs; this spec is their default-mode sibling)
  - New schema / new dashboard-widget substrate
  - The external customer `/portal` surface
anchor_specs:
  - docs/superpowers/specs/2026-05-31-archetype-aware-workspace-design.md
  - docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md
  - docs/superpowers/specs/2026-05-24-workspace-home-primitive-registry-design.md
  - docs/superpowers/specs/2026-06-05-portal-navigation-archetype-ia-design.md
related_specs:
  - docs/superpowers/specs/2026-06-06-archetype-portal-screen-prototypes-design.md
  - docs/superpowers/specs/2026-05-24-dales-ac-repair-workspace-home-visual-design.md
  - docs/specs/reporting-ux-primitives-spec.md
primary_epics:
  - EP-REDUCTION-GEAR-ARCH
related_backlog:
  - BI-1CCC6264
  - BI-02845133
  - BI-5B8FE5C1
---

# Main Portal Workspace Home Redesign

## 1. Architect Verdict

**The vertical-home lineage fixed the wrong half of the screen first.** The whole `EP-REDUCTION-GEAR-ARCH` body of work — the resolver, the 11-primitive registry, the Dale HVAC visual anchor, the archetype-aware layering spec, the contribution roster — makes the *configured vertical* home excellent. But every install today renders the **default** home (`PlatformWorkspaceHome`), because `defaultWorkspaceHomeRegistry` is empty by design and most archetypes have no registered contribution yet. That default home is the screen Mark is looking at, and it is **not the company's day-to-day**. It is a platform-operator command center: a six-dimension readiness *maturity matrix*, a cross-domain tile launchpad, and a firehose calendar that mixes a customer's bookings with the platform's own cron digests and deployment windows.

This is the same defect the navigation/IA audit named on 2026-06-05: *"`/workspace` acts as a cross-domain launchpad instead of the archetype-specific daily work surface... 118 links in the sampled DOM... a health/status matrix [drilling] across domains."* ([portal-navigation-archetype-ia-design §Executive Verdict](2026-06-05-portal-navigation-archetype-ia-design.md)).

**Verdict:** the default `/workspace` home must be redesigned to answer one question — *"What is the immediate and next-up work for this business, in one compelling place?"* — using the **report-kit** palette we already shipped, wired to **real** loaders (no fabricated data), with the **full platform schedule moved off this page to an admin surface** and replaced by a *purposed* business schedule. The archetype-prototype spec ([2026-06-06](2026-06-06-archetype-portal-screen-prototypes-design.md)) left §7.1 as "preserve `PlatformWorkspaceHome`"; this spec closes that gap by redesigning the default home itself so it is a worthy at-a-glance surface for *any* business, including before a vertical contribution is registered.

This is the **default-mode sibling** of the archetype-aware spec, not a competitor. When a vertical contribution resolves, the archetype home wins (per [archetype-aware §Proposed IA](2026-05-31-archetype-aware-workspace-design.md)). When it does not — the common case today — the user gets *this* redesigned default home instead of operator chrome.

## 2. Problem Statement — what is wrong with the current default home

Current composition ([`apps/web/components/workspace-home/PlatformWorkspaceHome.tsx`](../../../apps/web/components/workspace-home/PlatformWorkspaceHome.tsx)):

1. **`BusinessCommandCenter`** ([`apps/web/components/workspace/BusinessCommandCenter.tsx`](../../../apps/web/components/workspace/BusinessCommandCenter.tsx)) renders, in order: a command strip, a 6-tile snapshot, a **6×6 "readiness matrix"** (AI workforce / customers / finance / compliance / people / platform-delivery × the *Six Cs* context/connections/capabilities/cadence/confidence/containment), and a work-in-motion grid. The readiness matrix is a **platform-maturity meta-view**. A bakery owner does not arrive asking "what is my AI-workforce containment posture?" — that is internal platform minutia.
2. **`WorkspaceCalendar`** ([`apps/web/components/workspace/WorkspaceCalendar.tsx`](../../../apps/web/components/workspace/WorkspaceCalendar.tsx)) renders a full `FullCalendar` with **10 source filters across 8 categories**, including `platform` cron `recurring-digest` jobs, `maintenance` events, `deployment-window`/`blackout` change-management, and `agent-task` runs. This is "everything the portal is scheduled to do" — the right data for an operator, the wrong altitude for a daily business home.
3. **`WorkspaceAreaLauncher`** ([`apps/web/components/workspace-home/WorkspaceAreaLauncher.tsx`](../../../apps/web/components/workspace-home/WorkspaceAreaLauncher.tsx)) is the cross-domain tile launchpad the IA audit flagged.
4. The **activity feed** ([`apps/web/components/workspace/ActivityFeed.tsx`](../../../apps/web/components/workspace/ActivityFeed.tsx)) is HR-centric (timesheets, leave, onboarding) rather than whole-business.

None of this is *wrong data* — it is **mis-prioritized altitude**. The redesign keeps every real signal but re-sorts it so the business's own immediate work is the first viewport and platform/operator concerns move to where operators look for them.

## 3. Design Goal & Principles

**Goal:** the default `/workspace` first viewport answers, at a glance, *what needs doing now and next* for the business — work, tasks, schedule, and activity — in one compact, compelling surface, built from reusable components and real data.

Principles (inherited from [archetype-aware §Design Principles](2026-05-31-archetype-aware-workspace-design.md); restated for the default home):

1. **Day-to-day first, platform-meta last.** The first viewport is the business's immediate + next-up work. Platform readiness/maturity is an operator concern, reachable but not resident here.
2. **Real data only — no fabrication.** Every tile, list, row, and schedule item binds to an existing loader. Zero placeholder/mock content. An empty real state renders a positive-empty or setup-action state (per [archetype-aware §Degraded and Missing-Data Behavior](2026-05-31-archetype-aware-workspace-design.md)), never invented rows.
3. **Compose report-kit, don't hand-roll.** KPI tiles use `StatCard`; lists use `DataTable`; status uses `StatusBadge`/`statusColors`; filters use `FilterBar`; trend charts use `Chart`. No local color maps, no bespoke `<table>` markup ([report-kit README](../../../apps/web/components/ui/report-kit/README.md)).
4. **Purposed schedule, not the firehose.** The home schedule shows business context only. The full multi-source schedule becomes an admin surface (§6).
5. **No second substrate.** Extend the workspace-home loaders, the command-center builder, the calendar projector, and report-kit. No new `Dashboard`/`Widget` table.
6. **Theme-aware.** `var(--dpf-*)` tokens and report-kit intent helpers only.

## 4. Redesigned First-Viewport Layout

The default home re-uses the canonical zone vocabulary from [archetype-aware §Proposed IA](2026-05-31-archetype-aware-workspace-design.md) (`critical-strip` / `primary` / `secondary` / `briefing` / `setup`) so the default home and vertical homes are structurally consistent.

```text
Workspace — <Business name>                       [Today · <weekday>, <date>]   [+ New ▾]

CRITICAL STRIP  (actionable rows, not just counts)
  [⚠ now]  Invoice #1048 overdue 12d · Acme Co · → /finance/invoices/1048
  [⚠ 10:30] Booking unconfirmed · J. Patel · → /storefront/inbox/...
  [• today] 2 approvals waiting on you · → /ops/improvements

PRIMARY ZONE  — "What needs doing now and next"
+-------------------------------+ +-------------------------------+
| Today & Next                  | | My / team work queue          |
| (purposed business schedule)  | | open + in-progress, by owner  |
|  09:00 Booking — Patel        | |  ⬤ Draft proposal — you       |
|  11:30 Invoice due — Acme     | |  ⬤ Follow-up call — A. Lee    |
|  14:00 Provider: Sam off      | |  ⬤ Review timesheet — (mgr)   |
|  → open full business calendar| |  → /ops  · → /workspace/my-queue|
+-------------------------------+ +-------------------------------+

SECONDARY ZONE  — at-a-glance business health (StatCards, real metrics)
[ Open work N ] [ Outstanding $X ] [ Customers N ] [ Bookings today N ] [ Overdue N ]

BRIEFING ZONE  — AI coworker handoffs + activity
+-------------------------------+ +-------------------------------+
| Coworker handoffs (PAR)       | | Recent activity               |
| AI-prepared replies/notes     | | what changed, who, when       |
| waiting for your go-ahead     | | (whole-business, role-scoped) |
+-------------------------------+ +-------------------------------+

SETUP RAIL (only while incomplete)
  Finish business setup · connect QuickBooks/Stripe · register worker home
```

### 4.1 First-viewport rule

Desktop first viewport (1366×768 floor, per the Dale density budget) must show: operating header, critical strip with ≥1 actionable row, the **Today & Next** business schedule, and the **work queue**. Secondary StatCards, briefing, and setup rail may sit below the fold — except the setup gap, which stays visible while the install is incomplete.

### 4.2 Mobile order

```text
Critical strip → Today & Next → Work queue → one setup gap → Coworker handoffs → Secondary StatCards → Recent activity
```

## 5. Zone → Component → Data Wiring (real, no fake data)

Every zone binds to a loader that already exists. The "Source today" column proves the data is real and wired; the "Component" column is the reusable primitive that renders it.

| Zone | What it shows | Component (reusable) | Real data source (existing) |
| --- | --- | --- | --- |
| Critical strip | Actionable exception rows (overdue money, unconfirmed/at-risk bookings, blocked work, approvals on you) | repurposed `BusinessCommandCenter` command strip + `StatusBadge` | `buildCommandStrip()` in [`command-center.ts`](../../../apps/web/lib/workspace/command-center.ts) — re-scoped to business exceptions (finance overdue, compliance, pending proposals); platform-only items (AI containment, broken providers, failed task runs) move to the admin operator view (§7) |
| Primary — Today & Next | Purposed **business** schedule: bookings, invoices/bills due, provider availability, CRM activity/pipeline deadlines, capacity-relevant HR (leave) | `DataTable` (compact agenda list) **or** a slimmed `WorkspaceCalendar` agenda view; `StatusBadge` for state; `LocalTime` for times | `getCalendarEvents()` in [`calendar-data.ts`](../../../apps/web/lib/workforce/calendar-data.ts), **filtered to business categories/sources** (§6.1). Same loader, narrowed projection — no new query |
| Primary — Work queue | Open + in-progress work the user (and, for managers, the team) must action | `DataTable` + `StatusBadge` | Backlog/work-item counts already loaded by `loadWorkspaceCommandCenter()` (`openBacklogCount`, `inProgressBacklogCount`); itemized rows via the existing `/ops` + `/workspace/my-queue` loaders |
| Secondary — health StatCards | ≤6 KPI tiles: open work, outstanding $, customers, bookings today, overdue items | `StatCard` (report-kit) | `WorkspaceMetrics` from [`command-center.ts`](../../../apps/web/lib/workspace/command-center.ts) — the same 6-tile snapshot, re-expressed as `StatCard`s with drill-down `href` and optional `delta` |
| Briefing — coworker handoffs | AI-prepared replies/notes/proposals waiting for the user (PAR acknowledge/reassign) | existing handoff rendering; `StatusBadge` | `CoworkerActionEnvelope` projection (per [archetype-aware §WWWD and Coworker Integration](2026-05-31-archetype-aware-workspace-design.md)); work-in-motion from `loadWorkspaceCommandCenter().commandCenter.workInMotion` |
| Briefing — recent activity | Whole-business recent changes, role-scoped | `ActivityFeed` (kept; broadened beyond HR where data exists) | `getActivityFeed()` in [`activity-feed-data.ts`](../../../apps/web/lib/activity-feed-data.ts) |
| Setup rail | One active setup gap + integration anchors | `StatCard`/notice + links | `buildAttentionItems()` + storefront/setup-activation state already loaded by `loadPlatformWorkspaceHomeData()` |

**No-fake-data rule (enforced):** components render only from these loaders. Where a loader returns zero rows, the component shows its declared empty/setup state — it must not synthesize illustrative rows. Tests assert that with empty inputs the rendered output contains no row content (only the empty-state copy).

## 6. The Schedule Split

Mark's instruction: *"The full schedule view is too much on this page... a better admin surface to see everything the portal is scheduled to do. A purposed schedule is needed here with the main business context, not internal platform minutia."*

The split runs along the calendar's **existing** `category`/`sourceType` axis ([`WorkspaceCalendar.tsx` `CATEGORY_CONFIG` / `SOURCE_FILTER_CONFIG`](../../../apps/web/components/workspace/WorkspaceCalendar.tsx)). No new event types, no new projector — just two bounded views over one loader.

### 6.1 Home — "Today & Next" (business context)

Default-home schedule shows **business** altitude only:

| Keep on home | Calendar category | Source filter | Event types |
| --- | --- | --- | --- |
| Bookings / appointments | `business` | `bookings` | `booking` |
| Customer activity & deadlines | `business` | `crm` | `crm-activity`, `pipeline-deadline` |
| Provider availability | `business` | `providers` | `provider-schedule` |
| Operating hours | `business` | `op-hours` | `operating-hours` |
| Money due | `finance` | `finance` | `invoice`, `bill`, `recurring-invoice` |
| Capacity-relevant people events | `hr` | (native/leave) | `leave` (coverage-affecting only) |
| Compliance deadlines | `compliance` | `compliance` | `compliance-deadline`, `audit`, `regulatory` |
| User-created events | `business`/`personal` | `native` | native |

Presented as a **compact agenda** (today + the next few days), not the month grid, so it earns its first-viewport slot. "Open full business calendar" links to the full month/week view *still scoped to these business sources*.

### 6.2 Admin — "Platform schedule" (everything the portal is scheduled to do)

Operator/platform altitude moves to a dedicated admin surface:

| Move to admin | Calendar category | Source filter | Event types |
| --- | --- | --- | --- |
| Scheduled platform jobs / cron digests | `platform` | `scheduled-jobs` | `recurring-digest`, `maintenance` |
| Deployment windows, blackouts, change requests | `operations` | `change-mgmt` | `deployment-window`, `blackout`, `change-request` |
| AI coworker scheduled task runs | `platform` | `agent-tasks` | `agent-task` |

**Route (architect default):** `/platform/schedule` — the platform family is the operator surface per the [IA route-ownership model](2026-06-05-portal-navigation-archetype-ia-design.md); `/ops` is the alternative if the implementer finds change-management already lives there. Whichever wins, the rule is one: *"everything the portal is scheduled to do"* lands under an operator route, gated by `view_platform`/`manage_platform`, and is reachable from the home only via an operator switch (per [archetype-aware §Resolved Review Q5](2026-05-31-archetype-aware-workspace-design.md)), not resident on the worker home.

**Reuse:** the admin surface renders the **same** `WorkspaceCalendar` component with the source/category set defaulted to the platform/ops subset — the calendar is already filter-driven, so this is configuration, not a fork.

## 7. Re-architecture of Existing Components

Nothing is thrown away — each current piece is repurposed to its correct altitude.

| Current component | Disposition | Where it goes |
| --- | --- | --- |
| `BusinessCommandCenter` **command strip** | **Keep, re-scope** to business exceptions | Critical strip on home |
| `BusinessCommandCenter` **snapshot (6 tiles)** | **Re-express as `StatCard`s** | Secondary zone on home |
| `BusinessCommandCenter` **readiness matrix (6×6 Six-Cs)** | **Move to operator surface** | A "Platform readiness" panel on `/platform` (or the operator-mode home), not the worker home. It is a maturity/governance view — exactly the platform minutia Mark flagged |
| `BusinessCommandCenter` **work-in-motion** | **Keep** | Briefing zone (handoffs/activity) |
| `WorkspaceCalendar` (full, 10 sources) | **Split** (§6) | Business subset → home agenda; full set → `/platform/schedule` admin |
| `WorkspaceAreaLauncher` (tile launchpad) | **Demote** | Moves below the fold / into the global rail per the IA audit's "convert cross-domain shortcuts into contextual actions" direction; it is navigation, not day-to-day work, so it must not outrank the work queue |
| `ActivityFeed` | **Keep, broaden** | Briefing zone; widen beyond HR where whole-business activity data exists |

The 6×6 readiness matrix relocation is the single most important change: it is the clearest instance of "internal platform minutia" occupying prime real estate on the business's daily screen.

## 8. Relationship to the Vertical-Home Lineage

| Surface | Owner spec | This spec's relationship |
| --- | --- | --- |
| Vertical archetype homes (HVAC dispatch board, clinic, retail, MSP…) | [vertical-workspace-home](2026-05-24-vertical-workspace-home-design.md), [Dale visual](2026-05-24-dales-ac-repair-workspace-home-visual-design.md), [contribution roster](2026-06-04-workspace-home-contribution-roster-design.md) | When a contribution resolves, the vertical home wins. This spec does not touch them. |
| Configuration layering, zones, report-kit rule, slot covenant | [archetype-aware-workspace](2026-05-31-archetype-aware-workspace-design.md) | This spec **conforms** to it — same zones, same report-kit mandate, same no-second-substrate rule, same `LocalTime`/banned-copy lint. |
| **Default/fallback `/workspace` home** | *(gap)* | **This spec.** It is the `configured-fallback` + `unconfigured` first-screen behavior, redesigned from operator-chrome into a real business day-to-day surface. |
| Per-category text prototypes | [archetype-portal-screen-prototypes](2026-06-06-archetype-portal-screen-prototypes-design.md) §7 | This spec resolves that spec's §7.1 default-home gap (see the review folded into that file). |

`software-platform` (the DPF-on-DPF install) is the one archetype that legitimately wants the operator command center as its day-to-day — for it, the relocated readiness matrix + platform schedule *are* the business ([contribution roster §3](2026-06-04-workspace-home-contribution-roster-design.md)). The operator view therefore is not deleted; it becomes the explicit operator mode and the `software-platform` home.

## 9. Non-Goals / Guardrails

- No new `Dashboard`/`Widget`/`PageBuilder` table; no drag-and-drop builder.
- No new calendar event types or projector forks — the split is filter configuration over the existing projection.
- No local color/status maps or hand-rolled tables — report-kit only.
- No fabricated/sample data in any state — empty real data renders empty/setup states.
- Banned-copy lint (`gear`, `ring`, `slip`, `cockpit`, `reduction-gear`, etc.) applies to all worker-facing strings ([archetype-aware §UI/UX Behavior](2026-05-31-archetype-aware-workspace-design.md)).

## 10. Acceptance Criteria

- Default `/workspace` first viewport shows, above the fold on 1366×768: operating header, critical strip with ≥1 actionable row, the **Today & Next** business agenda, and the **work queue** — and does **not** show the 6×6 readiness matrix or platform cron/deployment events.
- The **Today & Next** schedule renders only business-category/source events (§6.1); platform/ops/agent-task events are absent from the home and present on the operator `/platform/schedule` surface (§6.2).
- All KPI tiles are `StatCard`s; all status pills are `StatusBadge`; any tabular list is `DataTable`; any filter is `FilterBar` — verified by grep showing no new bespoke table/color-map markup in the redesigned components.
- Every rendered zone is bound to a real loader from §5; with empty inputs, no synthesized rows appear (unit-tested).
- The relocated readiness matrix renders on the operator surface and is reachable from the worker home only via an operator switch gated by `view_platform`/`manage_platform`.
- Banned-copy lint and `LocalTime` usage pass; tokens only, no raw hex.
- UX verification drives the Live portal at `http://localhost:3000/workspace` (desktop + mobile) and the operator schedule surface, reported as a structured dynamic-analysis narrative (drove X → observed Y → signed off Z), per the founder's "functional, not structural" standard.
- `pnpm typecheck` + web unit tests + production build pass before implementation is considered complete.

## 11. Backlog Mapping

No new epic. This is the default-home slice of the existing workspace-home work.

| Work area | Existing owner |
| --- | --- |
| Default-home redesign (zones, report-kit recomposition, command-strip re-scope) | `BI-1CCC6264` (resolver/registry/platform-fallback) — extend its platform-fallback rendering |
| Schedule split (business agenda on home; `/platform/schedule` admin) | new BI under `EP-REDUCTION-GEAR-ARCH` if not absorbed by `BI-1CCC6264` — "purposed business schedule + platform schedule admin surface" |
| Readiness-matrix relocation to operator surface | `BI-02845133` (software-platform / platform operator home) |
| report-kit recomposition of snapshot → StatCards | `BI-5B8FE5C1` (primitive library) reuse; no new primitive needed |

**Likely new BI to file** (gap proven not to fit an existing body): *"Default workspace-home redesign — business day-to-day surface + schedule split"*, scoped to the platform-fallback path so it lands independently of any single vertical contribution.

## 12. Verification Plan

1. Drive `/workspace` on the Live install as a non-platform user; confirm first viewport = header + critical strip + Today&Next + work queue; confirm no readiness matrix, no cron/deployment events.
2. Drive the operator `/platform/schedule` surface; confirm cron digests, deployment windows, blackouts, and agent-task runs are present there.
3. Resize to mobile; confirm the §4.2 order.
4. Confirm empty-state behavior with a freshly-seeded install (no bookings/invoices) renders setup/positive-empty states, not fabricated rows.
5. Confirm report-kit composition by source inspection and the unit-test assertions in §10.
6. Capture the dynamic-analysis report and turn it over to the founder for assurance.
