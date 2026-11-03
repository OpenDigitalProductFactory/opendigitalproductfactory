---
status: draft
---
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

The current clickable artifact combines purpose navigation, owner/search/current-problem filters and workroom-level time lanes with one contextual inspector. It uses illustrative data and performs no production operations. It includes recent success, running, failed, missed/stale and future first-run examples. Paused/completed and advanced register/timeline remain explicit disclosures. The superseded list prototype had additional scenario selectors; those are not present in this revision. Prototype styling is self-contained; production must reuse DPF tokens and components. This is not proof of production data, accessibility or scale.

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

## Integrated direction after operator review

The operator requested both graphical purpose context and time lanes, with filtering, then agreed to proceed with this direction. This is direction to develop the design, not independent spec approval or a claim that the current draft is accepted.

The default composition now combines purpose selectors and current-status summaries with one aligned recent/now/upcoming time window. Lanes aggregate at the owning Workroom or purpose owner. Problems and remedy links appear on their affected lane. Selecting a lane or run reveals impact, accountable owner, verified last success and expected next activity in a persistent contextual inspector. Planned marks use a distinct dashed treatment and explicitly do not establish successful execution. The complete day/week/month timeline remains an optional collapsed disclosure.

Qualitative user evidence: Airflow issue 67472 asks to preserve grid context while switching graph/log detail (https://github.com/apache/airflow/issues/67472); Dagster issue 29343 values the timeline snapshot and requests team/project grouping (https://github.com/dagster-io/dagster/issues/29343); Dagster discussion 24898 values aggregation but reports ambiguity and friction when run identity/context is lost (https://github.com/dagster-io/dagster/discussions/24898). These are specific reports, not a representative preference survey; issue requests are not proof a feature shipped.

Author browser checks on the isolated static prototype: current-problems filter reduces five groups to the failed backup and missed Workroom; selecting missed check shows matching owner, three-day-old success and stale next-run uncertainty; unmatched search shows no matches with clear recovery; clearing filters restores five groups; future first-run selection explicitly says expected/not executed and no successful result recorded. Focus remains on the selected run after its details update. JavaScript syntax and whitespace are checked separately. This is not served DPF application verification. Narrow layouts, light theme, large cohorts, full disabled/completed interactions, screen-reader use and all production acceptance checks remain pending. The draft still needs a more compact default viewport and reviewed data enrichment.

The original UX engagement CE-6F6299DE remains requested with no fulfillment or result as of this checkpoint. The existing handoff defect is tracked in BI-EBA897BD / BI-331868F4. No independent critique or stage completion is inferred from the request.

## Persona, subject and archetype context — operator extension

The operator requires schedules to be useful within a persona and Workroom context across business archetypes. Their example is a horse stable: an operator must see a named horse's veterinary visits, riding lessons, farrier appointments and other commitments together. This is a design requirement, not evidence that this installation runs a stable or that those sources are already integrated.

### Existing foundations and boundaries

- `packages/db/src/archetype-room-definition-projection.ts` derives room definitions from the canonical operational value stream: stage/input/output/responsible role/gates/measures become room source/trigger/outcome/required participant/gates/measures. Load-bearing stages become standing rooms. These are reusable definitions, not proof an instance or appointment exists.
- `packages/storefront-templates/src/standing-rooms.ts` derives universal operating rooms plus software-specific rooms only for software businesses. Do not give a stable a repository-maintenance cockpit merely because that is the example on the current install.
- Evaluating the exported ALL_ARCHETYPES catalog returns 107 archetypes across 25 categories. The earlier count of 111 literal archetypeId declarations included nested product-mix references and was not a valid leaf inventory. This source inventory is not a count of installed businesses. Reuse `deriveTwinProfile`, `deriveResourceCapacityProfile` and the canonical value-stream projection, rather than authoring another archetype-to-layout catalog here.
- The live `list_workrooms(view: definitions)` inventory was traversed to completion: 20 canonical source definitions, including booking, field-service-job, scheduled, manual-task and activity. The response explicitly says occurrence assessment not exercised and organization applicability unknown. It is not an inventory of instantiated horse-care Workrooms.
- The existing calendar projects native and domain events (`apps/web/lib/workforce/calendar-data.ts`); shared capacity is profiled by `resource-capacity-profile.ts`; resource/availability/allocation records live in `resource-scheduling.prisma`. A merged display must not become another booking, animal identity, availability or schedule writer.
- `AnimalProfile` is a durable animal identity, with animal-welfare/custody consumers already present. Its current custody lifecycle does not prove working-horse workload or equestrian booking support. Horses must retain animal semantics; they are not employees, equipment or public adoption listings. A lesson also reserves human time and location capacity without changing the horse's identity.
- The Work Atlas tailoring design (`2026-10-27-work-atlas-archetype-tailoring-design.md`) already specifies thirteen visual grammars and equine farm rounds. `BI-7EE5681A` remains triaging for organization-level operating refinements; `BI-3BAC3218` remains triaging for working animals, due care and workload; `BI-AAEE06B5` remains triaging for veterinary appointment/clinic flow. `BI-8C25D89C` owns the farm/ranch cockpit. These are dependencies and overlap, not completed integrations or authorization to deliver every vertical in this refactor.

### Proposed schedule hierarchy

Entry context resolves the authorized persona, organization/site, selected subject and Workroom. A person arriving from a horse, client, property, equipment item or Workroom sees that context preselected and can widen it without losing their selection. A manager's authorized whole-operation view can group by subject, responsible person, location or Workroom. Grouping and filtering are views of the same occurrences; they do not copy or reassign work. Persona presets change relevance and language, never authorization.

Default hierarchy: selected context → bounded time lanes with integrated attention → selected occurrence and its Workroom → source-specific advanced diagnostics. The inspector separates the subject of work, accountable person, assigned provider/performer, location/resources and owning Workroom. Unknown relationships remain unassigned/unlinked; title parsing must not manufacture them. One appointment involving several participants may appear in several lanes, but counts deduplicate by canonical occurrence identity.

The operator-facing business schedule belongs in the existing workspace/Workroom/subject entry points. `/admin/scheduled-jobs` continues to answer automation health and diagnostics; it should open the same linked context where relevant. A planned veterinary visit is a business commitment; its reminder task is an automation. Sending the reminder does not establish attendance or completed care. Their states and attention reasons remain distinct even when displayed together. Navigation placement and the dependency split require independent review before implementation; this appendix does not silently turn an admin refactor into a complete vertical scheduling product.

### Representative contexts to carry into the next prototype

| Existing archetype or family | Persona and primary context | Recognizable schedule question | Sources and limits |
| --- | --- | --- | --- |
| Agriculture/ranching; equestrian example is a proposed operating composition | Stable manager, instructor, authorized horse owner; named animal and yard | What is this horse committed to this week, and what needs arranging? | Animal identity, care/workload dependency, bookings/classes, staffing, location capacity; dedicated stable leaf/composition still needs validation |
| Veterinary clinic / mobile vet | Receptionist, clinician, practice owner; animal, provider, clinic or farm round | Who is booked, what preparation is needed, and which visit is unconfirmed? | Existing booking/field/care authorities; clinic-flow extension remains triaging |
| Education/training and fitness | Instructor or coordinator; learner/cohort, teacher and room | Which lessons have a missing instructor, venue or confirmation? | Class/appointment and staffing sources; distinguish learner, payer and instructor |
| Trades and property operations | Dispatcher, technician, property manager; job/site and crew | Which arrival window, maintenance visit or resource commitment is at risk? | Field-service WorkCases, staffing, travel/buffers and existing capacity |
| Rental and boarding | Operator; asset or animal, return/stay and location | What is due back/out, unavailable, or awaiting inspection/care? | Rental/occupancy sources; animal identity remains distinct from rentable equipment |
| Professional services, public services and nonprofit programs | Matter owner, caseworker or program lead; client/matter/program | What deadline or commitment needs a person next? | Existing activity/manual-task/approval/Workroom sources; deadlines are not fabricated appointments |
| Software platform | Service owner and operator; purpose and owning Workroom | Is committed automated work current, and which failure needs intervention? | Existing scheduled-work register and execution history; the original admin acceptance criteria remain mandatory |

Other arrangements follow the existing Work Atlas grammars (FLOOR, BAYS, STORE, VENUE, COUNTER, DOCK and the remaining profiles), with service windows, promised-by dates or cutoffs where those are the authoritative time semantics. This is a coverage plan, not a claim that every source already exposes all required relations.

### Stable acceptance scenario and shared invariants

Use clearly labelled illustrative horses in design review, never the daughter's actual business data. A horse's week combines a lesson booking, a confirmed veterinary appointment, a farrier visit still needing confirmation and a due-care item that has no appointment yet. An instructor's day narrows to assigned lessons; the yard manager can widen to all horses; an authorized horse owner sees only their permitted animals and events. A cross-lane conflict preserves one occurrence, shows the affected commitments in place, and opens the source record for a permitted remedy. Do not infer clinical restrictions or a care interval: display only recorded constraints and provider instructions with their source.

Acceptance must distinguish proposed, awaiting confirmation, confirmed, cancelled, missed and recorded complete domain commitments from automation enabled/running/failed/stale. Time elapsed is not completion. A due-care window without an exact booking stays a window or unscheduled item, never an invented 09:00 visit. Missing feeds/history/ownership and partial coverage remain visible. A reminder failure may be actionable without declaring the visit itself failed. Clinical records are disclosed only through the existing source authorization; persona changes cannot reveal hidden subjects through counts or labels.

Carry timezone/DST, multi-day/repeating events and exceptions, conflicts/buffers where supported, no matches versus no schedules versus unavailable sources, keyboard/text alternatives, mobile, themes and bounded large cohorts into the reviewed plan. Validate at least one subject-centric, provider-centric, location-centric, deadline-centric and automation-centric context before claiming the shared pattern scales. Existing production action writers and safeguards remain authoritative.

### Additional primary research

[Hippovibe calendar tutorial](https://www.hippovibe.io/article/how-to-easily-organise-all-the-events-around-your-horses) supports horse/group/team/user/event-type/health-reminder filters and events linked to horses, contacts, users and locations. Adopt linked context and independent filtering; do not assume a filter is an authorization boundary. Its [health tutorial](https://www.hippovibe.io/article/how-to-manage-your-horses-health-with-hippovibe) separates recorded history from upcoming care, with per-horse and whole-yard views. Adopt that evidence distinction; do not derive a clinical schedule from a UI example.

[Sagehill Stables' published ECPro operating guidance](https://www.sagehillstables.com/ecpro.html) describes lesson/course calendars and horse assignments, including personal practice bookings so a horse is not assigned to a conflicting lesson. This is firsthand evidence of the resource-sharing problem, not an endorsement or proof of DPF support. [FullCalendar's resource/event contract](https://fullcalendar.io/docs/resources-and-events) demonstrates one event associated with multiple resources; adopt the projection/identity distinction, not an additional dependency or a claim that an animal is merely a resource record.

### Verification and next gate

Source paths and `origin/main` were inspected after fetching main; live backlog and Workroom definition reads were used without direct database fallback. Code graph reports main/high trust with four of five structural relationship families; its positive ResourceCapacityProfile/deriveResourceCapacityProfile hits corroborate source. No absence is inferred from an empty graph. Open PR sweep found no scheduling implementation among the two open PRs at this checkpoint. Some unrelated domain discovery candidates were grant-denied; those operational records were not accessed through another channel.

This extension is researched design work only. The original integrated prototype illustrates software operations. A companion [contextual schedule prototype](assets/2026-11-02-contextual-schedule-prototype.html) now exercises a three-day slice for stable, clinic and field-service contexts with manager, assigned worker and subject-owner preview personas. Author browser checks verified stable owner filtering removes Jasper from both the display and subject choices, and business-context switching updates the subjects, role labels, commitments and inspector. These are local illustrative projections, not production authorization tests. Independent UX/spec approval, a dependency-covered plan and implementation remain outstanding. Live business occurrence coverage and stable-specific model fit remain unverified. No stage completion, schedule mutation or new schema is claimed.

Context prototype verification: JavaScript syntax, document-index freshness and whitespace checks passed. Browser visual inspection covered the desktop dark view and native-keyboard persona/context selection; source actions are explicitly simulated. Other accessibility, narrow viewport, light theme, large-cohort, deadline-centric and live source checks remain unrun. The full-week and provider/location grouping interactions still need design review.

## Scope correction and process audit after operator clarification

This clarification supersedes any reading of the contextual appendix as a horse-business implementation request. The requirement is scheduling across EVERY archetype's Workrooms and situations. Training courses and sessions, restaurant opening/closing and service windows, hotel stays/check-in/check-out/turnover, appointments, deadlines, recurring obligations and automation require different time semantics and potentially coexist within one business. Horse examples are illustrative. The referenced vertical backlog work is overlap/fit evidence, not an automatic dependency or commitment to implement those businesses in this refactor. The narrow companion prototype is exploratory evidence only and does not establish this broader coverage.

Research must produce two linked baselines: the market's scheduling models and interaction patterns, AND the platform's existing archetype definitions, Workroom shapes, persona contexts, data authorities and source capabilities. Compare options against both before selecting a shared arrangement. A matrix must name recurrence/exception, interval/window/deadline/stay semantics, accountable owner versus subject/provider, timezones, dependencies/conflicts, authorization, current uncertainty and allowed next action. Cover the existing archetype catalog through shared scheduling patterns and identify exceptions explicitly; do not substitute three examples for catalog coverage. Independent craft input is required before treating the proposed composition as the chosen design.

Live audit: Large@1.0.0 remains at spec; CE-6F6299DE is requested without fulfillment/result. The drive records awaiting_agent_capacity over 19 ticks and an earlier run without stage evidence. These are observed dispatch/evidence gaps, not proof of a global outage. The UX role, active service offer and canonical skill instructions exist. The external agent's stored skills list and the offer's backing skillIds are empty; their meaning must be reconciled with actual client exposure/runtime assignment, rather than claiming skill content was deleted.

WWMD comparison DI-7BF3A79081EA recommends recovery of the existing stage rather than the continued solo prototype loop or holding all independent research for process repairs. Its feature vectors are author tradeoff estimates, not empirical measures. WWWD's mission and decision-scope corpus were consulted as context; this process question is platform-owned. Requested UX WSID consultation DI-6377DF65743C instead resolved software-engineer, declaredBorrow:false, confidence0.35 and no recommendation. Source preserves the identified AGT-EXT-CODEX craft. This is not UX steering, and no identity bypass is authorized. Existing BI-EBA897BD carries the recurrence, with engagement execution owned by BI-331868F4 and shape-based review instantiation by BI-E27F3600. No specialist findings, review approval or stage completion are inferred.

## Recovery research baseline — market and platform

Research question: how can one governed schedule experience help every persona understand the time commitments in their Workrooms, while retaining the original admin automation-health purpose and each domain's meaning and safeguards? This is not a request to implement all verticals or to replace their scheduling engines.

### Complete exported catalog sweep

Executed the existing pure source projections over every exported archetype: ALL_ARCHETYPES, deriveOperationalValueStream, deriveStandingRooms, deriveTwinProfile and deriveResourceCapacityProfile. TypeScript was transpiled in memory for this read-only inventory; no runtime/database or package install was used for that extraction. The inventory covers 107 exported archetypes and 25 categories, not 111 raw literal references. It is definition-level evidence only. A declared class or dispatch pattern is not proof of courses, transport capacity, event feeds, permissions or booking behavior on a live install. Definitions without an authoritative event source must remain visibly unsupported/unavailable rather than silently empty.

| Category | Exported leaf archetypes reviewed | Existing derived capacity patterns |
| --- | --- | --- |
| healthcare-wellness | veterinary-clinic, dental-practice, medical-practice, physiotherapy, counselling, optician, home-health-care, mobile-phlebotomy, dme-delivery | appointment, dispatch |
| beauty-personal-care | hair-salon, barber-shop, nail-salon, beauty-spa, personal-trainer, mobile-beauty | appointment, dispatch |
| trades-maintenance | facilities-maintenance, plumber, electrician, cleaning-service, landscaping, hvac-contractor, pest-control, appliance-repair, pool-spa-service, pressure-washing, roofing-gutters | dispatch |
| professional-services | it-managed-services, legal-services, accounting, marketing-agency, consulting, field-inspection, land-surveying, process-serving-notary | dispatch |
| software-platform | software-platform | No physical capacity profile; deadlines/commitments/automation require their own sources |
| education-training | corporate-training, tutoring, music-school, driving-school | class |
| pet-services | pet-grooming, dog-walking, pet-boarding, mobile-pet-grooming, mobile-vet | appointment, dispatch, occupancy |
| food-hospitality | restaurant, catering, bakery | service-floor, venue |
| retail-goods | retail-goods, artisan-goods, florist, wholesale-distribution, furniture-delivery-install | dispatch |
| fitness-recreation | gym, yoga-studio, dance-studio | class |
| nonprofit-community | pet-rescue, animal-shelter, community-shelter, charity, sports-club, cooperative, agricultural-cooperative, meal-delivery-program | dispatch, rental |
| hoa-property-management | homeowners-association, condo-association, property-management-company | project-resource |
| banking-financial-services | community-bank, credit-union, mortgage-lending | No physical capacity profile; deadlines/commitments/automation require their own sources |
| public-sector | small-town-municipality, municipal-utility, law-enforcement-agency | dispatch |
| asset-rental | equipment-rental, self-storage, production-equipment-rental | rental |
| real-estate-construction | new-home-builder, custom-home-builder | project-resource |
| automotive-services | auto-glass, mobile-mechanic, mobile-detailing, mobile-tire, roadside-assistance, locksmith | dispatch |
| moving-and-logistics | moving-company, junk-removal, courier-delivery, last-mile-freight, freight-brokerage | dispatch |
| security-services | guard-patrol, alarm-cctv-install | dispatch |
| media-production | film-video-production, post-production-studio, event-production-staging | No physical capacity profile; deadlines/commitments/automation require their own sources |
| live-events-venues | event-venue, tour-promoter, talent-booking-agency | venue |
| warehousing-fulfilment | third-party-logistics, ecommerce-fulfilment, cold-chain-storage, cross-dock-transload | service-floor |
| fabric-care-services | dry-cleaning-plant-network, wash-and-fold-laundry, alterations-tailoring | service-floor |
| agriculture-ranching | mixed-farm-ranch, crop-hay-farm, cattle-ranch | dispatch |
| manufacturing | industrial-equipment-oem | service-floor |

The default OVSM backbone is extended by leaf process profiles: for example, animal-welfare profiles produce 21 stages, while rental/custody profiles add return/inspection or receiving/storage. Do not replace those Workroom definitions with a page-owned list. Source-derived room definition preserves trigger, required role, intended result, trust gates and measures; an actual schedule requires a related occurrence or availability authority as well.

### Time meanings that cannot be flattened

| Time meaning | Representative situations | Source or source-fit evidence | Presentation constraint |
| --- | --- | --- | --- |
| Operating/availability windows | Restaurant open/close, provider hours, closures | BusinessProfile.businessHours and hoursConfirmedAt through operating-hours-read.ts; ProviderAvailability / ResourceAvailability | A window permits work; it is not an appointment or proof the business opened. Distinguish configured/default/unconfirmed hours. |
| Booked intervals | Consultations, reservations, lessons | StorefrontBooking scheduledAt/duration/status/provider; CareAppointment subject/provider/resource and footprint | Booking, attendance and completed work are separate evidence. |
| Courses/cohorts and repeating sessions | Training term, class series, instructor/room/learner | education-training catalog and class capacity profile; recurrence primitives | A class profile is not a complete course/cohort/attendance product. Preserve series identity and cancelled/changed occurrences; source integration still needs verification. |
| Staff assignments | Restaurant shifts, instructors, housekeeping | Workforce calendar and staffing projection into calendar | Assignment, availability preference and actual attendance are different. Respect overnight windows and explicit leave. |
| Stays and turnover | Hotel check-in/out, occupied/dirty/ready rooms | Existing occupancy/resource family; planned lodging BI-5AA20AFB, BI-C32044BB, BI-0820CF57 all triaging | Stay interval, arrival/departure actions and room readiness need coordinated lanes, not a single success color. Hotel is not an exported leaf in this inspected catalog. Do not promise an installed lodging integration. |
| Arrival/service windows | Field work, moving, mobile care | Field-service WorkCase and field-dispatch/capacity profiles | Travel/buffer and assignment are constraints, not invented exact arrival times. |
| Return/inspection windows | Rentals and reusable equipment | YARD/rental profile and return-inspect value-stream stage | Expected return is not actual return or readiness for next use. |
| Deadlines and obligations | Case/matter deadlines, renewals, regulatory dates, periodic reviews | Calendar projections, WorkEngagement.dueAt, manual tasks/approvals/activities | Do not invent a start/end time; record deadline provenance, owning person and next action. |
| Service periods and cutoffs | Restaurant service, events, warehouse waves, production promises | FLOOR/VENUE/DOCK/BAYS profiles and domain capacity/turn authorities | Capacity or readiness can be at risk without an execution failure. |
| Automated execution | Repository checks, backups, Workroom stage drives | ScheduledAgentTask and scheduled-work register/history | Enabled, executing, verified success, stale and retired remain independent. Preserve the original admin acceptance criteria. |

Across these meanings: recurrence is a rule, an occurrence is one dated instance, a projection is not a booking, a reminder is not completion, and no signal is not healthy. One occurrence may appear under its subject, performer, location and Workroom, but totals deduplicate by canonical source identity. Future occurrences remain expectations rather than guarantees. Local timezone and IANA-zone/DST handling belong to the source temporal contract, not formatting a UTC cron string as local.

### Market comparison: inspect models as well as screens

| Comparator and primary material | Observed model or interaction | Adopt | Reject / limitation |
| --- | --- | --- | --- |
| [Cal.com schema](https://github.com/calcom/cal.com/blob/main/packages/prisma/schema.prisma) | Separate EventType, Schedule, Availability and Booking. Availability has weekday or date windows; Schedule has timezone; EventType includes confirmation, notice and before/after buffers; Booking has occurrence times, attendees and state. | Separate rule, availability, committed occurrence and participant context; explicit pending confirmation and buffers. | Meeting-centric booking is not sufficient for opening hours, stay readiness or scheduler execution health. No Cal.com dependency proposed. |
| [Easy!Appointments appointment model](https://github.com/alextselegidis/easyappointments/blob/develop/application/models/Appointments_model.php) | Start/end, service, provider, customer and status; explicit unavailability flag; validation of linked provider/customer/service and interval. | Human-purpose labels and source relationships, availability separate from appointments. | A single provider/customer appointment model cannot represent every Workroom situation. No copied code or imported engine. |
| [Odoo community ResourceCalendar](https://github.com/odoo/odoo/blob/19.0/addons/resource/models/resource_calendar.py) | Resource working time combines weekday attendance intervals and general/resource-specific leave with timezone and fixed/flexible schedules. | Availability windows and exceptions as first-class context, not scheduled-job rows. | A resource working-time model does not establish business opening, booking attendance or outcome. Community source is not evidence of proprietary Appointments internals. |
| [Mews Timeline](https://help.mews.com/s/article/timeline) | Bookings organized by space type/number, time-scale/density controls, distinct reservation and housekeeping states, contextual filters and optional/unconfirmed styling. | Coordinate time and physical context; show required action at the affected commitment; distinguish readiness from booking. | Do not copy vendor colors or imply moving an event automatically satisfies preparation, capacity or authority. Product documentation is precedent, not proof of DPF integration. |
| [7shifts Availability](https://kb.7shifts.com/hc/en-us/articles/4417513664659-7shifts-101-Availability) | Recurring work preferences/conflicts and specific time-off workflows are distinct; overnight shifts have explicit day-association rules. | Separate availability, assignment and actual work; include overnight boundary checks. | Do not adopt an undocumented cross-midnight policy or expose employee availability solely through a persona filter. |
| [Odoo Appointments](https://www.odoo.com/documentation/19.0/applications/productivity/appointments.html) | User- or resource-based availability, booking duration and confirmation/capacity context. | Contextual booking and capacity-linked selection. | Appointment booking alone is not an all-purpose calendar. App documentation and community working-time model are separate evidence. |

Additional task-specific precedent remains relevant: Airflow's persistent grid/detail context, Dagster's grouped timeline demand, deadline-aware monitoring, and Hippovibe's subject/team/event filters. These were already linked above. They are bounded qualitative observations, not a representative user-preference survey. Course semantics are corroborated by [Frappe Education's Course Schedule documentation](https://docs.frappe.io/education/course-schedule): course, instructor, student group, room and interval with attendance recorded separately. The attempted develop source path returned 404, so this is documentation evidence, not a verified current source-model inspection.

### Standard and constraints

[RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) separates calendar events, to-dos and free/busy and defines recurrence/timezone/exception semantics. Reuse the platform's existing RFC-5545 RecurrenceSchedule and existing expansion code; do not introduce a competing recurrence engine. Standards alignment does not require migrating every legacy recurrence representation in this UI refactor. Record source behavior and gaps before promising series edits. Applicable updates and source-specific recurrence support must be checked when implementing affected contracts.

### Architecture options for review

1. Expand the admin job register into one universal operational calendar and writer. This puts domain work in an admin mental model and couples unrelated authorization/state machines; unsuitable unless the existing sources are explicitly superseded through a larger approved design.
2. Compose shared read projections and visual/context controls over authoritative domain sources. Keep business/persona/Workroom entry context and a linked admin automation-health view. Domain writers retain scheduling/conflict/audit rules. Candidate preference: supports mixed situations without equating a stay, opening window and automated run. Missing adapters and authority must be disclosed and independently covered, not hidden by a generic row.
3. Keep separate domain calendars and improve only deep links plus the admin overview. This minimizes integration initially but leaves cross-Workroom coordination and shared subjects fragmented. It is a viable bounded first delivery only if the research/owner explicitly accepts that limitation and a covered convergence path is recorded.

These are proposals for governed comparison and actual craft contribution, not a selected implementation or a replacement for independent review. The original job-health refactor and shared contextual scheduling may need separate deliverables under one approved baseline; the reviewed plan must make that boundary explicit.

### Research evidence still owed

Definition/model coverage is now systematic; live occurrence, permission and source-read coverage is not. The original UX engagement must receive immutable source plus actual rendered evidence and return attributable findings. Its result must address the broad time semantics and persistent context, not merely accessibility or the horse fixture. Independent spec approval, delivery boundaries, lifecycle/orphan cohort audit, a backlog-covered reviewed plan and served verification remain outstanding. No research stage completion is asserted by this appendix.
