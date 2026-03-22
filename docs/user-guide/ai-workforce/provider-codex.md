---
title: OpenAI Codex
area: ai-workforce
order: 4
lastUpdated: "2026-03-22"
updatedBy: "Claude (COO)"
---

## Overview

OpenAI Codex is an agentic coding specialist that runs tasks with tool use, sandboxed execution, and persistent threads. Unlike standard LLM providers, Codex is designed for autonomous code generation and execution rather than conversational chat.

## Two Authentication Paths

### OAuth Subscription (ChatGPT Plan)

- Uses your ChatGPT Plus, Pro, Team, Edu, or Enterprise plan
- Sign in with your OpenAI account — no API key needed
- Billing is included in your ChatGPT subscription
- This is the recommended setup for most users

### API Key (Pay-per-token)

- Uses an OpenAI API key with a funded billing account
- Pay-per-token pricing
- Requires a separate funded API account (not the same as your ChatGPT subscription)
- Important: a ChatGPT subscription does NOT fund the API account — they are separate billing systems

## Setting Up OAuth

1. Navigate to External Services and click "OpenAI Codex"
2. Select "OAuth (Sign in)" from the Authentication Method dropdown
3. Click "Sign in with OpenAI Codex"
4. Sign in with your OpenAI account
5. Select your organization and project when prompted (do not skip this step)
6. The platform stores an encrypted token that auto-refreshes

Note: The OAuth callback uses a dedicated port (1455) on localhost. This is required by OpenAI's shared client configuration and is handled automatically by the platform.

## Agent Provider vs Standard Provider

Codex is categorized as an "agent" provider, which means it behaves differently from standard LLM providers:

- **Model discovery**: Models cannot be discovered via the standard /v1/models API when using OAuth subscription. Models are defined in the platform registry and updated when OpenAI announces changes.
- **Test connection**: When using OAuth, the test verifies that the credential is valid rather than making an API call (subscription tokens use a different backend than the standard API).
- **MCP service**: Codex has a linked MCP (Model Context Protocol) service called "OpenAI Codex Agent" that provides two tools: `codex` (start a coding session) and `codex-reply` (continue a thread). This service activates automatically when you connect via OAuth and deactivates when you disconnect.

## Linked MCP Service

When you connect Codex via OAuth, the platform automatically activates the "OpenAI Codex Agent" MCP service. This allows the platform's AI coworker agents to dispatch coding tasks to Codex.

The MCP service:

- Activates automatically on OAuth connect
- Deactivates automatically on OAuth disconnect
- Provides `codex` and `codex-reply` tools
- Runs via stdio transport (managed by the platform)

You can view the MCP service status on the External Services page under "Activated MCP Services".

## ChatGPT Provider (Automatic)

When you connect Codex via OAuth, the platform automatically activates a second provider called "ChatGPT (OpenAI Subscription)". This gives the AI coworker access to GPT chat models (currently GPT-5.4) using your same ChatGPT subscription -- no separate configuration needed.

The ChatGPT provider uses a different backend endpoint (`chatgpt.com/backend-api`) and the OpenAI Responses API format. This is necessary because ChatGPT subscription tokens cannot access the standard OpenAI platform API (`api.openai.com`).

You can also sign in from the ChatGPT provider page directly -- it uses the same OpenAI OAuth. Either way, both providers share the token.

## Technical Notes (Provider Integration)

The ChatGPT/Codex integration has several non-obvious requirements:

- **Endpoint**: ChatGPT subscription tokens use `chatgpt.com/backend-api/codex/responses`, NOT `api.openai.com/v1/chat/completions`. The standard API rejects subscription tokens with 403.
- **API format**: The backend uses the OpenAI Responses API (not Chat Completions). Request format: `{ model, input, instructions, store: false, stream: true }`.
- **Streaming mandatory**: The backend requires `stream: true`. The platform collects the SSE stream and extracts the `response.completed` event.
- **Store must be false**: The backend requires `store: false` for subscription tokens.
- **Model IDs**: Only Codex-supported model IDs work (`gpt-5.4`, `gpt-5.3-codex`, etc.). Standard model names like `gpt-4o` or `codex-mini-latest` are rejected.
- **No model discovery**: The backend has no `/v1/models` equivalent. Models are seeded by the platform, not discovered.
- **Credential sync**: Both providers share one OAuth token. Token refresh on either side syncs to the other.
- **Greenfield install**: The `docker-entrypoint.sh` runs `sync-provider-registry.ts` before `seed.ts` to ensure the chatgpt provider row exists before model seeding.

## Troubleshooting

- "HTTP 403 on Test Connection with API Key" -- your OpenAI API account needs funding. The ChatGPT subscription does not fund API access.
- "HTTP 403 on Sync Models" -- model discovery is not available with OAuth subscription tokens. Models are managed via the platform registry.
- "Organization and project prompt" -- you must select these during OAuth sign-in. Skipping causes the flow to fail.
- "Port 1455 unreachable" -- ensure the platform's Docker container has port 1455 mapped (this is configured in docker-compose.yml).
- "Store must be set to false" -- internal error if `store: false` is missing from the Responses API request body.
- "Stream must be set to true" -- internal error if `stream: true` is missing from the Responses API request body.
- "Model X is not supported when using Codex with a ChatGPT account" -- the model ID is wrong. Use `gpt-5.4` or another Codex-supported model, not `gpt-4o` or `codex-mini-latest`.
