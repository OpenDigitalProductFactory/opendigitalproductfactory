---
title: "Connecting AI Providers"
area: "ai-workforce"
order: 2
relatedCode:
  - apps/web/lib/ai-inference.ts
---

## Overview

The platform connects to external AI providers to run inference for your AI workforce. Depending on the provider, you can authenticate using one of three methods: API Key, OAuth Sign-in, or None (for local providers). Each method is configured on the provider's detail page under External Services.

Authentication proves only that a connection works. Before using company or customer data, also identify whether the connected account is personal/individual, business/team, enterprise, or unknown, and review its contract, retention, training, and processing-region terms. DPF keeps unreviewed hosted connections limited to public or synthetic work.

## Authentication Methods

### API Key

The standard method for providers with pay-per-token billing. Obtain a key from the provider's developer console and paste it into the provider detail page. The platform uses the key for every inference request.

Supported providers: Anthropic (API), OpenAI, Gemini, xAI / Grok, Mistral, and most other hosted providers.

### OAuth Sign-in

Browser-based authentication using your existing subscription. No API key is required. The platform redirects you to the provider's login page; once you authenticate, a token is stored securely (encrypted in the database) and refreshed automatically.

Supported providers: Claude / Anthropic (Max subscription), OpenAI Codex (ChatGPT Plus/Pro plan).

### Device-Code Sign-in (xAI / Grok)

A headless-friendly OAuth variant for providers whose CLI ships a device-code flow. Rather than a browser redirect back to the platform, the platform runs the provider CLI's `device-auth` flow in the build sandbox, shows you a verification URL and a short user code, and waits while you authorize in your browser. The captured credential is stored encrypted, injected into each build sandbox, and self-refreshed. This is the recommended path for Grok because obtaining an xAI API key from `console.x.ai` is awkward for non-technical operators. See [xAI / Grok](./provider-xai.md) for the full flow.

Supported providers: xAI / Grok.

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

- If you have a personal subscription — OAuth may connect it, but keep it to public or synthetic work unless the provider explicitly supplies suitable business terms for that exact account.
- If you have a business/team or enterprise subscription — use its supported connection method, then record and review the connected account's terms.
- If you have a metered API account — use an API key, then separately verify who owns the account and which data protections are actually enabled.
- If you are running models locally — use None (auto-detected).

Some providers support both OAuth and API Key. You can switch between methods on the provider detail page at any time. Disconnecting an OAuth connection clears the stored token immediately.

## Business-safe review

The Providers & Routing page gives one recommendation grouped as **Use now**, **Use after review**, and **Not for this work**. It also previews what may leave the installation, what remains controlled, and what DPF blocks.

You can complete this review with the keyboard and a screen reader. The recommendation status, each connection group, the next action, consultation failures, and setup progress are announced in text rather than by color alone. Long connection names wrap on small screens.

If you choose **Skip safely** or **Review later**, DPF does not treat the provider as approved. Company and customer data stay restricted until the missing account, contract, region, or other evidence is reviewed. You can return to Providers & Routing and ask the COO again; a denied or unavailable consultation does not change provider posture.

On each provider detail page, record:

- the connected account type;
- whether no-training treatment has been verified in the provider's current terms;
- the processing regions enabled for that exact connection.

This is recorded as an operator attestation, not contract proof. A DPA, BAA, supplier contract, special retention option, or regional entitlement still needs its own evidence. Provider-published privacy pages describe an offering; they do not prove what your account purchased or enabled.

For EEA, UK, public-sector, healthcare, education, financial-services, or other regulated use, ask the COO to consult the Data Governance Agent. The answer should cite applicable regulator guidance and provider terms, identify unknowns, and recommend qualified review when it cannot substantiate a claim.

DPF checks those references before returning the specialist's answer. A material citation must match a current governed source claim and apply to the company location, workload, and named provider context. If the account class, service, jurisdiction, or evidence cannot be matched, the COO gives a conservative **cannot confirm** answer, preserves the current provider restrictions, and links the authoritative source that was actually accepted. It does not fill evidence gaps from model memory.

Local processing reduces external egress but is not automatically compliant. Security, retention, lawful basis, access control, capability, and sector obligations still apply.

## Finance Bridge

When a provider is configured successfully, the platform now seeds a Finance bridge for it automatically:

- The provider is linked to a Finance supplier record
- Finance gets a draft AI contract/profile even if the commercial plan details are incomplete
- Missing commercial details become explicit finance work items instead of blocking technical setup
- The provider detail page shows a Finance Bridge panel, and Finance exposes the same supplier through `/finance/spend/ai`

This keeps provider authentication and finance ownership connected without forcing the setup user to complete every contract detail up front.

## Where To Review It

After provider setup, the finance-linked surfaces are:

- `/platform/ai/providers/[providerId]`
  Shows the Finance Bridge panel with supplier linkage, contract count, work-item count, and billing/usage links.

- `/finance/spend/ai`
  Shows the finance-owned AI spend workspace with committed spend, setup gaps, and utilization context.

- `/finance/suppliers/[id]`
  Shows AI Provider Finance Context when the supplier is linked to a configured provider.

## Troubleshooting

- **"Token expired"** — click Sign In again to re-authenticate. This is the only action required.
- **"Provider not configured"** — verify that an API key or OAuth connection has been set up for this provider.
- **"No eligible endpoints"** — the provider needs at least one profiled model. Click "Sync Models & Profiles" on the provider detail page.
