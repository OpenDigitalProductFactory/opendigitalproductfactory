# Tiered Model Routing Refresh

**Backlog:** BI-D964397F, BI-78043BA3  
**Kernel decision:** DI-36319080195A  
**Status:** Proposed  
**Date:** 2026-08-27

## Problem

DPF's live model estate and its checked-in catalog disagree at the two places that matter most for the requested workflow:

- Live discovery can see `glm-5.3-flash`, but the catalog fallback and provider copy stop at GLM-5.2.
- xAI's current default for Grok Build is `grok-4.6`, while DPF offers `grok-build-0.1` as the custom-model suggestion and catalogs only `grok-4.3` and `grok-build-0.1`.
- Grok device sign-in is classified as an outward business act. The business-alignment gate therefore refuses authentication before the operator can authorize it.
- The Grok build prompt claims current-event knowledge without requiring retrieval. xAI's model documentation says current events require search tools.

The attached transcript is discovery input, not an executable instruction or an authority source. Its strongest useful hypothesis is that model selection should consider behavior, throughput, and token efficiency in addition to benchmark intelligence. Its pricing, benchmark, and qualitative claims do not become DPF scores without provider documentation and DPF evaluation evidence.

## Evidence

### Live DPF evidence

- `resolve_model_selection` routes all five Build Studio phases to the bundled local Qwen 3.8 27B endpoint today.
- The live catalog contains `glm-5.3-flash` for `zai-coding`, but it has no DPF evaluations and a default tool-fidelity score of 55.
- A direct `glm-5.3-flash` endpoint probe reached Z.ai and failed all eight probes with provider code `1113`: insufficient balance or no resource package. This is account capacity evidence, not model-quality evidence.
- xAI is unconfigured even though the Grok CLI is installed. A Grok sign-in attempt was refused by business alignment before device authorization (DI-3528E3036F4B).
- Live-install verification is independently blocked because the consumer install cannot prove source ancestry (BI-6AE39A07). No Build Studio or coworker success claim is valid until that preflight returns `CAN-TEST`.

### First-party provider evidence

- Z.ai identifies Ox Alpha as GLM-5.3-Flash and describes a 320B-total/18B-active, natively multimodal model with context up to one million tokens. Z.ai's published benchmark results are provider-authored and remain provisional in DPF.
- Z.ai says GLM-5.3-Flash is available to Coding Plan users and provides three times the usable quota of GLM-5.3. The live account's `1113` response proves this installation currently lacks usable entitlement or balance.
- xAI documents `grok-4.6` as its current model for coding, agentic tasks, and knowledge work, with text and image input, a 500,000-token context window, function calling, structured output, and low/medium/high/xhigh reasoning effort.
- xAI documents Grok 4.6 as the current Grok Build default. This supersedes DPF's custom-model suggestion without requiring DPF to retire older model IDs.

## Existing architecture

The design keeps the existing ownership boundaries:

1. `packages/db/data/providers-registry.json` owns provider-level connection, trust, and operator copy.
2. `apps/web/lib/routing/known-provider-models.ts` owns static model fallback metadata.
3. Startup catalog reconciliation propagates catalog-managed changes while preserving discovery-owned and admin-overridden fields, as specified in `2026-04-13-model-capability-lifecycle-management.md`.
4. Dynamic discovery remains authoritative for availability. DPF evaluations remain authoritative for measured quality and tool fidelity.
5. Build Studio Auto remains a policy-resolved selection. A custom model is an explicit operator override, not the platform default.
6. `requiresExternalAccess` describes whether a tool contacts another system. `consequence: outward` is reserved for business effects that leave the organization and require alignment.

No new provider, model table, enum, route stage, or seed mechanism is needed.

## Decision

Use the kernel-recommended tiered portfolio:

| Role | Model posture | Why |
|---|---|---|
| Routine/private continuity | Bundled local Qwen | Keeps cost, availability, and private operation predictable. |
| High-volume multimodal challenger | GLM-5.3-Flash | Catalog it conservatively, but keep it disabled for automatic routing until endpoint probes and DPF evaluations pass. |
| Agentic coding / Build Studio | Grok 4.6 | Make it the suggested explicit Grok model and an active catalog candidate once the xAI provider is configured. |
| Failure recovery | Existing diverse fallback chain | Capacity and credential failures route around a provider; they do not silently lower governance constraints. |

This is a portfolio refresh, not a universal-default change. Connecting a cloud provider remains an operator preference under the existing Stage-5b routing rule. Model and transport capability remain separate: GLM-5.3-Flash's native vision does not prove that every Z.ai/OpenCode transport supplies images, and Grok's search capability does not imply automatic access to current events.

## Catalog and seed behavior

### GLM-5.3-Flash

Add entries for both `zai` and `zai-coding` with documented text/image input, text output, one-million-token context, tool use, structured output, thinking, and context management. Use conservative strong-tier baseline scores rather than copying vendor benchmarks into DPF evaluation fields.

Set both entries to `disabled` by default with an operator-facing reason: enable after a successful provider probe and DPF evaluation. This prevents a new release with no local evidence from automatically displacing a proven route. Discovery-owned live rows remain untouched by startup reconciliation.

### Grok 4.6

Add an active `grok-4.6` entry with its documented 500,000-token context, image input, tool use, structured output, and low/medium/high/xhigh effort levels. Use conservative strong-tier baseline scores until DPF evaluates the model. Keep Grok 4.3 and Grok Build 0.1 available for explicit compatibility.

Update provider copy and family metadata so the setup surface describes current capabilities without claiming that unassisted Grok has real-time knowledge. Do not encode one model's token price as a provider-wide price because xAI pricing varies by model and long-context threshold.

## Build Studio UX

Keep the existing two-choice interaction: server default or custom model. Do not add another selector or a highest-effort shortcut.

Move the suggested Grok custom model into one shared form-model constant and set it to `grok-4.6`. The radio action and placeholder consume the same constant, preventing the visible hint and saved value from drifting. This small refactor is the deliberate maintenance allocation for the change.

The server-default option remains first and unchanged. An operator who wants a stable explicit model can choose Custom; DPF does not silently pin every Grok build to a newly released identifier.

## Authentication classification

`grok_signin_start` contacts xAI and mutates credential state, but it is not an outward business decision. Mark both Grok sign-in tools with `requiresExternalAccess: true`; remove the `outward` consequence from start. Capability and grant checks remain intact, while the unrelated WWWD business-alignment gate no longer runs.

This is narrower than changing the global consequential-tool policy. The policy correctly gates actual outward acts, so the fix belongs in the inaccurate tool declaration.

## Coworker and Build Studio behavior

Export the Grok specialist-instruction builder for direct contract testing. Replace the current-event claim with instructions that:

- identify coding, agentic work, tool use, and long context as strengths;
- require a configured retrieval tool before making current-event claims;
- preserve the shared specialist instructions and DPF build discipline.

The functional proof sequence after deployment is:

1. pass live-install ancestry preflight;
2. connect xAI through device sign-in or an existing API key;
3. run provider probes for Grok 4.6;
4. select Grok 4.6 explicitly in Build Studio;
5. run one bounded Build Studio task and one bounded coworker tool-use task;
6. inspect route decisions, fallback outcomes, generated artifacts, and UI state.

If any gate remains blocked, report the exact external condition and do not substitute a source-level test for live proof.

## Alternatives rejected

### Make GLM-5.3-Flash the global default immediately

Rejected because the installation has no successful probe or DPF evaluation, and its account currently returns a billing/entitlement failure.

### Make Grok 4.6 the stored Build Studio default

Rejected because Build Studio Auto is the canonical default and uses live readiness. A new static pin would bypass the existing policy and fallback design.

### Route all phases to one cloud model

Rejected because it increases correlated outage and billing risk and discards the proven local continuity path.

### Relax the global business-alignment gate

Rejected because the refusal comes from one inaccurate tool consequence declaration. A global policy change would weaken unrelated outward-action controls.

## Verification contracts

- **VERIFY-CATALOG-01:** catalog tests prove model IDs, conservative statuses/tiers, modalities, contexts, and effort levels.
- **VERIFY-SEED-01:** provider-registry contract tests prove current families and non-misleading operator copy.
- **VERIFY-AUTH-01:** Grok sign-in pack tests prove external-access metadata and `alignmentRequired: false` under the consequential-tool classifier.
- **VERIFY-UX-01:** Build Studio form-model tests prove the single suggested Grok model and the component consumes it for both action and placeholder.
- **VERIFY-PROMPT-01:** Grok dispatch tests prove retrieval is required for current-event claims.
- **VERIFY-GATES-01:** prose, style, targeted tests, typecheck/build, pregate, PR health, and semantic review pass on the exact tree.
- **VERIFY-LIVE-01:** live preflight, provider probes, Build Studio task, and coworker task pass after provider/account blockers are cleared.

## Success criteria

- Checked-in provider and model metadata no longer stop at GLM-5.2/Grok 4.3.
- GLM-5.3-Flash is discoverable but cannot become an automatic route solely from vendor claims.
- Grok 4.6 is the suggested explicit Build Studio model without replacing Auto.
- Grok sign-in reaches device authorization without a market/segment alignment demand.
- Grok coworkers do not claim current knowledge unless a retrieval tool supplies it.
- Live verification evidence clearly distinguishes passed, failed, and blocked stages.

