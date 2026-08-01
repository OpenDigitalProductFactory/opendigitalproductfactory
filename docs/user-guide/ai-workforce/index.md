---
title: "AI Workforce"
area: ai-workforce
order: 1
---

## Overview

AI Workforce is the directory and management home for the people-like AI roles that work in DPF. Start here to find who can help, what work they offer, whether that work is available for the current business type, and how much approval or review it requires.

Coworkers are grouped from customer-facing work inward:

1. **Customers and sales**
2. **Your team**
3. **Operations and delivery**
4. **Platform and back office**
5. **Other** — work that has not yet been explicitly classified

Provider, model, prompt, skill, runtime, and decision evidence remains available, but it is supporting detail rather than the directory's starting point.

The grouping describes the work a coworker offers, not where the coworker's
identity sits in the workforce hierarchy. A coworker appears in one of the four
areas only when an active service is assigned there. Unassigned work remains in
**Other** instead of being guessed from a title or team.

## Find and Work With a Coworker

1. Open `/platform/ai/overview`.
2. Search by coworker name or the work you need done.
3. Filter by business area, interaction, availability, or attention state. Additional profession and lifecycle filters are under **More filters**.
4. Read the three compact signals on each coworker: who they interact with, whether their declared work supports this business type, and their approval/autonomy posture.
5. Choose **View coworker** for the full record.
6. Choose the named action, such as **Ask Marketing**, when the coworker is **Available for your business type**. This opens the selected coworker in the existing panel without sending a message for you.

The roster keeps filter state in the URL. Returning from a coworker record restores the same directory view.

An availability label is not a runtime guess. It is projected from the current storefront business type, explicit coworker service declarations, enabled skill assignments, registered tools, effective grants, lifecycle certification, governed blockers, and the same routing requirements used for a representative task from that service. Those routing requirements include task type, tool use, sensitivity clearance, capability and context floors, Golden Triangle priority, model assignment, policy, capacity, and local-only settings. Provider and model assignments are preferences: an eligible fallback may keep work available, while a provider known to need reauthentication or billing repair is not advertised as ready. **Available** means at least one applicable advertised service has verified backing and an eligible task route. The searchable work, area, job description, interaction labels, availability, and named Ask action all describe that same service. A ready service does not make unresolved sibling work ready; each sibling and its evidence remain visible under **Availability evidence**.

Missing declarations or unevaluated readiness appear as **Coverage not defined**. Missing backing appears as **Setup needed**, and lifecycle, safety, or routing blockers appear as **Needs attention**. These states fail closed and do not show the Ask action. A recovery action appears only when DPF has an owner-capable destination that the signed-in operator can access, such as business type, capabilities, capability needs, the runnable certification job, or AI readiness. Platform-managed catalog defects remain visible in Availability evidence without a misleading operator action. Coworker-specific actions preserve the current roster filters. Opening a named Ask action never sends work automatically; the operator must submit a message explicitly.

Model assignments explicitly saved by an operator remain unchanged during upgrades. Platform-supplied defaults are system-owned and converge to the current release declaration, so an obsolete default from an earlier release cannot silently leave a coworker unavailable after the platform has corrected that default.

## Key Concepts

- **Provider Registry** — The list of AI providers connected to the platform (e.g., Anthropic/Claude, OpenAI/Codex, xAI/Grok, Docker Model Runner for local models). Each provider has its own credential path, status, sensitivity clearance, and set of available models.
- **Model Profiles** — Per-model configuration that controls routing behaviour: capability tier, cost sensitivity, latency requirements, and which task types the model is suitable for.
- **Routing** — The logic that selects which model handles a given request. Routing considers the task type, required capability level, current provider availability, and cost constraints.
- **Failover Chain** — The ordered sequence of fallback models to use if the primary model is unavailable or returns an error. Failover is automatic and transparent to users.
- **Token Spend** — Usage tracking per provider and model. Visible to admins to monitor cost and identify unexpected consumption patterns.
- **Finance Bridge** — When a provider is configured, the platform can seed finance ownership by linking the provider to a supplier, draft contract, and finance work items.
- **Tool Grants** — Each agent has a declared set of tool grants in `agent_registry.json` that control which platform tools it can invoke. Tool grants are enforced at runtime — an agent can only use tools that match its grants AND the user's role capabilities (effective permissions = user role intersection with agent grants).
- **Approval and autonomy** — The owner-facing record projects existing oversight and governance evidence into plain labels: **Cannot act**, **Advises only**, **Prepares work for approval**, **Acts with approval**, **Acts with review**, or **Can act within limits**. Incomplete or contradictory evidence appears as **Approval rules need review**.
- **Tool Evaluation Pipeline** — External tools (MCP servers, npm packages, APIs) must pass a multi-agent evaluation pipeline (security, architecture, compliance, integration) before adoption. See EP-GOVERN-002.

## What You Can Do

- Register new AI providers and configure their API keys and connection settings
- Find coworkers by business area, customer/partner interaction, business-type availability, approval posture, and attention state
- Open one coworker record with six sections: **Overview**, **Work Offered**, **Availability**, **Capabilities**, **Autonomy & Governance**, and **Activity**
- Open the selected coworker in the shared panel without creating a second conversation surface
- Review available models per provider and configure their routing profiles
- Set up failover chains to ensure continuity when a provider is degraded
- Monitor token spend and usage patterns across all active providers
- Hand off configured providers into Finance so supplier ownership and committed spend stay visible
- Manage agent-to-provider assignments for specific platform capabilities
- Optionally give the standing COO a conversational name from its coworker record; DPF always keeps the `AI COO` role visible and does not change the coworker's identity, authority, or audit attribution
- View the **Authority** tab to understand agent tool grants, oversight levels, and escalation paths
- Review the **Action History** to see all agent proposals and their approval status
- Inspect the **Tool Execution Log** to audit every tool call made by any agent (who, what, when, result)
- Open a coworker record to review **Living Playbooks** and see when the platform is testing a better method
- Evaluate external tools via the **Tool Evaluation Pipeline** before adding them to the platform
- Connect external coding surfaces such as Claude, Codex, and Grok while keeping the same MCP, evidence, documentation, and PR gates as Build Studio
- Open **Runtime Health** to see which local services are required by enabled capabilities and which AI runtimes are managed by configured providers

## Related Routes

- `/platform/ai/overview` — customer-first coworker directory
- `/platform/ai/agent/[agentId]` — selected coworker record and work entry
- `/platform/ai/providers/[providerId]` — provider setup and the Finance Bridge panel
- `/platform/ai/agent/AGT-ORCH-000` — standing COO record, including its optional organization-visible conversational name
- `/platform/ai/runtime-health` — capability-aware local service and external-provider health
- `/finance/spend/ai` — finance-owned view of AI supplier commitments and work items

## Reading Runtime Health

Runtime Health explains infrastructure in terms of enabled capabilities. **Required — unavailable** needs attention because an enabled capability depends on that local service. **Optional — inactive** is expected when its capability is disabled and does not make the platform unhealthy. **Optional — degraded** means the capability is enabled but its local service is unavailable. **External — provider managed** reports reconciled provider evidence rather than pretending the provider is a local container. Each state includes text and an action; color is supplementary.

### Context budget: what recent turns were given

Every coworker turn assembles context — page data, recalled facts, prior conversation — against a token budget for the model running it. When it does not all fit, the least important sources are shortened or left out. **Context budget** is a collapsed panel at the foot of Runtime Health that reports what was left out, across the most recent turns that recorded a decision.

Expand it when a coworker seems not to know something it should. It separates three cases that otherwise look identical: the fact was never found, it was found but left out for budget, or it was supplied and the model did not use it. The first two show here; the third does not, which is itself the answer.

It reports **what was withheld from the model, not whether the reply was worse for it** — that judgement stays yours. "No turns recorded a trace" means nothing has arbitrated in the sample yet, which is different from nothing being left out. If one source dominates the table, that is the candidate for a larger budget or a smaller payload.

## Authority & Governance

The **Authority** tab (`/platform/ai/authority`) provides visibility into the agent governance model:

### Agent Authority Overview
Each agent card shows:
- **Tool grant count** — how many platform tools the agent can invoke
- **Oversight** — how much employee involvement the coworker needs: **Employee only**, **Needs approval**, **Employee review**, or **Runs on its own**. Stored internally as the HITL tier (0-3); "HITL" is the technical name for the same setting, and the portal shows the plain label.
- **Escalation path** — which employee role receives escalations and the SLA
- **Value stream** — which IT4IT value stream the agent operates in

### Tool Execution Log
Every tool call — not just proposals — is recorded in the `ToolExecution` table with:
- Which agent made the call
- Which user triggered the conversation
- What tool was called, with what parameters
- Whether it succeeded or failed, and how long it took

Filter by agent, tool name, success/failure, or time range to answer questions like:
- "What did AGT-190 (Security Auditor) do last week?"
- "How many backlog items were created by agents this month?"
- "Which tools are failing most often?"

### Effective Permissions
Agent tool availability is the **intersection** of two authority systems:
1. **User role capabilities** — what the logged-in user's platform role allows (HR-000 through HR-500)
2. **Agent tool grants** — what the agent's declared grants in `agent_registry.json` permit

An action is only possible if BOTH allow it. This prevents agents from exceeding their design scope, even when triggered by a user with broad permissions.

## Living Playbook experiments

An approved Living Playbook candidate can carry an evidence-cleared replay definition. For those
candidates, DPF schedules a bounded shadow experiment automatically; approval still does not make
the candidate active.

The coworker record shows **Testing a better method**, the number of valid comparison pairs, the
evidence origin, the current result, and whether more evidence is needed. Expand **Experiment
evidence details** for method/model factors, corpus and oracle versions, invalid-pair reasons,
freshness, and engineer IDs.

Only immutable, versioned replay fixtures execute autonomously in this first lane. The compared
provider or model is evidence, while the orchestrating coworker remains the accountable agent in
the audit ledger. Missing fixtures, live-environment requests, mutable code-workspace work, and
authority-ceiling cases stop without activation or customer-state mutation.

When the required comparison cells are complete, fresh, non-regressing, and within the promotion
policy's activity and risk ceiling, DPF can activate the winning method without another approval.
Activation is limited to the installations, organizations, task corpora, and model profile proven
by that evidence. It never adds tool authority. The coworker's **Living Playbooks** panel shows the
active method, where it may run, when its evidence was last checked, and what evidence is still
needed before broader use.

A rejected candidate remains useful negative knowledge: DPF will not repeat the materially same
experiment unless the corpus, model, oracle, or promotion policy changes. If an active method later
regresses, DPF rolls back to the recorded prior-safe method and retains both versions in the audit
history. Unsupported risks, regulatory human-control requirements, and missing rollback targets
still escalate.

## Tool Evaluation Pipeline

External tools must be evaluated before adoption (EP-GOVERN-002). The pipeline runs 6 agents with different perspectives:

| Agent | Role | What It Checks |
|-------|------|---------------|
| AGT-112 (Gap Analysis) | Discovery Scout | Searches registries, finds 2-5 candidates |
| AGT-190 (Security Auditor) | Security Review | CoSAI 12-category threat checklist |
| AGT-181 (Architecture Guardrail) | Architecture Fit | Trust boundaries, coupling, API surface |
| AGT-902 (Data Governance) | Compliance | License, data residency, regulatory |
| AGT-131 (SBOM Management) | Integration Test | Sandboxed install, smoke tests, rollback |
| AGT-111 (Investment Analysis) | Risk Adjudicator | Final GO/CONDITIONAL/REJECT verdict |

Approved tools are version-pinned with conditions and scheduled for periodic re-evaluation.

## Development Surfaces

Build Studio is the guided in-product development surface. Claude, Codex, and Grok are first-class external agent surfaces for contributors who need direct source access. All of them use the same DPF MCP coordination plane, branch/worktree isolation, evidence gates, documentation impact check, DCO-signed PR process, and release-readiness rules.

Use [Agent Development Environments](../contributing/agent-dev-environments.md) to set up those external clients, and [Build Studio](../build-studio/index.md) for the guided operator workflow.
