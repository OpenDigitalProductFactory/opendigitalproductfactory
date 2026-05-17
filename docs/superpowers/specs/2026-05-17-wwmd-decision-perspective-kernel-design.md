# WWMD Decision Perspective Kernel Design

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

Non-negotiable boundary: a customer profile must not inherit Mark-specific business judgment as authority by default. DPF product doctrine can be advisory product guidance; the customer's own WWWD profile becomes authoritative for its business context once it exists.

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

DPF's differentiator is that the decision perspective is not just a retrieved corpus. It is a governed operating profile with evidence, confidence, escalation, audit, and autonomy behavior.

## 5. Design Pillars

### 5.1 Decision Perspective Profiles

A profile names the decision perspective, owner, scope, source materials, confidence state, autonomy policy, and escalation route. V1 uses `Mark / DPF Platform` as the seed profile.

### 5.2 WWMD Now, WWWD Later

For this DPF install, WWMD and WWWD overlap because the product is the portal. Future customers get their own WWWD profiles. That future support must be designed now through explicit profile ownership and scope boundaries, but business-archetype-specific behavior is not a v1 goal.

### 5.3 Confidence Earned Slowly, Lost Quickly

Confidence is an operating state derived from source quality, pattern history, context fit, risk tier, and outcome feedback. Text volume does not create confidence.

Autonomy levels:

| Level | Behavior |
| --- | --- |
| Low confidence | Ask or escalate to a human. Capture answer, criteria, and rationale. |
| Medium confidence | Recommend with evidence, trade-offs, and required approval. |
| High confidence, low risk | Arbitrate and continue, with a decision record. |
| High confidence, high risk | Escalate or require approval anyway. |

### 5.4 Constructive Conflict

Coworkers can disagree, ask for approval, or raise objections. That is not a system failure. It is how real teams work.

WWMD should preserve competing views long enough to understand the trade-off, synthesize when confidence is sufficient, and escalate to the accountable human when the conflict is unresolved, high-risk, or outside the profile's scope.

Core rule: do not force consensus. Escalate real stalemates to the responsible human, then learn from the answer.

### 5.5 Evidence-Based Decisioning

WWMD must distinguish:

- facts with evidence
- interpretations of those facts
- Mark/organization preferences
- assumptions
- unknowns

Debate and synthesis outputs must cite evidence and label fuzzy memory as fuzzy memory. Unsupported claims cannot carry the same confidence as source-backed facts, confirmed decisions, or authoritative records.

### 5.6 Servant Leadership and Accountability

The gate exists to keep teams moving, not to dominate decisions. It should clarify ambiguity, route the right human into the loop, reduce repeated cognitive burden, and convert leadership decisions into durable future guidance.

## 6. Runtime Flow

V1 starts in Build Studio.

1. Build Studio detects ambiguity at a phase gate, design debate, approval handoff, constructive-conflict event, or "what next?" decision.
2. The gate invokes the `Mark / DPF Platform` decision perspective profile.
3. The gate gathers relevant material: principles, prior specs/decisions, source-backed evidence, active build context, deliberation outputs, and relevant memory/facts.
4. The gate returns one of three outcomes:
   - `recommend`: propose a direction with evidence and confidence.
   - `arbitrate`: decide a low-risk ambiguity and continue.
   - `escalate`: ask the accountable human.
5. Every invocation writes a decision interaction record with question, context, options, sources, rationale, confidence, risk tier, outcome, and any human override.
6. If escalated, the human answer captures answer, criteria, rationale, accountable person, and whether the rationale should become candidate future perspective material.
7. Reviewed material can later be promoted into the profile. It is never automatically doctrine just because it was said once.

## 7. Data Model Concepts

V1 should keep the model small and reuse existing DPF primitives where possible.

### 7.1 Decision Perspective Profile

The reusable profile boundary:

- profile id and display name
- owner principal / organization
- profile kind: `platform`, `organization`, `customer`, future `team`
- scope: routes, products, domains, risk bands
- default escalation owner or resolver rule
- autonomy policy
- confidence state by decision class

### 7.2 Perspective Material

Source material for the profile:

- articles and public thought material
- DPF principles and specs
- prior decisions and approval rationales
- corrections and disagreements
- source-backed evidence and receipts
- manual leader guidance

Fields should include source, source type, scope, freshness, confidence, review status, and promotion state.

### 7.3 Decision Interaction

Every WWMD/WWWD invocation:

- profile id
- route/build/task context
- question and options
- deliberation or A2A inputs
- evidence bundle
- recommendation/arbitration/escalation
- confidence before and after
- human outcome, if any
- links to `TaskRun`, deliberation run, `ToolExecution`, receipts, and Build Studio phase where applicable

### 7.4 Escalation Capture

When the gate escalates:

- who is accountable
- what decision was needed
- what answer was given
- criteria used
- rationale
- dissent or objections resolved
- whether the answer should become candidate profile material

## 8. Existing DPF Primitives to Reuse

| Need | Existing primitive |
| --- | --- |
| Durable doctrine | `WikiPage` principles and founder kernel |
| Mark/DPF source corpus | founder-kernel raw sources, specs, articles, wiki ingest |
| Memory with freshness | `UserFact`, governed memory, semantic memory |
| Work identity | `TaskRun`, `TaskMessage`, `TaskArtifact` |
| Tool/audit evidence | `ToolExecution`, `ToolExecutionReceipt` |
| Constructive conflict | deliberation framework |
| Build Studio gate | phase gates and `PhaseHandoff` |
| Decision support | `principle_decide`, `wiki_query`, `search_specs_and_plans`, backlog recommendation tools |
| Operator visibility | AI Operations Map and AI Workforce pages |

Schema changes should be added only where these primitives cannot carry the profile boundary, confidence state, or decision-interaction ledger cleanly.

## 9. UI and Surfaces

### 9.1 Build Studio Gate Panel

First v1 surface. Appears at ambiguous phase gates, design debates, handoffs, and start/continue decisions.

Expected content:

- the ambiguity being resolved
- options considered
- WWMD recommendation or escalation
- evidence and sources
- confidence and risk tier
- accountable human prompt if escalation is required

### 9.2 Decision Ledger / Inspector

Visibility surface for operators:

- recent WWMD invocations
- recommendation versus human outcome
- confidence changes
- source material used
- stalemates and escalations
- candidate material awaiting review

### 9.3 General Runtime Gate

Later surface. Other coworkers can invoke the gate when ambiguity, constructive conflict, or approval uncertainty blocks progress.

### 9.4 Standalone Ask WWMD Surface

Lower-priority backlog item. It should feel similar to the current GPT experience, but it must use the same governed profile, source material, evidence labels, and confidence rules. It should not become a forked chatbot.

## 10. First Implementation Slice

Recommended v1:

1. Define the `Decision Perspective Profile` TypeScript contract and seed `Mark / DPF Platform` as a profile constant or seed-backed record.
2. Add a pure WWMD decision evaluator that accepts:
   - question
   - options
   - route/build/task context
   - evidence bundle
   - profile material summaries
   - risk tier
   - deliberation inputs, if present
3. Add `Build Studio` gate integration for one high-value ambiguity point.
4. Persist a decision interaction ledger row or artifact using the smallest schema extension that fits existing `TaskRun`/Build Studio records.
5. Add escalation capture for human answer, criteria, and rationale.
6. Add a small AI Workforce/Build Studio inspector for the ledger.

Do not start by building the standalone chat surface. The gate needs real decisions and outcome feedback before the advisory surface can be trusted.

## 11. Backlog Follow-Ups

These should become explicit backlog items when the spec is accepted:

1. Build Studio WWMD gate and decision ledger v1.
2. Perspective material ingestion and review workflow for the Mark/DPF kernel.
3. Constructive-conflict integration with deliberation outputs.
4. Human escalation capture and candidate-material promotion.
5. Decision confidence scoring and demotion rules.
6. Standalone Ask WWMD advisory surface.
7. Customer WWWD profile support after platform kernel proves itself.

## 12. Article Handoff

The article angle is captured in the companion handoff:

`docs/superpowers/plans/2026-05-17-wwmd-marketing-article-handoff.md`

The Marketing Strategist should use that brief to draft an article about WWMD/WWWD as an evidence-backed autonomy gate, not as "a clone of Mark."

## 13. Open Questions

1. Should profile material be stored as new rows, wiki pages with profile metadata, or a thin profile-material table pointing at existing sources?
2. Which Build Studio ambiguity point should be first: phase advancement, plan/design debate, implementation start, or review/ship decision?
3. How should confidence be scored initially: rule-based only, or rule-based plus model-assessed evidence fit?
4. Who is the accountable human resolver for v1: Mark directly, COO coworker routing to Mark, or Build Studio owner role?
5. What is the minimum UI needed for confidence changes to feel trustworthy without overwhelming the operator?
