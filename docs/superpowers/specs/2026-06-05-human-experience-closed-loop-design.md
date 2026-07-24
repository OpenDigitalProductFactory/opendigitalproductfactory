# Human Experience Closed-Loop - Clickstream Capture, Analysis, and Optimization Design

| Field | Value |
| --- | --- |
| Status | Chief-architect review applied 2026-06-05; live epic and slice BIs exist; awaiting founder go for Slice 1 planning |
| Date | 2026-06-05 |
| Owner | Mark Bodman |
| Original author | Claude (Opus 4.8) |
| Architect review | Codex, 2026-06-05 |
| Scope | Architecture for first-party capture of internal-portal human interactions, deterministic friction analysis, AI-assisted UX finding synthesis, and governed improvement proposal flow |
| Out of scope | Feature code, schema migration, seeding the coworker, customer storefront capture, rrweb replay in v1, replacing the existing UX auditor / Build Studio verification substrate |
| Primary epic alignment | Live epic `EP-HX-LOOP` - Human Experience Closed-Loop |
| Related backlog | `BI-F323122B`, `BI-122C437F`, `BI-B4EC0C40`, `BI-4A1B34E1`, `BI-96812FC2`, `BI-963CA935` |
| Current linkage gap | MCP live backlog shows `EP-HX-LOOP` and all six BIs in `triaging`, but the canonical specs/plans search still returned zero matches for this spec and the epic reported `hasSpec: false`. Ratification must link this spec path before planning begins. |
| Anchor docs | `docs/superpowers/specs/2026-04-05-continuous-improvement-flywheel-design.md`, `docs/superpowers/specs/2026-06-05-portal-navigation-archetype-ia-design.md`, `docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md`, `docs/architecture/ai-coworker-development-principles.md`, `docs/platform-usability-standards.md`, `apps/web/components/ui/report-kit/README.md` |

## Architect Review Update

The original direction is right: DPF should continuously learn from real human use, not only from agent logs, manual audits, and Build Studio verification. The spec needed several corrections so it does not create parallel truth or overstate current runtime state.

Applied corrections:

- **Live backlog state is now explicit.** `EP-HX-LOOP` exists with six slice BIs, all currently `triaging`; it is no longer a merely proposed epic. The missing piece is spec linkage/indexing, not epic creation.
- **Current truth and target architecture are separated.** DPF already has strong server/agent observability; it does not yet have client-side human interaction capture or the proposed `InteractionEvent`, `UxSession`, `UxFrictionSignal`, or `UxReplayChunk` models.
- **The design-knowledge dependency is corrected, and is itself an INTERIM dependency (BI-0C86FA67, 2026-07-23).** The current skill is `skills/design/ui-ux-design-intelligence.skill.md` with 67 styles, 96 palettes, 57 font pairings, 25 chart types, and 99 UX guidelines. The prior referenced skill name is not present in this worktree — but this skill is the same superseded content under a new name: EP-UX-SYSTEM spec rev 2 (`docs/superpowers/specs/2026-07-22-holistic-ux-system-and-agent-codification-design.md` §6 L3, §8.1 D4, merged PR #3434) supersedes it, because it teaches Tailwind utilities (`animate-pulse`, `bg-primary`, `shadow-dpf-*`) that only existed in a deleted v3 `tailwind.config.ts`. The durable replacement — a two-tier skill composing pinned external guidelines (Vercel Web Interface Guidelines, Anthropic `frontend-design`) plus a generated DPF tier — is owned by `BI-49292C2B` (EP-UX-SYSTEM Phase 2, not yet built as of 2026-07-23). **Retirement trigger:** when `BI-49292C2B` ships, Slice 4's `composesFrom` and every reference below must repoint to its skill in the same change that closes it; do not let this spec keep citing `ui-ux-design-intelligence` past that point.
- **The UX dashboard contract is now binding.** Any HX reporting or review surface must use DPF theme tokens, `report-kit` primitives, `LocalTime`, and the central status-intent registry. Do not hand-roll badges, KPI cards, filters, tables, charts, timestamps, or local color maps.
- **The loop is positioned as an evidence producer, not a competing router.** HX findings emit `ImprovementSignal` rows and, when warranted, governed `AgentActionProposal` / `BacklogItem` records. Prioritization stays in the Continuous Improvement Flywheel and the normal backlog.
- **rrweb remains out of v1.** Replay is useful for human diagnosis, but it carries the highest privacy risk. Slices 1-5 close the loop without replay; Slice 6 stays deferred until masking, retention, and operator controls are proven.

## Executive Verdict

DPF can already see what **agents and the system** do. `GearInterface` records ring-boundary transmissions, `AdapterRunTelemetry` records inference cost and latency, `ToolExecution` audits platform tool calls, `DecisionInteraction` records governance choices, Build Studio carries `uxTestResults` and `uxVerificationStatus`, and the continuous-improvement flywheel can dedupe recurring evidence through `ImprovementSignal`.

DPF still cannot see what the **human** does in the browser: which routes they enter, where a primary action is hard to find, which buttons receive dead clicks, where a user rage-clicks, where a form is abandoned, or whether a shipped UX fix measurably reduced friction. The portal navigation audit had to discover problems by manually driving the UI. That will not scale.

The recommended architecture is a first-party, self-hosted, privacy-first HX loop:

1. **Capture** - a small portal-shell SDK captures page views, route transitions, semantic clicks, frustration signals, client errors, and typed flow anchors. It masks before network transmission and never captures free text or keystrokes.
2. **Store** - append-only `InteractionEvent` rows, derived `UxSession` rollups, and deterministic `UxFrictionSignal` rows create queryable evidence without depending on a third-party analytics product.
3. **Analyze** - Inngest jobs compute funnels, dead/rage/error clicks, abandonment, slow interactions, route dwell, and server-side joins before any LLM sees the data.
4. **Optimize** - the UX Analyst coworker reasons over structured analysis briefs, emits evidence-cited findings, writes `ImprovementSignal` rows, and proposes backlog work through governed proposal flow. The next cycle re-measures the same signal.

The architectural bet is **DPF as its own private experience-analytics engine**, not an embedded SaaS analytics product. The result should feel less like "tracking users" and more like a governed quality system for the human-facing product surface.

## Current Repo Truth

These are verified current substrates this spec builds on. They are not to be rebuilt or silently redefined.

| Concern | Current substrate | Verified path / model | Architectural rule |
| --- | --- | --- | --- |
| Ring-boundary observability | `GearInterface` | `packages/db/prisma/schema.prisma` model `GearInterface`; `apps/web/lib/gear-interface/otel-exporter.ts` | Mirror or project from source events; do not mutate source write models to satisfy HX. |
| Inference cost and latency | `AdapterRunTelemetry` | `schema.prisma` model `AdapterRunTelemetry`; `apps/web/lib/routing/adapter-telemetry-writer.ts` | Join HX to inference through explicit correlation IDs, not fuzzy after-the-fact matching. |
| Tool invocation audit | `ToolExecution` / `ToolExecutionReceipt` | `schema.prisma` models `ToolExecution`, `ToolExecutionReceipt` | Autonomous HX proposals remain auditable. |
| Governance choices | `DecisionInteraction` | `schema.prisma` model `DecisionInteraction` | Founder/operator gates are already captured elsewhere; do not create a second decision log. |
| Improvement evidence | `ImprovementSignal` + `createOrTouchImprovementSignal()` | `apps/web/lib/improvement-flywheel/signals.ts` | HX recurring friction becomes deduped evidence; prioritization stays in the flywheel. |
| Backlog/proposal flow | `AgentActionProposal`, `BacklogItem` | `apps/web/lib/actions/proposals.ts`, `apps/web/lib/explore/backlog.ts`, `apps/web/lib/mcp-tools.ts` | `BacklogItem.source` is intake origin; HX-created BIs use `source: automated-detection` and a closed `workType`. |
| Live backlog truth | MCP `list_epics`, `list_backlog_items` | `EP-HX-LOOP` plus six BIs, all `triaging` | The next step is spec linkage and Slice 1 planning, not new-epic creation. |
| Route inventory | `PORTAL_NAV_ROUTES` | `apps/web/lib/navigation/portal-navigation-model.ts` | Captured route/destination keys should resolve through the canonical nav model. |
| Periodic jobs | Inngest scheduled/event functions | `apps/web/lib/queue/functions/*` | HX sessionization and analysis should follow existing Inngest patterns and quiescence discipline. |
| UI/data-display standards | Theme tokens and report-kit | `docs/platform-usability-standards.md`, `apps/web/components/ui/report-kit/README.md` | HX review surfaces use report-kit and tokens only. |
| UX design reference | `ui-ux-design-intelligence` skill (INTERIM — superseded by EP-UX-SYSTEM, replacement pending `BI-49292C2B`) | `skills/design/ui-ux-design-intelligence.skill.md` | Use the current skill name; do not use obsolete skill names unless they are reintroduced. Retire this row and repoint to `BI-49292C2B`'s skill when it ships — see "Architect Review Update" above. |

Missing today:

- No client-side portal instrumentation stream.
- No `InteractionEvent`, `UxSession`, `UxFrictionSignal`, `UxAnalysisRun`, or `UxReplayChunk` models.
- No same-origin HX collector route.
- No correlation ID passed from browser interactions into server/tool/inference records.
- No UX Analyst coworker over observed human behavior.
- No HX dashboard or governed operator control for capture, retention, and sampling.

## Research and Benchmarking

### DPF-Specific Research

MCP `search_design_intelligence` returned no curated hits for HX analytics / friction-loop queries in the `ux` or `reasoning` domains during this review. Binding local guidance therefore comes from:

- `docs/platform-usability-standards.md` for WCAG 2.2 AA, theme tokens, focus states, and prohibited hardcoded colors.
- `apps/web/components/ui/report-kit/README.md` for status badges, stat cards, filters, tables, exports, charts, status intent mapping, and `LocalTime` usage.
- `docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md` for existing UX auditor, regression-test, `uxTestResults`, and `uxVerificationStatus` seams.
- `docs/superpowers/specs/2026-06-05-portal-navigation-archetype-ia-design.md` for the first proven friction class this HX loop should measure after it lands.

### External Patterns

| Source | Pattern to adopt | Pattern to reject |
| --- | --- | --- |
| PostHog autocapture | Hybrid autocapture plus explicit product events. Autocapture gives coverage; typed flow events provide funnel anchors. | Autocapture-only analysis that produces noisy, low-semantic events. |
| rrweb | DOM replay can be useful after mask-all privacy proof. Use only for sampled/flagged human diagnosis. | Replay in v1, replay to LLMs, or raw DOM/text capture without proven masking. |
| Datadog RUM frustration signals | Deterministic `rage_click`, `dead_click`, and `error_click` signals, searchable and dashboarded by route/action. | Treating frustration signals as proof of root cause without server-side correlation. |
| FullStory/Amplitude/Heap category patterns | Frustration and funnel-dropoff taxonomy. | Importing a product-analytics vendor as the substrate. |
| WCAG 2.2 | Accessibility remains a baseline: contrast, target size, keyboard/focus, and accessible authentication issues are UX evidence. | Treating analytics as a substitute for accessibility verification. |
| UX research AI pipeline guidance | Break analysis into artifacts: event rollups -> coded signals -> aggregate brief -> AI synthesis -> cited finding. | Giving an LLM raw event firehose, raw replay, or unstructured transcripts and asking for generic insight. |

### Capture Model Decision

Use **hybrid autocapture plus typed events**.

Autocapture covers:

- page view
- route transition
- semantic click
- dead click
- rage click
- client JS error
- visible API error
- scroll-depth milestone

Typed events cover known product funnels:

- `flow.build.ideate_submitted`
- `flow.onboarding.archetype_selected`
- `flow.business_setup.completed`
- `flow.portal_settings.saved`
- `flow.backlog_item.created`

Typed events are declared in one registry module and referenced by the analyzer. Funnel definitions must import from that registry; string literals in multiple places are not allowed.

## Recommended Architecture

```text
BROWSER - internal portal shell
  HX Capture SDK
    - pageview / route / click / dead-click / rage-click / error
    - typed flow anchors from a central registry
    - masks before network, no free text, no keystrokes
    - batches with sendBeacon/fetch keepalive
    - emits hxCorrelationId for action-causing interactions
        |
        v
POST /api/hx/collect
  - same-origin, authenticated, origin-checked
  - validates event schema and payload limits
  - enriches route through portal-navigation-model
  - writes append-only InteractionEvent
        |
        v
Inngest hx-sessionize
  - stitches events into UxSession
  - computes rule-based UxFrictionSignal
        |
        v
Inngest hx-analyze-daily / hx-synthesize-weekly
  - computes funnels, dropoffs, dwell, repeat friction
  - joins server-side telemetry by hxCorrelationId
  - writes UxAnalysisRun / analysis brief
        |
        v
UX Analyst coworker
  - reads aggregate brief, not raw events
  - consults ui-ux-design-intelligence and UX auditor outputs
  - emits evidence-cited findings
        |
        v
ImprovementSignal -> AgentActionProposal -> BacklogItem
        |
        v
Build Studio / manual fix -> next HX cycle re-measures signal
```

## Architecture Rules

1. **No third-party egress.** HX data stays in the local DPF install unless a future, governed export feature explicitly says otherwise.
2. **Mask before network.** The browser SDK is the first privacy boundary. The collector rejects payloads that look like raw text, email, phone, address, or input values.
3. **No raw replay in v1.** Slices 1-5 use structured events and aggregates only.
4. **Correlation is explicit.** Browser actions that trigger server work carry an `hxCorrelationId`; server-side writers attach it where relevant. Do not infer joins by timestamp alone.
5. **Deterministic before AI.** LLMs receive analysis briefs with counts, routes, signal IDs, and evidence pointers. They never receive the raw firehose.
6. **One improvement spine.** HX emits into `ImprovementSignal` and governed proposal/backlog flow. It does not create a second work queue.
7. **UI surfaces compose existing primitives.** Any HX list, dashboard, badge, KPI, filter, export, chart, or timestamp uses report-kit / `LocalTime` and DPF tokens.
8. **Accessibility remains a gate.** HX signals can identify friction, but Build Studio UX verification and WCAG checks remain mandatory for shipped UI work.

## Stage 1 - Capture

Create a first-party client SDK loaded by the internal portal shell.

### V1 Event Set

Slice 1 should prove the smallest safe capture set first:

| Event | Payload rule |
| --- | --- |
| `pageview` | route, nav key, timestamp, viewport class, referrer route key if internal |
| `route_transition` | from route key, to route key, duration bucket |
| `click` | route key, element descriptor, semantic role, `data-hx-id` if present |
| `dead_click` | click target produced no route, focus, request, modal, or visible state change within threshold |
| `rage_click` | repeated clicks on same semantic target within a short interval |
| `client_error` | error class and route, with message redacted/truncated |
| `visible_api_error` | route, action key, response class, visible error category |
| `flow.*` | registry-defined funnel anchor with enumerated payload only |

Form interaction metadata is allowed only after the Slice 1 plan proves masking tests. If included, it is metadata-only: field role, field key, validation error kind, focus/blur/submit/abandon. Field values, partial values, placeholder-derived text, and keystrokes are prohibited.

### Element Identity

Element identity resolves in this order:

1. `data-hx-id` on intentionally instrumented controls.
2. Accessible name / ARIA label, normalized and truncated.
3. Semantic role plus nearest route/nav key.
4. Last resort: stable component descriptor, never a raw CSS selector as primary identity.

Do not use CSS selectors as canonical identity. They are brittle and may leak structure without meaning.

### Capture Controls

Use a `PlatformConfig` key such as `humanExperienceCapture` for v1 single-install control:

```json
{
  "enabled": false,
  "scope": "internal-portal",
  "eventSamplingRate": 1.0,
  "replaySamplingRate": 0,
  "rawEventRetentionDays": 30,
  "sessionRetentionDays": 90,
  "signalRetentionDays": 365
}
```

The exact key name can be finalized in Slice 1, but the control must exist before collection is enabled. Capture must be visible to administrators and documented in the product surface.

## Stage 2 - Store

Proposed models:

### `InteractionEvent`

Append-only, raw-but-masked event store.

Fields:

- `eventId`
- `organizationId`
- `sessionId`
- `anonymousActorRef`
- `hxCorrelationId`
- `eventType`
- `route`
- `routeKey`
- `destinationKey`
- `elementDescriptor`
- `occurredAt`
- `viewport`
- `payload`
- `privacyClass`
- `retentionUntil`

Indexes:

- `(organizationId, sessionId, occurredAt)`
- `(organizationId, eventType, occurredAt)`
- `(organizationId, routeKey, occurredAt)`
- `(hxCorrelationId)`

### `UxSession`

Derived session rollup.

Fields:

- `sessionId`
- `organizationId`
- `anonymousActorRef`
- `startedAt`
- `endedAt`
- `entryRouteKey`
- `exitRouteKey`
- `routeSequence`
- `eventCounts`
- `completedFlows`
- `abandonedFlows`
- `frictionSignalCount`
- `outcome`

### `UxFrictionSignal`

Deterministic pre-LLM signal.

Kinds:

- `rage_click`
- `dead_click`
- `error_click`
- `form_abandon`
- `funnel_dropoff`
- `slow_interaction`
- `route_thrashing`
- `scroll_thrashing`
- `accessibility_blocker_observed`

Fields:

- `signalId`
- `kind`
- `routeKey`
- `destinationKey`
- `elementDescriptor`
- `severity`
- `occurrences`
- `affectedSessions`
- `firstSeenAt`
- `lastSeenAt`
- `joinedServerRefs`
- `evidence`
- `status`

### `UxAnalysisRun`

Stores each deterministic analysis cycle and the compact brief the coworker receives.

Fields:

- `runId`
- `startedAt`
- `completedAt`
- `scope`
- `eventsAnalyzed`
- `sessionsAnalyzed`
- `signalsAnalyzed`
- `brief`
- `modelInputDigest`
- `coworkerFindingRefs`

### `UxReplayChunk`

Deferred to Slice 6. If implemented later, it must be mask-all by default, sampled, TTL-limited, and for human diagnosis only. It is not part of v1 acceptance.

## Stage 3 - Analyze

Use two deterministic jobs and one synthesis job:

| Job | Cadence | Responsibility |
| --- | --- | --- |
| `hx-sessionize` | Event-driven or short debounce | Stitch events into sessions and update derived counts. |
| `hx-analyze-daily` | Daily | Compute friction signals, funnel dropoffs, route dwell, and server-side joins. |
| `hx-synthesize-weekly` | Weekly | Ask UX Analyst coworker to synthesize top evidence bundles into findings. |

Daily deterministic signals give quick regression detection. Weekly coworker synthesis reduces proposal spam and allows patterns to mature.

The analysis brief must include:

- top signals by `severity x affectedSessions x recurrence`
- funnel completion and dropoff counts
- route/key inventory from `portal-navigation-model.ts`
- joined `ToolExecution`, `AdapterRunTelemetry`, and `GearInterface` refs when correlation exists
- before/after metric if the signal was previously acted on
- excluded data count and privacy rejection count

The analysis brief must not include:

- raw free text
- raw DOM
- full session replay
- unmasked form values
- user identity

## Stage 4 - Optimize

The UX Analyst coworker converts briefs into governed findings.

### Coworker Contract

Create a specialist coworker only after Slice 1-3 evidence exists.

Proposed assets:

- `prompts/specialist/ux-analyst.prompt.md`
- `packages/dpf-skill-pack/skills/ux-analysis/SKILL.md`
- registry entry in `packages/db/data/agent_registry.json`

The coworker should:

- consume `UxAnalysisRun.brief`
- cite `UxFrictionSignal.signalId`, route key, affected-session count, and before/after metric
- consult `skills/design/ui-ux-design-intelligence.skill.md` (INTERIM dependency — see "Architect Review Update"; repoint to `BI-49292C2B`'s replacement skill when it ships)
- reference AGT-903 / AGT-906 / AGT-907 outputs when a finding overlaps accessibility, heuristic UX, or regression-test scope
- produce structured findings, not generic prose

**Boundary against AGT-906 `ux-design-critic` (already encoded in `packages/db/src/workforce-seed.ts` and `apps/web/lib/tak/agent-routing.ts` for that coworker).** This coworker is posterior/behavioural: it reasons over real user telemetry — `UxAnalysisRun` briefs derived from captured `InteractionEvent`/`UxFrictionSignal` rows — after the fact, answering "where did users struggle". `ux-design-critic` is prior/compositional: it reasons over rendered screenshots and the founder-authored critique corpus, before merge, answering "is this well designed". A finding that is compositional rather than behavioural should be handed to `ux-design-critic` rather than speculated about here. Only one of the two should be surfaced as "the UX coworker" on any given nav/workforce surface — `ux-design-critic` is the only one seeded today (this coworker is still `deferred`, see `BI-4A1B34E1`); when it is built, its registry entry, prompt, and nav label must stay distinct from `ux-design-critic`'s.

The coworker must not:

- read raw events by default
- read replay chunks
- propose work without evidence counts
- bypass `ImprovementSignal`
- auto-create backlog items without governed proposal flow unless a future policy explicitly grants that authority

### Loop Closure

1. Finding calls `createOrTouchImprovementSignal()` with `sourceType: "ux_friction"` and stable `sourceId` such as `routeKey:kind:elementKey`.
2. Recurrence increments the existing signal instead of creating duplicates.
3. Findings above threshold create `AgentActionProposal(actionType: "create_backlog_item")`.
4. On approval, `BacklogItem` uses `source: automated-detection`, `workType: bug | feature | refactor`, and starts in the current backlog intake state (`triaging` in live MCP results).
5. Build Studio or manual implementation ships a fix.
6. The next HX analysis run compares the same signal before/after.
7. If severity and reach drop below threshold, the finding resolves with evidence; if not, recurrence climbs and it resurfaces.

## Operator UX

The first operator surface should be quiet, operational, and evidence-first.

Recommended placement:

- `/ops/improvements` for findings, proposed work, and before/after outcomes.
- `/platform/audit/metrics` or a Platform Audit subview for capture health, privacy rejection counts, retention status, and collector diagnostics.
- `/platform/audit` only for any future replay viewer.

UI requirements:

- Use `StatCard` for top-line event/session/signal counts.
- Use `StatusBadge` and central `statusColors` for signal status and severity.
- Use `FilterBar` for route, signal kind, severity, and status filters.
- Use `DataTable` for findings/signals.
- Use `Chart` by subpath only for meaningful time-series views.
- Use `ExportButton` only for masked aggregates; raw events are not exported in v1.
- Use `LocalTime` for timestamps.
- Use only `var(--dpf-*)` tokens.
- Provide empty states that explain whether capture is off, no traffic exists, or no friction was detected.

The surface should show confidence honestly:

- sample size
- analysis window
- capture status
- privacy rejection count
- correlation coverage
- whether the finding is new, recurring, resolved, or inconclusive

## Privacy, Consent, and Governance

This capability is powerful enough to damage trust if it feels hidden. Privacy is not a later UI affordance; it is part of the architecture.

Rules:

- Capture is disabled until an operator enables it through a governed config surface.
- Internal-portal capture is v1 scope. Customer storefront and external `/portal` capture require a separate consent/legal review.
- The browser SDK strips or blocks sensitive values before network transmission.
- Inputs, textareas, contenteditable nodes, password fields, tokens, emails, phone numbers, addresses, and payment-like values are deny-listed.
- `data-hx-allow` may only allow semantic metadata. It must not allow raw text capture.
- The collector validates payload size, allowed event types, route keys, and privacy class.
- Same-origin and session authentication are required. No CORS collection endpoint.
- Raw events have short TTL. Aggregates and signals may persist longer because they are non-identifying evidence.
- Pseudonymous `anonymousActorRef` is not anonymous. Any identity join for support must be access-controlled and audited.
- Replay is off in v1. If Slice 6 lands later, replay chunks must be masked, sampled, TTL-limited, and never sent to the LLM.

## Phased Implementation

Each slice is independently shippable and verifiable. Do not build ahead; file/plan/build/verify one slice at a time.

### Slice 0 - Ratification and Linkage

Backlog already exists. Before implementation planning:

- Link this spec path to `EP-HX-LOOP`.
- Record the founder/architect decision that Slices 1-5 are v1 and Slice 6 is deferred.
- Confirm the six BIs remain the right slice shape.
- Feed `BI-F323122B` into planning only after linkage is visible through MCP search/spec surfaces.

### Slice 1 - Capture SDK, Collector, and `InteractionEvent`

Backlog item: `BI-F323122B`.

Required plan correction: split the work internally into a safe minimum proof before full event breadth.

- 1A: pageview, route transition, click, dead/rage click, client/visible API error, typed-event registry, collector route, payload validation, `InteractionEvent`.
- 1B: form metadata only after masking tests pass. No form values.

Verification:

- Drive the canonical local install internal portal.
- Confirm masked events land with route keys and no sensitive payload.
- Confirm collector rejects raw-looking text and oversized payloads.
- Confirm SDK does not block interaction or create layout shift.

### Slice 2 - Sessionization and Friction Signals

Backlog item: `BI-122C437F`.

- Add `UxSession`.
- Add deterministic `UxFrictionSignal`.
- Implement `hx-sessionize`.
- Implement rule tests for each signal kind.

Verification:

- Induce known dead click, rage click, route thrash, and form-abandon metadata in a controlled route.
- Confirm signals match expected rows and evidence.

### Slice 3 - Analysis Brief and Server-Side Join

Backlog item: `BI-B4EC0C40`.

- Add `UxAnalysisRun`.
- Add `hx-analyze-daily`.
- Propagate and join by `hxCorrelationId`.
- Compute funnel/dropoff/dwell aggregates.

Verification:

- Seed a deterministic event fixture.
- Hand-compute counts and compare to the generated brief.
- Confirm joined server refs appear only when explicit correlation exists.

### Slice 4 - UX Analyst Coworker

Backlog item: `BI-4A1B34E1`.

- Add coworker registry, prompt, and skill.
- Use `ui-ux-design-intelligence` as an INTERIM design-knowledge dependency; repoint `composesFrom` to `BI-49292C2B`'s replacement skill if that BI has shipped by the time this slice builds (retirement trigger, see "Architect Review Update").
- Produce evidence-cited findings over analysis briefs.
- Emit `ImprovementSignal` only; do not create a parallel queue.

Verification:

- Run on a seeded friction scenario.
- Confirm finding cites signal IDs, affected-session counts, route keys, and proposed fix rationale.
- Confirm no raw event payload reaches the model.

### Slice 5 - Loop Closure and Proposal Pipeline

Backlog item: `BI-96812FC2`.

- Threshold findings into `AgentActionProposal`.
- On approval, create `BacklogItem(source: automated-detection)`.
- Re-measure after a mock or real fix.
- Resolve or resurface the signal based on metric movement.

Verification:

- Full round trip: induce friction -> synthesize finding -> approve BI proposal -> apply mock fix -> re-measure resolution.

### Slice 6 - Masked Replay (Deferred)

Backlog item: `BI-963CA935`.

Deferred. Only start after Slices 1-5 prove value and privacy controls.

Requirements if later reactivated:

- rrweb mask-all defaults.
- sampled/flagged sessions only.
- short TTL.
- human diagnosis only.
- no LLM replay access.
- report-kit viewer if surfaced.

## Resolved Decisions

1. **Replay is out of v1.** Slices 1-5 are sufficient to close the loop.
2. **Internal portal only for v1.** External customer surfaces need separate consent and legal review.
3. **Cadence is daily deterministic signals plus weekly coworker synthesis.** This balances regression latency with noise control.
4. **Epic shape is standalone.** `EP-HX-LOOP` exists and is the right home; it reuses Reduction Gear and flywheel primitives without being swallowed by either.
5. **Report-kit is binding for HX UI.** HX dashboards/reviews must not become a new design-system fork.
6. **`ui-ux-design-intelligence` is the design skill dependency, and it is explicitly INTERIM.** It is the same content as the retired `ui-ux-pro-max`, now superseded by EP-UX-SYSTEM (spec rev 2, PR #3434); the durable replacement is `BI-49292C2B`'s two-tier skill (pinned external guidelines + generated DPF tier), not yet built as of 2026-07-23 (BI-0C86FA67). Any future rename or the `BI-49292C2B` handoff must update this spec and seeded skill references in the same change.

## Open Decisions

1. **Default capture state after install.** Recommendation: disabled until explicitly enabled in Platform config, even for internal portal, because trust matters more than early data volume.
2. **First analysis surface.** Recommendation: `/ops/improvements` for findings/proposals; Platform Audit for collector/privacy health.
3. **Exact raw-event retention default.** Recommendation: 30 days raw events, 90 days sessions, 365 days signals, but confirm against deployment/customer requirements in Slice 1 planning.
4. **Correlation ID storage targets.** Recommendation: add optional correlation refs to HX models first; only add optional fields to existing server-side writers when a concrete join is needed and tested.

## Acceptance Criteria

- Live MCP search can find this spec path for `EP-HX-LOOP`.
- `BI-F323122B` plan names current repo truth and does not claim HX models already exist.
- Collector is same-origin, authenticated, origin-checked, schema-validated, and payload-limited.
- Browser SDK masks before network and has tests proving sensitive inputs are not serialized.
- `InteractionEvent` rows contain route/nav keys from `portal-navigation-model.ts`.
- `UxFrictionSignal` rows are deterministic and unit-tested.
- `UxAnalysisRun.brief` contains aggregate evidence only.
- UX Analyst coworker cannot access raw events or replay by default.
- Findings emit `ImprovementSignal` before any backlog proposal.
- Backlog proposals use `source: automated-detection` and valid closed `workType`.
- HX operator UI uses report-kit, `LocalTime`, DPF tokens, and central status intents.
- Canonical-runtime UX verification exercises the HX control surface and at least one captured portal flow.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Privacy/trust regression | Disabled-by-default config, visible admin controls, masking before network, payload rejection tests, short TTL. |
| Event noise | Hybrid typed events, deterministic aggregation, weekly synthesis threshold, recurrence dedupe. |
| LLM confabulation | Analysis briefs only, evidence IDs required, no raw firehose, no finding without counts. |
| False root cause | Explicit server correlation IDs; findings state confidence and correlation coverage. |
| Performance overhead | Idle batching, sendBeacon/keepalive, payload caps, no synchronous blocking, SDK perf test. |
| Parallel work queue | Always emit through `ImprovementSignal` and governed proposal/backlog flow. |
| UI design fork | Report-kit and token requirements are acceptance criteria. |
| Replay scope creep | Replay is deferred and human-only; no LLM replay access. |

## Next Step

Founder go should trigger Slice 1 planning for `BI-F323122B`, not implementation directly. The plan must start with a failing test/migration shape for `InteractionEvent`, a masking contract test, and a canonical-runtime verification path that proves the collector works on the internal portal without capturing sensitive values.

## Sources

- [PostHog autocapture docs](https://posthog.com/docs/product-analytics/autocapture)
- [PostHog - Is autocapture still bad?](https://posthog.com/blog/is-autocapture-still-bad)
- [rrweb guide](https://rrweb.com/docs/guide)
- [Datadog RUM frustration signals](https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/frustration_signals/)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Great Question - AI for UXR Analysis and Synthesis](https://greatquestion.co/ux-research/ai-analysis-synthesis)
