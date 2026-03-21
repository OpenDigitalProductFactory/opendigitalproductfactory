---
title: "AI Workforce"
area: ai-workforce
order: 1
lastUpdated: 2026-03-21
updatedBy: Claude (COO)
---

## Overview

The AI Workforce area is where platform administrators configure the AI infrastructure that powers the platform's agents, coworkers, and automated capabilities. It manages which AI providers are active, how models are selected for different tasks, and how the platform behaves when a provider is unavailable.

## Key Concepts

- **Provider Registry** — The list of AI providers connected to the platform (e.g., Anthropic, OpenAI, Ollama for local models). Each provider has its own API key, status, and set of available models.
- **Model Profiles** — Per-model configuration that controls routing behaviour: capability tier, cost sensitivity, latency requirements, and which task types the model is suitable for.
- **Routing** — The logic that selects which model handles a given request. Routing considers the task type, required capability level, current provider availability, and cost constraints.
- **Failover Chain** — The ordered sequence of fallback models to use if the primary model is unavailable or returns an error. Failover is automatic and transparent to users.
- **Token Spend** — Usage tracking per provider and model. Visible to admins to monitor cost and identify unexpected consumption patterns.

## What You Can Do

- Register new AI providers and configure their API keys and connection settings
- Review available models per provider and configure their routing profiles
- Set up failover chains to ensure continuity when a provider is degraded
- Monitor token spend and usage patterns across all active providers
- Manage agent-to-provider assignments for specific platform capabilities
