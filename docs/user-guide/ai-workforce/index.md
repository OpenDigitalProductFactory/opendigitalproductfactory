---
title: "AI Workforce"
area: ai-workforce
order: 1
---

## Overview

The AI Workforce area is where platform administrators configure the AI infrastructure that powers the platform's agents, coworkers, and automated capabilities. It manages which AI providers are active, how models are selected for different tasks, how the platform behaves when a provider is unavailable, and how agent authority and governance are enforced.

## Key Concepts

- **Provider Registry** — The list of AI providers connected to the platform (e.g., Anthropic/Claude, OpenAI/Codex, xAI/Grok, Docker Model Runner for local models). Each provider has its own credential path, status, sensitivity clearance, and set of available models.
- **Model Profiles** — Per-model configuration that controls routing behaviour: capability tier, cost sensitivity, latency requirements, and which task types the model is suitable for.
- **Routing** — The logic that selects which model handles a given request. Routing considers the task type, required capability level, current provider availability, and cost constraints.
- **Failover Chain** — The ordered sequence of fallback models to use if the primary model is unavailable or returns an error. Failover is automatic and transparent to users.
- **Token Spend** — Usage tracking per provider and model. Visible to admins to monitor cost and identify unexpected consumption patterns.
- **Finance Bridge** — When a provider is configured, the platform can seed finance ownership by linking the provider to a supplier, draft contract, and finance work items.
- **Tool Grants** — Each agent has a declared set of tool grants in `agent_registry.json` that control which platform tools it can invoke. Tool grants are enforced at runtime — an agent can only use tools that match its grants AND the user's role capabilities (effective permissions = user role intersection with agent grants).
- **HITL Tiers** — Human-In-The-Loop tiers define how much autonomy an agent has. Tier 0 = executive oversight required, Tier 1 = manager approval, Tier 2 = auto-approved with audit, Tier 3 = informational only.
- **Tool Evaluation Pipeline** — External tools (MCP servers, npm packages, APIs) must pass a multi-agent evaluation pipeline (security, architecture, compliance, integration) before adoption. See EP-GOVERN-002.

## What You Can Do

- Register new AI providers and configure their API keys and connection settings
- Review available models per provider and configure their routing profiles
- Set up failover chains to ensure continuity when a provider is degraded
- Monitor token spend and usage patterns across all active providers
- Hand off configured providers into Finance so supplier ownership and committed spend stay visible
- Manage agent-to-provider assignments for specific platform capabilities
- View the **Authority** tab to understand agent tool grants, HITL tiers, and escalation paths
- Review the **Action History** to see all agent proposals and their approval status
- Inspect the **Tool Execution Log** to audit every tool call made by any agent (who, what, when, result)
- Evaluate external tools via the **Tool Evaluation Pipeline** before adding them to the platform
- Connect external coding surfaces such as Claude, Codex, and Grok while keeping the same MCP, evidence, documentation, and PR gates as Build Studio
- Open **Runtime Health** to see which local services are required by enabled capabilities and which AI runtimes are managed by configured providers

## Related Routes

- `/platform/ai/providers/[providerId]` — provider setup and the Finance Bridge panel
- `/platform/ai/runtime-health` — capability-aware local service and external-provider health
- `/finance/spend/ai` — finance-owned view of AI supplier commitments and work items

## Reading Runtime Health

Runtime Health explains infrastructure in terms of enabled capabilities. **Required — unavailable** needs attention because an enabled capability depends on that local service. **Optional — inactive** is expected when its capability is disabled and does not make the platform unhealthy. **Optional — degraded** means the capability is enabled but its local service is unavailable. **External — provider managed** reports reconciled provider evidence rather than pretending the provider is a local container. Each state includes text and an action; color is supplementary.

## Authority & Governance

The **Authority** tab (`/platform/ai/authority`) provides visibility into the agent governance model:

### Agent Authority Overview
Each agent card shows:
- **Tool grant count** — how many platform tools the agent can invoke
- **HITL tier** — the autonomy level (0-3) determining approval requirements
- **Escalation path** — which human role receives escalations and the SLA
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

Use [Agent Development Environments](../getting-started/agent-dev-environments.md) to set up those external clients, and [Build Studio](../build-studio/index.md) for the guided operator workflow.
