---
title: Z.ai GLM provider integration
description: Adds Z.ai as an OpenAI-compatible provider for internal routing and evaluates GLM-5.2 for Build Studio OpenCode dispatch.
---

# Z.ai GLM Provider Integration

## Status

Draft for implementation. Research completed 2026-06-28.

## Problem

DPF needs a first-class Z.ai provider so the operator can connect a Z.ai account and use GLM-5.2 for internal platform tasks. The provider must also be evaluated for Build Studio coding through OpenCode.

The user asked for both OAuth and API account options. Current Z.ai documentation found during research describes API-key OpenAI-compatible access and OpenCode configuration, but does not publish an OAuth flow for model API access. The platform must not imply OAuth support that the provider does not document.

## Goals

- Seed Z.ai as a visible model provider with API-key setup.
- Add GLM-5.2 to the known model catalog with long-context, tool-use, structured-output, and coding metadata.
- Let internal model routing discover or fall back to GLM-5.2 through the existing OpenAI-compatible adapter path.
- Extend Build Studio's OpenCode path so it can target a credentialed OpenAI-compatible coding endpoint, not only local Docker Model Runner / Ollama endpoints.
- Provide operator-facing account setup copy that points to the Z.ai console/docs without exposing an unsupported OAuth button.
- Preserve the ability to test with the operator's Z.ai account/API key after the provider is available.

## Non-Goals

- Do not implement unofficial browser-session OAuth, cookie capture, or any provider flow not documented by Z.ai.
- Do not add a new model-provider schema table. Existing `ModelProvider`, `CredentialEntry`, `DiscoveredModel`, and `ModelProfile` substrate is sufficient.
- Do not replace Build Studio's OpenCode engine. Refactor the endpoint/provider config boundary only.

## Research & Benchmarking

### Z.ai

- Z.ai quick start documents API-key authentication and an OpenAI-compatible base URL at `https://api.z.ai/api/paas/v4`.
- Z.ai OpenCode documentation configures OpenCode through an OpenAI-compatible coding endpoint at `https://api.z.ai/api/coding/paas/v4`.
- Z.ai GLM-5.2 documentation presents GLM-5.2 as the current high-capability model family with long-context support.
- Z.ai function-calling documentation confirms tool-call style capabilities for model API use.
- No official OAuth model-access flow was found in Z.ai documentation during this pass.

Sources:

- `https://docs.z.ai/guides/overview/quick-start`
- `https://docs.z.ai/guides/develop/openai/python`
- `https://docs.z.ai/guides/llm/glm-5.2`
- `https://docs.z.ai/guides/capabilities/function-calling`
- `https://docs.z.ai/scenario-example/develop-tools/opencode`

### Existing DPF Providers

- `packages/db/data/providers-registry.json` is the provider seed source.
- `apps/web/lib/routing/known-provider-models.ts` is the curated fallback catalog used when provider discovery is missing or unparseable.
- `apps/web/lib/routing/adapter-registry.ts` already maps OpenAI-compatible providers to `openAIAdapter`.
- `apps/web/lib/inference/ai-provider-internals.ts` handles dynamic discovery and falls back to `KNOWN_PROVIDER_MODELS`.
- `apps/web/lib/integrate/build-studio-config.ts` auto-detects providers by `cliEngine` and already knows how to require credentials for non-`none` providers.

### Build Studio OpenCode

`apps/web/lib/integrate/opencode-dispatch.ts` is currently local-endpoint shaped:

- It always resolves `getOllamaBaseUrl()`.
- It preflights with `preflightLocalEndpoint()`.
- It writes an OpenCode config provider named `local`.
- It exports `OPENCODE_LOCAL_KEY=local`.
- It runs `opencode run ... -m local/<model>`.

That is the refactoring seam. OpenCode itself can target OpenAI-compatible providers; DPF's runner currently cannot.

## Architecture Decision

Recommended and WWMD-scored path: **API-key account-guided setup**.

Z.ai will ship as an API-key OpenAI-compatible provider. The UI can describe it as connecting a Z.ai account because the operator signs into Z.ai externally to create the API key, but the DPF credential stored in `CredentialEntry` is an API key. OAuth is not shown as a working credential method until Z.ai publishes an official model-access OAuth flow.

WWMD `principle_decide` result recorded in Work Capsule `WC-BC3309F0`: `api_key_account_guided`, high confidence, margin `2.918`.

## Provider Shape

Add two provider registry entries unless implementation proves one entry can safely represent both endpoints without confusing discovery:

1. `zai`
   - Name: `Z.ai`
   - Category: `direct`
   - Base URL: `https://api.z.ai/api/paas/v4`
   - Auth method: `api_key`
   - Auth header: `Authorization`
   - Families: `glm-5`, `glm-coding`
   - Supports tool use: `true`
   - CLI engine: omitted
   - Purpose: internal inference and routing.

2. `zai-coding`
   - Name: `Z.ai GLM Coding`
   - Category: `direct`
   - Base URL: `https://api.z.ai/api/coding/paas/v4`
   - Auth method: `api_key`
   - Auth header: `Authorization`
   - Families: `glm-5`, `glm-coding`
   - Supports tool use: `true`
   - CLI engine: `opencode`
   - Purpose: Build Studio OpenCode dispatch against the coding endpoint.

Both entries use API-key credentials. If provider discovery proves identical and the coding endpoint is usable for normal chat, a later cleanup can collapse this into one provider with explicit endpoint roles. First implementation should prefer separate rows because `baseUrl` is single-valued today and Build Studio needs a different endpoint than normal platform inference.

## Model Catalog

Add curated fallback models to `KNOWN_PROVIDER_MODELS`:

- `zai`: `glm-5.2`
- `zai-coding`: `glm-5.2`

Initial metadata:

- Quality tier: `frontier` for `glm-5.2` unless live testing downgrades it.
- Model class: `reasoning` for normal provider, `code` for coding provider.
- Max context: `1_000_000` if the current Z.ai model docs continue to show 1M-context GLM-5.2 configuration.
- Capabilities: tool use, structured output, streaming, thinking/long-context where supported by metadata.
- Scores are provisional curated priors and must be corrected after live testing with the operator's account.

## OpenCode Refactor

Introduce a provider-target abstraction for OpenCode dispatch:

```ts
type OpencodeProviderTarget = {
  providerSlug: string;
  displayName: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  apiKeyValue: string;
  model: string;
  requiresModelPreflight: boolean;
};
```

Local providers map to:

- `providerSlug: "local"`
- `apiKeyEnvVar: "OPENCODE_LOCAL_KEY"`
- `apiKeyValue: "local"`
- `requiresModelPreflight: true`

Z.ai coding maps to:

- `providerSlug: "zai"`
- `apiKeyEnvVar: "OPENCODE_ZAI_API_KEY"`
- `apiKeyValue: <decrypted CredentialEntry secret>`
- `requiresModelPreflight: false` initially, because remote `/models` behavior may differ and should not block configuration before account testing.

The generated OpenCode config should use `providerSlug/model` consistently, so Build Studio can run:

```sh
opencode run --dir /workspace -m zai/glm-5.2 --format json --dangerously-skip-permissions "$PROMPT"
```

The dispatch code must never write the raw API key into logs or Build Studio dispatch records.

## UI / UX Fit

Provider setup should stay simple:

- Show Z.ai as a provider card with "API key" setup.
- Copy should say the operator signs into Z.ai to create an API key.
- Do not render a live OAuth action for Z.ai.
- If a secondary "OAuth" mention is needed to satisfy account-option language, it must be an informational unavailable state: "Z.ai has not published OAuth access for model APIs yet."

UX-fit decision: progressive disclosure wins. The default provider setup remains a small set of human-understandable choices: connect provider, paste API key, test connection. No token-count or endpoint-mode controls are added to the default screen.

## Implementation Plan

1. Tests first:
   - Provider registry contract includes `zai` and `zai-coding`.
   - Known model catalog includes GLM-5.2 entries and capabilities.
   - Adapter registry maps Z.ai providers to the OpenAI-compatible adapter.
   - OpenCode config builder can generate both local and credentialed remote provider configs.
   - Build Studio config accepts a credentialed `opencode` provider without local-only wording.

2. Provider seed:
   - Add `zai` and `zai-coding` entries to `packages/db/data/providers-registry.json`.
   - Preserve API-key-only supported auth until official OAuth exists.

3. Model catalog:
   - Add GLM-5.2 fallback entries.
   - Add or update tests in `apps/web/lib/routing/known-provider-models.test.ts`.

4. Routing adapter:
   - Add `zai` and `zai-coding` to `apps/web/lib/routing/adapter-registry.ts`.

5. OpenCode dispatch refactor:
   - Refactor `buildOpencodeConfig()` to accept a target object while keeping a local compatibility wrapper if useful.
   - Resolve `zai-coding` credentials from `CredentialEntry` when Build Studio selects that provider.
   - Keep local provider preflight behavior unchanged.

6. Build Studio configuration polish:
   - Remove "local" from error copy for generic OpenCode providers.
   - Only show local endpoint preflight/config controls for no-auth local providers.

7. Documentation:
   - Update `docs/architecture/local-llm-build-engine.md` or add a short linked note explaining that OpenCode is an engine that can target local or credentialed OpenAI-compatible endpoints, while local DMR remains the no-credential default.

## Verification

Source-local gates:

- `pnpm --filter @dpf/db exec vitest run test/model-profile-seed-contract.test.ts test/voice-stt-provider-contract.test.ts` if provider registry tests are affected.
- `pnpm --filter web exec vitest run apps/web/lib/routing/known-provider-models.test.ts apps/web/lib/integrate/opencode-dispatch.test.ts`
- `pnpm --filter web typecheck`

Runtime-bound gates:

- Run the production build through canonical local install or the shared local-CI convergence sandbox per `AGENTS.md`.
- After the operator supplies a Z.ai API key, test:
  - Provider connection succeeds.
  - GLM-5.2 appears as a routed model.
  - A non-destructive internal task can call GLM-5.2 with tool-use metadata where supported.
  - Build Studio OpenCode can run a small coding task against `zai-coding/glm-5.2`, or records a precise blocker if Z.ai account tier/model entitlement prevents it.

## Risks

- Z.ai endpoint or model names may differ by account tier. Mitigation: dynamic discovery remains primary; curated catalog is only fallback.
- Z.ai OpenCode coding endpoint may require a GLM Coding Plan entitlement distinct from ordinary API keys. Mitigation: keep `zai-coding` separate and surface account-tier errors plainly.
- OAuth may appear later. Mitigation: schema already supports OAuth provider fields; add it only when official docs expose authorize/token endpoints.
- Remote coding through OpenCode may have different event or failure behavior than local coding. Mitigation: keep current fatal-error parsing and add dispatch-attempt evidence for remote failures.

## Open Questions For Live Account Testing

- Exact GLM-5.2 model ID returned by the operator's account.
- Whether the normal API endpoint and coding endpoint share the same API key.
- Whether the coding endpoint supports `/models` and the same chat-completions/tool-call contract as the normal endpoint.
- Whether OpenCode with GLM-5.2 edits the repo successfully in the Build Studio sandbox on a small task.
