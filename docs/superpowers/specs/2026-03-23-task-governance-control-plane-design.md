# Task Governance Control Plane Design

**Date:** 2026-03-23  
**Status:** Draft  
**Authors:** Mark Bodman + Codex (design partner)  
**Related existing epics:** `EP-AGENT-EXEC-001`, `EP-INF-008`, `EP-INF-011`, `EP-AI-UX`  
**Related existing specs:**  
- `2026-03-14-agent-execution-design.md`  
- `2026-03-16-unified-mcp-coworker-design.md`  
- `2026-03-16-orchestrated-task-routing-design.md`  
- `2026-03-17-development-lifecycle-architecture-design.md`  
- `2026-03-18-knowledge-driven-agent-capabilities-design.md`  
- `2026-03-20-adaptive-model-routing-design.md`  
- `2026-03-20-specialized-model-capabilities-design.md`  
- `2026-03-22-nvidia-provider-integration-design.md`

---

## Problem Statement

The platform already has strong building blocks for agent execution:

- contract-based routing and execution plans
- HITL proposal approval
- route telemetry and recipe performance
- build-phase orchestration
- semantic memory
- provider and specialist expansion

But it is still missing one higher-order operating layer:

1. Work is not yet represented as a durable parent task and subtask graph.
2. Specialist assignment is route-aware but not yet governed as explicit task-node employment.
3. Multi-agent review, skeptical review, and "wisdom of crowds" style signals have no structured place to attach.
4. Non-technical users still rely on chat turns and ad hoc tool invocation rather than reusable, self-maintaining workflow patterns.
5. External or inactive specialist resources can be surfaced, but not yet through a unified activation-proposal model tied to user need, cost, expertise, and policy alignment.
6. Session-scoped autonomy, consequence disclosure, and end-to-end execution-chain traceability need one canonical control plane instead of being spread across several subsystems.

The platform should not import a parallel swarm runtime. It should add a single control plane over the architecture already built.

---

## Goals

1. Add one platform-native control plane that governs task decomposition, specialist employment, approvals, evidence, and learning.
2. Preserve chat as the primary user surface while making orchestration, automation, and skills more effective underneath it.
3. Keep consensus, gossip, and crowd-style reasoning advisory only.
4. Require explicit, session-scoped authority for consequential actions, with consequence disclosure before authority is granted.
5. Let the coworker prepare activation proposals for inactive or not-yet-employed resources when there is a defensible financial, efficiency, expertise, or policy case.
6. Produce a complete execution chain for evidence, debugging, audit, and optimization.
7. Support a growing specialist ecosystem, including NVIDIA and future providers, without making users manage provider complexity directly.

## Non-Goals

1. Replacing the current routing stack.
2. Replacing chat with a graph UI.
3. Giving collective reasoning autonomous authority.
4. Enabling standing persistent autonomy by default.
5. Building a general-purpose distributed consensus substrate.
6. Making non-technical users manually create, repair, or clean up task graphs.

---

## Design Summary

Introduce a `Task Governance Control Plane` above the existing routing and execution stack.

The layers become:

1. **Chat and UX layer**  
   The primary human surface. Users work mainly through the AI coworker, with automation, skills, and proactive recommendations improving efficiency.

2. **Task Governance Control Plane**  
   The new control plane. It creates parent tasks and subtasks, attaches authority rules and evidence contracts, coordinates checkpoints, invokes specialist reviewers, prepares activation proposals, and records the execution chain.

3. **Existing routing and execution layer**  
   The current contract-based routing, execution recipes, provider/model selection, tool execution, and fallback logic remain responsible for selecting and running the best route for a unit of work.

The control plane governs how work is structured. The routing layer governs how a node is executed.

---

## Key Principles

### 1. Chat First

Chat remains the predominant surface. The graph exists behind the scenes.

### 2. Human Preference Informs the System

The platform should learn from what users accept, reject, repeat, or override, and turn that into safer and easier defaults rather than orchestration complexity.

### 3. Advisory Consensus Only

Collective reasoning, gossip, dissent, and public-opinion style signals are informative. They are not authority.

### 4. Session-Scoped Authority

Consequential authority expires with the session. Disconnect, timeout, or later return requires re-authorization.

### 5. Full Consequence Disclosure

Before granting authority, the platform must disclose route, resource use, important risks, likely consequences, and meaningful alternatives.

### 6. End-to-End Traceability

Every meaningful sub-agent and specialist contribution must be reconstructable, even if advisory.

### 7. Inherent Lifecycle

Graph creation, maintenance, pruning, reuse, and cleanup must be native platform behavior. Non-technical users should not manage graph hygiene manually.

---

## Research & Benchmarking

### Open Source Systems Compared

1. **Ruflo / Claude Flow ecosystem**  
   Source: [GitHub repo](https://github.com/ruvnet/ruflo), [README](https://raw.githubusercontent.com/ruvnet/ruflo/main/README.md)  
   Learned:
   - hierarchical agent coordination is a strong pattern
   - persistent memory and checkpointing matter
   - large specialist catalogs are useful only when governed
   - swarm-oriented coordination is powerful but easy to overshoot for business software

2. **LangGraph / LangGraph Supervisor**  
   Sources: [LangGraph docs](https://langchain-ai.github.io/langgraphjs/reference/modules/langgraph.html), [Supervisor docs](https://langchain-ai.github.io/langgraphjs/reference/modules/langgraph-supervisor.html), [LangMem docs](https://langchain-ai.github.io/langmem/)  
   Learned:
   - supervisor-managed specialized agents map well to platform task decomposition
   - checkpointers and long-term memory are first-class needs
   - HITL and controllability are more important than raw autonomy for production systems

3. **CrewAI**  
   Sources: [Introduction](https://docs.crewai.com/en/introduction), [Crews](https://docs.crewai.com/en/concepts/crews)  
   Learned:
   - crews and flows are a useful separation: workflow control vs agent collaboration
   - hierarchical and sequential processes should both exist
   - task delegation and stateful flows are the transferable parts, not broad multi-agent theater

### Commercial Systems Compared

1. **Microsoft Copilot Studio**  
   Sources: [Autonomous agents guidance](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/autonomous-agents), [Docs index](https://learn.microsoft.com/en-us/microsoft-copilot-studio/)  
   Learned:
   - scoped permissions, decision boundaries, and auditability are central
   - human-in-the-loop is treated as a first-class design primitive
   - the user-facing experience stays simple while governance remains explicit

2. **Google Vertex AI Agent Builder**  
   Sources: [Overview](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-builder/overview), [Product docs landing page](https://cloud.google.com/agent-builder)  
   Learned:
   - build / scale / govern is the correct lifecycle framing
   - sessions, memory, code execution, tools, and observability belong in one governed stack
   - agent catalogs and tool ecosystems need inventory and governance, not just connectivity

3. **Salesforce Agentforce**  
   Sources: [Get started](https://developer.salesforce.com/docs/ai/agentforce/guide/get-started.html), [Actions](https://developer.salesforce.com/docs/ai/agentforce/guide/get-started-actions.html), [Action chaining](https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-patterns-action-chaining.html), [Tools](https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-ref-tools.html)  
   Learned:
   - explicit actions and user confirmation work well for business users
   - deterministic chains plus optional LLM tool use is a good hybrid pattern
   - built-in confirmation and progress behavior fit non-technical users better than opaque autonomy

### Patterns Adopted

- hierarchical coordinator + specialist worker model
- stateful task decomposition
- explicit checkpoints and approvals
- long-term memory plus background learning
- action catalogs / specialist registries
- safe recommendation-first UX

### Patterns Rejected

- broad decentralized consensus as execution authority
- exposing graph complexity directly to non-technical users
- building a second standalone agent runtime alongside the platform
- raw provider catalog exposure without policy and business framing

### Gaps the Platform Should Fill

- tighter linkage between chat, task decomposition, specialist employment, and evidence
- session-scoped authority with explicit consequence disclosure
- activation proposals grounded in business justification
- integration of specialist ecosystem growth into the existing governed platform

---

## Architecture Tracks

The control plane should be delivered as three connected architecture tracks.

### Track A: Task Graph Orchestration

The substrate. It defines:

- parent tasks and subtasks
- dependency and checkpoint models
- authority envelopes
- evidence contracts
- execution-chain traceability
- graph lifecycle and cleanup

### Track B: Collective Reasoning and Skeptical Consensus

The advisory intelligence layer. It defines:

- multi-specialist review triggers
- skeptical review patterns
- dissent and objection handling
- gossip-style signal exchange
- confidence shaping for recommendations

This track never owns consequential authority.

### Track C: Specialist Ecosystem and Innovation Intake

The employable resource layer. It defines:

- specialist job taxonomy
- capability registry for providers, models, tools, and external resources
- activation proposal rules
- innovation intake for ecosystems such as NVIDIA
- promotion, retirement, and policy alignment

### Delivery Order

1. Track A first
2. Track B second
3. Track C third

This is required because B and C both attach to the durable task substrate in A.

---

## Governance Model

### Default Authority

Advisory only.

### Consequential Authority

Must be explicitly granted per session after disclosure of:

- recommended route
- resources/providers/specialists to be used
- expected benefits
- meaningful risks and consequences
- policy-aligned alternatives

### Activation Proposals

The platform may prepare activation proposals when there is a defensible:

- financial argument
- efficiency argument
- expertise or quality argument
- policy or organizational-objective argument

### Consensus

Consensus and crowd reasoning:

- may increase confidence
- may trigger caution
- may recommend escalation
- may not autonomously approve execution

### Traceability

Every meaningful step should be attributable to:

- objective
- decomposition choice
- worker role
- concrete route
- authority state
- evidence produced
- human decisions
- outcome

---

## Learning Loop

The control plane should improve defaults by learning from:

- accepted and rejected routes
- accepted and rejected activation proposals
- repeated manual behaviors
- successful decomposition patterns
- successful specialist assignments
- useful skeptical-review signals
- policy-route adherence

This learning should influence:

- recommended route selection
- default decomposition templates
- skill suggestions
- proposal wording
- specialist recommendations

It must not silently:

- expand authority
- enable new providers
- increase risk posture
- persist autonomy beyond the session

---

## Relationship to Existing Platform Components

The new control plane is additive to the current architecture.

### It reuses:

- `RequestContract`, execution recipes, and route selection
- `AgentThread` and `AgentActionProposal`
- `FeatureBuild` and build evidence
- route telemetry and recipe-performance feedback
- semantic memory
- specialist/provider classification

### It should not overload:

- `BacklogItem` as a runtime execution node
- `FeatureBuild` as the universal task graph
- `AgentThread` as the only state container for non-trivial work

### Canonical new shared concept

`TaskRun` becomes the canonical runtime orchestration container for governed work across:

- coworker sessions
- build workflows
- specialist reviews
- activation proposals
- future cross-domain business workflows

---

## Future Refactoring

1. Align build tasks currently embedded in `FeatureBuild.buildPlan.tasks` with the future canonical task-node model.
2. Gradually shift repetitive coworker patterns into reusable task templates and skills.
3. Unify route telemetry and execution-chain telemetry so node-level and route-level analytics compose cleanly.
4. Extend provider policy metadata so specialist employment recommendations can reason more directly about budget, compliance, and organizational objectives.

---

## Recommended Next Spec

The first implementation spec under this umbrella should be:

- `2026-03-23-task-graph-orchestration-design.md`

That spec defines the canonical data model, lifecycle, authority envelope, evidence contract, and integration points needed before collective reasoning and specialist ecosystem governance can be layered on top.
