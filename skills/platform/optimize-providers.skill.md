---
name: optimize-providers
description: "Rebalance AI provider priorities for best capability-per-dollar"
category: platform
assignTo: ["platform-engineer"]
capability: "manage_provider_connections"
taskType: "analysis"
triggerPattern: "optimize|rebalance|cost|priority"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Optimize Provider Priorities

Run the provider priority optimization — rebalance for best capability-per-dollar.

## Steps

1. Review PAGE DATA for the current provider configuration and usage stats.
2. Analyse each provider: cost per token, capability level, reliability, latency.
3. Identify inefficiencies: expensive providers handling simple tasks, underused cheap providers.
4. Recommend a rebalanced priority order with rationale for each change.
5. Estimate the cost savings from the recommended changes.

## Guidelines

- Present the current vs. recommended configuration side by side.
- Always explain the trade-offs: cost vs. quality vs. speed.
- Do not change priorities without the user's approval.
- If usage data is insufficient, recommend a monitoring period before optimization.
- Consider task routing: complex tasks to capable models, simple tasks to efficient ones.
