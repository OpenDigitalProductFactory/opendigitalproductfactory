---
name: token-spend
description: "Summary of token usage and costs across providers"
category: platform
assignTo: ["platform-engineer"]
capability: "view_platform"
taskType: "analysis"
triggerPattern: "token|usage|cost|spend"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Token Spend Summary

Show me a summary of token usage and costs.

## Steps

1. Review PAGE DATA for token usage metrics and provider cost data.
2. Break down usage by provider, model, and time period.
3. Calculate total spend and cost per conversation or task.
4. Identify the highest-cost activities and providers.
5. Show trends: is usage growing, stable, or declining?
6. Suggest cost reduction opportunities if any are apparent.

## Guidelines

- Present numbers in a clear table format.
- Use consistent units (tokens, dollars, time periods).
- Compare against any budget or threshold if configured.
- If historical data is limited, note the data window and avoid extrapolating.
- Highlight any anomalies: sudden spikes, unusually expensive sessions.
