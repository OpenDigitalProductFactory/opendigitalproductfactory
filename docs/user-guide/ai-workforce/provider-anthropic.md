---
title: "Claude / Anthropic"
area: ai-workforce
order: 3
lastUpdated: "2026-03-22"
updatedBy: "Claude (COO)"
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
4. Click Save, then Test Connection

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

If the subscription token expires, the platform automatically attempts to refresh it. If refresh fails, the provider status changes to "expired" and the admin must sign in again. The API Key provider is unaffected by subscription token issues — they are independent.
