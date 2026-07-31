# Marketing Strategist Evidence-to-Outcome Loop Implementation Plan

**Status:** in progress — Deliverable A shipped 2026-07-28 (PR #3701, `ef16e317ce`); B, C and D remain

**Backlog item:** `BI-IMP-14F9E938`

**Epic:** `EP-MARKETING`

**Source improvement:** `IP-0C52D`

**Related specs:** `docs/superpowers/specs/2026-05-26-marketing-execution-loop-design.md`, `docs/superpowers/specs/2026-06-26-marketing-coworker-campaign-parity.md`
**Related plans:** `docs/superpowers/plans/2026-06-24-marketing-coworker-parity-completion.md`, `docs/superpowers/plans/2026-07-22-archetype-scoped-marketing-cockpit.md`, `docs/superpowers/plans/2026-07-22-restaurant-marketing-owner-first-disclosure.md`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Turn the Marketing Strategist from a reactive planning assistant into a governed acquisition operator that repeatedly:

```text
observe evidence
  -> identify the highest-value bottleneck
  -> establish one bounded experiment
  -> prepare variants and drafts
  -> wait at publish / reply / spend approval
  -> execute through an existing channel adapter
  -> measure after an evidence threshold
  -> continue, stop, or iterate
  -> preserve the learning for the next decision
```

The operator should see useful work and decisions without having to repeatedly prompt the coworker. Consequential external actions remain human-controlled.

## Confirmed problem

Live production data inspected on 2026-07-28 showed:

- one `MarketingCampaignBrief`, one `MarketingAssetTask`, and three `OutboundDraft` rows;
- zero `MarketingCampaign`, `OutboundPublication`, `MarketingKpiCheckpoint`, `ScheduledOutboundAction`, and `OutboundAutopilotPolicy` rows;
- no active recurring `ScheduledAgentTask` for `marketing-specialist`;
- a connected `linkedin-personal-social` credential but no publication;
- recent successful `get_marketing_summary` / `get_content_calendar` reads alongside repeated failed `get_campaign_plan` / `get_campaign_performance` calls with empty arguments.

The defect is not missing marketing architecture. The architecture exists but does not form a reliable operating loop.

## Existing substrate to extend

Do not rebuild these capabilities:

| Concern | Existing source of truth |
| --- | --- |
| Strategy and review | `MarketingStrategy`, `MarketingReview`, `getMarketingWorkspaceSnapshot()` |
| Executable campaign | `MarketingCampaign`, `create_marketing_campaign`, `get_campaign_plan` |
| Work production | `MarketingCampaignBrief`, `MarketingAssetTask`, `OutboundDraft` |
| Creative variants | `MarketingAssetVariant`, `create_asset_variant`, `record_variant_result`, `get_asset_variants` |
| Competitive evidence | `MarketingBattlecard` and marketing battlecard tools |
| Attribution | `build_tracked_links`, publication metrics, CRM/storefront source data |
| Approval and publication | `OutboundApprovalDecision`, `OutboundPublication`, channel adapters |
| Scheduling and bounded automation | `ScheduledOutboundAction`, `OutboundAutopilotPolicy`, Inngest marketing scheduler |
| Measurement | `refresh_channel_kpis`, `get_campaign_performance`, `MarketingKpiCheckpoint` |
| Operator surface | `/customer/marketing` and its strategy/campaign/funnel/automation subroutes |
| Recurring coworker work | `ScheduledAgentTask`, `COWORKER_SELF_TASKS` |

No Airbyte/ClickHouse-style warehouse is in scope. PostgreSQL and existing integration adapters remain canonical until measured source volume, latency, or analytical workload proves them insufficient.

## Architecture decisions

### 1. One canonical marketing operating snapshot

Create a domain read model that assembles the decision context once and serves both coworker tools and the owner surface. It must be organization- and archetype-scoped and include:

- strategy freshness and unresolved assumptions;
- active campaigns and the most useful next executable step;
- brief, task, variant, draft, approval, publication, and scheduled-action state;
- connected-channel capabilities and honest unsupported operations;
- campaign/channel performance, KPI targets, attribution confidence, and data freshness;
- funnel progression through inquiry, opportunity, conversion, and attributable revenue where evidence exists;
- experiment evidence sufficiency and the reason a winner may or may not be declared;
- blocked state and one recovery action when credentials, provider capacity, approval, or evidence are missing.

`get_marketing_summary`, `get_campaign_plan`, `get_campaign_performance`, the campaign pages, and the first-viewport decision resolver must consume projections from this read model rather than independently reconstructing partial truths.

### 2. Existing tools, fewer ambiguous calls

Keep the focused campaign tools, but make tool selection mechanically safe:

- `get_marketing_summary` returns campaign identities and next-step references.
- `get_campaign_plan` and `get_campaign_performance` continue to require `campaignId`, but empty calls return a structured recovery result containing candidate campaign IDs instead of an opaque failure.
- Tool descriptions and route prompts tell the coworker when the workspace-level snapshot is sufficient and when to drill into a campaign.
- Remove or converge duplicate summary assembly; do not create a fourth campaign read path.

### 3. A durable operating cycle, not a daily content generator

Replace the current "keep the Campaigns page non-empty" self-task with an idempotent operating cycle:

1. Read the canonical snapshot.
2. If source data is stale or missing, create no experiment; surface the precise blocker.
3. If no active campaign exists, establish one bounded experiment from saved business context.
4. If a campaign has unfinished safe internal work, advance one coherent batch: tasks, variants, tracked links, drafts.
5. If approval is required, stop with one reviewable evidence packet.
6. If a campaign is live but below its evidence threshold, wait; do not churn creative.
7. If evidence is sufficient, record the continue/stop/iterate decision and the winning/losing rationale.
8. Create the next iteration only when the decision changes a hypothesis, audience, message, channel, or proof asset.

Balanced proactivity runs weekly. Assertive proactivity may run daily, but the cycle is state-driven and frequently no-ops. It must never create filler artifacts to appear busy.

Reliable scheduled execution depends on the platform-wide provider-routing repair tracked in `BI-8058697C`; implementation may proceed with deterministic tests and manual dispatch, but autonomous function cannot be claimed until that dependency is functionally verified.

### 4. Extend variant lineage instead of adding a parallel experiment framework

`MarketingAssetVariant` already carries hypothesis, creative body, and basic results. Extend the existing campaign/task/draft/publication linkage so a variant can be traced through:

```text
business signal + provenance
  -> hypothesis
  -> campaign / task / variant
  -> outbound draft / publication
  -> impressions / clicks / conversions / cost
  -> attributable opportunity / revenue where available
  -> decision and reusable learning
```

Before adding a new model, test whether optional lineage metadata plus explicit foreign keys on the existing models can express the contract. If a separate decision/evidence record is required, justify it with a substrate ledger and use expand/backfill/contract migration safety.

Evidence thresholds are configurable by channel and objective. Do not encode "48 hours" or a universal impression count as a general marketing rule. The decision service should consider time in market, spend, conversion volume, channel learning status when available, and confidence. Insufficient evidence must be a first-class result.

### 5. Human control at phase boundaries

Safe internal work proceeds without per-tool confirmation. Human approval remains mandatory for:

- public publish or customer reply unless a previously approved bounded policy explicitly covers it;
- ad audience, account, creative, and spend;
- spend-ceiling changes;
- public claims without grounded proof;
- strategy changes that affect pricing, legal commitments, or operational capacity.

The coworker prompt must stop forcing plan-only replies and one-step waits for safe internal work. It should instead produce a bounded evidence packet at the next consequential gate.

## UX fit review

- **Decision:** fits-with-guardrails
- **Owning area:** Business > Customer
- **Route family:** `/customer/marketing` is canonical; no new global route or navigation layer
- **Primary persona:** founder/operator who needs the next acquisition decision without learning campaign-system internals
- **Navigation layer touched:** contextual action and existing local marketing subroutes only
- **Reuse/convergence:** preserve the owner-first decision section delivered in PR #3414; compose `StatusBadge`, `StatCard`/`KpiCard`, `Notice`, `EmptyState`, `DataTable`, and `Chart` from report-kit
- **Source truth:** the canonical marketing operating snapshot
- **Empty/failure behavior:** distinguish no campaign, waiting for approval, gathering evidence, unsupported channel, stale data, and provider unavailable; show one recovery action instead of a wall of zeros
- **AI boundary:** status cards and metrics navigate only; explicit launch actions preview context and expected next step; publish/spend actions retain confirmation
- **Required guardrails:**
  - Keep the first viewport to one owner question, one next decision, and at most one primary action.
  - Do not re-expose strategy, proof, campaign machinery, automation, and publishing simultaneously.
  - Do not add a second dashboard or new tab row.
  - Use theme/design tokens and report-kit; no page-local status-color map or hand-rolled KPI components.
  - Preserve archetype-fit quarantine before any external action.
  - Empty states are actionable setup/waiting states, never zero-card grids.
- **Evidence before merge:** route/unit tests, UX budget and theme scans, desktop plus 390px browser verification, keyboard/accessible-name exercise, fresh/blocked/approval/live/measured fixtures, and a complete happy-path campaign run
- **Captured in:** this section

## Delivery plan

### Deliverable A — canonical operating snapshot and tool-contract repair

**Status:** SHIPPED 2026-07-28 — PR #3701, squash-merged as `ef16e317ce`. Do not re-implement; extend it.

**Backlog item:** `BI-CEA797A1` (done)

**Independently shippable:** yes
**Depends on:** none

Likely files:

- `apps/web/lib/marketing.ts`
- new or converged module under `apps/web/lib/marketing/`
- `apps/web/lib/mcp/packs/marketing-ops-pack.ts`
- `apps/web/lib/mcp/packs/marketing-pack.ts`
- `apps/web/lib/marketing/campaigns.ts`
- `apps/web/lib/marketing/campaign-performance.ts`
- `apps/web/lib/marketing/next-decision.ts`
- relevant tool-pack, snapshot, scoping, and next-decision tests

Implementation:

1. Write failing tests for the live gaps: campaigns/metrics absent from the workspace summary; empty campaign drill-in calls; cross-org/archetype leakage; stale-data and unsupported-channel states.
2. Introduce one pure projection type for the operating snapshot and one database assembler.
3. Include campaign identities, execution counts, next step, publication/KPI summaries, channel readiness, freshness, and attribution confidence.
4. Make campaign drill-in failures actionable and structured.
5. Route the MCP summary and owner-decision resolver through the shared projection.
6. Spend approximately 20% of this deliverable removing duplicated query/formatting paths and stale tool assumptions.

Verification:

- targeted Vitest for snapshot, pack handlers, campaign rollups, organization/archetype scoping, and next-decision behavior;
- tool-registry/grant contract tests;
- source-local typecheck;
- functional MCP probe against seeded campaigns showing the same state on the owner page and in tool output.

#### What actually landed (read before building B, C or D)

- `apps/web/lib/marketing/operating-snapshot.ts` is the canonical projection. It **composes** `getMarketingWorkspaceSnapshot()` rather than replacing it, and adds campaign identities (execution + measurement rollups), channel-adapter readiness incl. contractual operations an adapter does *not* implement, evidence freshness, blockers each carrying one recovery action, and one next executable step. Pure builders are separate from the single DB assembler.
- `projectOperatingSnapshotForTools()` is the MCP-facing view; `buildMarketingOwnerDecision()` re-voices the *same* canonical next step for the owner. A parity test walks every next-step id, so the tool surface and the page cannot disagree.
- Campaign drill-ins are organization-scoped via `requireCampaignInScope`, and a missing/unknown `campaignId` returns candidate ids plus one recovery instruction.
- Supporting modules to reuse, not re-create: `org-scope.ts`, `archetype-context.ts`, `acquisition-signals.ts`, and `loadPublicationMetricsForTasks()` in `campaign-performance.ts`.

Two constraints B and C inherit:

- **Do not pass `getMarketingOperatingSnapshot()` a workspace it must reload.** `getMarketingWorkspaceSnapshot()` upserts `MarketingStrategy`; loading it twice concurrently races the `organizationId` unique key and 500s the render. Hand the loaded snapshot over via `{ workspace }`. The underlying upsert is still racy on a cold workspace — tracked as `BI-48025D6B`.
- **Evidence *sufficiency* is still C's job.** The snapshot reports `attributionConfidence` and `stale` — what the data can honestly support — not whether a winner may be declared.

### Deliverable B — governed recurring acquisition operating cycle

**Backlog item:** `BI-A6D5DF95`

**Independently shippable:** yes
**Depends on:** Deliverable A; reliable autonomous production also depends on `BI-8058697C`

Likely files:

- `apps/web/lib/operate/scheduled-jobs/coworker-self-tasks.ts`
- `apps/web/lib/actions/agent-task-scheduler*.ts`
- `apps/web/lib/marketing/scheduler.ts`
- `apps/web/lib/marketing/agentic-operations.ts`
- `apps/web/lib/tak/agent-routing.ts`
- `prompts/route-persona/marketing-specialist.prompt.md`
- marketing self-task, scheduler, routing, and agentic-loop tests

Implementation:

1. Encode the operating-cycle decision as a pure state reducer returning `blocked`, `wait`, `prepare`, `approval-needed`, `measure`, or `iterate`.
2. Change the marketing self-task to call the snapshot and follow that state, with idempotency keys and no filler fallback.
3. Permit coherent safe-internal batches while keeping publish, reply, and spend at phase gates.
4. Reconcile Balanced/Assertive cadence and no-op behavior with the existing proactivity control.
5. Make provider/tool failure produce a durable blocker and operator-readable recovery, not repeated empty calls.
6. Replace the persona's plan-only/atomic-turn rules with the evidence-packet boundary.
7. Keep scheduler side effects idempotent and preserve the existing outbound kernel veto.

Verification:

- red/green state-reducer tests for every state and transition;
- scheduled-task idempotency and no-duplicate tests;
- prompt/routing tests proving safe internal continuation and external-action restraint;
- functional manual dispatch against a seeded campaign;
- after `BI-8058697C` is resolved, observe a real scheduled run that creates or advances useful work without user prompting.

### Deliverable C — experiment lineage, anti-entropy evidence, and outcome learning

**Backlog item:** `BI-1B121908`

**Independently shippable:** yes
**Depends on:** Deliverable A

Likely files:

- `apps/web/lib/marketing/variants.ts`
- `apps/web/lib/marketing/campaign-performance.ts`
- `apps/web/lib/marketing/battlecards.ts`
- `apps/web/lib/marketing/utm.ts`
- channel KPI adapters and pullback
- Prisma schema/migration only if the verified existing relationships cannot carry lineage
- profession corpus or marketing skill guidance for evidence sourcing

Implementation:

1. Define the lineage contract and prove what existing fields/relations can already supply.
2. Bind variants to drafts/publications and retain source-signal provenance, hypothesis, channel/objective threshold, and decision rationale.
3. Connect conversion outcomes to CRM/storefront/revenue evidence only where identifiers support honest attribution; otherwise expose confidence/unknown.
4. Replace the global `MIN_IMPRESSIONS_FOR_DECISION` rule with objective/channel-aware evidence sufficiency while retaining a conservative default.
5. Add anti-entropy intake from first-party objections/inbox/search evidence and provenance-tagged public competitive evidence; do not scrape or copy content outside provider terms.
6. Feed a confirmed winner/loser learning into the next operating snapshot without treating correlation as causation.
7. If schema changes are necessary, use one fleet-safe migration with inline backfill or explicit data-safe attestation.

Verification:

- pure ranking/sufficiency tests including low sample, tie, zero conversion, high spend, and stale evidence;
- lineage round-trip from signal to publication to outcome;
- attribution-confidence tests;
- migration safety guard and clean migration apply when applicable;
- no new warehouse or parallel experiment table without recorded substrate justification.

### Deliverable D — owner operating view and end-to-end certification

**Backlog item:** `BI-E7B1321C`

**Independently shippable:** yes, after A–C
**Depends on:** Deliverables A, B, and C

Likely files:

- `apps/web/app/(shell)/customer/marketing/page.tsx`
- existing `/customer/marketing/*` subroutes
- `apps/web/components/customer-marketing/`
- `apps/web/lib/marketing/disclosure.ts`
- `apps/web/lib/coworker-lifecycle/golden-journeys.ts`
- route, disclosure, component, UX-budget, and certification tests

Implementation:

1. Preserve the owner-first lead section; drive it from the canonical snapshot.
2. Present one state-aware band: needs approval, running/gathering evidence, winner/decision ready, or blocked.
3. Put campaign detail and historical metrics on existing subroutes, not in the first viewport.
4. Reuse report-kit for metrics, status, empty, warning, tabular, and trend displays.
5. Add a realistic certification journey that establishes a campaign, creates variants/drafts, stops at approval, publishes through a test adapter, pulls KPI evidence, and makes the next decision from that evidence.
6. Add failure journeys for missing credentials, insufficient evidence, provider unavailable, archetype mismatch, and rejected approval.

Verification:

- affected Vitest suites and typecheck;
- production build;
- UX budget/theme/style/accessibility guards;
- browser exercise at desktop and 390px for fresh, blocked, approval, live, and measured fixtures;
- functional happy path with evidence timeline; no success claim from structural tests alone.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-IMP-14F9E938`
- Receipt: `cms4zgdfk004b01mxv2iq8rr7`
- Dependencies: A has none; B depends on A and `BI-8058697C` for production autonomy; C depends on A; D depends on A, B, and C.
- A — canonical operating snapshot and tool repair -> `BI-CEA797A1`
- B — governed recurring operating cycle -> `BI-A6D5DF95`
- C — experiment lineage and outcome learning -> `BI-1B121908`
- D — owner operating view and certification -> `BI-E7B1321C`

The governed receipt maps all four independently shippable deliverables to live BIs. The external provider-routing dependency remains explicit in the plan and Deliverable B's BI.

## Risks and rollback

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| Summary query becomes too broad/slow | bounded selects, per-org indexes, query-count/performance tests | feature flag or revert consumer wiring while retaining pure projection |
| Scheduled cycle creates duplicate/filler work | state reducer, stable idempotency keys, recent-artifact checks, no filler fallback | disable marketing self-task; existing manual tools remain |
| Coworker changes campaign too quickly | evidence-sufficiency result and wait state | revert threshold configuration; pause campaign/autopilot |
| Attribution overclaims revenue | explicit confidence and unknown state; only join on durable identifiers | suppress revenue attribution while retaining channel KPIs |
| Schema tightening wedges existing installs | expand/backfill/contract or data-safe attestation | forward corrective migration; never edit a committed migration |
| UI regresses into a dense dashboard | first-viewport budget, report-kit reuse, progressive disclosure, route-specific detail | revert D UI slice without reverting backend loop |
| External action escapes approval | existing outbound veto, spend gate, approval records, negative tests | disable policy/channel; pause scheduler |

## Documentation impact

Update in the implementing PRs:

- `docs/user-guide/` for the Marketing Strategist operating cycle, approval states, measurement, and recovery;
- marketing architecture/spec history when the read model or lineage contract changes;
- prompt/skill documentation when coworker behavior changes;
- no public-site positioning claim until a live end-to-end run proves the capability.

## Completion gate

The umbrella is complete only when:

1. the four child BIs have landed through separate DCO-signed PRs;
2. the canonical snapshot agrees across MCP and UI for the same organization;
3. a scheduled or manually dispatched coworker run advances safe internal work without a chat prompt;
4. the run stops at the correct external-action gate;
5. a test-channel publication produces KPI evidence;
6. the next coworker decision cites that evidence and honestly handles insufficiency;
7. the owner can understand the current state and one next action at desktop and 390px;
8. affected tests, typecheck, production build, UX verification, and any migration apply have passed;
9. user and architecture documentation are current;
10. no parallel warehouse, workflow engine, dashboard dialect, or experiment substrate was introduced without explicit supersession evidence.

## Separate-thread implementation prompt

Use this prompt in a new Codex task after this planning PR is merged:

> Implement the Marketing Strategist evidence-to-outcome loop from
> `docs/superpowers/plans/2026-07-28-marketing-evidence-to-outcome-loop.md`.
>
> Read the repository `AGENTS.md` in full, query the live BIs and the plan's backlog-coverage receipt, and begin with Deliverable A only. Use one fresh sibling worktree from `origin/main`, one BI, one branch, and one ready-for-review PR. Do not implement Deliverables B-D in the same PR.
>
> Follow `dpf-worktree-per-session`, `dpf-tdd`, `dpf-architecture-review`, `dpf-local-merge-ci-before-push`, and `dpf-pr-with-dco`; use `dpf-ux-fit-review` for any UI-affecting slice. Preserve the owner-first disclosure already delivered on `/customer/marketing`. Extend the existing marketing campaign, variant, publication, scheduler, KPI, and channel-adapter substrate; do not introduce a parallel warehouse, workflow engine, experiment model, dashboard, or navigation layer without first proving the existing substrate unfit.
>
> Spend about 20% of the implementation budget converging duplicated marketing read/query/formatting paths and removing stale tool assumptions. Define done with red-green tests, organization/archetype isolation, actionable empty campaign drill-ins, matching MCP/UI projections, source-local typecheck, and the applicable canonical-runtime gates. Record documentation impact and durable learnings, commit with DCO sign-off, push, open a regular non-draft PR, and report the evidence without claiming autonomous production behavior until `BI-8058697C` is functionally resolved.
