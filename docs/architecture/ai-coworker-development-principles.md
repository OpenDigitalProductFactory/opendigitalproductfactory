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

## Application

These principles apply to:
- All new agent development in the Build Studio pipeline
- AI Coworker conversations across all platform pages
- Agent tool registration and schema design
- Memory and context management
- Multi-agent orchestration and handoff

When these principles conflict with expediency, the principles win. A well-structured agent that works reliably is worth more than a quick hack that fails unpredictably.
