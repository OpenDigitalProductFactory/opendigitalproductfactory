# Scheduled Work: purpose, ownership and progressive disclosure

Status: graphical redesign after operator rejection; no implementation authorization.
Backlog: BI-AB7A3504. Workroom: WC-30762068. Shape: delivery-large@1.0.0.
Prototype: assets/2026-11-02-scheduled-work-disclosure-prototype.html.
Related corrective Workroom work: BI-6DAF8A1D; inspector parity BI-94C9AFC1.

## Objectives and acceptance contract

**OBJ-UNDERSTAND:** Operators identify current problems, impact and next actor without reading a timeline or job table.
**OBJ-TRUST:** Execution confidence and freshness remain independent of enablement and lifecycle.
**OBJ-SCALE:** Purpose groups and owning Workrooms absorb stage-level schedules without growing the default view per job.
**OBJ-PRESERVE:** Existing scheduler, authorization, commissioning, audit and safe maintenance behavior remain authoritative.

| Acceptance | Objectives | Observable outcome |
| --- | --- | --- |
| AC-1 | OBJ-UNDERSTAND, OBJ-SCALE | Overview has a concise summary and at most three prioritized current problem groups with an explicit path to all remaining problems; each has impact, last verified success or unknown, accountable owner or unassigned, and supported next action. |
| AC-2 | OBJ-SCALE | Workroom schedule groups use authoritative room title and accountable owner, with schedules nested under their room; no grouping from a guessed title or owner inferred from the current user. |
| AC-3 | OBJ-TRUST | Healthy, failed, paused, stale, first-run-not-due, never-run-overdue, completed one-shot and unavailable-reporting cases remain distinguishable. Historic failures do not inflate actionable counts for intentionally disabled or completed work. |
| AC-4 | OBJ-TRUST | Neither enabled nor an old successful result makes missing/stale future scheduling healthy. Disabled without recorded intent is labelled disabled, not intentionally paused. |
| AC-5 | OBJ-PRESERVE | Full register search and state/owner/purpose filters, history, raw diagnostics, commissioning and maintenance remain accessible through explicit disclosure; timeline starts collapsed. |
| AC-6 | OBJ-PRESERVE | Keyboard, labelled screen-reader controls, mobile/no overflow, theme tokens, unchanged server authorization and action-specific safeguards pass served verification. |
| AC-7 | OBJ-SCALE, OBJ-TRUST | Lifecycle audit distinguishes retained history, obsolete active schedules, missing owners, and unknown lineage; no age-only retirement or storage deletion. |

## Existing evidence and source boundaries

Live inspection on November 2 showed 814 entries and a headline claiming 413 needed attention. Disabled Workroom rows carried old errors or OK beside stale next-run dates. These are dated observations, never reusable UI constants. No orphan count has been proven.

Current page: apps/web/app/(shell)/admin/scheduled-jobs/page.tsx and ScheduledJobsClient.tsx. Existing shared UI: report-kit StatusBadge, Notice, ExpandableCard, CollapsibleList, DataTable, FilterBar and EmptyState. Keep the server page responsible for data access and client wrappers responsible for interaction. Keep /admin/scheduled-jobs as the canonical route under existing Health & recovery navigation; touch local disclosure and contextual actions, not global navigation.

Data owner: operate/scheduled-jobs/register.ts and work-model.ts span ScheduledAgentTask and ScheduledJob/catalog. Agent task authority wins over mirrors. The DTO exposes last outcome, enablement, stale projection and action capabilities, but not a verified last-success history aggregate, canonical Workroom identity/title or resolved accountable person. Those are required data seams, not facts the client may invent. Reuse taskConfig.workroomStage and existing Workroom relationships/read helpers after verifying the exact linkage. Batch enrichments; no query per job. No schema or new scheduler proposed.

Existing work: BI-78C6646C repaired stale catalog cadence. BI-819AD433 owns bounded monitoring results and actionable changes. Preserve both. Existing control.ts retireWork marks rows retired and disables tasks without deleting mutex/audit rows; recurring schedules are refused. Retained rows are therefore not proof of orphaned active work or unbounded execution cost. Actual active-orphan and storage-growth audits remain pending.

## Research and benchmarking

Primary sources checked November 2:

- Apache Airflow UI: https://airflow.apache.org/docs/apache-airflow/stable/ui.html . Adopt overview-to-work-detail navigation and separate schedule state from run status; keep its technical ID-first register and run grid in advanced disclosure for this persona.
- Prefect open-source state model: https://github.com/PrefectHQ/prefect/blob/main/docs/v3/concepts/states.mdx . Adopt the distinction between workflow definition and individual execution state. Do not transplant another state machine or engine. Hosted docs redirected unsuccessfully; repository source is the reference.
- PagerDuty alerts: https://docs.pagerduty.com/incident-management/incidents/alerts . Adopt grouping related alerts into one actionable incident with detail retained. Reject speculative cause grouping: group by recorded purpose/owner and proven shared cause only.
- Better Stack monitor lifecycle: https://betterstack.com/docs/uptime/pausing-monitors-and-maintenances/ . Adopt explicit paused/maintenance semantics distinct from monitored health. Do not label every disabled task intentionally paused without evidence.

DPF-specific gap: these patterns must preserve Workroom owner hierarchy and distinguish permission to run, actual execution, result freshness, retained history and missing observability. No external dependency is adopted.

## Design choice and default view

Revised direction for review: graphical purpose/Workroom map with recent, current and upcoming activity; attention and remedy are integrated at the affected area. Selecting an area opens one inspector. Compare with grouped temporal-sequence lanes. No detached attention list. The detailed day/week/month timeline remains optional and collapsed. Aggregate at scale; no hundreds of stage-level nodes. Alternative considered: merely collapse the existing timeline and table. It reduces volume but leaves misleading health, stage-level noise and ownership unresolved; insufficient for OBJ-TRUST and OBJ-SCALE. A new scheduler dashboard/substrate is unnecessary and rejected.

Priority: current failed work with verified impact, missed expected runs beyond existing cadence grace, then unverified coverage requiring action. Missing reporting is uncertainty, not failure; first run in the future is pending, not overdue. Group only common supported remedies. Overview remains bounded at hundreds of rooms; group lists use preview/pagination rather than opening every room by default. Counts reflect the same pure projection as the register and clearly label any bounded/incomplete reads.

Work detail: current execution state and uncertainty, intended cadence and exact next/last dates in the user's timezone (America/Chicago in this session; derive from user locale/runtime), recent results, accountable human versus executing coworker, and only allowed contextual controls. UTC cron descriptions must not be relabelled local: convert displayed occurrences through existing schedule helpers, including DST cases.

Last successful result: derive from existing authoritative history where available. A last failure's timestamp is never called last success. If history is absent, display No verified successful result available and link to diagnostics; do not manufacture a value.

Advanced: existing full register, search/filters and pagination; optional collapsed chart; per-item raw cadence, IDs, infrastructure, raw errors and history; bulk retirement preview and commissioning. The existing server action remains the writer. Dispatch acknowledgement says Requested, not Succeeded. Restore focus after dialogs; announce action results and failures.

## Lifecycle audit

Before implementation finalization, query authorized live task/room lineage and record aggregate cohorts: active room stages, terminal room stages still active, disabled room stages, upcoming/finished one-shots, manual slot locks, unregistered rows and missing owners. Sample canonical owner/lifecycle relations in each questionable cohort. Inspect creation and terminal cleanup paths. State unknown when a relationship cannot be established. Retire only through existing eligible controls and authorization; no production mutation in a read-only audit. Repair a demonstrated lifecycle leak at its source through proportional governed coverage, rather than deleting historical data.

## Prototype and limitations

HTML is a clickable design artifact with clearly labelled illustrative data, no production operations. It provides mixed/healthy/failed/disabled/stale/never-run/empty selectors, nested purpose and Workroom details, collapsed history/timeline/diagnostics, full-register filtering and theme switching. Its small fixture is for interaction review, not proof of production grouping, accessibility, timezone conversion or scale. Production components must use DPF tokens and report-kit; prototype styles are self-contained. The illustrative first-run-future example is deliberately not an actionable failure.

Prototype gaps before design sign-off: bounded all-problems navigation; a large cohort pagination fixture; measured default viewport; and reviewed owner/history enrichment. Do not treat the prototype as finished UI or a passed gate.

## Governance and review

UX fit: fits-with-guardrails as author proposal only; independent review pending. Owning area Platform, persona nontechnical operator, navigation local/contextual, no AI prompt sending on inspection. Existing UX engagement CE-6F6299DE requested but not fulfilled; bind the same engagement to committed immutable prototype rather than creating another request.

Operator must review the prototype before implementation, as explicitly requested. Canonical spec approval, research receipt, architecture review and covered reviewed plan follow the large shape. No completed spec receipt until actual design criteria are met. Unit tests cover pure presentation projection, lifecycle/health combinations and existing action safeguards; typecheck affected package. Served checks cover representative states, keyboard, screen-reader semantics, mobile, themes, user timezone/DST and measured UX-budget manifest. Record local source-only versus shared/canonical execution evidence honestly.

## Compatibility, migration and scope

No schema migration currently proposed; reuse sources and controls. Presentation changes do not rewrite schedules or job authority. New enrichment remains tenant scoped. Unknown owner, unavailable history or partial fetch must be explicit. Organization facts and live counts never enter reusable code. Workroom process visibility repair BI-6DAF8A1D remains a separate deliverable and must be delivered before this thread is considered fully complete. Design and implementation for that corrective item are pending.

## Author preview checkpoint

The conversation preview was rendered with the bundled isolated static visualization wrapper and inspected in the browser. Healthy, failed, disabled, stale, upcoming first-run, overdue first-run and empty selections changed the overview correctly. This is prototype-only interaction evidence, not served application verification. Theme control exercised; dark screenshot captured. Full screen-reader, narrow viewport, light screenshot, register filter interactions and scale verification remain unrun. JavaScript syntax and whitespace checks passed. Existing guide link lint passed (97 user-guide pages); it does not certify this design. Platform managed HTML document DOC-C9893809 renders source rather than executing the prototype; use the conversation preview for review.

## Graphical revision after operator feedback

The operator rejected the list-led proposal: it obscures where issues occur and what happens next. The new prototype compares Purpose map and Time lanes with contextual attention, visible recent/current/upcoming markers and one selected inspector. Lines show schematic sequence only, not duration or dependencies. Plans are not guaranteed runs. Original list-led prototype is superseded and remains unapproved. At scale the same purpose/owning-room aggregation, bounded selection and canonical data seams remain required.

Research additions: Airflow interactive Grid/Graph views (https://airflow.apache.org/docs/apache-airflow/stable/ui.html) place run state and actions together; Dagster run timelines (https://dagster.io/blog/dagster-debugging) give temporal execution context; Cronitor groups (https://cronitor.io/docs/groups-api) model grouped monitors with status/latest issue; Better Stack grouping (https://betterstack.com/docs/uptime/grouping-and-ordering-monitors/) keeps related monitoring together; Healthchecks (https://healthchecks.io/docs/configuring_checks/) distinguishes schedule/grace semantics. Adopt context, grouping and direct inspection; reject invented dependencies, a second scheduler, and future-run guarantees.

Browser inspected both alternatives and selected the overdue Workroom; its inspector showed the matching owner, old successful result, untrusted next run and missed-check action. Prototype-only evidence. Mobile, real-time placement, scale and production data verification remain pending, as do independent UX/spec review.
