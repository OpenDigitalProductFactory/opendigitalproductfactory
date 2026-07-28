# AI Coworker Development Principles

**Status:** Foundational specification
**Created:** 2026-03-31
**Authors:** Mark Bodman, Claude (Software Engineer)
**References:** Diversity of Thought Framework, IT4IT v3.0.1, EP-BUILD-HANDOFF spec

---

## Purpose

This document defines the architectural principles for developing AI Coworker agents within the Digital Product Factory. It is the governing specification for all future agent design, tool assignment, memory strategy, and multi-agent orchestration.

These principles are derived from production testing, industry framework research (Anthropic Agent SDK, OpenAI Agents SDK, LangGraph, CrewAI, AutoGen), and the platform's Diversity of Thought framework.

---

## Principle 1: Specialization Over Generalization

**A specialist with 5 focused tools outperforms a generalist with 40.**

### Rule
Each AI Coworker agent should have access to **no more than 10 tools** relevant to its current task. When tool count exceeds 15, tool selection accuracy degrades significantly, regardless of model capability.

### Implementation
Tools are tagged with the phases and contexts in which they are relevant. The platform filters the tool list before each agent invocation, presenting only the tools the agent needs for its current role.

```typescript
type ToolDefinition = {
  name: string;
  buildPhases?: BuildPhaseTag[];  // Only available during these phases
  // ... other fields
};
```

### Evidence
- Haiku with 40+ tools entered repetition loops calling wrong tools
- Haiku with 5-9 phase-filtered tools correctly generated code and called sandbox tools
- Industry consensus (Azure, Redis, all major frameworks): 3-5 tools per specialist is optimal

---

## Principle 2: Orchestrator-Worker Pattern

**A coordinator routes work to specialists. Specialists do not route to each other.**

### Rule
Multi-step workflows use a hierarchical orchestrator-worker pattern. The build pipeline acts as the orchestrator, dispatching each phase to the appropriate specialist agent. Agents do not hand off directly to each other — the orchestrator mediates all transitions.

### Implementation
Each build phase maps to a specialist agent:

| Phase | Agent Role | IT4IT Alignment | Model Tier |
|-------|-----------|----------------|-----------|
| Ideate | Product Designer | §5.2.1 Conceptualize | Standard (Haiku) |
| Plan | Architect | §5.2.4 Define Architecture | Standard (Haiku) |
| Build | Software Engineer | §5.3.3 Design & Develop | Frontier (Sonnet) |
| Review | QA / Scrum Master | §5.3.5 Accept & Publish | Standard (Haiku) |
| Ship | Operations Engineer | §5.4 Deploy + §5.5 Release | Standard (Haiku) |

### Rationale
- Simple phases (ideate, plan, review, ship) are deterministic workflows that smaller models handle well
- The build phase requires complex multi-step tool reasoning and code generation — it needs a stronger model
- This matches the industry pattern: cheap models for routing, expensive models for complex reasoning
- Token budget is 3-4x lower per call, enabling more iterations within rate limits

---

## Principle 3: Structured Handoffs, Not Conversation History

**Pass decisions and context, not transcripts.**

### Rule
When work transitions between agents (or between phases), the outgoing agent produces a **structured handoff document**. The incoming agent reads only this document — never the raw conversation history from the previous phase.

### Implementation
```typescript
interface PhaseHandoff {
  fromPhase: BuildPhase;
  toPhase: BuildPhase;
  summary: string;              // 2-3 sentences, plain language
  evidence: Record<string, unknown>;  // Phase-specific artifacts
  openIssues: string[];         // What the next agent should know
  userPreferences: string[];    // Decisions the user made
}
```

### Rationale
- Raw conversation history wastes tokens on irrelevant context (ideate discussion during build phase)
- Structured handoffs capture what matters: decisions, evidence, and user intent
- Each agent starts with a clean context window focused on its task
- Token reduction: ~16K per call → ~4K per call (3-4x improvement)

---

## Principle 4: Diversity of Thought in Agent Design

**Different agents should think differently, not just have different tools.**

### Rule
Each agent's system prompt defines three cognitive components from the Diversity of Thought framework:

| Component | What it defines | Example |
|-----------|----------------|---------|
| **Perspective** | How the agent frames the problem | Software Engineer sees "code structure"; Ops Engineer sees "deployment safety" |
| **Heuristics** | Strategies for finding solutions | Engineer uses test-driven development; Ops uses rollback-first deployment |
| **Interpretive Model** | What "good" means | Engineer optimizes for correctness; Ops optimizes for availability |

### Implementation
Agent system prompts explicitly declare their perspective, heuristics, and success criteria. This is not decorative — it determines which solutions the agent considers and which it misses.

When a complex problem requires multiple perspectives (a rugged landscape in Diversity of Thought terms), the orchestrator consults multiple specialists before deciding. The combined output exceeds what any single agent would produce.

### Rationale
- A team of diverse "good enough" agents outperforms a single "best" agent on complex problems
- Different perspectives reveal different solution peaks
- The IT4IT value streams already define distinct roles with different optimization targets
- This prevents the failure mode where every agent gives the same generic answer

---

## Principle 5: Selective Memory, Not Total Recall

**Remember decisions and rationale. Re-derive details from source.**

### Rule
The vector database (Qdrant) stores **salient context** — decisions, user preferences, design rationale, and cross-conversation insights. It does not store raw conversation transcripts, code content, or data that can be derived from the codebase or git history.

### What to Store

| Store | Example | Why |
|-------|---------|-----|
| User decisions | "User chose in-memory state over database for this demo" | Informs future suggestions |
| Design rationale | "Complaints tracker uses client-side state because it's a demo feature" | Prevents re-litigating decisions |
| Cross-conversation context | "The promoter image is JIT-built from the portal container" | Connects knowledge across sessions |
| Discovered constraints | "Anthropic subscription only gives Haiku access" | Prevents repeated failures |
| Quality patterns | "This user prefers Tailwind over CSS modules" | Personalizes agent behavior |

### What NOT to Store

| Skip | Example | Why |
|------|---------|-----|
| Raw conversation | "User said: build it now..." | Ephemeral, bulky, low signal |
| Code content | "The complaints page contains..." | Read from sandbox or git |
| Build artifacts | Test output, diffs, logs | Stored in FeatureBuild record |
| Transient state | "Build is in plan phase" | Query the database |

### Implementation
Each agent stores memories at natural decision points — not after every exchange. The memory is tagged with the agent role, build phase, and topic so retrieval is contextual.

Semantic recall uses the query context (current conversation + build phase) to retrieve the 5-8 most relevant memories. This is sufficient because memories are distilled to decisions and rationale, not raw detail.

### Rationale
- Token efficiency: memories should be dense (high information per token)
- Retrieval quality: fewer, more relevant memories beat many marginally relevant ones
- The details are always available from primary sources (codebase, git, database)
- Memory serves as an index into knowledge, not a copy of it

---

## Principle 6: Tools Must Be Self-Documenting

**If the model can't understand a tool from its schema, the schema is wrong.**

### Rule
Every tool definition includes:
- A **description** that explains what it does and when to use it
- **Parameter descriptions** with types, examples, and constraints
- **Required parameters** clearly marked

The build phase system prompt includes a **tool usage guide** that maps common tasks to specific tools with parameter examples.

### Implementation
```
TOOL GUIDE:
- To create a new file: write_sandbox_file(path, content) — content is the FULL file
- To modify existing file: read first, then edit_sandbox_file(path, old_text, new_text)
- To run commands: run_sandbox_command(command)
```

### Rationale
- Smaller models (Haiku) rely heavily on description quality for tool selection
- A model that sees `write_sandbox_file` with `content: "The full file content to write"` knows to pass the entire file
- A model that sees only `content: string` may omit it or pass a description instead
- This is the difference between a tool call succeeding and entering a retry loop

---

## Principle 7: Human-in-the-Loop at Phase Boundaries

**The human approves transitions, not individual tool calls.**

### Rule
Human approval gates exist at **phase boundaries** (ideate → plan, plan → build, review → ship), not at individual tool calls within a phase. Within a phase, the agent operates autonomously using its scoped tools.

Exception: `executionMode: "proposal"` tools present a card for approval before executing side effects that affect production (deploying to production, registering products, modifying user data).

### Implementation
- Phase transitions require the agent to save evidence and pass a quality gate
- Quality gates are deterministic checks (design review required, tests must pass)
- The human sees a summary and approves/rejects/requests changes
- Within a phase, the agent calls tools freely without per-call approval

### Rationale
- Per-call approval breaks the agent's reasoning flow and wastes the user's time
- Phase-boundary approval gives the human meaningful decision points
- Proposal tools handle the exceptions where individual actions need approval
- This matches the IT4IT value stream gate model

---

## Principle 8: Fail Fast, Explain Clearly

**Stop on the first error. Don't retry blindly. Tell the user what happened.**

### Rule
When a tool call fails, the agent should:
1. Report the error in plain language
2. Explain what it was trying to do
3. Suggest what the user can do (if applicable)
4. Stop — do not retry the same call with the same arguments

The agentic loop enforces a **tool repetition limit** (3-5 calls of the same tool). This is a safety net, not a feature — agents should not need it if they handle errors correctly.

### Rationale
- Blind retries waste tokens and rate limit budget
- Users need to understand what happened to provide guidance
- The repetition limit exists because smaller models sometimes loop — but well-prompted agents with focused tool sets rarely trigger it

---

## Principle 9: Responsible Capacity Utilization

**Use paid AI capacity for governed value, not empty activity.**

### Rule
AI coworkers should treat available paid capacity as an operating asset. When authorized work is available, idle capacity is waste. When no useful, safe, evidence-producing work is available, the coworker should record or surface the blocker rather than spend tokens to appear busy.

Useful capacity work includes:
- reducing human cognitive load
- advancing approved backlog work
- producing durable work products
- running verification and capturing evidence
- reviewing stale specs, plans, PRs, or runtime state
- identifying capability gaps
- converting repeated work into proceduralization candidates

### Implementation
Capacity use should be driven by Standing Orders, calendar/availability state, safe work queues, and existing authority controls. Coworkers may continue low-risk governed work when humans are unavailable, but must stop at approval boundaries for consequential actions.

### Rationale
A salaried employee who does nothing while valuable work exists wastes organizational capacity. Fixed-price or subscription AI capacity has the same economic shape. The goal is not to burn tokens. The goal is to convert available capacity into reviewed work, evidence, learning, and platform improvement.

---

## Application

These principles apply to:
- All new agent development in the Build Studio pipeline
- AI Coworker conversations across all platform pages
- Agent tool registration and schema design
- Memory and context management
- Multi-agent orchestration and handoff
- External coding agents working on DPF, including Codex and Claude, through the canonical project rulebook

When these principles conflict with expediency, the principles win. A well-structured agent that works reliably is worth more than a quick hack that fails unpredictably.

---

## Principle 10: Query The Canonical Business Product Boundary

**Do not turn business products into digital architecture or invent the people
who consume them.**

### Rule

When an AI coworker needs to reason about what an organization sells, it queries
the organization-scoped `ProductLine` and `Product` hierarchy under **Goods and
Services for Sale**. `DigitalProduct` remains the architecture record for
software, data, and digital platforms. Storefront archetypes and taxonomy nodes
are reference definitions; neither is the organization's mutable product truth.

For selectable commercial objects, continue through
`ProductOffering → CatalogItem`. `StorefrontItem` is a channel projection and
must not become a second price/name authority. `ServiceOffering` continues to
own DigitalProduct operational commitments; follow its optional
`commercialOffering` trace only when that link was explicitly recorded.

The organization is the default provider for a simple business. Consumer claims
must be derived from real customer, booking, order, subscription, or fulfilment
evidence. Product-line capture alone never proves a product team, business unit,
subscriber, entitlement, or consumer.

### Implementation

- filter product lines and products by `organizationId` and `effectiveTo: null`;
- follow `ProductLine.parentId` for rollups while preserving organization scope;
- use `CatalogItem` as the exact selectable/requestable object for storefront,
  quote, sales-desk, partner, and mobile-channel reasoning;
- query bundle, price-list, promotion, and channel-eligibility rows through the
  organization-scoped CatalogItem boundary; never treat Storefront projection
  fields as a second packaging authority;
- resolve price and promotion windows against an explicit `asOf` time, prefer
  an exact SKU price over the catalog-item default, and preserve the selected
  identifiers in the commercial snapshot;
- count a package sale once; component allocations are non-additive analysis
  attributes and must not be summed into a second revenue total;
- read a quote line's immutable `configurationSnapshot` for one-off choices and
  its `catalogSkuId` for an exact reusable choice; do not promote a one-off
  snapshot to a reusable SKU unless the operator deliberately does so;
- use `StorefrontArchetypeComposition.productLineId` only as channel provenance;
- defer any business-product-to-digital-product trace until a later governed
  phase has real endpoint evidence and a consuming workflow;
- prefer business Products when generating "what we sell" WWWD context, with
  legacy DigitalProduct/ServiceOffering reads only as a migration fallback.

### Rationale

The provider-consumer boundary is stable from a one-person business to a large
enterprise. Scale changes disclosure and reporting detail, not the canonical
model. Keeping the query boundary explicit prevents plausible-sounding but
fabricated organization structure from entering plans, prompts, or reports.
