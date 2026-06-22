# Golden Triangle Decision Primitive

**Cost | Quality | Time as a governed preference-to-policy compiler for trusted AI agents**

*Design review draft v0.3 - 2026-06-21*

> **v0.3 changelog.** Integrates a multi-thread review (UX/accessibility, ethos/culture fit, strategy/completeness) plus a competitive-benchmarking pass. Headline changes: **presets are the primary control** (the triangle becomes a fine-tune visualization); a corrected **2-degrees-of-freedom accessibility contract** (a 2D control is not the WAI-ARIA *slider* pattern); the triangle is framed as **cognitive-load migration** and connected to the **kernel principle system**; and three factual corrections to the v0.2 control-layers analysis — the `effort` lever already exists end-to-end, perspective/review count's home is the **deliberation engine**, and `MAX_ITERATIONS` is a *safety ceiling*, not the dominant cost lever. Adds cold-start defaults, the composition point with `inferContract()`, and success metrics.

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
- **AGENTS.md gates.** This is an operator-configurable control, so it must carry a `UX-Fit-Decision:` attestation scoring `human_cognitive_load` via `principle_decide` (UX-Fit Gate, CI-enforced by `scripts/check-ux-fit-decision.mjs`), and pass the Spec/Plan/Doc gate.

Candidate principle: the cognitive-load migration audit flags `migrate-to-the-right-tier` as a not-yet-existing kernel principle. The triangle's learned-default arc (§9) is a concrete proving ground for promoting it.

---

## 1. Research and Benchmarking

### External Precedent

The Golden Triangle borrows the executive clarity of the classic project-management triangle: time, cost, and quality/scope interact, and pressure on one dimension affects the others. PMI's own discussion of the triple constraint is useful precisely because it warns against treating the model as a deterministic formula. That supports DPF's design choice: use the triangle as an intent surface, not as literal optimization math.

Trusted AI precedent points in the same direction. NIST AI RMF frames trustworthy AI as governed, measured, and managed over time. For DPF, that means every triangle-driven action needs a policy record, telemetry, and a feedback path; a visual knob is not trust by itself.

Observability precedent also matters. OpenTelemetry's trace/metric/log model emphasizes correlated context across telemetry signals. DPF should follow that pattern: the preference snapshot, route decision, model attempt, token cost, feedback verdict, and benchmark record share a single correlation identifier (the route receipt id; §8).

Accessibility precedent is non-negotiable — **but the WAI-ARIA *slider* pattern is one-dimensional and does not cover a 2D point control.** Because the posture selector exposes two degrees of freedom, its accessible foundation is the **preset list (a `radiogroup` of real buttons) plus three labeled numeric spinbuttons**, with the triangle layered on top as an enhancement (§6). The numeric/preset layer — not the drag surface — is the canonical accessible control.

External references:

- PMI, [The Triple Constraint](https://www.pmi.org/learning/library/triple-constraint-erroneous-useless-value-8024)
- NIST, [AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- OpenTelemetry, [Overview](https://opentelemetry.io/docs/specs/otel/overview/)
- W3C WAI-ARIA APG, [Slider Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/) (one-dimensional; see §6 for the 2-DOF contract)

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

- **Layer 1 (default, primary): four preset cards** — Fast, Frugal, Assured, Balanced — each a real `<button>` showing the preset name and a one-line plain-language effect. Most users stop here; selecting a preset is one click or keypress.
- **Layer 2 (opt-in fine-tune): a triangle visualization** that plots the active posture as a labeled point and, once "Fine-tune" is engaged, lets the user nudge the point between presets. The triangle is a *view of* and *adjustment to* the posture, not the only input. Because the weighting is soft and non-zero-sum (Decision 2), the triangle must communicate that vertices are *emphasis*, not a fixed budget being divided — show each axis's resulting bias as a labeled fill/scale, not only as distance from a vertex.

The UI always shows: active preset name, the plain decoded summary, the projected cost/latency envelope when available, and whether hard policy changed the requested posture.

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

1. **Default:** four preset buttons + the active preset's one-line decoded summary. Usable on the first screen with one click.
2. **Fine-tune (on demand):** a toggle reveals the triangle and three numeric weight steppers for users who want a posture between presets.
3. **Operator detail (on demand):** a "Show what this configured" disclosure reveals the exact `budgetClass`, `reasoningDepth`, `effort`, tier floor, verification depth, retry/orchestration budget, deliberation pattern, model candidates, and any policy override.

The plain decoded summary and the receipt link are always visible; everything else is revealed, not defaulted.

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

- **Roles & structure.** Presets render as a `role="radiogroup"` of real `<button role="radio" aria-checked>` controls (one is always the active posture). The three weights render as `<input type="number">` spinbuttons (Cost %, Quality %, Time %) with visible `<label>`s; together they reproduce any posture. The triangle, if interactive, is a focusable thumb with `aria-roledescription="priority area"` whose accessible name reports all three weights and the active preset — **never** the only path to a value.
- **Keyboard model (two axes, explicit).** With a preset focused: Arrow keys move between presets; Enter/Space selects. With the triangle thumb focused (fine-tune only): Left/Right adjust the Cost↔Time balance, Up/Down adjust toward/away from Quality, in fixed steps (e.g. 5%); Home returns to Balanced; PageUp/PageDown jump to the nearest preset; step size and current axis are announced. The three spinbuttons are independently Tab-reachable; editing one re-normalizes the others and announces the change.
- **Screen-reader announcements.** On any change, announce the **decoded outcome**, not just raw weights, via an `aria-live="polite"` region: e.g. "Assured posture. Cost 20%, Quality 55%, Time 25%. Decoded: stronger model, deeper review, higher projected cost." When hard policy alters the request, the live region announces the adjustment.
- **No color-only encoding** (WCAG 1.4.1): every axis and the active preset are conveyed by text/label/position, never hue alone.
- **Reduced motion.** Honor `prefers-reduced-motion` locally (drag-trail/snap animation disabled); do not assume a platform-wide primitive exists.
- **Touch & target size.** Preset buttons, steppers, and the thumb meet the DPF 44px minimum hit area.
- **Semantic HTML & focus.** Real `<button>`/`<input>`/`<fieldset>`/`<legend>`; no `<div onClick>`. Use the platform `:focus-visible` token, do not redefine it.

### Empty, projecting, and failure states

- **No projection yet:** when a cost/latency envelope is unavailable, show "No estimate yet — appears after the first runs"; never a fabricated or zero estimate.
- **Cold start (no history):** the evidence view and calibration panels show an honest empty state ("No runs recorded yet"), not zero-filled KPIs. The decode panel labels the state: "Using platform defaults — no learning history yet" (§7.x).
- **Fail-closed (no valid route):** render §7's fail-closed behavior as a designed screen — explain the conflict in plain language, list nearest valid alternatives, offer the escalation action if one exists, otherwise a clear "deferred, no governed path" message. Not an error toast.
- **Policy-clamped / downgraded:** show the requested posture and the actual posture side by side with the reason, distinguishing a *policy override* from an *infrastructure failover* (a preferred provider failing over to a backup is not the triangle ignoring the user).

### Design-system constraints

- Use DPF theme tokens (`--dpf-*`); the surface is quiet and operational, not a marketing hero.
- **Compose reporting/data-display UI from the shared report-kit** (`apps/web/components/ui/report-kit/`): `StatusBadge`, `StatCard`, `DataTable`, `FilterBar`, `Chart`. Do not hand-roll badges, tables, KPI tiles, status-color maps, or charts (kernel principle `compose-report-kit-for-reporting-ux`). Status/severity colors resolve through `statusColors.ts` (status → intent → token), never a page-local hex.
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

1. New org/user default preset = **Balanced**, which compiles to **no deltas**: the decoded policy equals what `inferContract()` already produces from `TaskRequirement` (`budgetClassDefault`, `reasoningDepthDefault`, `minimumTier`). Balanced is a pass-through, not a competing default.
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

### Representative Compile Table

| User posture | Decoded intent | Compiler behavior |
| --- | --- | --- |
| Assured | "Get this right." | `quality_first`, high `effort`/reasoning, stronger tier floor, more context, multi-branch deliberation, deep verification, generous retry, explicit receipt. Cost and time may rise. |
| Fast | "I need this now." | Lower latency target, minimal/low `effort` when safe, single pass, shallow verification, tight retries, fastest eligible endpoint. May reduce assurance. |
| Frugal | "Spend carefully." | `minimize_cost`, smallest capable model, low `effort`, tighter token/context and loop/duration budget, single deliberation branch, avoid frontier unless policy requires it. May increase time. |
| Balanced | "Use the sensible default." | Pass-through: existing task-requirement and agent defaults, modest review/verification (no deltas — see Cold-start). |
| Custom: cost 0.6 / quality 0.3 / time 0.1 | "Mostly cheap, some care." | `minimize_cost`, low `effort`, shallow verification, single deliberation branch, retry ≤ 1, mid tier-floor. |
| Custom: cost 0.2 / quality 0.6 / time 0.2 | "Mostly right, watch spend." | `quality_first`, high `effort`, deep verification, 2-branch deliberation, retry ≤ 2, strong tier-floor — but capped token/context budget. |

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

---

## 12. Risks and Issues

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Illusion of control | A nice triangle can hide opaque routing choices. | Always show decoded policy and actual receipt, **and surface the delta**: a plain-language callout whenever hard policy/fail-closed changed the posture, or actual cost/latency/outcome diverged from the projection. |
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
| Silent policy override | Hard constraints may change the posture invisibly. | Explain adjustments inline and in receipts (the delta callout). |

---

## 13. Build Order

v1 implements WWMD and WWWD/org scopes only; WSID/profession and per-decision-override-for-all-roles are deferred (§15 Q5).

### Slice 0: Substrate Audit and Refactor Budget

Use the requested 20 percent refactor budget here.

- Verify exact existing fields and gaps across `ModelProfile`, `AgentModelConfig`, `RequestContract`, `TaskRequirement`, the `effort` lever, the deliberation engine, route receipts, telemetry, and decision records.
- Map each triangle axis to its `PRINCIPLE_DIMENSIONS` member(s) and record a `UX-Fit-Decision:` attestation scoring the control on `human_cognitive_load` via `principle_decide` (AGENTS.md §12 — mandatory, CI-enforced).
- Audit the profile referenced by `DecisionInteraction.profileId` before adding any saved-defaults table.
- Confirm whether benchmark records should be materialized or initially projected as a read model; align the shape to GearInterface.
- **Go/no-go on the orchestration-budget surface.** Confirm there is no *posture-driven* orchestration budget today (`agentic-loop.ts` bounds runs with the `MAX_ITERATIONS = 200` safety ceiling, phase-aware `MAX_DURATION_*` limits, a spin guard, a one-nudge cap, and a repetition detector — none driven by posture). Decide whether the orchestration budget (duration ceiling, retry budget, verification depth, deliberation pattern) is a new per-decision field or an extension of `AgentModelConfig`/workflow policy. Slices 2–3 depend on this.
- Define stable TypeScript types for the posture override and orchestration budget.

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

### 14.1 Success Metrics (does the shipped feature work?)

Measured against a control cohort with the triangle off:

- **Posture fidelity:** ≥ X% of runs where the realized route/effort matches the requested posture's decoded policy (from receipts).
- **Cost-posture correlation:** Frugal runs show statistically lower median cost than Balanced, Assured higher, on matched task classes (predicted-vs-actual drift within Y%).
- **No silent under-serve:** Assured realized quality (verification pass + acceptance, not satisfaction) ≥ Balanced; Frugal shows no more than Z% drop in verification pass vs Balanced.
- **Override transparency:** 100% of policy-overridden runs surface an explanation (zero silent overrides).
- **Adoption without confusion:** triangle-set runs show no elevated rework/retry vs defaults (guards against illusion-of-control degrading outcomes).

---

## 15. Open Decisions

1. Should the saved default table be new (`DecisionPreferenceProfile`) or an extension of the profile referenced by `DecisionInteraction.profileId`?
2. Is the existing `taskType` / `TaskRequirement` taxonomy sufficient for benchmarking, or do we need a separate task-class taxonomy?
3. Should "cost" v1 mean token/provider cost only, or include review labor and rate-limit capacity from day one?
4. *(Resolved — see §5 "Composition point with `inferContract()`": routing-shaped fields go through `inferContract`; loop/verification/perspective fields are workflow-layer.)*
5. Should per-decision overrides be available to all users, or only roles with specific tool/authority grants? (Deferred past v1.)
6. How should the TAK draft standard name and validate the preference snapshot, decoded policy, receipt, and feedback objects?
7. What is the minimum cohort size before hive-derived defaults can influence a local install?
8. Should the orchestration budget (loop/duration ceiling, retry budget, verification depth) be a new per-decision field or an extension of `AgentModelConfig`/workflow policy? (Perspective count is *not* part of this — it maps to deliberation pattern selection. Resolve the narrower question in Slice 0.)
9. Should the triangle's preset defaults be expressed as a stored `principle_decide` input (option set + dimension vector) so default-tuning is auditable through the existing decision ledger, rather than as hardcoded weights?
10. Should the triangle receipt *be* a GearInterface Ring 1↔2 emission (dual-emit) rather than a standalone benchmark table, so one record feeds the Cockpit, Calibrator, and hive trust transport? (Resolve in Slice 0 against the Gear spec's Phase-0 status.)

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
