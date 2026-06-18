---
title: "xAI / Grok"
area: ai-workforce
order: 6
---

## Overview

xAI's Grok is a first-class direct AI provider, configured the same way as Anthropic and OpenAI on its provider detail page under **External Services**. It is treated as a standard token-billed provider in capability-tier routing — not special-cased — and it carries the same sensitivity-clearance and grant gating as every other external provider.

Two models are seeded for routing:

| Model | Class | Best for | Context |
|-------|-------|----------|---------|
| **Grok 4.3** | reasoning | Reasoning, analysis, long-context, tool use | 1M tokens |
| **Grok Build 0.1** | code | Agentic coding, web dev, Build Studio tasks, tool use | 256K tokens |

Both support tool use, streaming, structured output, images, thinking, and prompt caching. Because Build Studio OAuth connections can't call xAI's `/v1/models` discovery endpoint, these are seeded known models rather than discovered dynamically.

## Authentication

Grok supports two authentication methods. Choose either on the provider detail page; you can switch between them at any time.

### Device-code sign-in (recommended)

Obtaining an xAI API key from `console.x.ai` is poor UX, especially for a non-technical operator. Grok's CLI ships a clean **OAuth 2.0 device-code** flow, and the platform drives it for you rather than reimplementing xAI's OAuth in-portal:

1. On the xAI provider page, click **Sign in to Grok** (or let a coworker start it — see below).
2. The platform runs `grok login --device-auth` in the build sandbox and shows you a verification URL (`accounts.x.ai/oauth2/device`) plus a user code.
3. Open the URL in your browser, sign in with the account method you already use (Google / X / Apple), and confirm the code.
4. The platform reads the resulting `~/.grok/auth.json` out of the sandbox, stores it encrypted as the `xai` credential, and activates the provider.

On each Build Studio dispatch, the stored credential is injected into the build sandbox's `~/.grok/auth.json` and the CLI self-refreshes it; the platform reads the refreshed token back out and persists it so the next build uses the latest token.

### API key

The standard pay-per-token path: obtain a key from `console.x.ai` and paste it into the provider detail page. The platform sends it as the `Authorization` header against `https://api.x.ai/v1`. When the stored credential is an API key rather than an `auth.json` blob, dispatch falls back to `XAI_API_KEY`.

## Coworker-driven setup

Because the device-code flow runs entirely through governed tools, an AI coworker can drive Grok setup on your behalf instead of you navigating the provider page:

- **`grok_signin_start`** — initiates the device-code flow in the sandbox and returns the verification URL and user code for you to authorize in your browser.
- **`grok_signin_status`** — polls for completion: `ok` (credential captured and the xAI provider activated), `pending` (waiting for you to authorize), or `failed`.

Both tools require the `manage_provider_connections` capability and are recorded in the tool-execution log like any other governed action.

## Sensitivity Clearance

Like all external providers, Grok is assigned a sensitivity-clearance set (`public`, `internal`, `confidential`, `restricted`) on its provider page. Routing's hard filter refuses to send a request to Grok for data whose sensitivity its clearance does not cover. Local models remain the default for restricted data.

## Cost Model

Grok uses a per-token cost model. Configured-provider usage flows into the Finance module through the Finance Bridge, so Grok spend appears alongside other AI providers under `/finance/spend/ai`.

## Troubleshooting

- **"Sign in to Grok" shows no URL** — the `grok` binary must be present in the build sandbox. Ensure the sandbox image is current (the binary install landed with the EP-GROK-001 sandbox Dockerfile work).
- **Stuck on "Waiting for authorization…"** — the device-code flow blocks until you confirm the code in your browser. Re-run the sign-in if the code expired.
- **Token eventually goes stale** — OAuth-mode dispatch reads the CLI-refreshed token back out of the sandbox and persists it after each run; if a build hasn't run recently, the next dispatch refreshes it again.
- **"No eligible endpoints"** — the seeded Grok models should profile automatically; if not, click "Sync Models & Profiles" on the provider page.

## Related Specs

- `docs/superpowers/specs/2026-05-31-grok-first-class-support-design.md` — first-class Grok support (EP-GROK-001)
- `docs/superpowers/specs/2026-06-07-grok-device-code-oauth-design.md` — device-code OAuth for Build Studio dispatch
