# AI Routing Architecture & Explainability — Design

| Field | Value |
| --- | --- |
| Status | Approved — documentation authority, deterministic Designed EA projection, and architecture drill-through implemented; Operations Map Observed/Compare delivery remains |
| Date | 2026-07-26 |
| Epic | `EP-CFACFA9F` — AI Routing Architecture & Explainability |
| Umbrella BI | `BI-3FA17F95` |
| Plan | `docs/superpowers/plans/2026-07-26-ai-routing-architecture-explainability.md` |
| Primary surface | Existing `/platform/ai/operations-map` |
| Architecture surface | Existing `/ea` |
| Upstream security contract | `BI-3D210AF8`; merged PR #3602; `docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md` |
| Composes with | `EP-AI-OPSMAP`, `EP-PARITY-ENGINE`, `EP-ROUTING-11`, `EP-DATA-GOVERNANCE` |

## 1. Executive decision

DPF will present AI routing through **one canonical architecture model with three
synchronized projections**:

1. **Designed** — how a request is supposed to move through screening, policy,
   eligibility, selection, fallback, dispatch, and response handling.
2. **Observed** — privacy-safe operational evidence over the same stations and
   edges for a selected time window.
3. **Compare** — conformance between the designed path and observed evidence,
   including missing evidence, unexpected paths, stale design, and attribution
   gaps.

The owner-facing projection is a plain-language subway map informed by BPMN. The
technical projection uses BPMN for behavior, SysML for requirements and
verification, and ArchiMate/C4 for realizing structure. These are viewpoints over
the existing DPF substrate, not separately maintained diagrams.

The pre-dispatch sensitive-routing plan is authoritative for screening, PDP/PEP,
masking/tokenization, fallback enforcement, safe receipts, and authorized
rehydration. This design consumes those contracts and does not redefine them.

## 2. Problem

DPF has substantial routing capability but no single governed picture that answers,
at a glance:

- How is an AI request supposed to be routed?
- Is protected data allowed to cross the chosen boundary?
- Why did this provider and model win?
- Which alternatives were excluded, and why?
- What happens when the selected route is unavailable or reaches a time/usage limit?
- Did fallback preserve the original policy obligations?
- How is the system actually behaving now?
- Where does operational evidence disagree with the design?
- What can an operator safely adjust?

Today those answers are distributed across routing code, data-governance policy,
provider suitability, provider/model configuration, EA views, several design
documents, route receipts, outcomes, token usage, capacity state, and the AI
Operations Map.

The initial audit found concrete ambiguity:

- `docs/superpowers/specs/2026-04-20-routing-architecture-current.md` says provider
  and model pins are deliberately unused.
- `docs/user-guide/ai-workforce/model-routing-lifecycle.md` describes a seeded pin
  and a pin-preference routing stage.
- `docs/superpowers/specs/2026-04-27-routing-control-data-plane-design.md` describes
  a target RIB/FIB separation whose primary backlog item is deferred.
- The unified Operations Map canvas remains a preview above legacy authoritative
  panels.
- The EA substrate defines cross-notation relationships, but the live install has
  no instantiated cross-notation relationship edges.

This makes it possible for individual documents to be locally correct while the
whole system remains difficult to explain or verify.

The documentation-authority slice resolves the pinning ambiguity: seed and
first-run bootstrap leave pins null; a persisted pin is an exceptional preference
override applied only to a non-excluded candidate; startup audits every persisted
pin. Live evidence on 2026-07-26 found 24 agent configurations and zero provider or
model pins. The [AI routing document map](../../architecture/ai-routing-document-map.md)
now distinguishes current implementation, adjacent delivery contracts, proposed
architecture, and historical records.

## 3. Goals

1. Give a nontechnical owner one picture that explains routing in business language.
2. Let a technical operator drill into rules, source versions, evidence, and
   remediation without leaving the shared context.
3. Keep design and operational evidence visibly separate but geometrically aligned.
4. Project current-state architecture from source registries and implementation
   contracts through the Parity Engine.
5. Consume privacy-safe routing receipts without exposing prompts, detected values,
   token maps, credentials, evidence documents, or vendor account identifiers.
6. Reuse the existing EA, Operations Map, routing, governance, and telemetry
   substrate.
7. Make documentation authority and supersession explicit.
8. Preserve the 20 percent refactoring budget for shared projection/evidence seams
   and deletion of superseded panels.

## 4. Non-goals

- Do not create another router, PDP, PEP, classification taxonomy, provider
  suitability compiler, operations route, or architecture database.
- Do not copy routing policy into diagram data.
- Do not store one EA element or conformance issue per inference transaction.
- Do not expose raw sensitive payloads in diagrams, inspectors, exports, logs, or
  receipts.
- Do not make SysML the normal-user experience.
- Do not adopt a full DMN substrate until the design proves that a governed
  decision inspector over existing rule sources is insufficient.
- Do not present the deferred RIB/FIB design as current implementation.
- Do not cut over from legacy Operations Map panels until functional, accessibility,
  responsive, and replay parity are proven.

## 5. Primary picture 1 — owner-readable routing subway

This is the default Designed view. Labels are phrased as owner questions. Technical
terms appear only in the inspector.

```mermaid
flowchart LR
    A["Work asks for AI help"] --> B["What work and data are involved?"]
    B --> C{"May this data cross the chosen boundary?"}
    C -->|"No / needs review"| D["Keep it local, request approval, or stop"]
    C -->|"Yes, but protect it"| E["Omit, mask, tokenize, or aggregate"]
    C -->|"Yes"| F["Build the allowed route set"]
    E --> F
    F --> G{"Which routes can actually do the work?"}
    G -->|"None"| D
    G --> H{"Which routes are available within current limits?"}
    H -->|"Temporarily unavailable"| I["Use an eligible fallback, defer, or stop"]
    H -->|"Available"| J["Balance quality, time, and cost"]
    I --> J
    J --> K["Dispatch through the selected adapter"]
    K --> L["Record a privacy-safe decision and outcome"]
    L --> M{"May protected values be restored here?"}
    M -->|"No"| N["Return a masked answer and explanation"]
    M -->|"Yes"| O["Return the authorized answer"]
    N --> P["Learn from outcomes and detect drift"]
    O --> P
    P --> B
```

### 5.1 Station semantics

| Owner-facing station | Technical contract | Canonical source |
| --- | --- | --- |
| Work asks for AI help | Inference/coworker entry point | Governed routed-inference entry points |
| What work and data are involved? | Activity context, purpose, actor, governed data classification | Data-governance registry plus activity contract |
| May this data cross the chosen boundary? | Data PDP decision and destination class | `policy-decision.ts` and sensitive-routing plan (`BI-3D210AF8`) |
| Keep it local, request approval, or stop | PDP deny/review outcome or local endpoint restriction | Policy decision PEP and safe fallback controller |
| Omit, mask, tokenize, or aggregate | Mask-before-context/tokenization obligations | `mask-for-context` contract from `BI-DG-009` |
| Build the allowed route set | `RequestContract` provider/residency/sensitivity constraints | Request-contract compiler and provider-suitability policy |
| Which routes can actually do the work? | Capabilities, context, modality, tool and contract-family floors | Routing loader and `routeEndpointV2` hard filters |
| Which routes are available within current limits? | Lifecycle state, runtime capacity, cooldown, short/long quota windows | Provider capacity/circuit-breaker sources |
| Use an eligible fallback, defer, or stop | Fallback chain execution preserving original constraints | Governed fallback contract (`fallback.ts`) |
| Balance quality, time, and cost | Ranking inside the eligible set | Routing scorer and Golden Triangle posture |
| Dispatch through the selected adapter | Adapter/transport invocation | Inference adapter registry (`ai-inference.ts`) |
| Record a privacy-safe decision and outcome | Screen, route, adapter, outcome and token evidence | `RouteDecisionLog`, `RouteOutcome`, `AdapterRunTelemetry` ledgers |
| May protected values be restored here? | Rehydration PDP check plus actor/surface/action authorization | `BI-749EB750` / `BI-62BFAA95` authorization contract |
| Return a masked answer and explanation | Unhydrated or token-preserved response with plain-language explanation | Response formatter with safe explanation codes |
| Return the authorized answer | Rehydrated response for authorized recipient/surface | Rehydration transformer (`rehydrationHandle`) |
| Learn from outcomes and detect drift | Evaluation, telemetry aggregation and parity | Parity Engine and conformance steward |

## 6. Primary picture 2 — design and evidence projection architecture

This picture explains how DPF keeps one model while serving different audiences and
time windows.

```mermaid
flowchart TB
    subgraph S["Canonical sources"]
      S1["Routing code and registries"]
      S2["Data policy and provider suitability"]
      S3["Provider/model/capacity configuration"]
      S4["Sensitive-routing contracts"]
    end

    subgraph P["Design projection"]
      P1["Versioned extractors"]
      P2["EA graph with stable source identities"]
      P3["BPMN behavior"]
      P4["SysML requirements and verification"]
      P5["ArchiMate/C4 realizing structure"]
    end

    subgraph E["Operational evidence"]
      E1["Safe screen receipt"]
      E2["RouteDecisionLog"]
      E3["RouteOutcome and adapter telemetry"]
      E4["Token/cost/capacity evidence"]
      E5["Authorized rehydration outcome"]
    end

    subgraph V["Synchronized user views"]
      V1["Designed"]
      V2["Observed"]
      V3["Compare"]
      V4["Technical inspector"]
    end

    S1 --> P1
    S2 --> P1
    S3 --> P1
    S4 --> P1
    P1 --> P2
    P2 --> P3
    P2 --> P4
    P2 --> P5
    E1 --> V2
    E2 --> V2
    E3 --> V2
    E4 --> V2
    E5 --> V2
    P3 --> V1
    P4 --> V4
    P5 --> V4
    V1 --> V3
    V2 --> V3
    P2 --> V4
    V3 --> V4
```

## 7. Viewpoint contract

### 7.1 Designed

Designed is the versioned architecture projection. It shows:

- expected stations, gates, paths and fallback boundaries;
- which rules are hard constraints versus ranking preferences;
- the source and version of each deterministic fact;
- which facts are implemented, proposed target-state, historical, or unresolved;
- requirements and verification cases.

Designed never derives truth from recent traffic. Zero traffic does not remove a
designed path.

### 7.2 Observed

Observed decorates the Designed geometry for a selected time window. It shows:

- request/decision volume;
- allowed, transformed, reviewed, denied and blocked outcomes;
- candidate exclusion reasons;
- selected providers/models/adapters;
- fallback depth and failure classes;
- p50/p95 latency and total elapsed time;
- input/output tokens and cost or subscription-window posture;
- capacity/cooldown state;
- evidence freshness;
- attribution and correlation coverage.

Observed never changes the designed topology. Unexpected observed routes appear as
temporary evidence edges and conformance candidates.

### 7.3 Compare

Compare uses explicit visual states:

| State | Meaning |
| --- | --- |
| Solid neutral | Designed and observed |
| Gray | Designed but not observed in the selected window |
| Colored | Observed volume/status over a designed edge |
| Dashed warning | Observed path not represented in the design |
| Broken evidence marker | Designed station has missing or stale operational evidence |
| Unattributed marker | Evidence cannot be assigned to a coworker/actor |
| Uncorrelated marker | Screen, route, outcome, or rehydration evidence cannot be joined |
| Proposed badge | Target-state design, not current implementation |

Conformance is aggregated by stable architecture identity and time window. The
system must not create a conformance row for every inference transaction.

### 7.4 Technical inspector

The inspector progressively discloses:

1. **Owner answer:** what happened, why, and the safest next action.
2. **Routing explanation:** selected route, excluded alternatives, fallback and
   obligations.
3. **Evidence:** timestamps, freshness, safe receipt identifiers, metrics and
   correlation coverage.
4. **Architecture:** BPMN/SysML/ArchiMate relationships, source keys, rule/policy
   versions and verification cases.
5. **Raw engineering identifiers:** available only to authorized technical users
   and still excluding protected payload content.

## 8. Notation decision

| Concern | DPF notation/presentation |
| --- | --- |
| Owner-readable end-to-end route | Subway rendering of the BPMN process |
| Process sequence, fallback and actors | BPMN 2.0 |
| Requirements, constraints, allocations and verification | SysML v2 |
| Enterprise/component realization | ArchiMate; C4 as a lightweight human view |
| Routing rule details | Governed decision inspector over canonical rule sources |
| Full decision requirements/tables | DMN only after the inspector is proven insufficient |

The current EA substrate already supports BPMN, SysML, ArchiMate, viewpoints,
snapshots, conformance issues and cross-notation relationship definitions. The first
implementation must instantiate and navigate those relationships rather than add a
parallel diagram store.

## 9. Data authority and safe evidence

### 9.1 Design authority

| Fact | Authority | Projection behavior |
| --- | --- | --- |
| Routing stages and order | Implemented routing modules/registries | Deterministic BPMN extraction |
| Data sensitivity/purpose rules | Data-governance sources | Linked rule source; do not copy policy |
| Provider suitability obligations | Suitability compiler and evidence registry | Linked constraints/requirements |
| Model/provider capabilities | ModelProfile/ModelProvider plus loaders | Derived eligible-route facts |
| Runtime capacity/cooldown | Capacity/circuit-breaker state | Observed overlay only |
| Target RIB/FIB design | Control/data-plane design spec | Proposed badge until implemented |
| Architect interpretation | Approved design artifact | Explicit architect provenance |

### 9.2 Operational authority

The evidence projection should reuse:

- sensitive-screen receipt from `BI-3D210AF8` (`InferenceDataScreenResult`: `screenId`, `decisionId`, `inputHash`, `classifiedDataClasses`, `obligations`, `transformation`);
- `RouteDecisionLog` (Prisma model: `id`, `agentMessageId`, `actorKind`, `actorId`, `agentId`, `selectedEndpointId`, `taskType`, `sensitivity`, `reason`, `candidateTrace`, `excludedTrace`, `policyRulesApplied`, `fallbackChain`, `suitabilityReceipt`);
- `RouteOutcome` (Prisma model: `id`, `requestId`, `providerId`, `modelId`, `taskType`, `agentId`, `latencyMs`, `inputTokens`, `outputTokens`, `costUsd`, `fallbackOccurred`);
- `AdapterRunTelemetry` (Prisma model: `id`, `threadId`, `agentMessageId`, `buildId`, `agentId`, `skillId`, `adapterKind`, `executionMode`, `status`, `inputTokens`, `outputTokens`, `estimatedCostUsd`);
- `TokenUsage`;
- `ProviderCapacityStatus`;
- provider suitability receipts/evidence;
- authorized rehydration result (`rehydrationHandle`).

The correlation envelope joins the existing ledgers through one request-scoped
OpenTelemetry-compatible trace identifier; it does not create a parallel trace
ledger:

```text
design revision + screen decision (traceId + screenId / decisionId)
  -> route decision (RouteDecisionLog indexed by traceId)
  -> route/fallback attempt(s) (RouteOutcome indexed by traceId)
  -> adapter outcome (AdapterRunTelemetry indexed by traceId)
  -> token/cost evidence (TokenUsage indexed by traceId)
  -> capacity evidence (ProviderCapacityStatus by provider and observation time)
  -> authorized rehydration outcome (rehydrationHandle)
```

`agentMessageId` and `gen_ai.conversation.id` remain conversation attribution, not
request correlation. `screenId` is derived from a payload hash and therefore can
repeat when the same safe input is screened more than once. `RouteOutcome.requestId`
is generated inside the outcome writer and is currently unrelated to the route
decision. Neither is a sound end-to-end execution key. The request-scoped `traceId`
is generated once for a live dispatch and copied to nullable, indexed fields on the
existing `RouteDecisionLog`, `AdapterRunTelemetry`, `RouteOutcome`, and `TokenUsage`
rows. Historic rows remain null and are reported as uncorrelated rather than
backfilled heuristically. No new telemetry table or trace model is approved.

The safe projection follows the OpenTelemetry GenAI vocabulary where it fits:
`gen_ai.provider.name`, `gen_ai.operation.name`, `gen_ai.request.model`,
`gen_ai.response.model`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, and `gen_ai.conversation.id`. Prompt, system
instruction, tool argument/result, and message-content attributes are deliberately
excluded because the semantic-convention registry warns that they can contain
sensitive information. References:
[OpenTelemetry GenAI attribute registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
and
[OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai).

Safe evidence may contain identifiers, hashes, versions, enumerated classes,
obligations, transformation type, explanation codes, provider/model identity,
timing, token/cost counts and outcome status.

Every Compare result must name the **design revision it compared against**—for
example the applicable EA snapshot/projection revision plus implementation source
revision hash (git commit SHA + EA snapshot ID). A current design silently overlaid on older traffic is not valid
conformance evidence. This revision should reuse existing snapshot/source identity
before any new persistence is considered.

Safe evidence must not contain raw messages, system prompts, tool arguments/results,
detected sensitive values, credentials, token maps, evidence documents, vendor
account identifiers, organization identifiers or free-text policy explanations that
could reproduce protected content.

## 10. Current evidence baseline

The 2026-07-26 live audit found:

- 21,979 route decisions;
- 35,860 route outcomes;
- 32,527 token-usage records;
- 20,740 route decisions with multi-step fallback chains;
- 1,054 route decisions with coworker attribution (about 4.8 percent);
- zero populated suitability receipts on route decisions;
- zero live `PolicyRule` rows;
- zero live `TaskRequirement` rows;
- six seeded cross-notation relationship types and zero instantiated
  cross-notation relationship edges;
- 18 SysML views and one BPMN view, all draft.

These numbers are an audit baseline, not a permanent contract. The product should
query and label the current time window, sample size, coverage and freshness.

## 11. Architecture feature gaps

### 11.1 Projection gaps

- The deterministic routing-process projection is implemented; live-install
  reconcile evidence remains part of the Phase 2 completion gate.
- The classifier and pure inference-policy evaluator from PR #3609 are represented
  as `partial` because they are implemented but not yet bound into dispatch.
  Transformation, fail-closed dispatch enforcement, and rehydration remain
  explicitly `proposed`.
- Nine BPMN/SysML/ArchiMate cross-notation relationships are defined by the routing
  projection and materialized through the shared applier; live graph counts must
  still be captured during governed nonprod verification.
- No design/runtime conformance projection exists for routing.

### 11.2 Evidence gaps

- Screen, decision, outcome and rehydration correlation is not yet one explicit
  envelope.
- Coworker attribution covers only a minority of historic route decisions.
- Suitability/sensitive-screen receipts are absent from the audited historic rows.
- Important design policy may live in code defaults while policy/task tables are
  empty.

### 11.3 Authoring/navigation gaps

- New View currently offers ArchiMate and BPMN, not SysML.
- The editor palette is scoped to one notation.
- No deterministic related-view drill-through convention exists.
- Full DMN decision modeling is absent.

### 11.4 Operations UX gaps

- The unified topology canvas is still a temporary preview.
- Legacy panels remain authoritative.
- The current surface does not align designed and observed routing.
- `BI-7E2A1DD0` reports that the deployed interactive diagram does not render.

## 12. Product and interaction design

### 12.1 Default owner experience

- Default to **Designed** on first visit, using plain language.
- Provide a visible time-window control when switching to Observed or Compare.
- Keep the same station positions across modes so the operator does not relearn the
  map.
- Show one short outcome, one reason, and one next action before technical detail.
- Use labels such as “May this data leave this computer/account boundary?” instead
  of PDP/PEP terminology.
- Explain unknown evidence honestly; never turn unknown into allowed.

### 12.2 Technical adjustment

Authorized technical users can:

- open provider/model configuration;
- inspect evidence freshness and account posture;
- inspect rule/policy source and version;
- see candidate exclusion traces;
- view capacity/cooldown and quota windows;
- navigate to linked EA viewpoints and implementation sources;
- simulate a route with payload-free contract inputs;
- propose a design or policy change through the owning governed workflow.

The map itself does not become an ungoverned policy editor.

### 12.3 Accessibility and responsive behavior

- Every station and edge is keyboard reachable (tabbable nodes, `Enter`/`Space` expands station details, `Escape` closes the technical inspector).
- Station node focus states use explicit high-contrast outlines compliant with WCAG 2.1 AA.
- Color is never the only status signal; icons, text labels, and patterns accompany all status indicators (`aria-label` / `aria-describedby` for visual status).
- A complete, screen-reader-accessible list/table representation (`<table summary="...">` or structured list with identical Designed/Observed/Compare data) provides full feature parity for non-visual operators.
- Dense technical labels collapse behind the inspector with progressive disclosure.
- Mobile view uses a vertical station sequence with identical stable node identities and responsive touch targets (minimum 44x44px touch boundary).
- Exported views include mode, time window, freshness, evidence coverage, and accessibility alt text metadata.

## 13. Documentation authority

The completed design BI must establish the following hierarchy:

1. This design, once approved, is the architecture authority for routing
   explainability and viewpoint ownership.
2. The implementation plan for `BI-3D210AF8` remains authoritative for
   pre-dispatch sensitive routing.
3. Provider-suitability design remains authoritative for provider trust/evidence
   compilation.
4. The current-state routing document must either be updated to the verified current
   pipeline or marked as a dated snapshot.
5. The control/data-plane design remains target-state while its implementation is
   deferred.
6. The user guide must describe verified current behavior and link to the
   owner-readable map.

The pinning contradiction was resolved from implementation and live configuration
evidence on 2026-07-26:

- `agentic-loop.ts` maps a persisted pin to the routed-inference preferred fields;
- `routed-inference.ts` can replace the V2 winner only with a candidate for which
  `excluded === false`;
- unavailable or excluded preference targets keep the V2 winner and add a warning;
- seed/bootstrap keep pins null and startup audits any non-null exception; and
- the live install contained 24 configurations, 0 provider pins, and 0 model pins.

Therefore documentation uses **exceptional eligible-candidate preference override**,
not “unused” and not an unconstrained “force.”

## 14. SysML architecture note

- **Scope:** AI inference and AI coworker routing from payload assembly through
  authorized response delivery.
- **Requirements/constraints:** sensitive data must be screened before external
  dispatch; provider suitability may narrow but not loosen data policy; fallback
  preserves the transformed payload and constraints; operational evidence excludes
  raw protected content; diagrams derive from canonical sources.
- **Interfaces/ports:** routed inference entry points, data PDP/PEP, RequestContract,
  route selector, fallback, adapters, route/outcome ledgers, Operations Map loader,
  EA projection reconciler.
- **Allocations:** data governance owns classification/purpose; provider suitability
  owns provider evidence compilation; routing owns eligible-set selection; adapters
  own transport; EA/Parity owns design projection; Operations Map owns presentation.
- **Verification cases:** sensitive blocked route, maskable route, exact-sensitive
  local/eligible route, governed fallback, unavailable-provider path, short/long
  limit path, authorized/unauthorized rehydration, missing-evidence conformance,
  unexpected observed path, accessibility and responsive parity.
- **Data authority:** canonical registries/code/policy remain authoritative;
  EA/BPMN/SysML and Operations Map are derived projections; telemetry ledgers remain
  operational authority.
- **EA/current-state catch-up:** add the AI routing process domain and materialize
  cross-notation relationships.
- **Parity impact:** add versioned extractors and conformance aggregation; do not
  hand-maintain current-state routing nodes.
- **Open risk:** current receipt, correlation and attribution coverage is
  insufficient for complete historic observed views.

## 15. Delivery boundaries

| BI | Independently shippable outcome |
| --- | --- |
| `BI-CC9BCFC8` | Canonical design artifact and documentation reconciliation |
| `BI-AA314BF4` | BPMN routing process and linked EA projection |
| `BI-758722A7` | Privacy-safe evidence correlation and conformance projection |
| `BI-52C015D8` | Cross-view drill-through and routing-decision inspector |
| `BI-7378E34C` | Designed/Observed/Compare Operations Map UX |
| `BI-C8BC9DD1` | Owner-actionable conformance findings — remediation contract + severity-faithful presentation |
| `BI-A4BC02BE` | Design conformance bounded to the instrumented era, not the fetch window |

Existing defect `BI-7E2A1DD0` is coordinated, not duplicated.

### 15.1 Conformance findings must carry remediation (BI-C8BC9DD1)

The conformance projection shipped with a finding shape of `message` + `count`
and nothing else. Two consequences were found in live use and are corrected by
`BI-C8BC9DD1`:

1. **No remediation exists to retrieve.** An owner asked the on-page coworker
   what to do about the findings; the coworker had no data to answer from,
   exhausted its iteration budget on tool calls, and returned a safety-limit
   message. The failure presented as a coworker defect but was an empty
   contract. Every finding now carries `ownerAction` and a plain-language
   `nextAction`, typed as `Record<RoutingConformanceIssueType, …>` so a new
   issue type cannot ship without its remediation.

2. **Severity was computed and then discarded.** The station badge rendered
   anything below `error` as a warning, so an `info` finding — including
   `ai-routing-design-unproven`, which counts traffic predating the evidence
   ledger — presented as an operational warning. Presentation is now faithful to
   the declared severity.

The `ownerAction` value `none-historical` is load-bearing: several findings
count traffic recorded before the evidence contract existed and can never reach
zero through any action. Presenting those as open work is false. Remediation
text is static per issue type and carries no request content, so the
privacy-safe projection boundary in §9 is unchanged.

### 15.2 Design conformance is bounded by the instrumented era (BI-A4BC02BE)

`unprovenDesignDecisions` was `totalDecisions − designBoundDecisions`, where
`totalDecisions` is however many rows the loader fetched (`WINDOWED_SOURCE_LIMIT`).
Because design-revision stamping began at a fixed point in the past, that
expression evaluated to `fetch_limit − total_stamped_rows_in_existence` — it
measured the page size, not conformance. Observed live as `400 − 229 = 171`,
presented to an owner as "171 issues".

Two properties made the figure unfalsifiable, and either alone is disqualifying
for an owner-facing number:

- it **decremented on every new inference**, because each one adds a stamped
  row, so it silently self-cleared with no remediation performed;
- it **scaled with the cap**, so raising the limit to 1000 would have reported
  771 on identical underlying data.

A decision recorded before stamping existed can never name a revision; those are
history, not failures. The projection now takes the earliest design-bound
decision in the window as the point the ledger begins, counts anything older as
`preInstrumentationDecisions`, and reserves `unprovenDesignDecisions` for
unstamped decisions at or after that boundary — which are genuine gaps, and are
classified `platform-defect` rather than `none-historical` accordingly.

When the window contains no stamped decision the boundary cannot be located, and
every unstamped row is treated as pre-instrumentation. That errs toward silence
rather than toward reporting a fault on an install that has simply not routed
since stamping shipped.

`coverage.instrumentedSince` is surfaced in the station inspector so an owner can
distinguish "we have no record of that period" from "the platform did something
wrong".

## 16. Refactoring budget

Reserve approximately 20 percent of implementation capacity:

| Refactor | Budget |
| --- | ---: |
| Extract shared routing-stage and stable-identity projection builders | 5% |
| Standardize safe correlation/receipt projection across existing ledgers | 5% |
| Centralize designed/observed/compare view-model construction | 4% |
| Consolidate architecture drill-through and inspector primitives | 2% |
| Delete retired Operations Map panels/toggles after parity | 4% |

## 17. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Diagram becomes another source of truth | Extract current-state facts; keep architect judgment explicit |
| Sensitive content leaks through observability | Safe-field allowlist, canary fixtures and no raw-payload persistence tests |
| Target design is mistaken for current behavior | Required Current/Proposed/Historical badges |
| Historic evidence cannot be correlated | Surface coverage honestly; do not fabricate joins |
| One enormous canvas recreates overload | Stable owner map plus progressive disclosure and alternate list view |
| Full DMN adoption adds premature substrate | Start with governed decision inspector; evaluate DMN after evidence |
| Cross-notation links remain theoretical | Live acceptance requires instantiated, navigable edges |
| Operations Map cutover regresses working behavior | Additive parity stages; delete legacy only after proof |

## 18. Architecture review

- **Decision:** aligned with important guardrails.
- **Single source of truth:** the design reuses routing/governance registries, the EA
  graph, telemetry ledgers and Operations Map; it does not create a diagram or
  evidence authority.
- **Data model:** no new Prisma model is approved. Each implementing BI must prove
  existing snapshot, evidence and relationship substrate insufficient before a
  schema proposal.
- **Parallel-work boundary:** PR #3609 landed the classifier and pure inference-policy
  evaluator. The remaining data-governance BIs own dispatch enforcement, masking,
  and rehydration; this epic consumes those contracts without duplicating them.
- **Current/target separation:** RIB/FIB and other target-state concepts require a
  Proposed badge until implementation evidence exists.
- **Evidence integrity:** Compare must bind observed traffic to the applicable design
  revision; comparing historical evidence only to today's design would create false
  drift.
- **Operational safety:** receipts and observability are safe-field projections, not
  prompt archives.
- **Recommended next step:** land the canonical design/document-authority BI first,
  then allow the projection, evidence and drill-through BIs to proceed independently.

### Phase 2 implementation advisory

- **Decision:** aligned with the existing EA and Parity Engine substrate.
- **Schema/data authority:** no schema or diagram store was added. The implementation
  reuses `EaElement`, `EaRelationship`, `EaView`, `EaConformanceIssue`, notation
  seeds, and the shared projection orchestrator.
- **Single source of truth:** one versioned routing-stage registry projects BPMN,
  SysML, and ArchiMate. The superseded seed-time AI-cockpit writer was removed while
  preserving its `sysml:aic:` stable identities for in-place reconciliation.
- **Cross-notation integrity:** the shared applier now resolves explicitly named
  relationship notations, preserves bounded explanation metadata, and validates
  explicit cross-notation edges against seeded `EaRelationshipRule` rows.
- **Current/target honesty:** the sensitive screen and policy gateway are `partial`
  with direct PR #3609 source anchors because their pure logic exists but dispatch
  binding does not. Transformation and rehydration remain `proposed`; implemented
  routing stages retain direct source anchors.
- **Standards:** the implementation remains within the ISO/IEC/IEEE 42010 viewpoint
  separation and existing OMG BPMN 2.0.2, SysML 2.0, and ArchiMate model-kind
  decisions in this design; no new external standard or tool was introduced.

### Phase 4 implementation advisory

- **Decision:** aligned with the existing EA substrate and the approved progressive
  disclosure model.
- **Data model:** no schema change or canonical view-link table was added. Related
  navigation is derived from current `EaElement` membership and the existing
  relationship graph for the applicable architecture revision.
- **Source of truth:** BPMN, SysML, ArchiMate, implementation source, and Operations
  Map links all originate from the deterministic projection metadata; the inspector
  owns no independent route rules.
- **Security:** the decision inspector serializes an explicit allowlist of
  architecture-safe input classes and bounded outcome labels. It does not load raw
  prompt, tool, detected-value, token-map, account, or policy payload content.
- **Authorization:** viewing technical detail requires `view_ea_modeler`; creating
  SysML views and refreshing deterministic projections requires `manage_ea_model`.
- **DMN decision:** a governed inspector is sufficient for the current read-only
  explainability need. DMN is deferred until an authorable decision-table need is
  demonstrated; adding notation now would duplicate rule authority.
- **Performance:** routing drill-through loads the bounded named design revision and
  derives shortest paths in memory, avoiding repeated depth-by-depth database
  traversal while preserving deterministic exact-element links.

## 19. Standards

- ISO/IEC/IEEE 42010:2022 — stakeholder concerns, viewpoints and model kinds.
- OMG BPMN 2.0.2 — process behavior and gateways.
- OMG DMN 1.5 — benchmark for decision requirements and tables; adoption deferred
  pending fit proof.
- OMG SysML 2.0 — requirements, constraints, allocations and verification.
- C4 dynamic diagrams — supporting technical interaction stories, used sparingly.
- OpenTelemetry semantic conventions for GenAI — common safe attribute vocabulary
  where compatible with DPF privacy constraints.

## 20. UX fit review

- **Decision:** fits-with-guardrails.
- **Owning area:** Platform.
- **Route family:** `/platform/ai/operations-map` is canonical; `/ea` is the
  authorized architecture drill-through.
- **Primary persona:** founder/operator asking how AI work is routed and whether it
  is safe and healthy. The contributor/platform operator is the secondary
  progressive-disclosure persona.
- **Navigation layer:** local page mode/filter controls only. No new global or
  section navigation.
- **Reuse/convergence:** reuse the existing Operations Map canvas/projections,
  report-kit status/table/filter primitives, `statusColors`, `LocalTime`, EA canvas
  and existing saved-view/replay behavior.
- **Source truth:** the design and operational authorities are named in §9; the UI
  may not invent a second status or metric calculation.
- **Empty/failure behavior:** no recent traffic still renders Designed with “No
  observed routes in this window”; unavailable telemetry preserves the last known
  design and shows evidence freshness/recovery; missing permission offers no raw
  technical detail.
- **AI boundary:** viewing, filtering and inspecting never sends a prompt. A future
  simulation or coworker action requires a context preview, expected next step and
  explicit confirmation.
- **First viewport guardrail:** answer three questions before any dense diagnostics:
  “How should work route?”, “Is anything unsafe or blocked?”, and “Is observed
  behavior different?” Avoid a generic KPI-card wall.
- **Disclosure guardrail:** mode and time-window controls remain reachable; only
  professional detail collapses. Do not hide the primary comparison control inside
  Advanced.
- **Evidence before merge:** route/source tests, served-DOM UX budget sweep, theme
  and style-drift checks, desktop/mobile browser exercise, keyboard/list
  equivalence, failure/permission fixtures and privacy canaries.
- **Captured in:** this section plus implementation plan Phases 4–5.

## 21. Open implementation decisions

1. **Corrected 2026-07-27 from implementation evidence:** one request-scoped
   `traceId` links `InferenceDataScreenResult` receipt -> `RouteDecisionLog` ->
   `AdapterRunTelemetry` -> `RouteOutcome` -> `TokenUsage`. `agentMessageId`
   remains conversation attribution; deterministic `screenId` and independently
   generated `RouteOutcome.requestId` are not execution correlation keys. Existing
   ledgers gain nullable indexed fields; no parallel trace ledger is required.
2. Can the current EA relationship/viewpoint validators render mixed-notation
   related-view navigation entirely through shared element identity, or is a narrow
   renderer change required?
3. **Resolved 2026-07-26:** provider/model pins are exceptional overrides among
   candidates that have already survived hard exclusions; unavailable or excluded
   targets fall back to the V2 winner, and the current install has no persisted
   pins.
4. Which existing encrypted runtime artifact can hold short-lived token maps?
5. **Resolved 2026-07-26:** The first Compare conformance projector uses request-time pure aggregation over time-window indexed queries (`RouteDecisionLog.createdAt`, `AdapterRunTelemetry.startedAt`), with in-memory caching for wider windows (30d/90d). No background cron job or new persistence table is required for initial rollout.

These decisions must be resolved against implementation and live evidence during
their owning BI. They do not justify parallel substrate in advance.
