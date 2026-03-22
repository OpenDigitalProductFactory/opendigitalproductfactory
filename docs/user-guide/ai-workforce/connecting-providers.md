---
title: "Connecting AI Providers"
area: "ai-workforce"
order: 2
lastUpdated: "2026-03-22"
updatedBy: "Claude (COO)"
---

## Overview

The platform connects to external AI providers to run inference for your AI workforce. Depending on the provider, you can authenticate using one of three methods: API Key, OAuth Sign-in, or None (for local providers). Each method is configured on the provider's detail page under External Services.

## Authentication Methods

### API Key

The standard method for providers with pay-per-token billing. Obtain a key from the provider's developer console and paste it into the provider detail page. The platform uses the key for every inference request.

Supported providers: Anthropic (API), OpenAI, Gemini, Mistral, and most other hosted providers.

### OAuth Sign-in

Browser-based authentication using your existing subscription. No API key is required. The platform redirects you to the provider's login page; once you authenticate, a token is stored securely (encrypted in the database) and refreshed automatically.

Supported providers: Claude / Anthropic (Max subscription), OpenAI Codex (ChatGPT Plus/Pro plan).

### None

Used for local providers that run on your machine or local network. No credentials are needed — the platform connects directly to the local endpoint.

Supported providers: Docker Model Runner, Ollama.

## How OAuth Works

1. Go to the provider's detail page (External Services > click the provider).
2. Select "OAuth (Sign in)" from the Authentication Method dropdown.
3. Click "Sign in with [Provider]".
4. Authenticate in your browser on the provider's website.
5. You are redirected back to the platform with a "Connected" status.
6. The token refreshes automatically — no manual intervention is needed.

## Choosing the Right Method

- If you have a subscription (Claude Max, ChatGPT Plus/Pro) — use OAuth.
- If you have an API account with billing — use API Key.
- If you are running models locally — use None (auto-detected).

Some providers support both OAuth and API Key. You can switch between methods on the provider detail page at any time. Disconnecting an OAuth connection clears the stored token immediately.

## Troubleshooting

- **"Token expired"** — click Sign In again to re-authenticate. This is the only action required.
- **"Provider not configured"** — verify that an API key or OAuth connection has been set up for this provider.
- **"No eligible endpoints"** — the provider needs at least one profiled model. Click "Sync Models & Profiles" on the provider detail page.
