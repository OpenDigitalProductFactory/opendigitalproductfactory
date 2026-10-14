---
title: "Connecting AI Providers"
area: "ai-workforce"
order: 2
relatedCode:
  - apps/web/lib/ai-inference.ts
  - apps/web/app/(shell)/platform/ai/providers/page.tsx
  - apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx
  - apps/web/components/platform/ProviderSuitabilityGuide.tsx
---

## Overview

The platform connects to external AI providers to run inference for your AI workforce. Depending on the provider, you can authenticate using one of three methods: API Key, OAuth Sign-in, or None (for local providers). Open **Platform > AI Operations > Providers & Routing**, then choose **Manage** beside a provider.

### Accounts and provider setup

The compact account table keeps **Allowed work**, models and capabilities,
connection problems, and capacity/reset information together. Allowed work is a
data-sensitivity boundary. Authentication, model access, or remaining quota does
not grant permission to send company or customer data. Capacity that a provider
has not reported stays **Capacity not reported**.

On initial setup, the available-provider catalog is open. **Continue with Local**
completes provider selection without requiring a hosted account. After setup,
the overview shows configured and unfinished accounts, including disabled or
disconnected accounts. **Add provider** opens the searchable catalog again;
**Add account** starts another named account for the chosen provider. Removing
the last hosted account does not restart setup.

**Manage account** opens that account's connection and Allowed work controls.
Connection checks, model refresh, sign-in, disconnect, and enable/disable actions
apply to the selected account. Secret fields are write-only: leave them empty to
keep the saved credential. Saving a replacement credential requires a fresh
data-terms review. The page announces pending actions and their results.

The legacy provider link opens the default account. **Shared provider settings**
contains catalog and endpoint configuration; provider-wide emergency clearance,
usage/billing, recipes, diagnostics, and routing operations remain reachable
through disclosures. Local hardware and installed-model management remain on
the Local detail page. Shared usage and diagnostics are identified as applying
across accounts.

An authenticated additional account is not automatically executable. Its own
model-access proof, work permissions, capacity, and supported execution channel
must qualify for the request. An unavailable policy read does not confirm that
hosted AI is permitted. The global Local-only policy remains visible above the
account table.

### Routing status and temporary pauses

Z.ai GLM Coding is also listed separately so you can manage its coding endpoint and traffic. It inherits the main Z.ai key unless you configure an override.

Each provider's **Routing right now** panel shows its operator pause alongside current usage limits, retry times, account or health restrictions, the platform's local-only policy, and local capacity reserved for platform verification. Times display in your browser's timezone. Open **More routing details** for recent health and subscription allocation observations. Workload and model requirements are checked separately for each request.

Choose **Pause now** to stop new model requests immediately. The pause lasts until you resume it. Choose **Set resume time** to add a duration in hours or days. A scheduled pause persists across refreshes and restarts. You can change the time, keep it paused indefinitely, or choose **Resume now** early. Work already running may finish.

Resuming removes the operator pause. It does not reset a provider's usage limit or override an authentication, billing, health, account, or local-only restriction. The panel keeps those restrictions visible. Read-only viewers can inspect the status; provider managers can change it.

**ChatGPT and Codex can share an OpenAI subscription.** Both appear in Providers & Routing. Each account keeps its own sign-in recovery unless the platform has verified a shared sign-in owner. Use the selected account's sign-in control; when the page identifies a shared owner, manage that sign-in there. Pausing one provider leaves the other's operator control unchanged. Subscription limits may affect both.

Authentication proves only that a connection works. Before using company or customer data, also identify whether the connected account is personal/individual, business/team, enterprise, or unknown, and review its contract, retention, training, and processing-region terms. DPF keeps unreviewed hosted connections limited to public or synthetic work.

## Authentication Methods

On a provider's detail page, **Configured** means settings and model profiles
are saved. **Save & verify connection** runs a connection check; a successful
check shows **Connection verified**. Neither label grants access to every saved
model or overrides workload rules. Open **Advanced diagnostics** to inspect model
history or refresh the catalog. Routine discovery runs automatically.

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

### Managing models on this computer

The Docker Model Runner provider page shows the models actually installed on
this computer, including their on-disk size when the runtime reports it. Local
providers do not ask for a hosted account type, a data-training declaration, a
DPA, or a processing region because that hosted-provider posture does not apply
to an on-box runtime.

Use **Install** and **Remove** on the provider page. DPF performs those actions
through the local runtime and reports long-download progress in the page; you
do not need to copy a command or use a terminal. Removing the embedding model
requires confirmation because semantic search and durable memory will stop
until an embedding model is installed again. If the installed runtime is too
old to support model management, the page asks you to update the runtime rather
than handing you a script.

### Local capacity during platform verification

A local provider shares the installation's finite execution capacity with
governed platform verification. While an exact local-CI run owns that capacity,
DPF defers new local completion and embedding requests. If the request has an
eligible cloud fallback, routing can use it; a local-only request waits or
returns a capacity deferral rather than reporting the local provider as broken.
DPF does not terminate a model that was already running before verification
began.

The guard uses the Windows host free-physical-memory measurement for CI
admission and renewal. Docker's displayed model residency, GPU VRAM, possible
shared or unified memory, WSL accounting, and Windows physical memory are
different measurements. DPF does not infer that a model's displayed size is
ordinary RAM consumption or assign a causal mechanism without corresponding
telemetry.

Local completion also waits when the graphics card itself is busy, even if no
platform verification is running. Another program on this computer — a game, a
second model, or a request that already holds the local model — can fill the
card. On Windows, a small publisher writes what the graphics driver reports,
because the portal cannot see the card directly. When that snapshot is fresh
and shows the card is busy, or a new model would not fit beside what is
already there, DPF defers the local completion and releases a parked local
model that is not serving a request. A missing or stale snapshot does not by
itself defer local work. Embedding requests keep the verification rule above
and are not held for this graphics-card check.

This behavior is automatic. If local work is temporarily deferred, wait until
the graphics card or the active verification is free and retry; do not disable,
reconnect, or re-profile the local provider unless its status remains unhealthy
after that wait.

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

The Providers & Routing page starts with one recommendation, one plain reason, the main safeguard summary, and the next action. The detailed **Use now**, **Use after review**, and **Not for this work** groups are still available under **Review provider choices**. Evidence details such as **Work DPF is protecting**, workload labels, route observations, and caveats are under **Review protected work and evidence** so a non-technical owner can set up providers without reading every routing detail first.

The safeguard summary previews what may leave the installation, what remains controlled, and what DPF blocks. The **Work DPF is protecting** labels are derived from the company profile, markets, products, customers, and planned AI work. Correct those labels before relying on the recommendation.

You can complete this review with the keyboard and a screen reader. The recommendation status, disclosure controls, each connection group, the next action, consultation failures, and setup progress are announced in text rather than by color alone. Long connection names wrap on small screens.

Routing eligibility follows the provider's **connection**, not just the
provider toggle. A provider whose default connection is disabled is shown with
a connection-specific reason ("routing skips it until you reconnect") instead
of a green active badge, on both the list and the provider detail page.
Activating a provider brings its default connection along, and the platform
preserves an intentionally disabled account during registry reconciliation.
Enable the account explicitly when you want routing to use it again.

If you choose **Skip safely** or **Review later**, DPF does not treat the provider as approved. Company and customer data stay restricted until the missing account, contract, region, or other evidence is reviewed. You can return to Providers & Routing and ask the COO again; a denied or unavailable consultation does not change provider posture.

On each provider detail page, record:

- the connected account type;
- whether no-training treatment has been verified in the provider's current terms.

This is recorded as an operator attestation, not contract proof. A DPA, BAA, supplier contract, special retention option, or regional entitlement still needs its own evidence. Provider-published privacy pages describe an offering; they do not prove what your account purchased or enabled.

If the organization's business setup explicitly requires processing in a region, the page names that region and asks whether this connected account can guarantee it. The organization being based in the United States, EEA, UK, or elsewhere does not by itself prove what a provider account purchased or enabled. When no region is required, there is no region question, and saving the other account terms preserves any existing region evidence.

After you save the declaration, the provider page separates connection verification from data-use eligibility. Saved model profiles describe catalog history; they do not confirm that every model is currently available. The trust panel states whether the connection can handle the company work represented by the current setup or only public and synthetic work. Missing optional evidence may remain visible as history, but it does not raise an action. A missing or invalid required claim names the blocked scope and the next action. DPA evidence is requested only on policy paths that require it; it is not a universal provider-setup requirement.

For EEA, UK, public-sector, healthcare, education, financial-services, or other regulated use, ask the COO to consult the Data Governance Agent. The answer should cite applicable regulator guidance and provider terms, identify unknowns, and recommend qualified review when it cannot substantiate a claim.

DPF checks those references before returning the specialist's answer. A material citation must match a current governed source claim and apply to the company location, workload, and named provider context. If the account class, service, jurisdiction, or evidence cannot be matched, the COO gives a conservative **cannot confirm** answer, preserves the current provider restrictions, and links the authoritative source that was actually accepted. It does not fill evidence gaps from model memory.

Local processing reduces external egress but is not automatically compliant. Security, retention, lawful basis, access control, capability, and sector obligations still apply.

See [Sensitive-Data Policy Packs](./sensitive-data-policy-packs.md) for the
technical boundaries DPF applies to clinical, financial, legal,
criminal-justice, safety, youth, employee, source-code, credential, customer,
and unknown governed data before provider selection.

### Break-glass: accepting a risk on purpose

Attestation above says an account *is* contractually safe. Sometimes an
organization instead wants to knowingly proceed on an account that is **not**
verified safe — an acceptable risk, made with eyes open. The provider detail
page has a separate, warning-toned **Accept risk / add an override** panel for
exactly that. It is deliberately not the attestation form: attestation records
that the account is protected; an override records that it is **not**, and that
you accept the exposure anyway.

An override is operator-only, defaults off, and is never the path of least
resistance — the attested-account and capable-local-model paths remain the
recommended answers. To create one, you pick the specific sensitivities to
accept (only those the provider is not already cleared for), type a
justification, set a required expiry, and check an acknowledgment that states
the exact risk. The decision is audited (who accepted, when, scope, the frozen
risk text), listed on the page, and revocable with one click; revoking restores
the block. Routing then permits that provider for those sensitivities until the
override expires or is revoked — without changing what the provider is genuinely
cleared for. Without an override, a coworker whose only cleared provider is a
too-weak local model is told plainly why it cannot answer, rather than being
routed onto an uncleared provider.

### OpenRouter and other router accounts

A router connection is two trust decisions: the OpenRouter account and the underlying provider that actually handles the request. For public work, DPF may use normal price or latency routing. For private or regulated work, DPF requires an explicit underlying-provider allowlist, disables unbounded fallback, requests parameter-compatible endpoints, enables Zero Data Retention, denies provider data collection, and requires returned router metadata before releasing the answer.

EU in-region OpenRouter processing is an enterprise feature. DPF uses `eu.openrouter.ai` only when the exact connected account has current enterprise and regional-processing evidence; a regular API key cannot inherit that entitlement. If the account, approved endpoint list, regional entitlement, policy pass-through, or returned underlying-provider evidence is missing, the restricted request stops safely instead of silently using a broader route.

DPF continuously watches evidence expiry, account/channel drift, regional-entitlement changes, and repeated route failures. These observations can request review or lower a recommendation, but cannot override a contract, residency, PDP, or operator denial. The provider overview summarizes governed route decisions only when privacy thresholds are met; small workload cohorts remain hidden.

Routing receipts retain only bounded policy facts: policy/input versions, the hashed connection reference, execution channel, account class, selected provider and returned underlying provider, exclusions, obligations, and explanation codes. They do not store model prompts, answers, attachments, credentials, external account identifiers, or arbitrary router/plugin metadata. You can inspect the explanation on the provider detail page and under **Governance & Audit > Routes**.

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

- **"Token expired"** — a stored expiry date does not prove the upstream token still works. Use the selected account's sign-in control, which remains available while a token is stored; disconnecting the account is not required. A verified shared sign-in owner, when identified on the page, supplies that account's recovery instead. The bounded expired-token verification repair retries once after refreshing the owning grant; if renewal fails or the second request is still expired, a new sign-in is required.
- **"Provider not configured"** — verify that an API key or OAuth connection has been set up for this provider.
- **"No eligible endpoints"** — the provider needs at least one profiled model. Click "Sync Models & Profiles" on the provider detail page.
