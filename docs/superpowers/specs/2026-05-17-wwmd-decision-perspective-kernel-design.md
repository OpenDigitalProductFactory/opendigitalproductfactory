# WWMD Decision Perspective Kernel Design

> **Amended 2026-07-23** by [`2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`](2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md).
> The kernel assumed a single authoring tier. Tier-scoped axis ownership is added there: this registry is retained as the **spine**, not as the total vector space.

| Field | Value |
| --- | --- |
| Date | 2026-05-17 |
| Status | Draft for review |
| Working title | WWMD / WWWD Decision Perspective Kernel |
| Primary v1 surface | Build Studio |
| Related epics | `EP-COWORKER-RT`, `EP-TAK-3F9A21`, `EP-PRINCIPLES`, `EP-BUILD-STUDIO`, `EP-BUILD-65837F` |
| Related docs | `2026-05-11-autonomous-coworker-runtime-design.md`, `2026-05-14-coworker-memory-shape-contracts-design.md`, `2026-05-12-principles-as-wiki-kind-design.md`, `2026-04-21-deliberation-pattern-framework-design.md`, `2026-04-30-ai-coworker-operator-pattern.md` |

## 1. Purpose

WWMD means "What Would Mark Do." In this DPF portal instance it is also the seed of WWWD, "What Would We Do," because the business and the product are the portal itself. The first profile is therefore a Mark-aligned DPF platform decision kernel.

For future customers, WWMD and WWWD must separate. Mark's platform doctrine may remain product-origin guidance, but each customer organization needs its own evolving WWWD profile from its leaders, articles, decisions, corrections, approvals, and rationales.

The feature is not a personality chatbot and not an imitation layer. It is a governed decision perspective service for ambiguous questions, next-step direction, constructive conflict, A2A/debate impasses, and approval gates. Its job is to help the platform move toward autonomy while keeping accountability, evidence, and confidence visible.

## 2. Product Thesis

WWMD/WWWD should let the portal answer questions like:

- What direction best fits the platform's established doctrine?
- Which option would Mark likely choose for the DPF product, and why?
- Which disagreement needs human leadership instead of forced consensus?
- Which decision has enough source-backed confidence to proceed?
- Which ambiguity should become durable future guidance after a human answer?

The core operating principle is:

> Confidence is earned in drops and lost in buckets.

The system must promote autonomy slowly through repeated evidence-backed alignment, and demote confidence quickly after misses, stale sources, contradicted rationale, or overconfident recommendations.

## 3. Scope and Identity

V1 introduces a reusable `Decision Perspective Profile`.

Initial profiles:

| Profile | Owner | Scope | Role |
| --- | --- | --- | --- |
| `Mark / DPF Platform` | DPF | Platform/product direction for this portal instance | V1 WWMD kernel |
| `DPF Organization` | DPF | The operating business behind this portal instance | Initially points to the Mark/DPF platform kernel because this product is the business |
| Future customer WWWD profile | Customer organization | Customer business decisions and operating preferences | Deferred, isolated from Mark-specific doctrine |

**Non-negotiable boundary:** a customer profile must not inherit Mark-specific business judgment as authority by default. DPF product doctrine can be advisory product guidance; the customer's own WWWD profile becomes authoritative for its business context once it exists.

### 3.1 Profile Inheritance Chain

Every profile operates within a fallback chain for coverage gaps. When the active profile lacks sufficient material to address a question domain, resolution proceeds in order:

1. Active profile (WWWD / customer-specific)
2. DPF product doctrine (general platform principles)
3. DPF organizational principles (TAK/GAID governance layer)
4. `defer` — insufficient coverage to frame even a recommended direction; capture as a profile gap

This chain must be supported in the data model from day one. Retrofitting a fallback chain after v1 ships requires schema changes that affect every decision interaction record.

## 4. Research and Benchmarking

The design adopts patterns from current agent-memory, HITL, governance, and deliberation systems while staying inside DPF's TAK/GAID architecture.

| Reference | Pattern to adopt | Pattern to reject |
| --- | --- | --- |
| [LangGraph memory](https://docs.langchain.com/oss/python/langgraph/memory) | Separate short-term thread state from durable memory. | Do not migrate DPF orchestration just for memory terminology; DPF already has `TaskRun`, `AgentThread`, and `PhaseHandoff`. |
| [Letta memory blocks](https://docs.letta.com/guides/core-concepts/memory/memory-blocks/) | Use named memory blocks with explicit descriptions and read/write intent. | Do not let coworkers silently self-edit authoritative doctrine. |
| [OpenAI Agents SDK HITL](https://openai.github.io/openai-agents-python/human_in_the_loop/) | Treat human approval as an explicit interrupt/resume flow. | Do not make approval an informal chat exchange with no durable state. |
| [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10) | Govern, map, measure, and manage AI risk with traceable risk context. | Do not treat "autonomy" as a single global switch. |
| [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) | Use least privilege, HITL for high-risk actions, monitoring, and memory/context controls. | Do not rely on prompt intent as the control boundary. |
| [A2A Task model](https://agent2agent.info/docs/concepts/task/) | Preserve task state, history, and artifacts as work identity. | Do not use raw conversation history as the only coordination record. |
| LLM council / deliberation patterns | Preserve competing views before synthesis. | Do not force synthetic consensus or hide unresolved objections. |
| Anthropic Constitutional AI (2026) | Principle-based reasoning hierarchy over hard-coded rules. | Do not adopt vendor-defined constitutions; customers define their own. |

### 4.1 Market Positioning

A May 2026 landscape sweep across Microsoft Copilot Studio, Salesforce Agentforce, IBM watsonx Orchestrate, Google Enterprise Agent Platform, and ServiceNow reveals a consistent gap: **no commercial platform ships a governed decision perspective service with confidence tracking, deliberation integration, and principle traceability.**

The dominant commercial pattern is three-layer architecture (orchestration / reasoning engine / grounding layer) with rule-based governance toolkits bolted on for compliance. Microsoft's April 2026 Agent Governance Toolkit is representative: it blocks bad actions at runtime but does not encode, version, or trace which organizational principles governed a specific recommendation.

Anthropic's Constitutional AI is the closest published conceptual analog, but it is a model-level compliance layer applied by the vendor — not a customer-controlled doctrine profile that evolves, is versioned, and produces an auditable decision ledger per invocation.

**DPF's differentiated position:**

| Capability | Commercial market | DPF WWMD/WWWD |
| --- | --- | --- |
| Principle traceability (decision → governing principle) | Absent | Core feature |
| Confidence as a governed runtime state | Absent (model confidence only) | Earned/demoted across interactions |
| Profile versioning (which doctrine was active at decision X) | Audit log only | Version-snapshotted decision context |
| Deliberation-first architecture before recommendation | Bolted-on review | Integrated into gate |
| Customer-controlled principle definition and versioning | Vendor-defined or absent | First-class customer capability |
| Principle contradiction resolution | None | Weighted vector aggregation (§5.7) |

The white space is real. DPF's differentiator is that the decision perspective is not just a retrieved corpus. It is a governed operating profile with evidence, confidence, escalation, audit, and autonomy behavior — and the customer owns it.

## 5. Design Pillars

### 5.1 Decision Perspective Profiles

A profile names the decision perspective, owner, scope, source materials, confidence state, autonomy policy, and escalation route. V1 uses `Mark / DPF Platform` as the seed profile.

### 5.2 WWMD Now, WWWD Later

For this DPF install, WWMD and WWWD overlap because the product is the portal. Future customers get their own WWWD profiles. That future support must be designed now through explicit profile ownership, scope boundaries, and the fallback chain in §3.1. Business-archetype-specific behavior is not a v1 goal.

### 5.3 Confidence Earned Slowly, Lost Quickly

Confidence is an operating state derived from source quality, pattern history, context fit, risk tier, and outcome feedback. Text volume does not create confidence.

Autonomy levels:

| Level | Behavior |
| --- | --- |
| Low confidence | Ask or escalate to a human. Capture answer, criteria, and rationale. |
| Medium confidence | Recommend with evidence, trade-offs, and required approval. |
| High confidence, low risk | Arbitrate and continue, with a decision record. |
| High confidence, high risk | Escalate or require approval anyway. |

Numeric thresholds for each confidence band and the mapping to outcome type are defined in the implementation plan's confidence formula. V1 uses rule-based scoring derived from material freshness, evidence grade, risk tier, and recent override history. Model-assessed evidence fit is deferred to v2, once the decision ledger has enough real invocations to validate calibration against human corrections.

### 5.4 Temporal Decay and Contradiction Detection

Perspective material expires. A source that predates a confirmed decision reversal is actively harmful if weighted equally with current doctrine. The system must:

- Assign a `freshness` state to every piece of perspective material: `current`, `stale`, `superseded`, `contradicted`.
- Decay `freshness` on a schedule relative to material type (articles decay faster than confirmed decisions; principles decay slowest).
- Detect contradiction: when a newly promoted piece of material conflicts with an existing source in the same scope, surface the conflict for human resolution rather than silently averaging. The older source transitions to `superseded` or `contradicted` only on explicit human confirmation.
- Weight stale or superseded sources below their face confidence in all gate invocations. A `contradicted` source contributes zero weight and is flagged in the decision ledger.

This is not optional hygiene — it is how the profile avoids compounding errors as doctrine evolves.

### 5.5 Constructive Conflict

Coworkers can disagree, ask for approval, or raise objections. That is not a system failure. It is how real teams work.

WWMD should preserve competing views long enough to understand the trade-off, synthesize when confidence is sufficient, and escalate to the accountable human when the conflict is unresolved, high-risk, or outside the profile's scope.

Core rule: do not force consensus. Escalate real stalemates to the responsible human, then learn from the answer.

### 5.6 Evidence-Based Decisioning

WWMD must distinguish:

- facts with evidence
- interpretations of those facts
- Mark/organization preferences
- assumptions
- unknowns

Debate and synthesis outputs must cite evidence and label fuzzy memory as fuzzy memory. Unsupported claims cannot carry the same confidence as source-backed facts, confirmed decisions, or authoritative records.

V1 does not require the evaluator to classify evidence into these categories automatically. The distinction is operationalized through `PerspectiveMaterial.evidenceGrade` (A–D, where D contributes zero confidence weight) and `freshness` state. Automatic evidence-type classification is a v2 capability.

### 5.7 Principle Contradiction Resolution

When two active principles conflict on a specific question, the gate does not pick a winner by position order.

**V1 behavior:** detect the conflict, force `escalate`, and record `principleConflict: true` on the `DecisionInteraction`. The decision record identifies which principles are in tension and on which domain. The human resolution is captured via `EscalationCapture` and becomes candidate profile material. This gives the system real conflict data before any synthesis model is built.

**V2 target:** apply the weighted vector model established in `2026-05-12-principles-as-wiki-kind-design.md`, where each principle carries a direction, weight, and applicable dimensions. Contradictory principles on the same dimensions are resolved into a weighted net vector. If the net confidence is above threshold, the gate may recommend rather than escalate. The v1 conflict ledger provides the calibration data v2 needs.

Principle conflict is never hidden in either version.

### 5.8 Decision Service Discipline

The gate exists to keep teams moving, not to dominate decisions. It should:

- Clarify ambiguity and route the right human into the loop.
- Reduce repeated cognitive burden by converting human answers into durable future guidance.
- Produce a decision record whether it recommends, arbitrates, defers, or escalates.
- Never claim authority it was not given. The gate's output is a perspective and a record; governance authority remains with the human principal.

## 6. Runtime Flow

V1 starts in Build Studio.

1. Build Studio detects ambiguity at a phase gate, design debate, approval handoff, constructive-conflict event, or "what next?" decision.
2. The gate invokes the `Mark / DPF Platform` decision perspective profile.
3. The gate gathers relevant material: principles, prior specs/decisions, source-backed evidence, active build context, deliberation outputs, and relevant memory/facts. If a `DeliberationRun` is already in progress or recently completed for the current `TaskRun`, its `DeliberationOutcome` and `ClaimRecord` set are included in the evidence bundle as Grade A or B sources per the deliberation framework's evidence grading.
4. The gate returns one of four outcomes:

   | Outcome | Condition | Action |
   | --- | --- | --- |
   | `recommend` | Profile has sufficient coverage and confidence is medium or above | Propose a direction with evidence and confidence score |
   | `arbitrate` | High confidence + low risk | Decide and continue; write a decision record |
   | `escalate` | Low confidence, high risk, or unresolved conflict | Ask the accountable human; capture everything |
   | `defer` | Profile lacks coverage for this domain | Surface a profile gap; capture the question as candidate material; do not fabricate a recommendation |

5. Every invocation writes a decision interaction record with: question, context, options, sources, rationale, confidence before and after, risk tier, outcome type, profile version snapshot, and any human override.
6. If escalated, the human answer captures: answer, criteria, rationale, dissent or objections resolved, accountable person, and whether the rationale should become candidate future perspective material.
7. If deferred, the gap is surfaced in the Decision Ledger as a coverage hole, and the question is queued as candidate profile material for review.
8. Reviewed material can later be promoted into the profile. Material is never automatically doctrine because it was said once.

### 6.1 Deliberation Integration

The WWMD gate and the Deliberation Pattern Framework are complementary layers, not alternatives.

- **Deliberation runs before the WWMD gate** at higher risk tiers or when ambiguity is high. The deliberation framework (see `2026-04-21-deliberation-pattern-framework-design.md`) produces a `DeliberationOutcome` with `ClaimRecord`s and evidence bundles. The WWMD gate consumes this as structured input — it is not re-running the debate.
- **WWMD invokes deliberation on request**. If the gate detects that competing options need structured multi-perspective analysis it does not yet have, it can invoke `start_deliberation` before returning a `recommend` or `escalate`. This prevents the gate from fabricating synthesis from thin context.
- **Authority is unchanged**. Deliberation outputs carry no governance authority. The WWMD gate synthesizes them. The HITL checkpoint after the gate carries the final decision.

The integration seam: `DecisionInteraction.deliberationRunId String?` links the interaction record to the relevant `DeliberationRun` so the decision ledger can show exactly what deliberation evidence informed each gate invocation.

### 6.2 Proactive Profile Degradation

The system must not silently accumulate errors. After each human override, the system records: domain, question class, what the gate recommended versus what the human answered, and the confidence delta.

When a given domain or question class accumulates three or more overrides with a consistent correction pattern, the Decision Ledger surfaces a `profile-drift-alert` for operator review. The alert proposes candidate edits to the perspective material — it does not automatically update doctrine. Human confirmation is required before any profile material changes.

This closes the feedback loop: the profile is self-improving in the direction of observed corrections, but under deliberate human control.

## 7. Data Model Concepts

V1 should keep the model small and reuse existing DPF primitives where possible.

### 7.1 Decision Perspective Profile

The reusable profile boundary:

- profile id and display name
- owner principal / organization
- profile kind: `platform`, `organization`, `customer`, future `team`
- scope: routes, products, domains, risk bands
- fallback profile id (for inheritance chain per §3.1)
- default escalation owner or resolver rule
- autonomy policy
- confidence state by decision class
- current version id (FK to profile version snapshot)

### 7.2 Decision Perspective Profile Version

Every time profile material is promoted or revoked, a version snapshot is written. Decision interaction records link to the snapshot active at the time of the invocation, not the current profile state. This makes the decision ledger auditable even as the profile evolves.

- snapshot id
- profile id (FK)
- snapshot timestamp
- material fingerprint (hash of active sources)
- promoted-by (human principal or operator)
- change summary

### 7.3 Perspective Material

Source material for the profile:

- articles and public thought material
- DPF principles and specs
- prior decisions and approval rationales
- corrections and disagreements
- source-backed evidence and receipts
- manual leader guidance

Fields: source, source type, scope, `freshness` (`current` | `stale` | `superseded` | `contradicted`), staleness decay schedule, last-validated date, confidence weight, promotion state, profile version when promoted.

Evidence grade (`A` | `B` | `C` | `D`) maps to confidence multipliers: A = full weight, B = 0.75×, C = 0.4×, D = zero weight. Grade D material is retained in the profile for audit purposes but contributes nothing to a confidence score. `contradicted` freshness also carries zero weight regardless of grade.

### 7.4 Decision Interaction

Every WWMD/WWWD invocation:

- profile id
- **profile version snapshot id** (which doctrine was active at this moment)
- route/build/task context
- question and options
- deliberation run id (FK to `DeliberationRun`, nullable)
- evidence bundle
- outcome type (`recommend` | `arbitrate` | `escalate` | `defer`)
- recommendation/arbitration/escalation/deferral
- confidence before and after
- human outcome, if any
- links to `TaskRun`, deliberation run, `ToolExecution`, receipts, and Build Studio phase where applicable

### 7.5 Escalation Capture

When the gate escalates:

- who is accountable
- what decision was needed
- what answer was given
- criteria used
- rationale
- dissent or objections resolved
- whether the answer should become candidate profile material

### 7.6 Deferral Capture

When the gate defers:

- question domain (the coverage gap)
- why the profile lacked coverage (no material, contradicted material, material below confidence threshold)
- whether the question should become candidate perspective material
- suggested source types that would fill the gap

## 8. Existing DPF Primitives to Reuse

| Need | Existing primitive |
| --- | --- |
| Durable doctrine | `WikiPage` principles and founder kernel |
| Mark/DPF source corpus | founder-kernel raw sources, specs, articles, wiki ingest |
| Memory with freshness | `UserFact`, governed memory, semantic memory |
| Work identity | `TaskRun`, `TaskMessage`, `TaskArtifact` |
| Tool/audit evidence | `ToolExecution`, `ToolExecutionReceipt` |
| Constructive conflict | deliberation framework (`DeliberationRun`, `DeliberationOutcome`, `ClaimRecord`) |
| Build Studio gate | phase gates and `PhaseHandoff` |
| Decision support | `principle_decide`, `wiki_query`, `search_specs_and_plans`, backlog recommendation tools |
| Operator visibility | AI Operations Map and AI Workforce pages |

Schema additions required beyond these primitives: `DecisionPerspectiveProfile`, `DecisionPerspectiveProfileVersion`, `PerspectiveMaterial`, `DecisionInteraction`, `EscalationCapture`, `DeferralCapture`.

## 9. UI and Surfaces

### 9.1 Build Studio Gate Panel

First v1 surface. Appears at ambiguous phase gates, design debates, handoffs, and start/continue decisions.

Expected content:

- the ambiguity being resolved
- options considered
- WWMD recommendation, arbitration, escalation prompt, or deferral notice
- evidence and sources
- confidence and risk tier
- which profile version was active
- accountable human prompt if escalation is required
- profile gap notice and candidate material prompt if deferred

### 9.2 Decision Ledger / Inspector

Visibility surface for operators:

- recent WWMD invocations
- recommendation versus human outcome
- confidence changes
- source material used
- stalemates and escalations
- deferral coverage gaps
- profile-drift alerts (domains with consistent override patterns)
- candidate material awaiting review
- profile version history

### 9.3 General Runtime Gate

Later surface. Other coworkers can invoke the gate when ambiguity, constructive conflict, or approval uncertainty blocks progress.

### 9.4 Standalone Ask WWMD Surface

Lower-priority backlog item. It should feel similar to the current GPT experience, but it must use the same governed profile, source material, evidence labels, and confidence rules. It should not become a forked chatbot.

### 9.5 Invocation Routing Policy

WWMD is a governed decision path, not a universal answer button. The product rule is: **direct ask helps think; WWMD helps decide.**

Use WWMD only when a question is both:

- **ambiguous** - more than one reasonable answer exists after deterministic checks, and
- **consequential** - the answer affects autonomy, phase movement, customer impact, architecture, authority, or reusable precedent.

| Ambiguity | Consequence | Default path |
| --- | --- | --- |
| Low | Low | Direct answer, normal coworker chat, or deterministic lookup |
| High | Low | Direct advisory chat; no ledger row unless the operator promotes the answer |
| Low | High | Deterministic gate, checklist, policy control, or required approval |
| High | High | WWMD decision interaction |

Surface-specific routing:

| Surface | Use WWMD when | Avoid WWMD when |
| --- | --- | --- |
| Build Studio | A deterministic phase gate has passed but the next phase still requires judgment, such as plan -> build readiness. | The plan fails structural review; deterministic feedback is enough. |

| A2A / coworker handoff | A `TaskRun` or handoff artifact has competing recommendations, unresolved risk, or no accountable next step. | The handoff is a straightforward task transfer with clear input, output, owner, and authority. |
| Deliberation | Deliberation has produced structured disagreement and the system must decide whether to synthesize, escalate, or defer. | Deliberation has already reached a low-risk consensus and no authority boundary is crossed. |
| Skills | Creating, assigning, or granting tools to a skill changes coworker authority, risk, or reusable behavior. | A user needs one-off help or a missing UI affordance; use direct chat or improve the surface. |
| Backlog / prioritization | Several plausible paths encode a doctrine or operating-model choice. | The user asks for status, lookup, hygiene, or deterministic sequencing. |
| Standalone Ask WWMD | The operator explicitly asks for a governed advisory decision and accepts evidence labels, confidence, and ledger capture. | The user is exploring, drafting, or brainstorming without wanting precedent. |

Every WWMD invocation must record why the direct path was insufficient. V1 can store this in `DecisionInteraction.outcomePayload.routingReason`; a later schema hardening can promote it to a first-class field if analytics need it.

## 10. First Implementation Slice

Recommended v1:

1. Define the `Decision Perspective Profile` TypeScript contract and seed `Mark / DPF Platform` as a profile constant or seed-backed record, including the profile version snapshot contract from day one.
2. Add a pure WWMD decision evaluator that accepts:
   - question
   - options
   - route/build/task context
   - evidence bundle (including `DeliberationOutcome` if available)
   - profile material summaries
   - risk tier
   - deliberation inputs, if present
   - And returns one of: `recommend`, `arbitrate`, `escalate`, `defer`
3. Add Build Studio gate integration at the **plan advancement decision** — the point where Build Studio must decide whether a plan is ready to enter implementation. This is the highest-value ambiguity point in the v1 lifecycle because it is: high-stakes (wrong plan wastes a full build), frequently ambiguous (plan quality is often borderline), and already visible to the operator (it's an existing gate, not a new one). This is the only automatic WWMD invocation in v1; other surfaces remain direct/advisory unless they deliberately call the same governed contract.

   **Relationship to existing Design Review gate:** Build Studio already has a Design Review phase gate that evaluates structural plan completeness (spec coverage, required sections, severity of review findings). WWMD is a separate, complementary gate layered *after* the deterministic Design Review gate passes. Design Review answers "is the plan structurally complete?" WWMD answers "given this plan and the organization's doctrine, is advancing the right call?" A plan that fails Design Review never reaches WWMD. A plan that passes Design Review may still be escalated or deferred by WWMD on doctrinal or contextual grounds.
4. Persist a decision interaction ledger row using the smallest schema extension that fits existing `TaskRun`/Build Studio records, with profile version snapshot FK.
5. Add escalation and deferral capture for human answer, criteria, rationale, and gap notice.
6. Add a small AI Workforce/Build Studio inspector for the ledger.

Do not start by building the standalone chat surface. The gate needs real decisions and outcome feedback before the advisory surface can be trusted.

## 11. Backlog Follow-Ups

These should become explicit backlog items when the spec is accepted:

1. Build Studio WWMD gate and decision ledger v1 (plan advancement gate first).
2. Perspective material ingestion and review workflow for the Mark/DPF kernel.
3. Profile version snapshots and ledger linkage.
4. Deliberation run integration (`deliberationRunId` FK on `DecisionInteraction`).
5. Constructive-conflict integration with deliberation outputs.
6. Human escalation capture and candidate-material promotion.
7. Deferral capture and coverage-gap surfacing in the Decision Ledger.
8. Decision confidence scoring (rule-based v1; model-assessed evidence fit at v2 when outcome data is available — see §13).
9. Temporal decay and contradiction detection for perspective material.
10. Proactive profile-drift alerts and candidate-edit proposals.
11. Standalone Ask WWMD advisory surface.
12. Customer WWWD profile support, including fallback chain resolution, after platform kernel proves itself.
13. Direct-ask vs WWMD evaluation harness using the same ambiguous fixtures, human adjudication, and ledger scoring so the product can prove when the governed path improves decisions.

## 12. Article Handoff Deferred

The article is intentionally deferred until the first WWMD implementation slice produces concrete evidence. The Marketing Strategist should not draft from the concept alone.

Revisit the article after v1 has:

1. A persisted decision profile and version snapshot.
2. At least one Build Studio plan-advancement gate invocation.
3. A decision ledger record showing evidence, confidence, outcome, and any escalation or deferral.
4. Operator-visible UI that can be referenced without hand-waving.

At that point, the article angle should present WWMD/WWWD as an evidence-backed autonomy gate, not as "a clone of Mark." The market positioning table in §4.1 is a comparison frame, but public claims must be source-verified before marketing use.

## 13. Open Questions

1. Should profile material be stored as new rows, wiki pages with profile metadata, or a thin profile-material table pointing at existing sources?

2. Which Build Studio ambiguity point should be first? **Recommended: plan advancement** — the gate where Build Studio decides a plan is ready for implementation. It is already a defined gate, is high-stakes, and is frequently ambiguous. See §10 for rationale.

3. How should confidence be scored initially: rule-based only, or rule-based plus model-assessed evidence fit? **Recommended: rule-based v1.** Rule-based scoring is measurable, debuggable, and auditable from day one without outcome data. Model-assessed evidence fit adds meaningful calibration only after a body of override and outcome data exists to tune against. Add it at v2 when the decision ledger has enough real invocations to validate the model's evidence assessment against human corrections.

4. Who is the accountable human resolver for v1: Mark directly, COO coworker routing to Mark, or Build Studio owner role? **Recommended: Build Studio owner role.** The gate should escalate to the person who owns the build in progress. For platform doctrine questions that exceed the build owner's authority, the escalation chain routes to Mark. This preserves the architecture without requiring Mark-specific coupling in the gate logic, and generalizes naturally to customer installs where "Mark" does not exist.

5. What is the minimum UI needed for confidence changes to feel trustworthy without overwhelming the operator?

   **Recommended:** Three labeled confidence tiers — `High`, `Medium`, `Low` — derived from the numeric score ranges in the implementation plan, never exposing the raw float. The gate panel shows: outcome badge (Recommended / Arbitrated / Escalation required / Coverage gap — deferred), confidence tier label, the count of source materials used, and a single primary action (accept escalation / review deferral / continue). The decision ledger inspector shows the numeric `confidenceBefore` and `confidenceAfter` for operators who want the detail. Raw floats live in the ledger, not the gate panel.
