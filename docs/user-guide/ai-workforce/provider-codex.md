---
title: OpenAI Codex
area: ai-workforce
order: 4
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

The sign-in asks OpenAI for offline access, which is what lets the platform renew the token on its own. Connections made before this was added have no renewal token: they stop working when the first token expires (about ten days after sign-in). If yours was connected before the upgrade, sign in once more so it can renew itself from then on.

Note: The OAuth callback uses a dedicated port (1455) on localhost. This is required by OpenAI's shared client configuration and is handled automatically by the platform.

## Agent Provider vs Standard Provider

Codex is categorized as an "agent" provider, which means it behaves differently from standard LLM providers:

- **Model discovery**: DPF automatically reads the connected sandbox's Codex model list. New models enter the catalog when that account and execution channel list them. A desktop client can show a different list because its version or account access differs. Saved profiles include history and do not prove current availability.
- **Save & verify connection**: Saves settings, prepares the model catalog, and sends a small inference request using an active model. OAuth checks use the subscription backend. Only a completed response verifies the connection and clears a previously recorded capacity cooldown for this provider. Account and data-use rules still determine which work can route there.

If OpenAI reports that the session token expired, verification attempts to renew it and checks the connection once more. If renewal cannot restore access, sign in again from Codex and retry verification. For the shared ChatGPT connection, use **Manage sign-in** in the panel above the connection form. Saving settings alone does not verify the connection.
- **Advanced diagnostics**: Opens model history, routing details and a manual refresh for troubleshooting. A failed refresh retains the previous catalog; results report models returned by that refresh and genuinely new records separately.
- **MCP service**: Codex has a linked MCP (Model Context Protocol) service called "OpenAI Codex Agent" that provides two tools: `codex` (start a coding session) and `codex-reply` (continue a thread). This service activates automatically when you connect via OAuth and deactivates when you disconnect.

Discovery for a selected Codex or ChatGPT account reads that account's subscription
CLI catalog. It uses a private CLI state directory and memory-only authentication;
simultaneous catalog reads do not replace each other's credentials. Missing,
disabled, or changed accounts fail without using another account. A failed read
preserves the last successful model-access result, and models absent from one
account are not retired for another account. Signing in or discovering models
does not establish permission to send sensitive data, and adding an account alone
does not enable account-aware execution routing.

The catalog process has a container-owned watchdog and removes its private state
after exit, including when the client disconnects. Credentials travel over process
stdin, not command arguments, shared auth files, or provider error logs. External
token login follows the [OpenAI app-server protocol](https://learn.chatgpt.com/docs/app-server).

## Coworker Verification on Development Deployments

On a platform-development deployment, an AI coworker with your existing delegated maintenance permissions can test an already active default ChatGPT or Codex subscription account without another approval request. The check sends a small verification request and can renew the account's existing session. It does not enable an account, change its data-use permissions, or switch to another account.

Inactive or disconnected accounts must be enabled or signed in through the existing account controls. New credentials, account activation, production changes and restricted-data actions keep their existing approval requirements.

## Linked MCP Service

When you connect Codex via OAuth, the platform automatically activates the "OpenAI Codex Agent" MCP service. This allows the platform's AI coworker agents to dispatch coding tasks to Codex.

The MCP service:

- Activates automatically on OAuth connect
- Deactivates automatically on OAuth disconnect
- Provides `codex` and `codex-reply` tools
- Runs via stdio transport (managed by the platform)

You can view the MCP service status on the External Services page under "Activated MCP Services".

## ChatGPT Provider (Automatic)

When you connect Codex via OAuth, the platform automatically activates a second provider called "ChatGPT (OpenAI Subscription)". This gives the AI coworker access to models available through your same ChatGPT subscription -- no separate configuration needed.

The ChatGPT provider uses a different backend endpoint (`chatgpt.com/backend-api`) and the OpenAI Responses API format. This is necessary because ChatGPT subscription tokens cannot access the standard OpenAI platform API (`api.openai.com`).

The ChatGPT provider page links to Codex with **Manage sign-in**. Use that link to connect or reconnect the shared account; both default providers share the token.

## Technical Notes (Provider Integration)

The ChatGPT/Codex integration has several non-obvious requirements:

- **Endpoint**: ChatGPT subscription tokens use `chatgpt.com/backend-api/codex/responses`, NOT `api.openai.com/v1/chat/completions`. The standard API rejects subscription tokens with 403.
- **API format**: The backend uses the OpenAI Responses API (not Chat Completions). Request format: `{ model, input, instructions, store: false, stream: true }`.
- **Streaming mandatory**: The backend requires `stream: true`. The platform collects the SSE stream and extracts the `response.completed` event.
- **Store must be false**: The backend requires `store: false` for subscription tokens.
- **Model IDs**: Use IDs returned for the connected account and execution channel. A model name in another client or public documentation does not establish access here.
- **Model discovery**: Codex reads the sandbox CLI catalog. ChatGPT attempts its backend catalog and falls back to the shared account's Codex catalog. Empty or failed inventories preserve the last good state. Two successful inventories that omit a cloud model retire its profile; local providers retain their exception for engine interruptions.
- **Credential sync**: Both providers share one OAuth token. Token refresh on either side syncs to the other.
- **Greenfield install**: The `docker-entrypoint.sh` runs `sync-provider-registry.ts` before `seed.ts` to ensure the chatgpt provider row exists before model seeding.

## Troubleshooting

- A failed readiness check shows the endpoint actually attempted. A network error, rejected request, or incomplete response leaves the existing capacity restriction in place. Retry after resolving the reported problem; signing in alone does not prove inference capacity.

- "HTTP 403 on Test Connection with API Key" -- your OpenAI API account needs funding. The ChatGPT subscription does not fund API access.
- "Model missing from diagnostics" -- compare the connected account and sandbox catalog with the other client. Automatic discovery cannot add access that the serving channel does not report.
- "Refresh failed" -- DPF keeps the last good catalog. Resolve the reported connection or service error and retry; there is no need to rebuild model profiles by hand.
- "Provider shows Expired, or disables itself with Re-authentication required" -- the token ran out and there was no renewal token to replace it. Sign in again from the Codex or ChatGPT provider page; both providers pick up the new token.
- "Organization and project prompt" -- you must select these during OAuth sign-in. Skipping causes the flow to fail.
- "Port 1455 unreachable" -- ensure the platform's Docker container has port 1455 mapped (this is configured in docker-compose.yml).
- "Store must be set to false" -- internal error if `store: false` is missing from the Responses API request body.
- "Stream must be set to true" -- internal error if `stream: true` is missing from the Responses API request body.
- "Model X is not supported when using Codex with a ChatGPT account" -- the model ID is wrong. Use `gpt-5.4` or another Codex-supported model, not `gpt-4o` or `codex-mini-latest`.
