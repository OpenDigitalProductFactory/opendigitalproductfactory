---
name: add-provider
description: "Help add and configure a new AI provider"
category: platform
assignTo: ["platform-engineer"]
capability: "manage_provider_connections"
taskType: "conversation"
triggerPattern: "add provider|new provider|register"
userInvocable: true
agentInvocable: true
allowedTools: [add_provider]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Add a New AI Provider

Help me add and configure a new AI provider.

## Steps

1. Ask the user which provider they want to add (e.g., OpenAI, Anthropic, local model).
2. Gather connection details: endpoint URL, API key, model name.
3. Ask about priority and capability mapping (which tasks this provider handles).
4. Use `add_provider` to register the provider.
5. Confirm the provider was added and suggest testing the connection.

## Guidelines

- Never display API keys in full — mask them after collection.
- Validate the endpoint URL format before submitting.
- Explain the priority system: higher priority providers are tried first.
- If the provider type is already registered, ask if this is an additional instance or a replacement.
- Suggest running a test prompt after registration to verify connectivity.
