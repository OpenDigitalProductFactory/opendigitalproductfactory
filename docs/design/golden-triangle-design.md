# Golden Triangle Decision Primitive

**Cost | Quality | Time as a governed preference-to-policy compiler for trusted AI agents**

*Chief architect review draft v0.2 - 2026-06-20*

---

## 0. Architect Verdict

The core idea is right and worth protecting: a non-technical operator should express intent in human terms, while DPF translates that intent into model routing, review depth, verification, retry posture, and budget controls.

The current draft, however, is too greenfield for the DPF substrate that already exists. The triangle must not become a second model registry, a second routing layer, or a pretty control that makes users feel in control while hidden policy does something else. Treat it as a governed **preference-to-policy compiler**:

1. A user chooses a posture: faster, cheaper, or more assured.
2. The compiler produces explicit policy deltas against existing routing and decision contracts.
3. Runtime receipts prove what actually happened.
4. Feedback and telemetry calibrate future defaults.

Architectural corrections required before implementation:

- Reuse `ModelProfile` as the canonical per-model capability source. Do not introduce a parallel `ModelRegistryEntry` in v1.
- Reuse `RequestContract`, `TaskRequirement`, `AgentModelConfig`, `RouteDecisionLog`, `RouteOutcome`, `AdapterRunTelemetry`, `TokenUsage`, and `DecisionInteraction` before adding schema.
- Split "quality" into **intended assurance posture** and **realized outcome quality**. The triangle sets the first; human and verification feedback measure the second.
- Treat "Mark / we / I" as authority scopes, not casual labels. They map to WWMD, WWWD/org, and per-decision user override. Customer decisions must not inherit platform-specific founder judgment as authority.
- Make privacy, provenance, and receipt visibility first-class. A trusted agent control must be auditable and reversible.
- Build the UI as an accessible control with a textual/numeric equivalent. A draggable triangle alone is not sufficient.

Status: approved product direction; implementation blocked until the substrate audit and policy compiler slice are complete.

---

## 1. Research and Benchmarking

### External Precedent

The Golden Triangle borrows the executive clarity of the classic project-management triangle: time, cost, and quality/scope interact, and pressure on one dimension affects the others. PMI's own discussion of the triple constraint is useful precisely because it warns against treating the model as a deterministic formula. That supports DPF's design choice: use the triangle as an intent surface, not as literal optimization math.

Trusted AI precedent points in the same direction. NIST AI RMF frames trustworthy AI as governed, measured, and managed over time. For DPF, that means every triangle-driven action needs a policy record, telemetry, and a feedback path; a visual knob is not trust by itself.

Observability precedent also matters. OpenTelemetry's trace/metric/log model emphasizes correlated context across telemetry signals. DPF should follow that pattern: the preference snapshot, route decision, model attempt, token cost, feedback verdict, and benchmark record need shared correlation identifiers.

Accessibility precedent is non-negotiable. WAI-ARIA slider guidance requires keyboard support and semantic state for custom controls. A triangular drag control is custom enough that it must provide an equivalent keyboard/numeric control and cannot rely on color or pointer movement alone.

External references:

- PMI, [The Triple Constraint](https://www.pmi.org/learning/library/triple-constraint-erroneous-useless-value-8024)
- NIST, [AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- OpenTelemetry, [Overview](https://opentelemetry.io/docs/specs/otel/overview/)
- W3C WAI-ARIA APG, [Slider Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/)

### DPF Substrate Precedent

DPF already has most of the hard plumbing this design needs:

- Model lifecycle and routing: [`docs/user-guide/ai-workforce/model-routing-lifecycle.md`](../user-guide/ai-workforce/model-routing-lifecycle.md)
- Request contracts and budget classes: [`apps/web/lib/routing/request-contract.ts`](../../apps/web/lib/routing/request-contract.ts)
- Cost-per-success ranking: [`apps/web/lib/routing/cost-ranking.ts`](../../apps/web/lib/routing/cost-ranking.ts)
- Decision scopes and audit ledger: [`docs/user-guide/ai-workforce/decision-perspective.md`](../user-guide/ai-workforce/decision-perspective.md)
- Cost governance and token telemetry: [`docs/superpowers/specs/2026-05-19-ai-cost-governance.md`](../superpowers/specs/2026-05-19-ai-cost-governance.md)
- Provider/model scoring convergence: [`docs/superpowers/specs/2026-06-19-provider-model-scoring-convergence-design.md`](../superpowers/specs/2026-06-19-provider-model-scoring-convergence-design.md)
- Situational decision weighting: [`docs/superpowers/specs/2026-06-05-situational-aware-decision-weighting-design.md`](../superpowers/specs/2026-06-05-situational-aware-decision-weighting-design.md)
- Routing/receipt substrate review: [`docs/architecture/2026-06-14-odysseus-review-depth-pass.md`](../architecture/2026-06-14-odysseus-review-depth-pass.md)
- Agentic loop execution and iteration ceiling: [`apps/web/lib/tak/agentic-loop.ts`](../../apps/web/lib/tak/agentic-loop.ts)

The design should therefore be written as **consolidate, compile, and surface**, not "create a new AI model-control system."

---

## 2. Purpose

The Golden Triangle is the product-level abstraction that lets a person say:

- "Get this right."
- "I need this now."
- "Keep this cheap."
- "Use the sensible default."

The platform converts that posture into expert settings:

- model quality floor
- `budgetClass`
- `reasoningDepth`
- residency and sensitivity constraints
- review/perspective count
- verification depth
- retry and fallback posture
- token/context budget
- approval/escalation behavior

The value is not the triangle graphic. The value is the translation layer and the audit loop behind it. A user should not have to know which model tier, review topology, or routing budget class is appropriate. DPF should know, show what it decided, and learn from the outcome.

---

## 3. Terms

| Term | Meaning |
| --- | --- |
| Preference vector | The user's saved or per-decision posture across cost, quality, and time. Stored as weights plus preset/source metadata. |
| Decoded policy | The concrete route, review, verification, and budget settings compiled from the preference vector. |
| Assurance posture | What the system intends to do to improve correctness: stronger model, deeper reasoning, more review, more verification. |
| Realized quality | What actually happened, measured through human verdicts, verification results, acceptance, retries, and downstream outcomes. |
| Route receipt | Evidence of the actual model/provider/fallback/token path taken for a run. |
| Benchmark record | A joined learning artifact: intended posture, decoded policy, predicted cost, actual cost/latency, model receipt, task class, and realized outcome. |

---

## 4. Updated Locked Decisions

| # | Decision | Resolution |
| --- | --- | --- |
| 1 | Visual primitive | One draggable point in a triangle remains the primary metaphor, backed by keyboard/numeric controls. |
| 2 | Weighting model | Soft preference weighting. Do not claim literal zero-sum optimization. The compiler owns real-world couplings. |
| 3 | Quality | Split into intended assurance posture and realized quality. The triangle only sets intended assurance. |
| 4 | Routing substrate | Compile to existing routing concepts first: `RequestContract`, `TaskRequirement`, `AgentModelConfig`, `ModelProfile`, and route telemetry. |
| 5 | Model registry | No new `ModelRegistryEntry` in v1. `ModelProfile` is canonical; provider-level scores are derived rollups. |
| 6 | Cost | Use real telemetry: `TokenUsage`, `AdapterRunTelemetry`, `RouteOutcome.costUsd`, predicted vs actual drift, and eventually capacity/rate-limit pools. |
| 7 | Feedback | Human feedback is a lightweight 3-state verdict, but it is only one signal. Also capture acceptance, verification, retry, and latency outcomes. |
| 8 | Authority scopes | WWMD/platform, WWWD/org, WSID/profession, and per-decision user override must be explicit and auditable. |
| 9 | Federated learning | Local-first. Hive contribution is opt-in, metadata-only, thresholded, revocable, and reputation-weighted. |
| 10 | Implementation order | Substrate audit and compiler first; UI second; learning/hive last. |

---

## 5. Authority Scopes

The v0.1 "Mark / we / I" framing is directionally right but needs governance language.

| Scope | User-facing idea | Governing source | Default role |
| --- | --- | --- | --- |
| WWMD / platform | "What would Mark do?" | Founder/platform kernel and approved DPF decisions | Platform-development default and first implementation slice |
| WWWD / organization | "What would we do?" | Organization profile, policies, and prior decisions | Customer/org default |
| WSID / profession | "What should a competent professional do?" | Role/profession corpus | Craft floor for specialist coworkers |
| Per-decision override | "What do I need here?" | User choice for this decision | Local override within policy limits |

Precedence:

1. Hard safety, residency, tool-grant, and compliance constraints always win.
2. Task requirements set the minimum floor.
3. Scope defaults apply next: platform, org, profession, or role.
4. The triangle can raise assurance, lower cost, or lower latency only within those bounds.
5. Per-decision override can supersede a default, but it cannot bypass a hard policy.

Critical boundary: customer business decisions must not inherit WWMD as authority by default. DPF product doctrine can be advisory; the customer's WWWD profile governs the customer's business context.

---

## 6. Interaction Model and UI Contract

### Primary Control

The canonical control is a triangular priority surface with vertices:

- Cost
- Quality
- Time

The user moves one point. The UI shows:

- active preset name
- numeric weights
- decoded policy summary
- projected token/cost/latency envelope when available
- whether hard policy limits changed the requested posture

Recommended preset names:

| Preset | Meaning | Reason |
| --- | --- | --- |
| Fast | Minimize elapsed time | Clear and non-technical |
| Frugal | Minimize spend | Better than "cheap" for a trusted product |
| Assured | Maximize confidence | Better than "gold-plate"; emphasizes trust, not indulgence |
| Balanced | Sensible default | Neutral center |

### Accessibility and Responsiveness

The triangle may be implemented as SVG/canvas or a positioned HTML control, but the data model must be ordinary state:

```ts
type GoldenTrianglePreference = {
  costWeight: number;
  qualityWeight: number;
  timeWeight: number;
  preset: "fast" | "frugal" | "assured" | "balanced" | "custom";
};
```

The component must provide:

- keyboard controls for each axis or preset
- numeric inputs/steppers that can fully reproduce any triangle state
- visible focus states
- screen-reader labels for current weights and decoded policy
- touch target sizes suitable for mobile
- no color-only encoding
- reduced-motion behavior
- stable dimensions so dragging, labels, and dynamic text do not resize the layout

Design system constraints:

- Use DPF theme tokens and report-kit primitives where applicable.
- Keep the surface quiet and operational, not a marketing hero.
- Do not place cards inside cards.
- Avoid decorative gradients/orbs and one-hue palettes.
- The first implementation should be usable on the first screen, not hidden behind explanatory copy.

---

## 7. Translation Compiler

The compiler is the heart of the feature.

```text
preference vector
  + authority scope
  + task class
  + sensitivity/residency/tool constraints
  + available model health/cost/capability
  + budget and latency envelope
  -> decoded policy
  -> route/review/verification execution
  -> receipt + telemetry + benchmark
```

### Control Layers

The compiler spans three layers, and `ModelProfile` is only the first. Most of the triangle's leverage — and almost all of its cost — lives in the layers below the model.

| Layer | Question it answers | Where it lives today | What the triangle compiles into it |
| --- | --- | --- | --- |
| Model | "Which engine, at what unit price?" | `ModelProfile` capability scores plus `inputPricePerMToken` / `outputPricePerMToken` | tier floor, candidate set |
| Per-call posture | "How hard to try on this one call?" | `RequestContract.reasoningDepth`, `RequestContract.budgetClass`, token estimates, tier-floor `minimumDimensions` | effort mode, cost/quality bias |
| Orchestration / loop | "How many calls, perspectives, retries, verifications?" | No posture-driven home; `agentic-loop.ts` bounds iterations with a hardcoded `MAX_ITERATIONS = 200` safety constant | iteration budget, perspective/review count, retry ceiling, verification depth |

Cost is an execution outcome, not a model attribute:

`cost ≈ unit_price × tokens_per_call × calls × iterations × retries`

`ModelProfile` supplies only the first term. The multipliers live in the orchestration layer (today a constant) and in the realized ledger (`RouteOutcome`, `TokenUsage`, `AdapterRunTelemetry`). A small model in a deep, multi-perspective, verify-and-retry loop can cost more than a single frontier call, so "pull toward Frugal" cannot be read off `costTier`: it must compile into a loop budget and be reconciled against measured spend (the predicted-vs-actual drift of Locked Decision 6).

### Inputs

- preference vector and preset
- active authority scope and profile version
- task type / task class
- route context: sensitivity, residency, interaction mode, tool needs
- available model profiles, provider health, pricing, and capability probes
- current budget/capacity state
- user and organization policy limits

### Outputs

| Output | Existing destination or likely home |
| --- | --- |
| `budgetClass` | `RequestContract.budgetClass` |
| `reasoningDepth` | `RequestContract.reasoningDepth` |
| minimum quality tier / dimensions | `TaskRequirement`, `AgentModelConfig`, `minimumDimensions` |
| residency and sensitivity | `RequestContract` route context |
| max latency | `RequestContract.maxLatencyMs` |
| review/perspective count | Build Studio / decision workflow policy, not raw routing |
| verification depth | Workflow policy / gate configuration |
| retry/fallback budget | Routing policy and fallback chain |
| token/context budget | Cost governance and request contract estimates |
| escalation/approval policy | Decision Perspective / HITL policy |

The model and per-call-posture rows compile into fields that already exist. The orchestration-layer rows — review/perspective count, verification depth, retry/fallback budget, and especially the iteration budget — have no single configurable home today; they are scattered across workflow policy, fallback config, and a hardcoded loop ceiling. A per-decision **orchestration budget** that bounds the agentic loop and is recorded on the receipt — not a new model registry — is the one new surface the triangle plausibly justifies. The audit confirms or refutes this in Slice 0.

### Representative Compile Table

| User posture | Decoded intent | Compiler behavior |
| --- | --- | --- |
| Assured | "Get this right." | `quality_first`, high reasoning, stronger tier floor, more context, multi-perspective review, deeper verification, generous retry, explicit receipt. Cost and time may rise. |
| Fast | "I need this now." | Lower latency target, minimal/low reasoning when safe, single pass, shallow verification, tight retries, fastest eligible endpoint. May reduce assurance. |
| Frugal | "Spend carefully." | `minimize_cost`, smallest capable model, tighter token/context budget, avoid frontier unless policy requires it, prefer cached/local paths when allowed. May increase time if local/cheap routes are slower. |
| Balanced | "Use the sensible default." | Existing task requirement and agent defaults, with modest review/verification. |

### Coupling Rules

The triangle is not literal zero-sum math:

- Higher quality often increases cost and time together.
- Lower cost may increase time if the cheapest eligible endpoint is slower.
- Lower time may lower cost by shortening work, but may increase downstream risk.
- Hard policy can override all three axes.

The UI must say when policy changed the requested posture. Example: "Frugal requested; restricted data requires local-only routing, so the compiler selected the best local eligible model and raised latency estimate."

### Fail-Closed Behavior

If no route satisfies the decoded policy and hard constraints, the system must not silently choose a weaker unsafe route. It should:

1. explain the conflict in operator-readable language
2. present the nearest valid alternatives
3. request approval if an escalation path exists
4. defer when no governed path exists

---

## 8. Data Model and Single Source of Truth

The v0.1 entity list is directionally useful but over-additive. v1 should add as little schema as possible.

| Concept | Recommendation |
| --- | --- |
| Saved triangle defaults | Add or extend a small preference profile table only after auditing existing profile/settings tables. Provisional name: `DecisionPreferenceProfile`. |
| Per-run triangle position | Store an immutable preference snapshot on the decision/run receipt path. Prefer linking to `DecisionInteraction` or route receipt over a detached `TrianglePosition` table. |
| Model profiles | Reuse `ModelProfile`. It is the canonical per-model scoring source. Provider scores are derived. |
| Provider metadata | Reuse `ModelProvider`, discovered models, capability profiles, and provider health. |
| Task taxonomy | Start with existing `taskType` / `TaskRequirement`. Introduce a new `TaskClass` only if the existing taxonomy cannot support benchmark aggregation. |
| Cost ledger | Reuse `TokenUsage`, `RouteOutcome`, `AdapterRunTelemetry`, and Build Studio cost rollups. Add fields only where the cost-governance spec already identifies a gap. |
| Feedback | Reuse `AdapterRunTelemetry.userAccepted` for per-turn acceptance where suitable; add decision-level verdict only where existing feedback cannot represent it. |
| Benchmark record | First implement as a read model/view joining existing decision, route, telemetry, and feedback rows. Materialize only when query cost or hive contribution requires it. |

Minimum benchmark fields:

- preference snapshot
- decoded policy snapshot
- active authority scope and profile version
- task type/class
- selected provider/model and fallback chain
- predicted input/output tokens and cost
- actual input/output/cache tokens, cost, and latency
- verification result
- human verdict
- accepted/rejected state
- retry/fallback count
- timestamp and coarse environment metadata

Do not store prompts, outputs, file contents, customer identifiers, or free text in benchmark rows intended for hive contribution.

---

## 9. Benchmarking and Learning Loops

The benchmark record powers three loops:

| Loop | Compares | Improves |
| --- | --- | --- |
| Quality calibration | Intended assurance vs realized quality | Preset defaults, review depth, verification policy |
| Cost calibration | Predicted cost vs actual cost | Token estimates, context budgets, cost projections |
| Latency calibration | Requested time posture vs actual elapsed time | Fast/frugal route choices and fallback ordering |

The model-scoring convergence rule is binding: model capability calibration writes to `ModelProfile`, not provider-level score columns. The provider grid may show rollups, but the learning loop must update the model rows the router actually reads.

Human verdicts should remain lightweight:

- positive
- mixed
- negative

But the platform should not overfit to satisfaction alone. "The answer sounded good" is not the same as "the answer was correct." Weight realized quality with:

- human verdict
- task completion / acceptance
- verification result
- retry success
- post-hoc correction or rework
- downstream incident/defect linkage where available

No LLM-as-judge should be a v1 truth source. It may be added later as an assistive signal, always subordinate to human and deterministic evidence.

---

## 10. Federated Hive Architecture

The hive is strategically valuable, but it is also the highest-risk part of the design. It should ship last.

### Local First

Every install stores its own benchmark history and can learn local defaults without cloud contribution. Local records are the source of truth.

### Project Rollup

Project-level aggregation answers: "For this product and team, what posture works best for this class of work?"

### Cloud Hive

Cloud aggregation answers: "Across opt-in installs, for this task class and sensitivity bucket, which route gives the best outcome for a comparable cost/time posture?"

Contribution contract:

| Included | Excluded |
| --- | --- |
| preference weights, decoded policy, task class, model tier/id, provider class, token counts, cost, latency, retry count, coarse verdict, coarse timestamp | prompts, outputs, file contents, customer/project names, user names, free text, attachments, exact timestamps, business identifiers |

Trust controls:

- opt-in by organization and scope
- local preview before contribution
- revocation for future contribution
- cohort thresholds before aggregate defaults are shown
- outlier suppression
- reputation weighting over time
- signed schema version so old payloads do not corrupt current learning

Anti-pattern rejected: uploading raw traces and trying to anonymize them later.

---

## 11. UI Surfaces

Recommended first surfaces:

1. **Decision Perspective / WWMD default editor**: the first saved Golden Triangle profile, scoped to platform decisions.
2. **Build Studio decision review panel**: show the active preference, decoded policy, and receipt for an actual decision.
3. **Platform > AI evidence view**: aggregate benchmark records, cost drift, and outcome comparisons.

Do not start with a global model-picker UI. The user should set intent and see receipts. Admins can still manage model/provider substrate in the existing Platform > AI provider and routing surfaces.

The decode panel should have two layers:

- Plain user view: "Assured mode: stronger model, deeper review, higher projected cost."
- Operator detail: exact `budgetClass`, `reasoningDepth`, tier floor, review count, verification depth, retry budget, model candidates, and policy overrides.

This preserves trust without making every user read infrastructure.

---

## 12. Risks and Issues

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Illusion of control | A nice triangle can hide opaque routing choices. | Always show decoded policy and actual receipt. |
| Duplicate substrate | A new model registry or ledger would fork routing truth. | Reuse `ModelProfile`, route telemetry, and token ledgers first. |
| Quality theater | Users may equate "more expensive" with "correct." | Separate intended assurance from realized quality and verification. |
| Authority confusion | Mark/we/I can blur platform, customer, and user decision scopes. | Use WWMD/WWWD/WSID/per-decision scope records and profile versions. |
| Feedback sparsity | Few verdicts can miscalibrate defaults. | Blend verdicts with verification, acceptance, retry, and rework signals. |
| Hive privacy leakage | Rare task/model/time combinations can identify work even without text. | Metadata minimization, coarse buckets, thresholds, and opt-in preview. |
| Hive poisoning | Bad or adversarial installs can skew defaults. | Reputation weighting, outlier suppression, and delayed trust. |
| Cost incompleteness | Token cost is not the whole cost: reviewer labor, latency, subscriptions, and rate limits matter. | Start with tokens, then add capacity/rate-limit and review-cost accounting. |
| Accessibility gap | Drag-only triangle excludes keyboard/screen-reader users. | Numeric/preset equivalent is required, not optional. |
| Silent policy override | Hard constraints may change the user's requested posture invisibly. | Explain policy adjustments inline and in receipts. |

---

## 13. Build Order

### Slice 0: Substrate Audit and Refactor Budget

Use the requested 20 percent refactor budget here.

- Verify exact existing fields and gaps across `ModelProfile`, `AgentModelConfig`, `RequestContract`, `TaskRequirement`, route receipts, telemetry, and decision records.
- Confirm whether saved defaults need a new table or can extend an existing profile/settings model.
- Confirm whether benchmark records should be materialized or initially projected as a read model.
- Remove or avoid any new entity that duplicates existing routing/cost truth.
- Confirm there is no per-decision agentic-loop budget today: `apps/web/lib/tak/agentic-loop.ts` bounds iterations with a hardcoded `MAX_ITERATIONS = 200` safety constant, not a posture-driven budget. Decide whether a per-decision **orchestration budget** (iteration ceiling, perspective/review count, retry budget, verification depth) is the one justified new surface, and where it attaches to the route/decision receipt.
- Define stable TypeScript types for preference input and decoded policy output.

Exit criterion: a one-page substrate delta naming every schema addition and every reused table.

### Slice 1: Pure Policy Compiler

Build `compileGoldenTrianglePolicy()` as a pure, tested function:

- input: preference vector, task class, authority scope, policy constraints, model availability summary
- output: decoded policy, policy adjustments, explanation, and blocked/defer state

No UI and no database writes until the compiler is deterministic and covered by unit tests.

### Slice 2: Accessible Canonical Component

Build the reusable component with:

- triangle pointer
- preset control
- numeric equivalent
- decode panel
- mobile layout
- keyboard and screen-reader support

### Slice 3: Receipt and Telemetry Join

Wire a real run:

preference snapshot -> decoded policy -> route decision -> model attempt -> token/cost/latency telemetry -> feedback.

### Slice 4: WWMD Default Editor

Ship the first saved profile under WWMD/platform scope. Keep it admin/operator-facing.

### Slice 5: Project and Org Defaults

Add WWWD/org and per-product defaults once the WWMD path proves stable.

### Slice 6: Learning Defaults

Start recommending default adjustments from local benchmark history, with human approval.

### Slice 7: Hive Contribution

Only after local/project learning is useful and the privacy contract is implemented.

---

## 14. Acceptance Criteria

The design is ready for implementation when:

- The spec no longer proposes a v1 `ModelRegistryEntry`.
- Every decoded policy field maps to an existing field or a named new field.
- The compiler has deterministic examples for Fast, Frugal, Assured, Balanced, and at least three custom positions.
- Hard policies can override the triangle and produce an explanation.
- A keyboard-only user can operate the control.
- The UI shows both requested posture and actual receipt.
- A benchmark row/view can join intended posture to actual model/cost/outcome.
- Hive contribution has an explicit payload schema and exclusion list.
- Tests cover policy compile behavior, not only component rendering.

---

## 15. Open Decisions

1. Should the saved default table be new (`DecisionPreferenceProfile`) or an extension of an existing profile/settings model?
2. Is the existing `taskType` / `TaskRequirement` taxonomy sufficient for benchmarking, or do we need a separate task-class taxonomy?
3. Should "cost" v1 mean token/provider cost only, or include review labor and rate-limit capacity from day one?
4. Which policy fields belong inside `RequestContract` and which belong in workflow/assurance policy outside routing?
5. Should per-decision overrides be available to all users, or only roles with specific tool/authority grants?
6. How should the TAK draft standard name and validate the preference snapshot, decoded policy, receipt, and feedback objects?
7. What is the minimum cohort size before hive-derived defaults can influence a local install?
8. Should the orchestration/loop budget (iteration ceiling, perspective count, retry/verification depth) be a new per-decision surface, or can it be expressed by extending `AgentModelConfig` or workflow policy? Today the loop ceiling is a hardcoded constant, so the triangle cannot move its largest cost/quality lever without resolving this.

---

## 16. Prototype Guidance

Build a prototype only after Slice 0 and Slice 1. The prototype should demonstrate:

- the canonical triangle component
- preset snapping and custom drag
- numeric/keyboard equivalent
- live decoded policy
- policy override explanations
- projected vs actual cost/latency placeholders
- 3-state feedback capture
- receipt display for the selected route

The prototype should not directly influence production routing until receipt and telemetry joins are wired.

---

## 17. Final Design Principle

The Golden Triangle earns trust only when the user can answer four questions:

1. What did I ask the agent system to optimize for?
2. What did the platform actually configure because of that?
3. What did it actually run and cost?
4. Did the result work?

If any one of those is missing, the feature is decoration. If all four are present, it becomes a real trusted-agent control.
