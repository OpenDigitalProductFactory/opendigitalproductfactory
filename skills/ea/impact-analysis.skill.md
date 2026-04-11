---
name: impact-analysis
description: "Analyse what is affected if a component changes using the EA model"
category: ea
assignTo: ["ea-architect"]
capability: "view_ea_modeler"
taskType: "analysis"
triggerPattern: "impact|dependency|what changes|trace"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Impact Analysis

The user wants to know what is affected if a component changes. Use the PAGE DATA to reason about the visible model. Describe the dependency chain in plain language.

## Steps

1. Identify the component the user wants to analyse from PAGE DATA or their message.
2. Trace upstream dependencies: what does this component depend on?
3. Trace downstream dependents: what depends on this component?
4. Identify cross-layer impacts (e.g., a technology change affecting application and business layers).
5. Summarise the blast radius in plain language.
6. Recommend risk mitigation steps if the impact is broad.

## Guidelines

- Always describe impacts in business terms, not just technical jargon.
- Use a dependency chain format: A -> B -> C to show propagation.
- If PAGE DATA is insufficient, state what additional model data would be needed.
- Flag any single points of failure discovered during the analysis.
- Keep the analysis scoped to what is visible — do not speculate beyond the data.
