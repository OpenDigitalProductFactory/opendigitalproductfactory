# Golden Triangle Decision Primitive

**Cost | Quality | Time as a governed preference-to-policy compiler for trusted AI agents**

*Design review draft v0.3.5 - 2026-06-23*

> **v0.3 changelog.** Integrates a multi-thread review (UX/accessibility, ethos/culture fit, strategy/completeness) plus a competitive-benchmarking pass. Headline changes: **presets are the primary control** (the triangle becomes a fine-tune visualization); a corrected **2-degrees-of-freedom accessibility contract** (a 2D control is not the WAI-ARIA *slider* pattern); the triangle is framed as **cognitive-load migration** and connected to the **kernel principle system**; and three factual corrections to the v0.2 control-layers analysis — the `effort` lever already exists end-to-end, perspective/review count's home is the **deliberation engine**, and `MAX_ITERATIONS` is a *safety ceiling*, not the dominant cost lever. Adds cold-start defaults, the composition point with `inferContract()`, and success metrics.
>
> **v0.3.1 architect/usability pass.** Tightens the enterprise architecture decision, adds a one-screen executive capsule, strengthens the UX navigation and component contract, makes the standards basis explicit (WCAG 2.2 + APG radio/spinbutton patterns), and replaces success-metric placeholders with initial launch guardrails to validate in Slice 0.
>
> **v0.3.2 Slice 0 close-out.** Folds the Slice 0 substrate-audit findings (companion doc [`golden-triangle-slice0-substrate-audit.md`](golden-triangle-slice0-substrate-audit.md)): the saved-defaults home already exists (`DecisionInteraction.profileId` → `DecisionPerspectiveProfile`, **extend it** — resolves Open Decision 1); the orchestration budget is **GO** as JSON on the receipt path (not `AgentModelConfig`, not a new table — resolves Open Decision 7); plus two corrections — `TaskRequirement.minimumTier` is code-side (`BUILT_IN_TASK_REQUIREMENTS`), not a DB column, and `verificationDepth` is inert until a verify step is wired.
>
> **v0.3.3 implementation underway.** Shipped: Slice 1 (pure compiler), Slice 3a (posture → `inferContract()` composition + additive caller overrides), and Slice 2 (the elegant posture control + `/platform/ai/priority` page). UX refinements: the control is surfaced in the **AI coworker dialog** as a compact, balance-coloured chip (`CoworkerPriorityControl`), and the triangle is **colour-coded by balance** — green when centred, yellow→red as one or two axes get starved, with the starved axis's vertex reddened. Remaining: receipts / outcome-diff (Slice 3b) and per-scope persistence (Slice 4) — both can be **migration-free** in v1 via the existing `DecisionInteraction.outcomePayload` and `DecisionPerspectiveProfile.autonomyPolicy` JSON fields (no schema change), which also sidesteps the no-`datasource.url`-in-worktree migration constraint.

> **v0.3.4 Slice 3b + 4 land (data + view).** Slice 3b ships the **outcome receipt**: a pure comparator (`buildGoldenTriangleReceipt`) that diffs the requested posture against what actually ran — flagging tier downgrades and, crucially, **distinguishing an infrastructure failover from a posture trade-off** — plus a **migration-free store** (rides `DecisionInteraction.outcomePayload`, structural-client + fail-open) and a read-only **Outcomes view** (`/platform/ai/priority/outcomes`) with an honest empty state. Slice 4 ships per-scope persistence (`getGoldenTrianglePosture`/`setGoldenTrianglePosture` on `DecisionPerspectiveProfile.autonomyPolicy.goldenTriangle`, `view_platform`-gated save). The one remaining piece is the **hot-path capture wiring** that records a receipt against each live run — a supervised step requiring a runtime DB, flagged rather than shipped blind.

> **v0.3.5 Slice 3 closes (posture governs live dispatch; outcomes are real).** The posture is now **wired into the inference hot path**: `prepareRoute()` resolves the effective posture (`resolveDispatchPosture`, single-org → platform default) and feeds it into `inferContract()` as **defaults** — every explicit caller field and the local-only sovereignty switch still win. Two safety properties make this safe on the shared path: **fail-open** (any error → today's behaviour) and **Balanced-inert** (a Balanced default produces no overrides → byte-identical to flag-off until a non-Balanced posture is chosen). For "see the difference," the telemetry-join is solved **migration-free via read-time reconstruction** (`listRecentPostureReceipts`): recent `AdapterRunTelemetry` rows (the real run facts) are compared against the active posture with the same pure `buildGoldenTriangleReceipt()` — zero writes, no schema change (AdapterRunTelemetry has no JSON column and routine runs create no `DecisionInteraction`; the write-path store stays for governed decisions). The Outcomes view now renders these plus the **Slice 6 calibration banner** (`suggestCalibration`). v1 note: read-time reconstruction measures recent runs against the *current* posture and does not reconstruct failover; the write-path store remains the route to historically-pinned, failover-aware receipts. **Remaining: Slice 7 (federated hive) only.**

---

## 0. Architect Verdict

The core idea is right and worth protecting: a non-technical operator should express intent in human terms, while DPF translates that intent into model routing, review depth, verification, retry posture, and budget controls.

The current draft must not become a second model registry, a second routing layer, or a pretty control that makes users feel in control while hidden policy does something else. Treat it as a governed **preference-to-policy compiler**:

1. A user chooses a posture: faster, cheaper, or more assured.
2. The compiler produces explicit policy deltas against existing routing and decision contracts.
3. Runtime receipts prove what actually happened.
4. Feedback and telemetry calibrate future defaults.

Architectural corrections required before implementation:

- Reuse `ModelProfile` as the canonical per-model capability source. Do not introduce a parallel `ModelRegistryEntry` in v1.
- Reuse `RequestContract`, `TaskRequirement`, `AgentModelConfig`, `RouteDecisionLog`, `RouteOutcome`, `AdapterRunTelemetry`, `TokenUsage`, `DecisionInteraction`, and the existing `effort` lever and deliberation engine before adding schema.
- The compiler **feeds** `inferContract()` (as the caller-override input); it never runs as a parallel resolution pass (§5).
- Split "quality" into **intended assurance posture** and **realized outcome quality**. The triangle sets the first; human and verification feedback measure the second.
- Treat "Mark / we / I" as authority scopes, not casual labels (§5). A customer business decision must not inherit platform/founder judgment as authority.
- Frame the control as **cognitive-load migration** and connect its trade-off vocabulary to the **kernel principle system** (`PRINCIPLE_DIMENSIONS` / `principle_decide`) — it is not a new weighting language (§2.1, §7).
- Make privacy, provenance, and receipt visibility first-class. A trusted-agent control must be auditable and reversible.
- Build the UI **presets-first** with a complete numeric/keyboard control; the draggable triangle is an opt-in fine-tune/visualization layer, not the primary affordance (§6).

Status: approved product direction; implementation blocked until the substrate audit (Slice 0) and policy-compiler slice (Slice 1) are complete.

---

## 0.1 Principle Alignment

This design is accountable to the following kernel principles and gates. Paths are given so reviewers can check the claims against the kernel, not just the prose.

- `decisions-belong-to-their-scope` (core) — subsidiarity; governs §5 authority scopes and the customer-must-not-inherit-WWMD boundary.
- `human-in-the-loop-at-phase-boundaries` (commandment, weight 1.0) — posture and orchestration-budget changes are *phase-boundary* decisions; any production-affecting change presents an approval card regardless of phase (§7, §12).
- `data-sovereignty-follows-control` — local-first, and residency as a hard bound the triangle cannot trade (§10).
- `learnings-belong-in-the-shared-commons` — the counter-pressure that legitimizes the hive; resolved against sovereignty in §10.
- `architecture-over-shortcuts`, `single-source-of-truth`, `schema-audit-before-features` / `verify-substrate-before-proposing-new` — reuse existing substrate; no parallel registries or ledgers (§0, §4, §8).
- `compose-report-kit-for-reporting-ux` (core) — all reporting/data-display UI composes the shared report-kit (§6, §11).
- **AGENTS.md gates.** This is an operator-configurable control, so it must carry a measured UX-fit manifest at `docs/ux-fit/<date>-<slug>.ux-fit.json` (UX-Fit Gate, CI-enforced by `scripts/check-ux-fit-decision.mjs`) and pass the Spec/Plan/Doc gate. The `UX-Fit-Decision:` attestation trailer was retired by BI-D967DEE0 — an acknowledgement no longer qualifies; supply `evidence.kind` `sweep-measurement` (adjudicated against the committed route-budget baseline) or `propose-n-pick`. **Historical note:** through 2026-06 `human_cognitive_load` had no carrying kernel principle, so `principle_decide` scored that mandated axis degenerately (hit by the nav-coherence work, 2026-06-21). That gap is now closed — `disclose-before-you-add-a-surface` carries it at −0.9, among others.

Candidate principle: the cognitive-load migration audit flags `migrate-to-the-right-tier` as a not-yet-existing kernel principle, and `human_cognitive_load` lacks a carrying principle. The triangle — a literal load-migration control — is a strong proving ground to promote a principle that carries that axis (and its learned-default arc, §9).

---

## 0.2 Executive Decision Capsule

| Question | Decision |
| --- | --- |
| What is this? | A governed preference-to-policy compiler for cost / quality / time posture. |
| What is the first shippable value? | Operators choose a plain-language posture and see the decoded policy + receipt for what the agent system actually ran. |
| What is it not? | Not a model picker, not a second router, not a new model registry, not a drag-only visualization. |
| What must be true before UI exposure? | Slice 0 proves the substrate shape; Slice 1 proves deterministic compile output; Slice 3 proves receipt telemetry. |
| Where does the refactor budget go? | Entirely into Slice 0 substrate consolidation: naming, type boundaries, receipt joins, and deletion/avoidance of duplicate registry or ledger concepts. |
| Primary UX promise | One-click default for most users; complete keyboard/numeric access for every posture; audit details available without making the default screen technical. |

Enterprise architecture contract:

```text
human posture
  -> Golden Triangle compiler (pure, deterministic)
  -> existing RequestContract / inferContract + workflow orchestration policy
  -> route execution + deliberation + verification
  -> receipt, telemetry, feedback, and learning record
```

Any implementation that skips the compiler, bypasses `inferContract()`, writes a standalone model-control table first, or exposes the triangle before receipts is a design violation.

---

## 1. Research and Benchmarking

### External Precedent

The Golden Triangle borrows the executive clarity of the classic project-management triangle: time, cost, and quality/scope interact, and pressure on one dimension affects the others. PMI's own discussion of the triple constraint is useful precisely because it warns against treating the model as a deterministic formula. That supports DPF's design choice: use the triangle as an intent surface, not as literal optimization math.

Trusted AI precedent points in the same direction. NIST AI RMF frames trustworthy AI as governed, measured, and managed over time. For DPF, that means every triangle-driven action needs a policy record, telemetry, and a feedback path; a visual knob is not trust by itself.

Observability precedent also matters. OpenTelemetry's trace/metric/log model emphasizes correlated context across telemetry signals. DPF should follow that pattern: the preference snapshot, route decision, model attempt, token cost, feedback verdict, and benchmark record share a single correlation identifier (the route receipt id; §8).

Accessibility precedent is non-negotiable — **but the WAI-ARIA *slider* pattern is one-dimensional and does not cover a 2D point control.** WCAG 2.2 also makes drag alternatives and target size first-class AA concerns, which reinforces the design choice: the posture selector's accessible foundation is the **preset list (a `radiogroup`) plus three labeled numeric spinbuttons**, with the triangle layered on top as an enhancement (§6). The numeric/preset layer — not the drag surface — is the canonical accessible control.

External references:

- PMI, [The Triple Constraint](https://www.pmi.org/learning/library/triple-constraint-erroneous-useless-value-8024)
- NIST, [AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- OpenTelemetry, [Overview](https://opentelemetry.io/docs/specs/otel/overview/)
- W3C, [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)
- W3C WAI-ARIA APG, [Slider Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/) (one-dimensional; see §6 for the 2-DOF contract)
- W3C WAI-ARIA APG, [Radio Group Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/) and [Spinbutton Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/)

### DPF Substrate Precedent

DPF already has most of the hard plumbing this design needs:

- Model lifecycle and routing: [`docs/user-guide/ai-workforce/model-routing-lifecycle.md`](../user-guide/ai-workforce/model-routing-lifecycle.md)
- Request contracts and budget classes: [`apps/web/lib/routing/request-contract.ts`](../../apps/web/lib/routing/request-contract.ts)
- Cost-per-success ranking: [`apps/web/lib/routing/cost-ranking.ts`](../../apps/web/lib/routing/cost-ranking.ts)
- The `effort` lever (thinking-budget) and adapter mapping: [`apps/web/lib/routing/chat-adapter.ts`](../../apps/web/lib/routing/chat-adapter.ts)
- Multi-perspective deliberation (perspective/review count): [`apps/web/lib/queue/functions/deliberation-run.ts`](../../apps/web/lib/queue/functions/deliberation-run.ts)
- Decision scopes and audit ledger: [`docs/user-guide/ai-workforce/decision-perspective.md`](../user-guide/ai-workforce/decision-perspective.md)
- Cost governance and token telemetry: [`docs/superpowers/specs/2026-05-19-ai-cost-governance.md`](../superpowers/specs/2026-05-19-ai-cost-governance.md)
- Provider/model scoring convergence: [`docs/superpowers/specs/2026-06-19-provider-model-scoring-convergence-design.md`](../superpowers/specs/2026-06-19-provider-model-scoring-convergence-design.md)
- Situational decision weighting: [`docs/superpowers/specs/2026-06-05-situational-aware-decision-weighting-design.md`](../superpowers/specs/2026-06-05-situational-aware-decision-weighting-design.md)
- Routing/receipt substrate review: [`docs/architecture/2026-06-14-odysseus-review-depth-pass.md`](../architecture/2026-06-14-odysseus-review-depth-pass.md)
- Agentic loop execution and governors: [`apps/web/lib/tak/agentic-loop.ts`](../../apps/web/lib/tak/agentic-loop.ts)
- Product-surface perception and action: the [Authorized Surface Contract](../superpowers/specs/2026-08-08-authorized-surface-contract-design.md) supplies principal-filtered semantic state and governed actions to the same loop; the Golden Triangle changes model behavior, never the user's or coworker's authority.

The design should therefore be written as **consolidate, compile, and surface**, not "create a new AI model-control system."

### Competitive Benchmarking (how the field builds agentic loops)

A 2026 survey of agent frameworks (LangGraph, OpenAI Agents SDK, Microsoft Agent Framework / AutoGen, CrewAI, LlamaIndex, Pydantic AI, Google ADK, smolagents) and the pattern literature (ReAct, Reflexion, Plan-and-Execute, ToT/LATS, CodeAct; Anthropic's *Building Effective Agents*) shows a convergent picture:

- **Table-stakes:** a ReAct loop over native tool-calling; routing/dispatch; a hard loop bound (`recursion_limit`=25, `max_turns`=10, `max_iter`=25, `max_steps`=20, `request_limit`=50, `max_llm_calls`=500); a reasoning-effort knob; model-tier selection; prompt caching; context compaction + tool-result truncation; just-in-time retrieval; evaluator-optimizer for criteria-clear tasks; planner/executor as a pattern.
- **Advanced / differentiating:** code-as-action (sandboxed); structured external memory; sub-agent context isolation; KV/prefix-cache-aware append-only context; learned routers (RouteLLM); verifier cascades (FrugalGPT); difficulty-adaptive effort.
- **Research-only / superseded:** ToT/LATS tree search; self-consistency vote; unaided self-refine for correctness (frontier reasoning models absorbed these).
- **The field's weakest dimension is cost governance.** Everyone counts tokens; few *enforce* a budget; almost none do cost-aware stopping; and the strongest empirical finding of the year (Anthropic's multi-agent research) is that *token spend explained ~80% of performance variance*. The master variable an agent system controls is how much compute to pour in — which validates the triangle's premise: it is fundamentally a **governed token-spend allocator** wearing a priority control.

**Where DPF's loop stands** (`agentic-loop.ts`): on-par-to-ahead of the framework baseline, with sophistication concentrated in routing, resilience, capability/tier gating, and governance — per-iteration cost-per-success routing, transport fallback + circuit-breakers, kernel-veto/grant/HITL guardrails, and many independent stop conditions. It is *behind* the leading edge on in-loop verification (no evaluator-optimizer wired into the loop), cache-aware context construction (it re-compacts every iteration), and — shared with nearly everyone — posture-driven budget control. None of these are foundational; they are un-wired capabilities, which is precisely what the triangle would expose.

**Novelty of the Golden Triangle.** Every *individual* mapping the triangle proposes already exists somewhere: priority→model (OpenRouter's 0–10 `cost_quality_tradeoff` dial; Azure AI Foundry's Balanced/Cost/Quality modes; RouteLLM/FrugalGPT), priority→effort (OpenAI `reasoning_effort`, Anthropic `effort`, Gemini thinking budget; Claude Code `/effort`), priority→loop-depth (`max_turns`/`recursion_limit`), priority→verification/retries (research-only: AVA allocates a user budget across search/sampling/verification). What does **not** exist in any shipped product is a single priority that compiles into all five coordinated knobs — model tier + effort + loop depth + verification + retries — as one policy object. The triangle is therefore **novel as an integration/abstraction, not as a mechanism**; its differentiator is pulling verification depth + retry + loop budget into the same compiled policy as model + effort. Closest analogues to position against: **Claude Code `opusplan` + effort** (closest product — model-role split + effort, two coordinated knobs), **OpenRouter / Azure dials** (single control → model selection only), **AVA** (research — one budget over search/sampling/verification), **FrugalGPT** (the cost-quality cascade primitive to reuse for the model-tier dimension). DPF is well-positioned to be first to productize the *full* compiler because it already owns the substrate the analogues lack.

Competitive references:

- Anthropic, [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) · [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) · [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [FrugalGPT](https://arxiv.org/abs/2305.05176) · [RouteLLM](https://arxiv.org/abs/2406.18665) · [AVA — Anytime Verified Agents](https://openreview.net/forum?id=JMDCMf7mlF)
- [OpenRouter Auto Router](https://openrouter.ai/docs/guides/routing/routers/auto-router) · [Azure AI Foundry model router](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-router) · [Claude Code model config](https://code.claude.com/docs/en/model-config)

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
- `reasoningDepth` and `effort` (thinking budget)
- residency and sensitivity constraints
- review/perspective count (deliberation pattern)
- verification depth
- retry and fallback posture
- token/context and loop/duration budget
- approval/escalation behavior

The value is not the triangle graphic. The value is the translation layer and the audit loop behind it. A user should not have to know which model tier, review topology, or routing budget class is appropriate. DPF should know, show what it decided, and learn from the outcome.

### 2.1 The triangle as cognitive-load migration

The triangle is a concrete instance of DPF's organizing thesis — moving load off the human onto AI and code (`docs/superpowers/audits/2026-06-19-cognitive-load-migration-analysis.md`). A decision decomposes into *gather context → generate options → decide → execute → verify*. The triangle keeps exactly one step — **decide the posture** (what to optimize for) — at the human tier, and migrates the rest down: the compiler *generates* the policy, routing/orchestration *executes* it, telemetry and feedback *verify* it. This is progressive disclosure as enforced by the UX-Fit gate (AGENTS.md §12): auto-derive everything computable (tier floors, token estimates, model health), and surface only the 3–5 plain postures. The plain/operator two-layer decode panel (§11) is that disclosure boundary made literal. Over time the human keeps only the *irreducible* judgment (the posture, especially when set as authority — "this is sensitive, spend more"), and the platform learns and carries the menial repeat (§9).

---

## 3. Terms

| Term | Meaning |
| --- | --- |
| Preference vector | The user's saved or per-decision posture across cost, quality, and time. Stored as weights plus preset/source metadata. |
| Posture override | The compiler's routing-shaped output (`{budgetClass?, reasoningDepth?, effort?, maxLatencyMs?, residencyPolicy?, minimumDimensions?}`), fed as the caller-override input to `inferContract()`. Never a parallel resolution pass. |
| Orchestration budget | The compiler's loop/workflow-shaped output (loop/duration ceiling, retry budget, verification depth, deliberation pattern) applied *outside* the request contract, at the loop/workflow layer. |
| Decoded policy | The full set of concrete settings — posture override + orchestration budget — compiled from the preference vector. |
| Assurance posture | What the system intends to do to improve correctness: stronger model, deeper reasoning, more review, more verification. |
| Realized quality | What actually happened, measured through human verdicts, verification results, acceptance, retries, and downstream outcomes. |
| Route receipt | Evidence of the actual model/provider/fallback/token path taken for a run; the correlation key for the benchmark record. |
| Ring-boundary record | A GearInterface-style canonical record emitted where work crosses a boundary and is graded (Reduction Gear Architecture). The benchmark record is one. |
| Benchmark record | A joined learning artifact: intended posture, decoded policy, predicted cost, actual cost/latency, model receipt, task class, and realized outcome. |

---

## 4. Updated Locked Decisions

| # | Decision | Resolution |
| --- | --- | --- |
| 1 | Primary control | **Presets are the primary control; the triangle is a secondary visualization and opt-in fine-tune.** The default affordance is four labeled presets with a plain-language effect line; the draggable triangle plots the active posture and is revealed on demand. Backed at all times by keyboard, numeric steppers, and preset selection (§6). |
| 2 | Weighting model | Soft preference weighting. Do not claim literal zero-sum optimization. The compiler owns real-world couplings; the UI must not assert a fixed budget being divided. |
| 3 | Quality | Split into intended assurance posture and realized quality. The triangle only sets intended assurance. |
| 4 | Routing substrate | Compile to existing routing concepts first — `RequestContract` (incl. `reasoningDepth`, `budgetClass`), the existing `effort` lever, `TaskRequirement`, `AgentModelConfig`, `ModelProfile`, the deliberation engine, and route telemetry. The compiler feeds `inferContract()`; it does not run beside it (§5). |
| 5 | Model registry | No new `ModelRegistryEntry` in v1. `ModelProfile` is canonical; provider-level scores are derived rollups. |
| 6 | Cost | Use real telemetry: `TokenUsage`, `AdapterRunTelemetry`, `RouteOutcome.costUsd`, predicted vs actual drift, and eventually capacity/rate-limit pools. |
| 7 | Feedback | Human feedback is a lightweight 3-state verdict, but it is only one signal. Also capture acceptance, verification, retry, and latency outcomes. Calibration trains on **realized** signals only (§9). |
| 8 | Authority scopes | WWMD/platform and WWWD/org are v1. WSID/profession and per-decision override are first-class concepts but deferred past v1 (§13). A customer business decision never inherits WWMD as authority (§5). |
| 9 | Federated learning | Local-first. Hive contribution is opt-in, metadata-only, thresholded, revocable, reputation-weighted, and incentive-aligned (§10). |
| 10 | Implementation order | Substrate audit and compiler first; UI second; learning/hive last. |

---

## 5. Authority Scopes

The v0.1 "Mark / we / I" framing is directionally right but needs governance language.

| Scope | User-facing idea | Governing source | Default role |
| --- | --- | --- | --- |
| WWMD / platform | "What would Mark do?" | Founder/platform kernel and approved DPF decisions | Platform/Build-Studio decisions only. **First *implementation* slice because DPF dogfoods on itself — not a baseline other scopes inherit.** Advisory-only for any customer business decision. |
| WWWD / organization | "What would we do?" | Organization profile, policies, and prior decisions | Customer/org default |
| WSID / profession | "What should a competent professional do?" | Role/profession corpus | Craft floor for specialist coworkers (deferred past v1) |
| Per-decision override | "What do I need here?" | User choice for this decision | Local override within policy limits (deferred past v1) |

Precedence:

1. Hard safety, residency, tool-grant, and compliance constraints always win.
2. Task requirements set the minimum floor.
3. **The most-local scope that *owns* the decision applies** (subsidiarity): a platform/build decision resolves in WWMD, a customer business decision in WWWD, a craft decision in WSID. A non-owning scope is **advisory only** and never supplies authority — a customer business posture is never defaulted from WWMD. If the owning scope is silent, surface to that scope's human or `defer`; do not borrow a neighbor's doctrine as authority.
4. The triangle can raise assurance, lower cost, or lower latency only within those bounds.
5. Per-decision override can supersede a default, but it cannot bypass a hard policy.

Critical boundary: customer business decisions must not inherit WWMD as authority by default. Operationally, a customer's live triangle posture routes through the Decision Perspective Gate against the org's WWWD profile, **not** raw `principle_decide` against the founder kernel (AGENTS.md §16; `decisions-belong-to-their-scope`).

### Composition point with `inferContract()`

The triangle does not run beside contract inference; it **feeds** it. The compiler emits a **posture override object** (`{budgetClass?, reasoningDepth?, effort?, maxLatencyMs?, residencyPolicy?, minimumDimensions?}`) that is passed as the `routeContext`/caller-override input to `inferContract()`, which remains the single place tier-floors and task defaults are merged (stricter-wins, as today). The triangle therefore only occupies the slot `inferContract` already reserves for an explicit caller — it never adds a parallel resolution pass (the "second routing layer" the Architect Verdict forbids). Orchestration-layer outputs (loop/duration budget, verification depth, deliberation pattern) are applied *outside* the contract, at the loop/workflow layer, because `inferContract` has no field for them. Receipts record both the posture override object and the final inferred contract so the two can be diffed. *(This resolves former Open Decision 4: routing-shaped fields go through `inferContract`; loop/verification/perspective fields are workflow-layer.)*

---

## 6. Interaction Model and UI Contract

### Primary Control

The canonical control is a **posture selector** with two coordinated layers.

- **Layer 1 (default, primary): four preset controls** — Fast, Frugal, Assured, Balanced — rendered as native radio inputs styled as compact segmented controls/cards where feasible, each showing the preset name and a one-line plain-language effect. Most users stop here; selecting a preset is one click or keypress.
- **Layer 2 (opt-in fine-tune): a triangle visualization** that plots the active posture as a labeled point and, once "Fine-tune" is engaged, lets the user nudge the point between presets. The triangle is a *view of* and *adjustment to* the posture, not the only input. Because the weighting is soft and non-zero-sum (Decision 2), the triangle must communicate that vertices are *emphasis*, not a fixed budget being divided — show each axis's resulting bias as a labeled fill/scale, not only as distance from a vertex.

The UI always shows: active preset name, the plain decoded summary, the projected cost/latency envelope when available, and whether hard policy changed the requested posture.

The first viewport must read as an operations control, not an illustration. Use compact preset buttons, a short decoded-policy line, and a receipt/projection area. The triangle is visually subordinate unless the user chooses Fine-tune; it should never dominate the page or push the receipt below the first meaningful viewport.

Preset names carry a mandatory plain-language effect line — the name alone must not be the only signal (operator copy targets FK reading grade ≤ 9 per `docs/platform-usability-standards.md`):

| Preset | Plain effect line (shown in UI) | Fallback name if comprehension testing flags it |
| --- | --- | --- |
| Fast | "Quickest result. May do less checking." | (keep) |
| Frugal | "Spends the least. May take longer." | "Economical" |
| Assured | "Most checking, strongest model. Costs more, takes longer." | "Thorough" |
| Balanced | "A sensible mix. Good default." | (keep) |
| Custom | "Your own fine-tuned mix." | — |

**Alternatives considered** (to satisfy `design-research-required`): three coupled sliders with a live triangle read-out, and presets + a single "balance toward quality ↔ cost ↔ speed" control. The chosen presets-first / triangle-as-fine-tune hybrid wins on lowest entry cost, honesty about the discrete reality (postures collapse to ~4 buckets + the orchestration budget is discrete), and it still gives the protectable triangle metaphor without forcing it as the input.

### Progressive Disclosure (default → reveal)

The control discloses in three steps, matching DPF's progressive-disclosure doctrine (AGENTS.md §12; a founder-patented value):

1. **Default:** four preset controls + the active preset's one-line decoded summary. Usable on the first screen with one click.
2. **Fine-tune (on demand):** a toggle reveals the triangle and three numeric weight steppers for users who want a posture between presets.
3. **Operator detail (on demand):** a "Show what this configured" disclosure reveals the exact `budgetClass`, `reasoningDepth`, `effort`, tier floor, verification depth, retry/orchestration budget, deliberation pattern, model candidates, and any policy override.

The plain decoded summary and the receipt link are always visible; everything else is revealed, not defaulted.

### User Journey Contract

The feature is successful only if the user can complete this loop without learning model-routing vocabulary:

1. **Choose posture:** pick Fast / Frugal / Assured / Balanced, or open Fine-tune.
2. **Preview policy:** read one plain sentence plus projected cost/latency, including any hard-policy adjustment.
3. **Confirm at the right boundary:** if the posture changes a phase-level or production-affecting behavior, show a phase-boundary approval card; do not ask per tool call.
4. **Run:** the router, deliberation engine, loop governors, and verification layer execute the decoded policy.
5. **Read receipt:** see requested posture, actual model/route/effort/verification, cost/latency, and any delta.
6. **Give feedback:** lightweight positive / mixed / negative verdict, optionally linked to acceptance or rework evidence.

The receipt is not an afterthought; it is the second half of the control. A posture picker without an adjacent receipt path fails the trust promise.

### Accessibility contract (2 degrees of freedom)

The numeric/preset layer is the canonical accessible control; the triangle is an enhancement. The data model is ordinary state:

```ts
type GoldenTrianglePreference = {
  costWeight: number;
  qualityWeight: number;
  timeWeight: number;
  preset: "fast" | "frugal" | "assured" | "balanced" | "custom";
};
```

- **Roles & structure.** Presets render as a native radio group where feasible (`<fieldset>` / `<legend>` / `<input type="radio">` styled as compact preset buttons). If the local component library requires a roving-button implementation, it must follow the WAI-ARIA APG radio-group pattern (`role="radiogroup"`, `role="radio"`, `aria-checked`, visible labels, described-by copy). The three weights render as `<input type="number">` spinbuttons (Cost %, Quality %, Time %) with visible `<label>`s; together they reproduce any posture. The triangle, if interactive, is a focusable thumb with `aria-roledescription="priority area"` whose accessible name reports all three weights and the active preset — **never** the only path to a value.
- **Keyboard model (two axes, explicit).** With a preset focused: Arrow keys move between presets; Enter/Space selects. With the triangle thumb focused (fine-tune only): Left/Right adjust the Cost↔Time balance, Up/Down adjust toward/away from Quality, in fixed steps (e.g. 5%); Home returns to Balanced; PageUp/PageDown jump to the nearest preset; step size and current axis are announced. The three spinbuttons are independently Tab-reachable; editing one re-normalizes the others and announces the change.
- **Screen-reader announcements.** On any change, announce the **decoded outcome**, not just raw weights, via an `aria-live="polite"` region: e.g. "Assured posture. Cost 20%, Quality 55%, Time 25%. Decoded: stronger model, deeper review, higher projected cost." When hard policy alters the request, the live region announces the adjustment.
- **No color-only encoding** (WCAG 1.4.1): every axis and the active preset are conveyed by text/label/position, never hue alone.
- **Reduced motion.** Honor `prefers-reduced-motion` locally (drag-trail/snap animation disabled); do not assume a platform-wide primitive exists.
- **Dragging alternative.** Any drag gesture has an equivalent click, keyboard, and numeric-input path (WCAG 2.5.7). Dragging can enrich the expert layer; it cannot be required for setting a posture.
- **Touch & target size.** Preset buttons, steppers, and the thumb meet the DPF 44px minimum hit area and WCAG 2.2 target-size expectations.
- **Semantic HTML & focus.** Real `<button>`/`<input>`/`<fieldset>`/`<legend>`; no `<div onClick>`. Use the platform `:focus-visible` token, do not redefine it.

### Empty, projecting, and failure states

- **No projection yet:** when a cost/latency envelope is unavailable, show "No estimate yet — appears after the first runs"; never a fabricated or zero estimate.
- **Cold start (no history):** the evidence view and calibration panels show an honest empty state ("No runs recorded yet"), not zero-filled KPIs. The decode panel labels the state: "Using platform defaults — no learning history yet" (§7.x).
- **Fail-closed (no valid route):** render §7's fail-closed behavior as a designed screen — explain the conflict in plain language, list nearest valid alternatives, offer the escalation action if one exists, otherwise a clear "deferred, no governed path" message. Not an error toast.
- **Policy-clamped / downgraded:** show the requested posture and the actual posture side by side with the reason, distinguishing a *policy override* from an *infrastructure failover* (a preferred provider failing over to a backup is not the triangle ignoring the user).

### Design-system constraints

- Use DPF theme tokens (`--dpf-*`); the surface is quiet and operational, not a marketing hero.
- **Compose reporting/data-display UI from the shared report-kit** (`apps/web/components/ui/report-kit/`): `StatusBadge`, `StatCard`, `DataTable`, `FilterBar`, `Chart`. Do not hand-roll badges, tables, KPI tiles, status-color maps, or charts (kernel principle `compose-report-kit-for-reporting-ux`). Status/severity colors resolve through `statusColors.ts` (status → intent → token), never a page-local hex.
- `Chart` is intentionally imported by subpath (`@/components/ui/report-kit/Chart`) because it pulls in recharts; do not re-export it through the report-kit barrel or make server components transitively client-heavy.
- The triangle specifically: token-only fills and thumb (no gradient, glow, or orb); axis emphasis shown with labeled fills meeting WCAG 2.2 AA 3:1 for UI components, never hue-only; quiet panel, no cards inside cards.
- **Mobile / narrow viewport:** the interactive surface falls back to presets + numeric steppers; the triangle renders as a read-only thumbnail. No drag-on-a-simplex requirement on touch widths.
- The first screen is usable with one click (pick a preset) and reads at a high-school level.

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
  -> posture override (-> inferContract) + orchestration budget
  -> route/review/verification execution
  -> receipt + telemetry + benchmark
```

Compiler invariants:

- **Pure and deterministic.** The compiler has no database writes, no network calls, no provider-specific branching, and no hidden randomness. Inputs in, decoded policy out.
- **Existing routing remains authoritative.** Routing-shaped fields go through `inferContract()`; workflow-shaped fields go to the orchestration budget; model/provider availability comes from existing routing substrate.
- **Hard constraints outrank posture.** Residency, sensitivity, tool grants, policy floors, and human-in-the-loop rules clamp the decoded policy before execution.
- **Receipts are mandatory.** Every compiled policy produces a preference snapshot, decoded-policy snapshot, final inferred contract, orchestration budget, and route receipt correlation id.
- **No silent learning.** Calibration can recommend defaults only from realized outcome signals and must preserve the before/after policy version.

Precedence order:

1. Hard policy and safety constraints.
2. Authority scope (WWMD / WWWD / later WSID or per-decision override).
3. Task requirements and model capability floors.
4. User posture preference.
5. Provider health, cost, latency, and capacity.
6. Learned defaults and tie-breakers.

### Control Layers

The compiler spans three layers, and `ModelProfile` is only the first. Most of the triangle's leverage — and almost all of its cost — lives in the layers below the model.

| Layer | Question it answers | Where it lives today | What the triangle compiles into it |
| --- | --- | --- | --- |
| Model | "Which engine, at what unit price?" | `ModelProfile` capability scores plus `inputPricePerMToken` / `outputPricePerMToken` | tier floor, candidate set |
| Per-call posture | "How hard to try on this one call?" | `RequestContract.reasoningDepth`, `RequestContract.budgetClass`, and the existing **`effort`** lever (`AgentRouteConfig.effort` → Anthropic extended-thinking budget / OpenAI `reasoning_effort`, see `chat-adapter.ts`); token estimates; tier-floor `minimumDimensions` | effort mode, cost/quality bias |
| Orchestration / loop | "How many calls, perspectives, retries, verifications?" | Perspective/review count → the deliberation engine (`DeliberationRun`, branch nodes, pattern). Loop/duration budget + verification depth have **no posture-driven home** today | deliberation pattern, loop/duration ceiling, retry budget, verification depth |

Cost is an execution outcome, not a model attribute:

`cost ≈ unit_price × tokens_per_call × calls × iterations × retries`

`ModelProfile` supplies only the first term. The multipliers live in the orchestration layer and the realized ledger (`RouteOutcome`, `TokenUsage`, `AdapterRunTelemetry`). A small model in a deep, multi-perspective, verify-and-retry loop can cost more than a single frontier call, so "pull toward Frugal" cannot be read off `costTier`: it must compile into a loop budget and be reconciled against measured spend (predicted-vs-actual drift, Decision 6).

### Kernel-governed trade-off vocabulary

The triangle's three axes are not a new weighting language — they project onto DPF's closed dimension registry (`PRINCIPLE_DIMENSIONS`, `packages/db/src/wiki-taxonomy.ts`): **Cost → `cost_efficiency` / `capacity_utilization`, Time → `speed_to_value`, Quality → `evidence_density` + `governance_compliance` + `long_term_maintainability`.** The coupling rules below are the kernel's *signed* dimension semantics (`PRINCIPLE_COST_DIMENSIONS`), not bespoke math. Two consequences:

1. **Defaults are a kernel decision.** Choosing/adjusting a *platform-default* preset (WWMD scope, Slice 4) is scored with `principle_decide` over these dimensions, and the per-principle contribution ledger it returns (`docs/architecture/autonomy-and-wwmd.md`) is reused as the decode panel's "why."
2. **The compiler still owns real-world couplings.** `principle_decide` governs *which default is doctrinally preferred*; the pure `compileGoldenTrianglePolicy()` owns the deterministic decode into posture-override + orchestration-budget fields.

A customer's *live, per-decision* posture is a WWWD/per-decision business choice and is **not** routed through the founder kernel (§5).

### Cold-start defaults

Before any benchmark history exists, the triangle defers to the existing inferred contract rather than overriding it:

1. New org/user default preset = **Balanced**, which compiles to **no deltas**: the decoded policy equals what `inferContract()` already produces from `TaskRequirement` (`budgetClassDefault`, `reasoningDepthDefault`) plus the code-side `BUILT_IN_TASK_REQUIREMENTS` tier floor — note `minimumTier` lives there, **not** as a DB column (Slice 0 finding). Balanced is a pass-through, not a competing default.
2. WWMD/platform scope may ship seeded non-Balanced presets for known platform task classes (e.g. code-gen → Assured) as the first-party prior.
3. A new customer org inherits Balanced until it sets WWWD defaults or accumulates ≥ N local benchmark rows (N defined in §9).
4. The decode panel labels cold-start state explicitly.

Acceptance: a fresh install with the triangle at Balanced produces byte-identical routing to the same install with the feature flag off (§14).

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
| `effort` (thinking budget) | `AgentRouteConfig.effort`; already mapped to provider thinking / `reasoning_effort` in `chat-adapter.ts`. The primary Quality↔Cost lever at the per-call layer. |
| minimum quality tier / dimensions | `TaskRequirement`, `AgentModelConfig`, `minimumDimensions` |
| residency and sensitivity | `RequestContract` route context |
| max latency | `RequestContract.maxLatencyMs` |
| review/perspective count | Deliberation pattern selection (`DeliberationRun`) — an existing home, not raw routing |
| verification depth | Workflow policy / orchestration budget (new) |
| loop/duration + retry budget | Orchestration budget (new) — biases the loop's existing governors |
| token/context budget | Cost governance and request-contract estimates |
| escalation/approval policy | Decision Perspective / HITL policy |

The model and per-call-posture rows compile into fields that already exist (`budgetClass`, `reasoningDepth`, `effort`, tier floor). **Perspective/review count is not homeless either** — it maps to deliberation pattern selection (`deliberation-run.ts`). The genuinely unhomed levers are narrower than v0.1 implied: a posture-driven **loop/duration budget** and **verification depth**. Note that the loop's behavioral governor today is **not** the `MAX_ITERATIONS = 200` safety ceiling (explicitly "NOT a behavioral limit") but the phase-aware `MAX_DURATION_*` limits, the local-model spin guard, the one-nudge cap, and the repetition detector in `agentic-loop.ts`. A per-decision **orchestration budget** that biases those governors and selects a deliberation pattern — recorded on the receipt, not a new model registry — is the one modest new surface the triangle justifies. Slice 0 confirms its shape.

Provisional orchestration-budget shape (Slice 0 confirms field-by-field):

```ts
type OrchestrationBudget = {
  maxDurationMs?: number;        // biases agentic-loop MAX_DURATION_* per posture
  retryBudget?: number;          // fabrication/transient retry ceiling
  verificationDepth?: "none" | "shallow" | "deep";
  deliberationPattern?: string;  // selects a DeliberationRun pattern (perspective count)
};
```

Attachment: recorded on the route/decision receipt alongside the posture override; read by the agentic loop and the deliberation orchestrator. Because the orchestration budget governs how hard a *phase* tries, it is set and changed at **phase boundaries**, not per tool call — honoring the commandment-tier `human-in-the-loop-at-phase-boundaries` principle. A posture change that would alter a production-affecting action still presents an approval card regardless of phase.

Non-functional requirements for the compiler:

- Deterministic enough for snapshot tests: the same inputs produce byte-identical decoded policy.
- Explainable enough for the plain decode panel: every adjustment has a human-readable reason and a machine-readable reason code.
- Diffable enough for receipts: requested posture, decoded policy, final inferred contract, and actual route can be compared field by field.
- Versioned enough for learning: every saved default and receipt records compiler version, preset version, and authority-profile version.
- Fail-closed by construction: blocked/defer is a first-class output, not an exception path.

### Representative Compile Table

> **Canonical, current mapping:** the exact per-vector parameters + features (incl.
> the **debate** rung the table below pre-dates) live in
> [golden-triangle-vector-reference.md](golden-triangle-vector-reference.md), mirrored
> from `compile.ts`. The rows below are the original illustrative intent.

| User posture | Decoded intent | Compiler behavior |
| --- | --- | --- |
| Assured | "Get this right." | `quality_first`, high `effort`/reasoning, frontier tier floor, deep verification, a **review** deliberation, retry 3. Cost and time may rise. |
| Max Quality (custom: quality ≥ 0.85) | "Get this as right as possible." | As Assured but **max effort** and a multi-perspective **debate** (the top of the rigor ladder) instead of a single review. |
| Fast | "I need this now." | Lower latency target (30s), low `effort` when safe, single pass, no verification, tight retries (1), fastest eligible endpoint. May reduce assurance. |
| Frugal | "Spend carefully." | `minimize_cost`, adequate (smallest capable) tier, low `effort`, shallow verification, no deliberation, retry 1, avoid frontier unless policy requires it. May increase time. |
| Balanced | "Use the sensible default." | Pass-through: existing task-requirement and agent defaults, no deltas (see Cold-start). |
| Custom: cost 0.6 / quality 0.3 / time 0.1 | "Mostly cheap, some care." | `minimize_cost`, low `effort`, shallow verification, no deliberation, retry 1, adequate tier-floor. |
| Custom: cost 0.2 / quality 0.6 / time 0.2 | "Mostly right, watch spend." | `quality_first`, high `effort`, deep verification, a **review** deliberation, retry 3, frontier tier-floor. |

### Coupling Rules

The triangle is not literal zero-sum math:

- Higher quality often increases cost and time together.
- Lower cost may increase time if the cheapest eligible endpoint is slower.
- Lower time may lower cost by shortening work, but may increase downstream risk.
- Hard policy can override all three axes.

The UI must say when policy changed the requested posture. Example: "Frugal requested; restricted data requires local-only routing, so the compiler selected the best local eligible model and raised the latency estimate."

### Fail-Closed Behavior

If no route satisfies the decoded policy and hard constraints, the system fails closed using the Decision Perspective Gate's governed outcomes (`docs/user-guide/ai-workforce/decision-perspective.md`) rather than a lookalike: **recommend** the nearest valid alternative, **arbitrate** between close alternatives with dissent preserved, **escalate** to the scope's human when an escalation path exists, or **defer** (capture the gap) when no governed path exists. It must never silently choose a weaker/unsafe route. When projected telemetry is unavailable, show "estimate unavailable" rather than fabricating a range; when a run is downgraded by failover, mark the deviation as *infrastructure failover*, distinct from a *policy override*.

---

## 8. Data Model and Single Source of Truth

The v0.1 entity list is directionally useful but over-additive. v1 adds as little schema as possible (`schema-audit-before-features`, AGENTS.md §11 — audit existing schema before adding any).

| Concept | Recommendation |
| --- | --- |
| Saved triangle defaults | Audit the existing profile referenced by `DecisionInteraction.profileId` first — saved defaults may extend that profile rather than introduce a new table. Provisional name if needed: `DecisionPreferenceProfile`. |
| Per-run triangle position | Store an immutable preference snapshot on the decision/run receipt path. Prefer linking to `DecisionInteraction` or route receipt over a detached `TrianglePosition` table. |
| Model profiles | Reuse `ModelProfile`. Canonical per-model scoring source; provider scores are derived. |
| Provider metadata | Reuse `ModelProvider`, discovered models, capability profiles, and provider health. |
| Task taxonomy | Start with existing `taskType` / `TaskRequirement`. Introduce a new `TaskClass` only if the existing taxonomy cannot support benchmark aggregation. |
| Cost ledger | Reuse `TokenUsage`, `RouteOutcome`, `AdapterRunTelemetry`, and Build Studio cost rollups. Add fields only where the cost-governance spec already identifies a gap. |
| Feedback | Reuse `AdapterRunTelemetry.userAccepted` for per-turn acceptance where suitable; add a decision-level verdict only where existing feedback cannot represent it. |
| Benchmark record | First implement as a read model/view joining existing decision, route, telemetry, and feedback rows. Materialize only when query cost or hive contribution requires it. |
| Ring-boundary alignment | The benchmark record is a Ring 1↔2 **GearInterface** emission (`docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md`), not a parallel ledger: map intended-vs-realized to torque technical/value/confidence, cost to `costUsd`, the human verdict to `graderType:human` + rationale, and the preference snapshot to the shaft source. Dual-emit if/when GearInterface lands (draft / Phase-0 today); until then, shape the view so the columns line up. |

Minimum benchmark fields:

- preference snapshot
- decoded policy snapshot (posture override + orchestration budget)
- active authority scope and profile version
- task type/class
- selected provider/model and fallback chain
- predicted input/output tokens and cost
- actual input/output/cache tokens, cost, and latency
- verification result
- human verdict
- accepted/rejected state
- retry/fallback count
- a single **correlation id** (the route receipt id) linking preference snapshot → `RouteDecisionLog` → `RouteOutcome` → `AdapterRunTelemetry` → `DecisionInteraction` (the OpenTelemetry-correlation precedent in §1)
- timestamp and coarse environment metadata

Do not store prompts, outputs, file contents, customer identifiers, or free text in benchmark rows intended for hive contribution.

Provisional artifact names for Slice 0 validation (names, not schema commitments):

| Artifact | Purpose | Persistence posture |
| --- | --- | --- |
| `GoldenTrianglePreferenceSnapshot` | Immutable requested posture, preset source, authority scope, and profile version for one run. | Persist with the decision/run receipt path. |
| `GoldenTriangleDecodedPolicy` | Compiler output: posture override, orchestration budget, policy adjustments, and explanation codes. | Persist with the receipt; no separate ledger unless query cost proves it. |
| `GoldenTriangleReceiptView` | Read model joining preference snapshot, final inferred contract, route outcome, telemetry, and feedback. | Start as a view/projection; materialize only for performance or hive export. |
| `GoldenTriangleDefaultProfile` | Saved default for a scope/task class if existing `DecisionInteraction.profileId` substrate cannot carry it cleanly. | Add only after Slice 0 proves existing profile extension is insufficient. |

These names keep implementation conversations precise while preserving the schema discipline: prefer projection and extension over new canonical tables.

---

## 9. Benchmarking and Learning Loops

The benchmark record powers three loops:

| Loop | Compares | Improves |
| --- | --- | --- |
| Quality calibration | Intended assurance vs realized quality | Preset defaults, review depth, verification policy |
| Cost calibration | Predicted cost vs actual cost | Token estimates, context/loop budgets, cost projections |
| Latency calibration | Requested time posture vs actual elapsed time | Fast/frugal route choices and fallback ordering |

Calibration adjusts defaults using **realized** signals only (verification, acceptance, rework, incident linkage). Intended assurance is the input being evaluated, never evidence of its own success; a default is never tuned on "Assured was selected a lot."

The model-scoring convergence rule is binding: model capability calibration writes to `ModelProfile`, not provider-level score columns. The provider grid may show rollups, but the learning loop updates the model rows the router actually reads.

Human verdicts stay lightweight (positive / mixed / negative), but the platform must not overfit to satisfaction — "sounded good" ≠ "was correct." Weight realized quality with: human verdict, task completion/acceptance, verification result, retry success, post-hoc correction/rework, and downstream incident/defect linkage where available.

No LLM-as-judge is a v1 truth source for the triangle's *realized-quality calibration*. (This does not affect existing review gates `reviewDesignDoc` / `reviewBuildPlan`, which remain workflow gates, not calibration ground truth.)

### From manual knob to learned default (the automation arc)

Per DPF's prime directive — "automate the menial, free humans for judgment that can't be automated" (`docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md`) — the triangle is a *migration target*, not a permanent chore. When the same posture is chosen for the same task class across N runs with stable realized-quality outcomes, the platform proposes that posture as the **learned default** for that task class and stops asking (the AI→code descent). The human is then surfaced only when intent *diverges* from the learned default. The floor that must **not** be automated: a posture deliberately set as *authority* ("this is sensitive, spend more"), and any change that would cross a hard safety/residency/compliance bound. The knob disappears for the menial repeat, never for the irreducible call.

---

## 10. Federated Hive Architecture

The hive is strategically valuable but the highest-risk part of the design; it ships last. It resolves a real tension between two DPF core principles: *learnings belong in the shared commons* (a confirmed posture-outcome is a team asset; local-only knowledge is a defect — `…/learnings-belong-in-the-shared-commons.md`) versus *data sovereignty follows control* (raw data must not cross a control boundary). The included/excluded contribution table below **is** the resolution: the *learning* propagates; the *data* never leaves.

### Local First

Every install stores its own benchmark history and learns local defaults without cloud contribution. Local records are the source of truth. Local-first here is DPF's **sovereignty posture**: per `docs/founder-kernel/wiki/principles/data-sovereignty-follows-control.md`, protection follows the *control and governing law of the operating entity*, not byte location — so benchmark records and residency-sensitive routing stay on customer-controlled infrastructure and fail loudly (`residencyPolicy: "local_only"`) rather than reach a foreign path. The triangle can never trade a residency constraint for cost or speed: residency is a hard bound (§5 precedence #1), not a posture axis.

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
- **incentive alignment:** contributions that would move a global default in the contributor's own cost-favorable direction are down-weighted unless corroborated by an independent cohort; no install can shift a default it directly benefits from beyond a capped influence
- signed schema version so old payloads do not corrupt current learning

Anti-pattern rejected: uploading raw traces and trying to anonymize them later.

---

## 11. UI Surfaces

Navigation and placement rules (portal IA):

- This is **not** a new global navigation destination. Global nav stays reserved for durable product areas; the Golden Triangle lives inside Platform > AI / Decision Perspective and appears contextually where a decision is being made.
- The saved-default editor is configuration, so it belongs with Decision Perspective / AI governance settings, not inside operational Build Studio task flow.
- The per-decision posture selector is a local page control, not navigation. It appears in a gate/review panel or launch form, then collapses back to the decoded summary + receipt link.
- Receipts and benchmark history are destination content. They belong in the AI evidence/audit surface, with drill-down links from decisions and Build Studio runs.
- Do not duplicate the same choice in top nav, section tabs, and page controls. The user chooses posture at the point of decision; admins maintain defaults in the governance surface.

Recommended first surfaces, **reusing the existing Decision Perspective substrate** (`apps/web/lib/decision-perspective/*`, `apps/web/components/decision-perspective/*`, route `/platform/ai/decisions/[interactionId]`) rather than new homes:

1. **Decision Perspective / WWMD default editor**: the first saved Golden Triangle profile, scoped to platform decisions.
2. **Build Studio decision review panel**: show the active preference, decoded policy, and receipt for an actual decision; render with `StatusBadge` + a small `DataTable`/definition list.
3. **Platform > AI evidence view**: aggregate benchmark records, cost drift, and outcome comparisons — built from report-kit (`StatCard` KPIs, `Chart` for predicted-vs-actual trends, `DataTable` + `FilterBar` for rows). No bespoke table/badge/chart.
4. **Per-decision posture (contextual, later slice)**: an inline, compact posture selector at the point of work — a coworker-task launch and/or a Build Studio gate — so a user can choose a posture for *this* decision within policy bounds. Reuses the same component in compact form and writes a per-run preference snapshot (§8). Ships after the receipt path (Slice 3) exists, so every per-decision posture produces a visible receipt.

Do not start with a global model-picker UI; the user sets intent and sees receipts. Admins still manage model/provider substrate in the existing Platform > AI surfaces.

The decode panel reuses the **Decision Canvas two-layer pattern** already shipped for WWMD explainability (operator-safe default + collapsed audit drawer):

- **Plain user view** (always visible): "Assured: stronger model, deeper review, higher projected cost."
- **Operator detail** (collapsed disclosure): exact `budgetClass`, `reasoningDepth`, `effort`, tier floor, verification depth, retry/orchestration budget, deliberation pattern, model candidates, and policy overrides.

Tiering rule: the plain view never shows schema identifiers or enum literals. The operator-detail view may show raw field names but pairs each with a human gloss (e.g. `reasoningDepth: high` → "Reasoning effort: high") and renders missing values as "default" / "not set", never raw `null`. The two-layer split preserves trust without making every user read infrastructure, and reuses a gate-passing component family rather than a parallel one.

Surface-level copy rules:

- Use posture verbs and outcomes ("check more", "spend less", "finish sooner") before platform nouns.
- Every numeric projection carries units and confidence state ("estimate unavailable", "based on 12 comparable runs", "policy floor applied").
- Every override callout states who/what overrode the posture: task floor, residency, sensitivity, provider health, budget cap, or human approval requirement.
- Receipt links use the same label everywhere: "View receipt". Do not alternate with "trace", "route log", "audit", or "details" unless the page title clarifies the deeper artifact.

---

## 12. Risks and Issues

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Illusion of control | A nice triangle can hide opaque routing choices. | Always show decoded policy and actual receipt, **and surface the delta**: a plain-language callout whenever hard policy/fail-closed changed the posture, or actual cost/latency/outcome diverged from the projection. |
| Premature UI exposure | Shipping the selector before receipts trains users to trust a promise the system cannot prove. | Feature-flag UI exposure until Slice 3 receipt joins exist; Slice 2 can be internally demoed but not placed in non-operator workflows. |
| Visual overreach | The triangle metaphor can dominate the page and make a serious governance control feel like a toy. | Presets, decoded summary, and receipt/projection stay first; triangle is opt-in fine-tune and read-only on narrow/touch-heavy layouts. |
| Duplicate substrate | A new model registry or ledger would fork routing truth. | Reuse `ModelProfile`, route telemetry, token ledgers, and the deliberation engine first. |
| Quality theater | Users may equate "more expensive" with "correct." | Separate intended assurance from realized quality and verification. |
| Frugal under-serving | A non-expert can pick "cheap" on a task where the cheap route is materially less correct, then trust the result. | Hard task floors (`minimumTier`) clamp Frugal; the decode panel states when Frugal was raised by a floor; realized-quality monitoring auto-raises the Frugal floor for a task class whose verification-pass rate falls below threshold. |
| Authority confusion | Mark/we/I can blur platform, customer, and user scopes. | WWMD/WWWD/WSID/per-decision scope records, profile versions, and the §5 non-inherit boundary. |
| Per-call control creep | An orchestration budget nudged mid-phase re-introduces per-call approvals. | Posture/orchestration-budget changes are phase-boundary decisions; production-affecting changes present a card regardless (`human-in-the-loop-at-phase-boundaries`). |
| Posture/realization gap from failover | Assured can silently run on a weaker backup model. | Receipt distinguishes infra-failover from policy-override; realized quality (not requested posture) drives learning. |
| Feedback sparsity | Few verdicts can miscalibrate defaults. | Blend verdicts with verification, acceptance, retry, and rework signals. |
| Default quietly under-serving | A scope default can serve badly without an alarm. | A guardrail monitor compares each default's realized-quality distribution against a floor; a drifting default raises a `PlatformIssueReport` and reverts toward Balanced pending review. |
| Hive privacy leakage | Rare task/model/time combinations can identify work even without text. | Metadata minimization, coarse buckets, thresholds, opt-in preview. |
| Hive poisoning & gaming | Bad or strategically self-interested installs can skew defaults. | Reputation weighting, outlier suppression, delayed trust, and incentive-alignment down-weighting (§10). |
| Cost incompleteness | Token cost is not the whole cost: reviewer labor, latency, subscriptions, rate limits. | Start with tokens, then add capacity/rate-limit and review-cost accounting. |
| Accessibility gap | A drag-only 2D control excludes keyboard/screen-reader users. | Presets + numeric are the canonical control; the triangle is an enhancement (§6). |
| APG mismatch | A bespoke radio/drag implementation can look accessible while violating keyboard/name/role/value semantics. | Prefer native radio and number inputs; if using custom roles, test against APG radio-group/spinbutton behavior plus screen-reader announcements. |
| Calibration drift | Learned defaults can slowly optimize for easy-to-measure cost/latency and underweight correctness. | Guardrail monitors compare realized quality against task floors; calibration changes require receipt-backed before/after evidence and revert path. |
| Silent policy override | Hard constraints may change the posture invisibly. | Explain adjustments inline and in receipts (the delta callout). |

---

## 13. Build Order

v1 implements WWMD and WWWD/org scopes only; WSID/profession and per-decision-override-for-all-roles are deferred (§15 Q5).

### Slice 0: Substrate Audit and Refactor Budget

**Status: COMPLETE** — see the companion delta [`golden-triangle-slice0-substrate-audit.md`](golden-triangle-slice0-substrate-audit.md). Resolved outcomes are marked ✓ below; the unmarked bullets remain the standing checklist for the implementing epic.

Use the refactor budget here. This is not cosmetic cleanup; it is the architectural work that prevents the feature from creating duplicate truth. The practical allocation is **~80% substrate refactor and integration / ~20% new feature** (founder direction, 2026-08-23, inverting the earlier 80/20 split). The platform's parts now largely exist, so its marginal value is in hybridizing them rather than adding more surface: prefer absorbing a capability into the existing spine over standing a new subsystem beside it, and justify any case where that is not possible.

- Verify exact existing fields and gaps across `ModelProfile`, `AgentModelConfig`, `RequestContract`, `TaskRequirement`, the `effort` lever, the deliberation engine, route receipts, telemetry, and decision records.
- Normalize names and type boundaries around preference snapshot, decoded policy, orchestration budget, receipt view, and feedback verdict before adding UI.
- Map each triangle axis to its `PRINCIPLE_DIMENSIONS` member(s) and commit a measured UX-fit manifest (`docs/ux-fit/<date>-<slug>.ux-fit.json`; AGENTS.md §12 — mandatory, CI-enforced). The attestation trailer is retired (BI-D967DEE0); `human_cognitive_load` now has carrying principles, so its `principle_decide` score is no longer degenerate (§0.1).
- **✓ Saved-defaults home found.** `DecisionInteraction.profileId` → `DecisionPerspectiveProfile` (org/principal-scoped, versioned, already carries `autonomyPolicy`). **Extend it** with a typed `goldenTriangle` field; do not add a new `DecisionPreferenceProfile` table (resolves Open Decision 1).
- Confirm whether benchmark records should be materialized or initially projected as a read model; align the shape to GearInterface.
- **✓ Orchestration-budget go/no-go — GO.** Confirmed no posture-driven orchestration budget exists today (`agentic-loop.ts` uses the `MAX_ITERATIONS = 200` *safety* ceiling plus phase-aware `MAX_DURATION_*`, a spin guard, a one-nudge cap, and a repetition detector — none posture-driven). Resolution: the orchestration budget (duration ceiling, retry budget, verification depth, deliberation pattern) is a **typed object persisted as JSON on the receipt / `DecisionInteraction.outcomePayload` path** — not columns on `AgentModelConfig` (a per-agent floor) and not a new table; it biases the existing governors. Caveat: `verificationDepth` has no consuming governor yet, so a `deep` value is inert until a verify step is wired. Slices 2–3 build on this shape.
- Define stable TypeScript types for the posture override and orchestration budget.
- Delete or avoid any provisional `ModelRegistryEntry`, detached `TrianglePosition`, page-local status-color map, or route-local model picker that appears during prototyping.

Exit criterion: a one-page substrate delta naming every schema addition, every reused table, and the orchestration-budget go/no-go.

### Slice 1: Pure Policy Compiler

Build `compileGoldenTrianglePolicy()` as a pure, tested function:

- input: preference vector, task class, authority scope, policy constraints, model availability summary
- output: posture override (for `inferContract`), orchestration budget, policy adjustments, explanation, and blocked/defer state

No UI and no database writes until the compiler is deterministic and covered by unit tests — including the composition with `inferContract()` (posture override in → final contract out) and the conflict case where a task's `budgetClassDefault` disagrees with the requested posture.

### Slice 2: Accessible Canonical Component

Build the reusable component **presets-and-numeric-first**, triangle layered on (depends on the Slice 0 orchestration-budget decision):

- preset selector (default path) + three numeric/keyboard inputs (canonical accessible control)
- triangle as a layered visualization + opt-in fine-tune
- decode panel (plain + operator-detail disclosure), reusing the Decision Canvas audit-drawer pattern
- empty / projecting / policy-clamped / fail-closed states
- mobile layout (presets + numeric primary; triangle read-only)
- keyboard and screen-reader support per the §6 contract

Slice 2 may be built in isolation but must not be exposed to non-operator users until Slice 3 receipts are live (avoids shipping a control without proof — the illusion-of-control risk).

### Slice 3: Receipt and Telemetry Join

Wire a real run: preference snapshot → decoded policy → route decision → model attempt → token/cost/latency telemetry → feedback, all under one correlation id.

### Slice 4: WWMD Default Editor

Ship the first saved profile under WWMD/platform scope (admin/operator-facing). Shipping WWMD first is an implementation-order choice (DPF dogfoods on itself), not an authority claim — the WWMD default must never become the silent baseline a customer's WWWD posture inherits (§5).

### Slice 5: Project and Org Defaults

Add WWWD/org and per-product defaults once the WWMD path proves stable.

### Slice 6: Learned Defaults & Posture Descent

Recommend, then (with human approval) auto-adopt, a learned posture per task class when realized quality is stable across N runs; always keep an exception path so a divergent intent re-raises the human decision. This is the triangle migrating its own load down per the prime directive (§9).

### Slice 7: Hive Contribution

Only after local/project learning is useful and the privacy contract is implemented.

---

## 14. Acceptance Criteria

The design is ready for implementation when:

- The spec no longer proposes a v1 `ModelRegistryEntry`.
- Every decoded policy field maps to an existing field or a named new field.
- The compiler has deterministic examples for Fast, Frugal, Assured, Balanced, and at least three custom positions (§7).
- Tests cover the composition of triangle output with `inferContract()`, including the conflict case.
- A fresh install at Balanced produces byte-identical routing to the same install with the feature flag off.
- Hard policies can override the triangle and produce an explanation.
- A keyboard-only user can reach any posture **and** read the decoded policy; a screen-reader user hears the decoded outcome (not just raw weights) on every change; the control passes the UX-Accessibility audit (semantic HTML, 44px targets, WCAG 2.2 AA contrast, no color-only encoding, reduced motion).
- Reporting/data-display UI composes report-kit primitives; no hand-rolled badge/table/chart/status-color map.
- Every surface defines empty (no history), projecting (no estimate), policy-clamped, and fail-closed states with an honest next action; no zero-filled dashboards.
- The UI shows both requested posture and actual receipt, with an explicit delta when they differ.
- A benchmark row/view joins intended posture to actual model/cost/outcome under one correlation id.
- Calibration is driven by realized-quality signals, not posture-selection frequency.
- Hive contribution has an explicit payload schema and exclusion list.
- Slice 0 commits a measured UX-fit manifest (`*.ux-fit.json`) and a substrate delta naming reused tables, new fields, rejected duplicate surfaces, and the refactor work completed or intentionally deferred.

### 14.1 Success Metrics (does the shipped feature work?)

Measured against a control cohort with the triangle off. Initial launch guardrails below are product targets to validate or recalibrate after Slice 0 baseline data:

- **Posture fidelity:** ≥ 95% of governed runs have actual route/effort/verification matching the decoded policy, excluding explicitly labeled provider outages and hard-policy overrides.
- **Cost-posture correlation:** On matched task classes, Frugal median token/provider cost is at least 20% below Balanced, and Assured is above Balanced only where it buys additional effort/review/verification. Predicted-vs-actual cost drift stays within 25% after the first 30 comparable runs per task class.
- **No silent under-serve:** Assured realized quality (verification pass + acceptance, not satisfaction) is at least Balanced; Frugal shows no more than a 5 percentage-point verification-pass drop versus Balanced on tasks where Frugal is allowed by policy.
- **Override transparency:** 100% of policy-overridden runs surface an explanation (zero silent overrides).
- **Accessibility completion:** keyboard-only and screen-reader test scripts complete preset selection, numeric fine-tune, policy preview, and receipt review with zero blocker issues.
- **Adoption without confusion:** triangle-set runs show no elevated rework/retry versus defaults after controlling for task class; if rework rises by more than 5 percentage points, revert exposure to operator-only while copy and defaults are corrected.

---

## 15. Open Decisions

1. Should the saved default table be new (`DecisionPreferenceProfile`) or an extension of the profile referenced by `DecisionInteraction.profileId`?
2. Is the existing `taskType` / `TaskRequirement` taxonomy sufficient for benchmarking, or do we need a separate task-class taxonomy?
3. Should "cost" v1 mean token/provider cost only, or include review labor and rate-limit capacity from day one?
4. Should per-decision overrides be available to all users, or only roles with specific tool/authority grants? (Deferred past v1.)
5. How should the TAK draft standard finalize names and validation for the provisional preference snapshot, decoded policy, receipt view, and feedback objects (§8)?
6. What is the minimum cohort size before hive-derived defaults can influence a local install?
7. Should the orchestration budget (loop/duration ceiling, retry budget, verification depth) be a new per-decision field or an extension of `AgentModelConfig`/workflow policy? (Perspective count is *not* part of this — it maps to deliberation pattern selection. Resolve the narrower question in Slice 0.)
8. Should the triangle's preset defaults be expressed as a stored `principle_decide` input (option set + dimension vector) so default-tuning is auditable through the existing decision ledger, rather than as hardcoded weights?
9. Should the triangle receipt *be* a GearInterface Ring 1↔2 emission (dual-emit) rather than a standalone benchmark table, so one record feeds the Cockpit, Calibrator, and hive trust transport? (Resolve in Slice 0 against the Gear spec's Phase-0 status.)

Resolved for v0.3.1: routing-shaped fields go through `inferContract`; loop/verification/perspective fields are workflow-layer (§5). This is no longer an open decision.

Resolved for v0.3.2 (Slice 0 substrate audit, [`golden-triangle-slice0-substrate-audit.md`](golden-triangle-slice0-substrate-audit.md)):
- **Q1 (saved-default table)** → **extend** `DecisionPerspectiveProfile` (reached via `DecisionInteraction.profileId`; versioned + scoped); do not add `DecisionPreferenceProfile`.
- **Q7 (orchestration-budget home)** → a **typed JSON object on the receipt / `DecisionInteraction.outcomePayload` path**, not `AgentModelConfig` and not a new table; it biases the existing loop governors. `verificationDepth` is defined but inert until a verify step is wired.
- New schema is minimal: predicted-cost columns (no drift capture exists today) + one propagated correlation id across the receipt chain (`RouteOutcome`/`TokenUsage`/`AdapterRunTelemetry`/`DecisionInteraction`).

---

## 16. Prototype Guidance

Build a prototype only after Slice 0 and Slice 1. The prototype should demonstrate:

- the preset selector (default path) and the numeric/keyboard inputs (canonical accessible control)
- the triangle as a layered visualization + opt-in fine-tune over that control
- live decoded policy (plain + operator-detail disclosure)
- policy-override and predicted-vs-actual delta callouts
- empty / projecting / fail-closed states
- 3-state feedback capture
- receipt display for the selected route, reusing the Decision Canvas audit-drawer pattern

The prototype must not influence production routing until receipt and telemetry joins (Slice 3) are wired.

---

## 17. Final Design Principle

The Golden Triangle earns trust only when the user can answer four questions:

1. What did I ask the agent system to optimize for?
2. What did the platform actually configure because of that?
3. What did it actually run and cost?
4. Did the result work?

If any one of those is missing, the feature is decoration. If all four are present, it becomes a real trusted-agent control — and a unit of the platform's load-migration machine: the human keeps the one irreducible judgment (the posture), and the platform carries the rest.
