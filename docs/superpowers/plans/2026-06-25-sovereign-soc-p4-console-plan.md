# Sovereign SOC — P4 /ops/security console

- **Date:** 2026-06-25
- **Spec:** [2026-06-24-sovereign-soc-siem-design.md](../specs/2026-06-24-sovereign-soc-siem-design.md) §4.6, §10
- **Epic:** EP-SOVEREIGN-SOC — **BI-80191C61**

## Goal

The operator surface: a SOC console answering the first-screen questions (Are we covered? Are we exposed? What needs a decision? Are we improving?).

## This pass (DONE)
- `apps/web/lib/security/console-data.ts` — pure `computeSocConsoleData`: coverage (connected vs stale sources; `monitoring=false` so an empty board is **not** green), detections (open + by severity), cases (open / awaiting-decision / resolved / by status), SLA metrics (MTTR, false-positive rate). `console-loader.ts` — the prisma-backed loader.
- `apps/web/app/api/platform/security/overview/route.ts` — GET, gated by `view_operations`, returns the aggregates + recent cases.
- `apps/web/app/(shell)/ops/security/page.tsx` — server-rendered console (inherits the ops `view_operations` gate): a report-kit `StatCard` grid + a recent-cases table with `StatusBadge` (new `security` / `securitySeverity` status domains in `statusColors.ts` — no page-local status maps).
- Nav: `ops-nav.ts` adds a "Security → SOC Console" group (`/ops/security`); the navigation EA projection ingests it. Route manifest regenerated (512 routes).
- Tests: `console-data.test.ts` (coverage/stale, severity tally, MTTR/FP-rate, empty-board-not-green).

## Remaining polish (needs the browser to iterate)
Interactive filtering (FilterBar by customer/severity/status/ATT&CK), per-customer MSP fleet drilldown, and trend charts are the visual-iteration follow-on; the data-backed first screen + recent cases is functional and gated here.

## Verified
web typecheck clean (page + API + loader); console-data 4/4; route manifest fresh.
