# Deliberation Pattern Framework Design

**Date:** 2026-04-21  
**Status:** Draft  
**Author:** Codex for Mark Bodman  
**Purpose:** Introduce a reusable internal deliberation framework for structured multi-agent quality patterns across the platform, with Build Studio as the first rich execution and visualization surface.

## 1. Inputs

This design extends and aligns:

- `docs/superpowers/specs/2026-03-23-task-graph-orchestration-design.md`
- `docs/superpowers/specs/2026-03-31-build-studio-agent-handoff-design.md`
- `docs/superpowers/specs/2026-04-13-build-studio-process-visualization.md`
- `docs/superpowers/specs/2026-04-13-model-capability-lifecycle-management.md`
- `docs/superpowers/specs/2026-04-12-unified-capability-and-integration-lifecycle-design.md`
- `docs/superpowers/specs/2026-04-18-lifecycle-evidence-specialist-design.md`
- `docs/superpowers/specs/2026-04-16-build-studio-process-improvements.md`

It is grounded in the current implementation and schema:

- `apps/web/lib/integrate/build-agent-prompts.ts`
- `apps/web/lib/build/process-graph-builder.test.ts`
- `apps/web/lib/tak/context-arbitrator.ts`
- `apps/web/lib/tak/prompt-loader.ts`
- `apps/web/lib/actions/external-evidence.ts`
- `packages/db/prisma/schema.prisma`

It is also grounded in runtime inspection on 2026-04-21:

- the platform already has task-graph primitives that can host deliberation without a second orchestration substrate:
  - `TaskRun` ([schema.prisma:2514](packages/db/prisma/schema.prisma#L2514))
  - `TaskNode` ([schema.prisma:2543](packages/db/prisma/schema.prisma#L2543))
  - `TaskNodeEdge` ([schema.prisma:2582](packages/db/prisma/schema.prisma#L2582))
- `TaskNode.nodeType` enumerates `skeptical_review` and `TaskNode.workerRole` enumerates `skeptical_reviewer` as declared options ([schema.prisma:2548](packages/db/prisma/schema.prisma#L2548)), but **no runtime code currently dispatches to those values** — they are reserved placeholders in the schema. Wiring them to live dispatch is part of this design, not a pre-existing capability. Note: these existing values use underscores (`skeptical_review`, not `skeptical-review`) and this design preserves that schema convention. New deliberation-specific enums introduced by this design (§6.6) use hyphens per CLAUDE.md.
- a full routing subsystem already exists at [apps/web/lib/routing/](apps/web/lib/routing/) (task-router, recipe-loader, pipeline-v2, provider adapters). Deliberation dispatch must ride on this, not parallel to it.
- the Docker stack runs `portal`, `postgres`, `redis`, `qdrant`, `neo4j` healthy, so this design can assume the normal runtime is present.

## 2. Problem Statement

The platform currently supports:

- single-agent coworker interactions
- Build Studio phase orchestration
- task graph runtime primitives
- route-aware model/provider selection
- prompt templates and specialist personas
- evidence and audit concepts

But it does not yet provide a reusable internal framework for structured multi-agent quality improvement before normal workflow gates.

Today, higher-quality outcomes often require an external manual pattern:

- run one model or persona to draft
- run another model or persona to review
- ask a different provider to challenge assumptions
- compare results manually
- reconcile disagreements by hand

This works, but it is outside the platform's runtime model and UX. The result is:

1. quality improvement depends on ad hoc human orchestration rather than a canonical platform capability
2. Build Studio cannot show when deeper internal scrutiny is happening, why it was invoked, or how it converged
3. multi-provider and multi-persona diversity are used informally, not governed or measured
4. source-backed rationale is not consistently enforced across review-like flows
5. the platform has execution primitives for review and skeptical review, but no reusable pattern definitions that tell it when, why, and how to branch work

The user has clarified several important constraints:

1. this does **not** change HITL principles
2. this is an internal quality-improvement layer before existing gates, not a replacement for approval or governance
3. `review` and `debate` are the first two patterns to support, but not the only future patterns
4. evidence quality matters: the platform should prefer retrieval and source-backed reasoning over vague model memory
5. both same-model multi-persona and heterogeneous multi-provider deliberation should be supported

## 3. Goals

This design should:

1. Introduce a reusable `Deliberation Pattern Framework` for structured internal quality-improvement workflows.
2. Treat `review` and `debate` as the first two canonical patterns in an extensible pattern registry.
3. Reuse the existing task graph runtime rather than creating a second orchestration subsystem.
4. Preserve existing HITL and authority rules unchanged.
5. Require source-backed rationale for source-sensitive claims.
6. Support three activation modes concurrently:
   - stage defaults
   - risk-based escalation
   - explicit invocation
7. Support three diversity modes:
   - single-model multi-persona
   - multi-model same-provider
   - multi-provider heterogeneous
8. Make Build Studio the first rich visualization surface for deliberation branches and synthesis.
9. Produce dual outputs:
   - a merged recommendation
   - a structured assertions/objections/adjudication record
10. Leave room for future patterns such as red-team, evidence reconciliation, design jury, and multi-pass verification.

This design must not:

1. bypass or weaken any existing HITL checkpoint
2. imply false independence when multiple branches are really the same model with minor prompt variation
3. force synthetic consensus when the evidence is weak or conflicting
4. rely on unsupported model-memory claims when retrieval is feasible
5. make Build Studio the only route that can use deliberation patterns

## 4. Research & Benchmarking

### 4.1 Systems compared

Open source / research-adjacent systems:

- **LLM Council**
  - <https://github.com/karpathy/llm-council>
  - demonstrates a practical multi-model council pattern:
    - parallel answers
    - peer review and ranking
    - chairman synthesis

- **Task Graph Orchestration design in DPF**
  - `docs/superpowers/specs/2026-03-23-task-graph-orchestration-design.md`
  - already establishes `TaskRun`, `TaskNode`, explicit review nodes, authority envelopes, and evidence contracts as the canonical runtime substrate

Academic/publications:

- **LLMs as Meta-Reviewers' Assistants: A Case Study**
  - <https://aclanthology.org/2025.naacl-long.395/>
  - relevant pattern: multi-perspective summarization to support a meta-reviewer rather than replacing judgment outright

- **Voting or Consensus? Decision-Making in Multi-Agent Debate**
  - <https://aclanthology.org/2025.findings-acl.606.pdf>
  - relevant finding: reasoning tasks and knowledge tasks benefit from different decision protocols; more rounds are not always better; diversity matters

- **Town Hall Debate Prompting: Enhancing Logical Reasoning in LLMs through Multi-Persona Interaction**
  - <https://arxiv.org/abs/2502.15725>
  - relevant finding: same-model multi-persona debate can improve reasoning performance without requiring heterogeneous providers

- **Adversarial influence / false-consensus in multi-agent LLM debate**
  - the draft cited <https://www.nature.com/articles/s41598-026-42705-7>, but that DOI did not resolve during spec review and the `s41598-026-*` pattern is inconsistent with Scientific Reports' DOI conventions for this time period
  - relevant finding regardless of citation: multi-agent debate is vulnerable to persuasive adversarial influence and synthetic consensus, so the protocol must explicitly defend against this (see §13 "synthetic consensus" and "false success from the synthesizer" risks)
  - **Verification TODO — REQUIRED before implementation:** replace this citation with a verified peer-reviewed reference on adversarial influence or false consensus in multi-agent LLM debate. Do not ship the framework with an unverifiable source; fabricated citations in a spec about retrieval-first evidence would be self-defeating.

Internal platform references:

- Build Studio process visualization already defines a strong graph metaphor for parallel/sequential work and convergence.
- Build Studio handoff design already separates phase-specific context from full chat history.
- Lifecycle evidence specialist design already treats evidence lineage and proceduralization as first-class concepts instead of post-hoc metadata.
- Model capability lifecycle work already distinguishes between catalog truth, discovered truth, and operator override.

### 4.2 Patterns adopted

1. **Pattern registry, not hardcoded workflows**  
   Adopted from the user's requirement and reinforced by the task-graph substrate. The platform should support a family of deliberation patterns, not only the first two.

2. **Meta-review / synthesis as a distinct role**  
   Adopted from LLM Council and the NAACL meta-reviewer study. Review flows should converge into an explicit synthesis/adjudication step rather than just “the system decided.”

3. **Decision protocol matters**  
   Adopted from ACL 2025 findings. Debate should not assume one universal convergence rule; different task types may prefer review, voting, consensus, or no-consensus outcomes.

4. **Diversity can come from personas or providers**  
   Adopted from Town Hall Debate Prompting and the user's current practice. Same-model multi-persona is valid and useful, but heterogeneous provider diversity matters more as stakes and ambiguity rise.

5. **Structural defenses against false consensus**  
   Adopted from Scientific Reports 2026. Debate is not automatically reliable just because multiple agents are speaking; skepticism, evidence requirements, and explicit unresolved-state handling are necessary.

6. **Graph-visible deliberation**  
   Adopted from existing Build Studio process-visualization direction. Internal quality work should be visible as branches and convergence, not hidden behind one spinner.

### 4.3 Patterns rejected

1. **Build-Studio-only implementation**  
   Rejected because the platform needs a reusable capability that can later serve other routes.

2. **Separate council subsystem with its own runtime**  
   Rejected because DPF already has a task graph and evidence-oriented runtime that can host this work.

3. **Consensus by default**  
   Rejected because some tasks need explicit dissent or no-consensus outcomes rather than forced synthesis.

4. **Prompt-only source requirements**  
   Rejected because source-backed reasoning needs structured runtime support, not just instructions.

5. **Silent quality layers**  
   Rejected because users need to know when and why extra scrutiny happened, especially in Build Studio.

### 4.4 Anti-patterns identified

- false diversity: branches appear independent but are really the same model with trivial role variation
- synthetic consensus: the system presents agreement despite weak or conflicting evidence
- citation theater: references look authoritative but are vague, hallucinated, or untraceable
- graph overload: users are forced to reason about orchestration internals rather than outcomes
- governance confusion: users mistake internal quality steps for approval or authority changes

### 4.5 DPF differentiator

Many systems can run multiple LLMs. DPF's differentiator should be:

- reusable pattern definitions
- route- and stage-aware activation
- explicit source-backed evidence contracts
- honest diversity reporting
- graph-visible convergence
- unchanged governance with better artifacts reaching existing gates

## 5. Decision

Introduce a shared **Deliberation Pattern Framework** as an extension layer over the existing task graph runtime.

The framework will:

- register reusable deliberation patterns
- activate them via stage defaults, risk signals, and explicit requests
- execute them on `TaskRun` / `TaskNode` / `TaskNodeEdge`
- require source-backed rationale where appropriate
- surface compact outputs to Build Studio and later to other routes

`review` and `debate` are the first two canonical patterns. They are not the only future patterns.

Build Studio is the first rich implementation and visualization surface, but not the only eventual consumer.

### 5.1 What is NOT in scope

To keep the boundary sharp:

- **Single-agent self-critique is not deliberation.** A coworker re-reading its own output in one prompt does not produce a `DeliberationRun`. Deliberation requires ≥2 distinct branch nodes plus a synthesizer.
- **Coworker-to-coworker delegation is not deliberation.** The existing `DelegationChain` flow (see [skill-discovery.ts](apps/web/lib/actions/skill-discovery.ts)) is authority propagation, not quality scrutiny. Delegation can *invoke* a deliberation, but is not one.
- **Phase gates are not deliberation.** Build Studio phase transitions and approval checkpoints remain governance, not deliberation. Deliberation feeds them, never replaces them.
- **Governance, approval, and authority changes are not in scope.** See §6.5 (authority envelope propagation) and §6.9 (HITL invariance).

### 5.2 Relationship to existing platform principles

- **Improvement loops.** The platform's "every coworker gets an improvement loop" principle is satisfied by deliberation patterns running as pre-gate quality layers on coworker outputs. This framework is the canonical implementation of that principle.
- **TAK governance substrate.** Deliberation runs produce evidence records and adjudication artifacts that TAK auditors can inspect. Authority envelopes on deliberation `TaskNode`s inherit TAK policy, they never extend it.
- **Reusability by design.** Pattern definitions are seeded from files (like `.prompt.md` / `.skill.md` assets) and are portable across installs in the hive mind.

## 6. Architecture

### 6.1 Core model

The framework has four layers:

1. **Task graph execution substrate**
   - `TaskRun`
   - `TaskNode`
   - `TaskNodeEdge`

2. **Deliberation pattern registry**
   - defines reusable patterns such as `review` and `debate`

3. **Evidence and claim layer**
   - records admissible sources, claims, objections, and rationale

4. **Route-specific presentation**
   - Build Studio graph view first
   - lighter summaries elsewhere later

### 6.2 Pattern definition model

Recommended new conceptual objects:

#### `DeliberationPattern` — seeded from files, stored in DB

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `patternId` | `String @id @default(cuid())` | Primary key. |
| `slug` | `String @unique` | File-backed identifier, e.g. `review`, `debate`. |
| `name` | `String` | Display name. |
| `purpose` | `String @db.Text` | Plain-language purpose statement. |
| `defaultRoles` | `Json` | Array of `{ roleId, count, required }`. |
| `topologyTemplate` | `Json` | Branch/convergence spec consumable by the task-graph builder. |
| `activationPolicyHints` | `Json` | Hints consumed by §7 resolver; not authoritative. Shape: `{ stageDefaults: string[], riskEscalation: { level: "medium" \| "high" \| "critical", addPattern?: string }[], explicitTriggers: string[] }`. The resolver may override these based on install policy. |
| `evidenceRequirements` | `Json` | §8.5 declaration. |
| `outputContract` | `Json` | Shape of the `DeliberationOutcome` produced. |
| `providerStrategyHints` | `Json` | Preferred diversity mode and strategy profile. |
| `sourceFile` | `String?` | Path to the seed file under `deliberation/`. |
| `status` | `String` | Canonical: `active` \| `deprecated` \| `draft`. See §6.6. |

Patterns follow the existing DPF convention: seeded from versioned files in the repo, editable at runtime via an admin surface, with runtime cache and fallback to file content on DB miss. Same model as `PromptTemplate` / `SkillDefinition`.

#### `DeliberationRun` — one active pattern instance

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `deliberationRunId` | `String @id @default(cuid())` | Primary key. |
| `taskRunId` | `String` | FK to `TaskRun.id`; deliberation is always parented to a task run. |
| `patternId` | `String` | FK to `DeliberationPattern.id`. |
| `artifactType` | `String` | What is under deliberation (e.g. `spec`, `plan`, `code-change`, `architecture-decision`). Canonical list in §6.6. |
| `triggerSource` | `String` | Canonical: `stage` \| `risk` \| `explicit` \| `combined`. §6.6. |
| `adjudicationMode` | `String` | Canonical: `synthesis` \| `majority-vote` \| `unanimous` \| `no-consensus-ok`. §6.6. |
| `activatedRiskLevel` | `String?` | Canonical: `low` \| `medium` \| `high` \| `critical`. §6.6. |
| `diversityMode` | `String` | Canonical: `single-model-multi-persona` \| `multi-model-same-provider` \| `multi-provider-heterogeneous`. §6.6. |
| `strategyProfile` | `String` | Canonical: `economy` \| `balanced` \| `high-assurance` \| `document-authority`. §6.6. |
| `consensusState` | `String` | Canonical: `consensus` \| `partial-consensus` \| `no-consensus` \| `insufficient-evidence` \| `pending`. §6.6. |
| `maxBranches` | `Int` | Hard cap enforced before dispatch. |
| `budgetUsd` | `Float?` | Per-run cost ceiling; dispatcher refuses further branches past it. |
| `startedAt` | `DateTime` | |
| `completedAt` | `DateTime?` | |

#### `DeliberationRoleProfile` — portable personas

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `roleId` | `String @id` | Slug, e.g. `reviewer`, `skeptic`, `adjudicator`. |
| `roleName` | `String` | Display name. |
| `personaGuidance` | `String @db.Text` | Portable persona prompt; `{{include:...}}` composition allowed. |
| `allowedNodeTypes` | `String[]` | Which `TaskNode.nodeType` values this role can occupy. |
| `sameModelPersonaAllowed` | `Boolean` | Whether the role remains meaningful in same-model diversity mode. |
| `preferProviderDiversity` | `Boolean` | Dispatch heuristic. |
| `requireProviderDiversity` | `Boolean` | Hard constraint; if unmet, run downgrades to constrained-fallback. |
| `evidenceStrictness` | `String` | Canonical: `lenient` \| `standard` \| `strict`. §6.6. |

### 6.3 Runtime reuse

The framework should **not** replace the task graph.

Instead:

- pattern roles map to `TaskNode.workerRole` and `TaskNode.nodeType`
- branch and convergence topology map to `TaskNodeEdge`
- runtime status, timing, and cost remain on the task graph
- Build Studio and future routes read deliberation metadata as a layer on top

### 6.4 First two pattern templates

#### `review`

Recommended default topology:

```text
artifact/draft
   └─ author node
        ├─ reviewer node A
        ├─ reviewer node B
        ├─ optional skeptical reviewer
        └─ synthesizer / meta-review node
```

Default outputs:

- merged recommendation
- issues found
- confidence
- unresolved risks
- evidence coverage summary
- structured objections and adjudication record

#### `debate`

Recommended default topology:

```text
question / artifact
   ├─ position node A
   ├─ position node B
   ├─ optional additional position nodes
   ├─ optional skeptic / rebuttal node
   └─ synthesizer / adjudicator node
```

Default outputs:

- consensus or non-consensus state
- strongest arguments per side
- evidence-backed rationale
- unresolved contention points
- recommended next action

### 6.5 Authority envelope propagation

Every deliberation branch executes as a `TaskNode` under the parent `TaskRun`. The framework must:

1. **Copy, never widen.** Each branch's `TaskNode.authorityEnvelope` is the intersection of the parent `TaskRun.authorityScope` and the role's declared requirements. Branches cannot be authorized to do anything the originating user could not already do.
2. **Carry user identity.** The originating `TaskRun.userId` is preserved on every branch for audit and tool-grant resolution. Branch execution inherits that user's skill assignments, tool grants, and HITL requirements.
3. **Refuse consequential tools by default.** Deliberation branches default to read-only / retrieval tools. Write / external-side-effect tools must be explicitly admitted by pattern definition AND within parent authority. A reviewer branch cannot silently contribute to the hive, push a PR, or mutate portal state.
4. **Adjudicator is not privileged.** The synthesizer/adjudicator role has no elevated authority; it produces a `DeliberationOutcome` artifact, not a governance decision.

### 6.6 Canonical enums — MANDATORY

Per CLAUDE.md "Strongly-Typed String Enums — MANDATORY COMPLIANCE", every string field below is a canonical enum. Values must match exactly. Adding a value requires updating the TypeScript union in the deliberation types module AND the corresponding MCP tool enum in the same commit.

| Model | Field | Valid values |
| ----- | ----- | ------------ |
| `DeliberationPattern` | `status` | `"active"` `"deprecated"` `"draft"` |
| `DeliberationRun` | `artifactType` | `"spec"` `"plan"` `"code-change"` `"architecture-decision"` `"policy"` `"research-question"` |
| `DeliberationRun` | `triggerSource` | `"stage"` `"risk"` `"explicit"` `"combined"` |
| `DeliberationRun` | `adjudicationMode` | `"synthesis"` `"majority-vote"` `"unanimous"` `"no-consensus-ok"` |
| `DeliberationRun` | `activatedRiskLevel` | `"low"` `"medium"` `"high"` `"critical"` |
| `DeliberationRun` | `diversityMode` | `"single-model-multi-persona"` `"multi-model-same-provider"` `"multi-provider-heterogeneous"` |
| `DeliberationRun` | `strategyProfile` | `"economy"` `"balanced"` `"high-assurance"` `"document-authority"` |
| `DeliberationRun` | `consensusState` | `"consensus"` `"partial-consensus"` `"no-consensus"` `"insufficient-evidence"` `"pending"` |
| `DeliberationRoleProfile` | `evidenceStrictness` | `"lenient"` `"standard"` `"strict"` |
| `ClaimRecord` | `claimType` | `"assertion"` `"objection"` `"rebuttal"` `"synthesis-fact"` `"synthesis-inference"` |
| `ClaimRecord` | `status` | `"supported"` `"contested"` `"unresolved"` `"rejected"` |
| `ClaimRecord` | `evidenceGrade` | `"A"` `"B"` `"C"` `"D"` |
| `EvidenceSource` | `sourceType` | `"code"` `"spec"` `"doc"` `"paper"` `"web"` `"db-query"` `"tool-output"` `"runtime-state"` |

Rules: hyphens not underscores in multi-word values; never invent synonyms (`reviewed`, `done`, `multi_provider`).

### 6.7 Module placement

New code lives at:

- `apps/web/lib/deliberation/` — pattern registry, activation resolver, run orchestrator, outcome synthesizer, types module.
- `deliberation/` — repo-root directory for `.deliberation.md` pattern seed files (mirroring `prompts/` and `skills/` conventions).
- `packages/db/src/seed-deliberation.ts` — seed script for `DeliberationPattern` and `DeliberationRoleProfile` rows from files.
- `packages/db/prisma/migrations/<ts>_add_deliberation/` — new Prisma migration.
- `apps/web/lib/mcp-tools.ts` — new tool entries (§6.8).
- `apps/web/components/deliberation/` — Build Studio summary + drill-down UI.

Reuses:

- `apps/web/lib/build/process-graph-builder.ts` — extended to render deliberation sub-branches inside a phase.
- `apps/web/lib/routing/` — pattern dispatch calls `task-router` / `recipe-loader` / `pipeline-v2` per branch; no parallel routing.
- `apps/web/lib/tak/prompt-loader.ts` — role persona content loads via the existing loader (DB first, file fallback, 60s cache).

### 6.8 MCP tool surface

Deliberation must be invokable across coworkers, not only from Build Studio. Three MCP tools are added in `apps/web/lib/mcp-tools.ts`:

- `start_deliberation` — `{ patternSlug, taskRunId?, artifactType, strategyProfile?, maxBranches?, budgetUsd? }` → `{ deliberationRunId }`. If `taskRunId` is omitted, the orchestrator creates a minimal bootstrap `TaskRun` parented to the caller's identity so deliberation can be triggered from coworker contexts that don't yet own a task run; the created run is visible in the normal task-graph UI and cleaned up on cascade. Proposal-mode by default; `autoApproveWhen` predicate admits stage-default and risk-escalated invocations pre-authorized by the activation resolver (per memory: proposal-mode without auto-approve stalls autonomous runs).
- `get_deliberation_status` — `{ deliberationRunId }` → current `consensusState`, branch counts, evidence coverage summary.
- `get_deliberation_outcome` — `{ deliberationRunId }` → full `DeliberationOutcome` + linked `ClaimRecord` / `EvidenceBundle` references.

Tool definitions carry the same canonical-enum arrays declared in §6.6.

### 6.9 HITL invariance

This framework does not change approval authority.

It is a pre-decision quality layer only:

- it can critique
- it can compare
- it can synthesize
- it can mark issues unresolved
- it can strengthen what reaches a gate

It cannot:

- grant new authority
- approve a consequential action
- mutate governance policy
- bypass existing HITL checkpoints

## 7. Activation Policy

### 7.1 Layered activation model

The platform should support all three trigger families concurrently:

1. **Stage defaults**
2. **Risk-based escalation**
3. **Explicit invocation**

### 7.2 Resolution rules

Decision order:

1. check explicit invocation
2. check risk escalation
3. apply stage default
4. otherwise continue with single-agent flow

Additional rule:

- explicit invocation may strengthen or add deliberation, but cannot weaken required stage/risk behavior

### 7.3 Stage defaults

Recommended first defaults for Build Studio:

- `ideate`
  - default `review`
- `plan`
  - default `review`
- `review`
  - default `review` or `multi-pass-verification`
- architecture trade-off work
  - default `debate` when ambiguity is high enough

### 7.4 Risk-based escalation

Suggested escalation signals:

- high business or compliance impact
- cross-domain or cross-portfolio design change
- weak or conflicting source evidence
- high novelty or poor precedent fit
- multi-system dependencies
- policy-sensitive or fact-sensitive outcomes

Suggested first policy:

- medium risk:
  - add skeptical review
- high risk or high ambiguity:
  - escalate to `debate` or a stronger future pattern

### 7.5 Explicit invocation

Examples:

- “Run peer review on this spec”
- “Have Codex and Claude debate this”
- “Do a red-team pass before review”

The platform should preserve this as a first-class user control even when stage/risk defaults exist.

### 7.6 Transparency rule

The platform should say when a deliberation pattern ran and why, in plain language.

Example:

> I added a peer review pass because this plan changes multiple systems and has weak precedent in the existing codebase.

Diagnostics can expose deeper routing detail, but the normal user-facing explanation should stay concise.

## 8. Evidence, Retrieval, and Citation Policy

### 8.1 Core rule

The framework should enforce a **retrieval-first deliberation policy** for source-sensitive work.

If a claim can be grounded in retrievable evidence, it must be.

Model memory may:

- generate hypotheses
- suggest search directions
- propose interpretations

But it should not act as final authority when a source is expected or available.

### 8.2 Evidence grades

#### `Grade A: exact source-grounded`

Direct reference to a specific:

- file and line
- spec and section
- paper and page/section
- URL and retrieval timestamp
- DB row or live query snapshot
- tool result reference

Required for:

- codebase assertions
- specifications
- research papers
- policy/compliance claims
- historical/date-sensitive claims

#### `Grade B: source-grounded synthesis`

Claim synthesized from multiple cited sources with explicit links.

Acceptable for:

- design recommendations
- trade-off analyses
- final summaries

#### `Grade C: contextual inference`

Inference derived from available evidence but not directly stated by one source.

Must be labeled as inference.

#### `Grade D: unsupported model-memory assertion`

No linked source.

May be used only as a hypothesis to investigate, never as final rationale in a deliberation outcome.

### 8.3 Structured source locators

The platform should require structured locators, not only loose URLs.

Recommended source locator forms:

- code: file path + line or commit
- internal docs/specs: path + heading/section
- PDFs/papers: DOI/URL + page/section when available
- web pages: URL + title + retrieved timestamp
- DB/live state: entity/table + query context + captured-at timestamp
- tool outputs: tool name + parameter hash + result reference

### 8.4 Admissibility rule

A branch may argue from:

- retrieved source evidence
- codebase/runtime evidence
- clearly labeled inference

A branch may not close an argument using:

- vague memory
- unattributed quotes
- hallucinated citations
- “industry standard” with no source

### 8.5 Pattern-level evidence declarations

Each pattern definition declares:

- `retrievalRequired: boolean` — if true, branches may not close claims from model memory alone
- `admissibleSourceTypes: EvidenceSource.sourceType[]` — canonical values from §6.6 (`code`, `spec`, `doc`, `paper`, `web`, `db-query`, `tool-output`, `runtime-state`)
- `freshness: "strict" | "standard" | "lenient"` — matches `DeliberationRoleProfile.evidenceStrictness` (§6.6). `strict` requires retrieval within the run; `standard` allows recent cached evidence; `lenient` allows any grounded citation.
- `conflictReconciliationRequired: boolean` — if true, conflicting Grade-A sources must be explicitly reconciled in the synthesis, not silently averaged

Examples:

- `review` on a code plan
  - admissible: `code`, `spec`, `doc`, `db-query`, `runtime-state`
  - freshness: `strict` for runtime/backlog/status claims, `standard` otherwise
- `debate` on architecture
  - admissible: `code`, `spec`, `doc`, `paper`
  - freshness: `standard`
- `debate` on provider capability or current facts
  - freshness: `strict`
  - `retrievalRequired: true` — unsupported memory claims disallowed

### 8.6 Insufficient evidence behavior

If the framework cannot retrieve enough evidence for a trustworthy result, it should degrade gracefully.

It should say:

- insufficient evidence to adjudicate confidently
- no consensus due to incomplete evidence

It should not fabricate a clean consensus.

## 9. Provider, Persona, and Diversity Strategy

### 9.1 Diversity modes

Support three execution modes:

#### `single-model multi-persona`

- one provider/model
- multiple roles/personas
- best for low-cost routine review and fast iteration

#### `multi-model same-provider`

- one provider family
- different model tiers or specialized variants
- useful where consistent provider behavior matters but more contrast is needed

#### `multi-provider heterogeneous`

- different providers or endpoint families
- best for higher-stakes or ambiguity-sensitive work where correlated blind spots matter

### 9.2 Strategy ladder

Use the cheapest sufficient diversity:

1. start with same-model multi-persona
2. escalate to mixed models within a provider if needed
3. escalate to heterogeneous providers when the risk/ambiguity benefit justifies it

### 9.3 Recommended strategy profiles

- `economy`
  - same model, multiple personas
- `balanced`
  - mixed models, potentially same provider
- `high-assurance`
  - heterogeneous providers plus explicit skeptic/reviewer separation
- `document-authority`
  - provider choice secondary to retrieval quality, but strict evidence grounding required

### 9.4 Portable personas

Personas should be first-class config, not just prompt fragments.

Examples:

- `author`
- `reviewer`
- `skeptic`
- `architect`
- `operator`
- `compliance-reviewer`
- `adjudicator`
- `historian`
- `customer-advocate`

These slugs become `DeliberationRoleProfile.roleId` values. Per §6.6 canonical-enum rules, multi-word role slugs use hyphens, not underscores. These roles should be portable across providers so the platform is not locked to one model family.

### 9.5 Honest diversity reporting

The framework should record:

- `personaDiversity`
- `modelDiversity`

This prevents false diversity narratives.

If a deliberation run used:

- the same model with multiple personas

the UI and audit trail should say so explicitly.

### 9.6 Fallback behavior

If only one provider is healthy or authorized:

- the pattern may still run in same-model multi-persona mode
- the platform should record that diversity was constrained
- it should not imply heterogeneous independence

### 9.7 Routing subsystem integration

Every branch dispatch goes through the existing routing pipeline — no parallel path.

- **Branch dispatch** — the run orchestrator builds a `RequestContract` (see [request-contract.ts](apps/web/lib/routing/request-contract.ts)) per branch, then calls `task-router` / `pipeline-v2` ([task-router.ts](apps/web/lib/routing/task-router.ts), [pipeline-v2.ts](apps/web/lib/routing/pipeline-v2.ts)). No hard pins, no hard-coded model IDs (per memory: no provider pinning).
- **Diversity enforcement at dispatch time** — for `multi-model-same-provider` and `multi-provider-heterogeneous`, the orchestrator requests *distinct* model/provider selections across branches, not just distinct personas. Diversity is validated post-hoc from the `routeDecision` JSON persisted on each `TaskNode`; if the routing layer returned duplicates despite the request, the run records `modelDiversity: constrained` rather than lying.
- **Recipe-driven patterns** — each `DeliberationPattern` may ship with a routing recipe entry (see [recipe-loader.ts](apps/web/lib/routing/recipe-loader.ts)) that captures the preferred capability tier + task type per role. Recipes are loaded from the pattern's seed file and registered at boot alongside existing recipes.
- **Cost and rate-limit awareness** — the orchestrator checks `rate-tracker` ([rate-tracker.ts](apps/web/lib/routing/rate-tracker.ts)) before dispatching each branch and degrades diversity before it fails the run (drop from `multi-provider-heterogeneous` to `multi-model-same-provider`, then to `single-model-multi-persona`). Every degradation is recorded on the `DeliberationRun`.
- **Champion-challenger reuse** — the existing [champion-challenger.ts](apps/web/lib/routing/champion-challenger.ts) machinery is a natural fit for `review` and can be used under the hood for same-provider two-branch review; the deliberation layer exposes a consistent pattern API above it so callers don't care which primitive implemented it.

## 10. Build Studio UX and Visualization

### 10.1 Role of Build Studio

Build Studio should be the first rich visualization surface for deliberation patterns.

It should reuse the existing process-graph direction rather than inventing a second visual language.

### 10.2 Visual model

Top level:

- build phases stay the primary flow

Inside a phase:

- deliberation appears as nested or expandable branch structures

The user should be able to see:

- that extra scrutiny was invoked
- why it was invoked
- what it produced
- whether it converged

Without being forced to manage the graph manually.

### 10.3 Review visualization

Recommended shape:

```text
draft node
   ├─ reviewer A
   ├─ reviewer B
   ├─ optional skeptic/verifier
   └─ synthesis node
```

### 10.4 Debate visualization

Recommended shape:

```text
question/artifact
   ├─ position A
   ├─ position B
   ├─ optional further positions
   ├─ optional skeptic / rebuttal branch
   └─ synthesis node
```

### 10.5 Default UX levels

#### Summary view

Should show:

- pattern invoked
- why it ran
- who/what participated
- convergence state
- evidence strength
- unresolved risk

#### Drill-down view

Should show:

- branch-by-branch claims and objections
- source links
- provider/persona identity
- synthesis logic

### 10.6 Recommended summary badges

- `Peer Review`
- `Debate`
- `Review + Skeptic`
- `Source-backed`
- `Mixed evidence`
- `Needs more evidence`
- `Same model, multiple personas`
- `Multi-provider review`
- `Consensus reached`
- `Partial consensus`
- `No consensus`

### 10.7 Usability rule

The default UI should explain quality-improvement activity, not expose raw orchestration internals.

Do not default to showing:

- token counts
- prompt internals
- all route metadata
- full branch transcripts

Those belong in diagnostics/drill-down.

Default language should feel like:

- “I added a peer review pass because this plan touches multiple systems.”
- “Two reviewers agreed, but the skeptic found weak evidence around provider assumptions.”
- “The debate did not reach consensus because the evidence is incomplete.”

## 11. Data Model Direction

### 11.1 Reuse first

The current schema already provides a strong runtime substrate:

- `TaskRun`
- `TaskNode`
- `TaskNodeEdge`
- `FeatureBuild`

This design should extend that substrate rather than replacing it.

### 11.2 Evidence persistence direction

`ExternalEvidenceRecord` is a useful start, but it is too thin for citation-grade deliberation provenance by itself.

It should either be extended or complemented by a stronger evidence layer that supports:

- branch-level source sets
- claim-to-source linkage
- evidence grade
- conflict tracking
- retrieval context

Recommended conceptual objects:

#### `EvidenceBundle`

- linked to `TaskNode` or deliberation branch
- artifact under evaluation
- retrieval/query context
- summary

#### `EvidenceSource`

- source type
- locator
- provider/tool used to retrieve it
- normalized excerpt/fact
- retrieval timestamp/freshness

#### `ClaimRecord`

- claim text
- claim type (canonical enum per §6.6: `assertion`, `objection`, `rebuttal`, `synthesis-fact`, `synthesis-inference`)
- supporting sources
- opposing sources
- evidence grade (canonical enum per §6.6: `A`, `B`, `C`, `D`)
- confidence
- branch owner (`TaskNode.id`)
- status (canonical enum per §6.6: `supported`, `contested`, `unresolved`, `rejected`)

#### `DeliberationOutcome`

- merged recommendation
- rationale summary
- confidence
- unresolved risks
- consensus state
- references to issue set and evidence bundles

#### `DeliberationIssueSet`

- assertions
- objections
- rebuttals
- adjudication notes

### 11.3 Build Studio storage rule

`FeatureBuild` should store:

- compact outcome
- compact summary
- references to the deeper deliberation runtime artifacts

It should not carry the full heavy branch-by-branch evidence payload inline.

### 11.4 Migration sketch

One Prisma migration under `packages/db/prisma/migrations/<timestamp>_add_deliberation/` adds:

- `DeliberationPattern`, `DeliberationRoleProfile` (seeded from files)
- `DeliberationRun` with FK `taskRunId` → `TaskRun.id` (cascade on delete)
- `DeliberationOutcome` with FK `deliberationRunId` (one-to-one)
- `DeliberationIssueSet`, `ClaimRecord`, `EvidenceBundle`, `EvidenceSource` — all FK-rooted on `deliberationRunId` so dropping a run cascades cleanly
- A `TaskNode.deliberationRunId String?` column (+ index) so branch nodes can be located from the deliberation side without a JSON join

No existing column semantics change. `TaskNode.nodeType` and `workerRole` gain no new enum values in this migration — the existing `review` / `skeptical_review` / `reviewer` / `skeptical_reviewer` options are sufficient for patterns 1–2; additional node types are added in the migration that ships each new pattern.

### 11.5 Observability

- **Structured traces** — every branch lifecycle event (`dispatched`, `running`, `completed`, `failed`, `degraded-diversity`, `budget-halted`) emits a `[tool-trace]` log line (per the project-wide `[tool-trace]` convention) keyed by `deliberationRunId`, `branchNodeId`, `patternSlug`, `role`.
- **Metrics** — the run orchestrator emits counters for pattern invocations, consensus-state distribution, evidence-grade distribution, diversity-mode actual vs. requested, and cost per pattern. These feed whatever platform telemetry surface is current; no new telemetry stack is introduced.
- **Audit trail** — every `DeliberationRun` and its `ClaimRecord`s are immutable-after-completion and readable by TAK governance tooling.
- **Diagnostic drill-down** — Build Studio exposes a diagnostic panel (hidden by default) that shows per-branch routing decisions, prompt hashes, token counts, and retry history. Primary UX stays summary-only (§10.7).

### 11.6 Resumability and failure semantics

- A `DeliberationRun` inherits the resume contract of its parent `TaskRun`. If the portal restarts mid-run, incomplete branches transition to `blocked` and the orchestrator resumes from the run's persisted `TaskNode` set rather than restarting the pattern from scratch.
- A failed branch does not fail the run. The synthesizer is invoked with whatever branches completed, and the outcome records `consensusState: "insufficient-evidence"` if the surviving branches cannot carry a defensible synthesis.
- A run that exceeds `maxBranches` or `budgetUsd` halts cleanly: no further branches dispatch, the synthesizer runs on what exists, and the outcome carries `budget-halted` in its metadata.
- Resume is scope-bounded: a run older than 24h without activity is abandoned rather than resumed, to avoid operating on stale evidence.

## 12. Rollout Plan

### Phase 1: Framework foundation

- add pattern definitions for `review` and `debate`
- add activation policy plumbing
- add pattern-instance metadata around the task graph
- add first-pass evidence and claim structures
- keep initial outputs mostly internal/diagnostic

### Phase 2: Build Studio review pattern

- implement `review` in Build Studio first
- use in `ideate`, `plan`, and selected review checks
- add summary-first branch visualization in the process graph

Why first:

- safer and more generally useful than debate
- immediate value for specs and plans
- lower complexity

### Phase 3: Build Studio debate pattern

- add `debate` after review stabilizes
- use for ambiguous architecture decisions and explicit requests
- support heterogeneous provider mode where available
- require stronger evidence handling

### Phase 4: Broader route adoption

Extend to:

- architecture/design routes
- compliance and policy drafting
- tool evaluation
- knowledge/article/spec workflows
- other high-stakes operational decisions

### Phase 5: Pattern expansion

Add future patterns through the same registry:

- `red-team`
- `evidence-reconciliation`
- `design-jury`
- `multi-pass-verification`
- future domain-specific patterns

### Rollout guardrails

1. Ship `review` before `debate`.
2. Keep the first Build Studio UX summary-first.
3. Preserve HITL semantics unchanged throughout all phases.

## 13. Risks and Mitigations

### Risk: false diversity

Branches look independent but are really the same model with mild persona variation.

Mitigation:

- record actual provider/model identity
- show diversity badges honestly

### Risk: synthetic consensus

The system forces agreement despite weak or conflicting evidence.

Mitigation:

- support explicit `consensusState: "no-consensus"` (§6.6)
- require unresolved issues to remain visible

### Risk: citation theater

References look impressive but are vague or hallucinated.

Mitigation:

- structured locators
- retrieval-first policy
- unsupported claims cannot be part of final rationale

### Risk: cost bloat

Deliberation branches spawn too often or an individual run over-runs.

Mitigation:

- layered activation policy (§7) prevents spurious invocations
- cheapest sufficient diversity ladder (§9.2)
- hard per-run `maxBranches` cap enforced at dispatch time
- hard per-run `budgetUsd` ceiling; dispatcher refuses further branches past it and the run halts cleanly with `budget-halted`
- rate-limit-aware degradation of diversity mode before dispatch failure (§9.7)
- review-first rollout; debate gated behind risk or explicit invocation for the first releases

### Risk: graph overload

Users get buried in orchestration detail.

Mitigation:

- summary-first UX
- diagnostics on drill-down only

### Risk: governance confusion

Users think deliberation changes approval authority.

Mitigation:

- explicit language that these are pre-decision quality layers only
- unchanged HITL flow

### Risk: proposal-mode stall in autonomous runs

The `start_deliberation` MCP tool ships in proposal mode by default. Without an `autoApproveWhen` predicate, stage-default and risk-escalated invocations would block indefinitely waiting for human approval, silently stalling autonomous and overnight flows.

Mitigation:

- pattern activations triggered by stage-default or risk-escalation resolution are pre-authorized via `autoApproveWhen`, matching the hive-contribution fix precedent
- explicit-invocation activations remain subject to normal proposal review
- tool adapters emit `[tool-trace]` logs on every activation decision so stalls are diagnosable without speculation

### Risk: false success from the synthesizer

The adjudicator produces a clean outcome that masks failed or empty branches — mirroring the `contribute_to_hive` `success:true + prUrl:null` pattern.

Mitigation:

- synthesizer must receive concrete branch artifacts; missing-branch cases force `consensusState: "insufficient-evidence"`
- `DeliberationOutcome` carries the branch completion roster so downstream consumers cannot read success without seeing how many branches contributed
- synthesis tool adapters validate output shape and log mismatches under `[tool-trace]`

## 14. Testing Strategy

### 14.1 Pattern runtime tests

- pattern definition loads correctly
- branch topology is created correctly
- convergence rules execute correctly

### 14.2 Evidence integrity tests

- final rationale cannot contain unsupported Grade D claims
- claim-to-source linkage is enforced
- conflicting sources stay visible

### 14.3 Diversity tests

- same-model persona mode is recorded honestly
- heterogeneous mode records actual provider/model differences
- constrained fallback works when only one provider is available

### 14.4 Build Studio tests

- summary view explains why a pattern ran
- process graph shows parallel branches and synthesis
- users can distinguish:
  - pattern invoked
  - consensus state
  - evidence quality
  - unresolved risk

### 14.5 QA additions

Add platform QA scenarios for:

- Build Studio plan with peer review enabled
- Build Studio architecture question with debate enabled
- explicit user request for mixed-provider debate
- source-sensitive claim with missing evidence producing "insufficient evidence"
- constrained-diversity run showing honest same-model labeling

### 14.6 Failure-mode tests

- budget-halted run with partial branches still synthesizes and records `budget-halted` metadata
- portal restart mid-run resumes blocked branches rather than double-dispatching
- stage-default activation runs without human approval prompt (proposal-mode auto-approve works)
- explicit-invocation activation still requires approval
- branch attempting an out-of-envelope tool call is refused and logged, run continues
- synthesizer fed zero completed branches records `insufficient-evidence`, never `consensus`

## 15. Success Criteria

### Platform success

- the platform can register and execute reusable deliberation patterns
- `review` and `debate` are implemented as the first two canonical patterns
- outputs are dual-form:
  - merged recommendation
  - structured assertions/objections/adjudication record
- evidence-backed rationale is enforced for source-sensitive work
- existing HITL principles remain unchanged

### Build Studio success

- Build Studio can invoke `review` in ideate and plan flows
- Build Studio can invoke `debate` for ambiguous or explicitly requested decisions
- the process graph shows deliberation branches and synthesis clearly
- users can understand why extra scrutiny happened without reading internal transcripts
- the platform surfaces `DeliberationRun.consensusState` truthfully using canonical values from §6.6:
  - `consensus` → UI: "Consensus reached"
  - `partial-consensus` → UI: "Partial consensus"
  - `no-consensus` → UI: "No consensus"
  - `insufficient-evidence` → UI: "Insufficient evidence"

## 16. Recommendation

Implement a reusable `Deliberation Pattern Framework` over the existing task-graph runtime, with:

- `review` and `debate` as the first two canonical patterns
- Build Studio as the first rich UX and visualization surface
- retrieval-first evidence requirements for source-sensitive work
- honest diversity reporting for same-model and mixed-provider flows
- unchanged HITL principles and approval gates

This gives the platform a clean, extensible way to support the quality-improvement behavior the user is already doing manually today:

- same-model different-persona critique when speed matters
- heterogeneous provider cross-checking when stakes and ambiguity rise
- graph-visible synthesis and evidence-backed rationale inside the platform rather than outside it
