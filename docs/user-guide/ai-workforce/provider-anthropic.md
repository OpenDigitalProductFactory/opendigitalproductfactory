---
title: "Claude / Anthropic"
area: ai-workforce
order: 3
---

## Overview

Anthropic provides Claude models. The platform supports two separate Anthropic providers for different billing models.

## Two Providers, One Vendor

### Claude / Anthropic (API Key)

- Uses a standard Anthropic API key from console.anthropic.com
- Pay-per-token billing (input and output tokens)
- Full API access including prompt caching and extended context windows
- Access to all Claude model families (Haiku, Sonnet, Opus)
- Best for: production workloads with predictable per-token costs

### Claude / Anthropic (OAuth Subscription)

- Uses your Claude Max subscription via OAuth sign-in
- Included in your subscription — no per-token cost
- Limited to Haiku-class models (claude-haiku-4-5, claude-3-haiku)
- No prompt caching or 1M context window
- Best for: teams already paying for Claude Max who want to use their subscription

## Setting Up OAuth Subscription

1. Navigate to External Services and click "Claude / Anthropic (OAuth Subscription)"
2. Select "OAuth (Sign in)" from the Authentication Method dropdown
3. Click "Sign in with Claude / Anthropic (OAuth Subscription)"
4. Sign in with your Claude account at claude.ai
5. The platform stores an encrypted token that auto-refreshes

After connecting:

- The provider status changes to "active"
- Click "Sync Models & Profiles" to discover available models
- 9 models are typically discovered (Haiku variants across versions)

## Setting Up API Key

1. Go to console.anthropic.com and create an API key
2. Navigate to External Services and click "Claude / Anthropic (API Key)"
3. Paste your API key (starts with sk-ant-api...)
4. If the key is organization-scoped, expand **Organization-scoped key** and enter its **Anthropic workspace ID**. Find the ID in Claude Console → Settings → Workspaces; it begins with `wrkspc_`. Leave this field blank for a key scoped to one workspace.
5. Save and verify the connection, then discover models.

Organization scope lets a personal or service-account key use workspaces that its linked identity can access. The workspace selection tells Anthropic where this connection's model requests and charges belong; it does not grant additional permissions. For a shared automated integration, Anthropic recommends a service-account key. API credits are separate from Claude subscription billing.

If an organization-scoped key returns HTTP 400, check that a workspace ID is configured and belongs to a workspace the linked identity can access. Changing or clearing the workspace requires connection verification again. This option does not configure billing-report access or workload identity federation.

See [Anthropic authentication and workspace selection](https://platform.claude.com/docs/en/manage-claude/authentication#select-a-workspace).

## Model Discovery

Both providers support automatic model discovery via "Sync Models & Profiles". The platform queries Anthropic's API, discovers available models, and creates routing profiles automatically. Models are profiled for capability tier, cost, and task suitability.

## Important Differences

| Feature | API Key | OAuth Subscription |
|---|---|---|
| Billing | Pay-per-token | Included in subscription |
| Models | All families | Haiku only |
| Prompt caching | Yes | No |
| Extended context | Yes (1M tokens) | No |
| Model discovery | Via API | Via API |
| Setup | Paste key | Browser sign-in |

## Fallback Behavior

The platform renews the subscription sign-in in the background about two hours before it expires, so it stays fresh even when no work is running and nobody has the provider page open. If a renewal fails, the platform tries again after 10 minutes, then 20, doubling up to every two hours, and the provider stays in routing while it retries.

Retrying stops only when Anthropic says the sign-in itself is no longer valid. When that happens, the Needs-you inbox shows **Sign in to Claude / Anthropic (OAuth Subscription) again**, linking to the provider page. Sign in there and background renewal starts again. A single failed request never takes a still-valid sign-in out of routing.

The API Key provider is unaffected by subscription token issues — they are independent.
