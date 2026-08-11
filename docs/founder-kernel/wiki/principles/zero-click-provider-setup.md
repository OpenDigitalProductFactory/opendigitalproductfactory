---
title: Zero-Click Provider Setup
pageKind: principle
status: published
abstract: OAuth sign-in (or API-key paste) is the only manual step for provider configuration. Everything else is automatic.
principleTier: core
principleDirection: After the one mandatory authentication step, every other provider-activation action (status, discovery, profiling, family enabling, routing availability) must be automatic. Test/Eval/Probe buttons are optimization, not prerequisites.
principleDimensionVector: {"human_cognitive_load": -0.8, "speed_to_value": 0.7, "long_term_maintainability": 0.4, "evidence_density": -0.2, "operator_effort": -0.7, "cost_efficiency": 0.45}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-3-archetype
principleConsumerArchetype: universal
principleConsumerContexts:
  - ui
  - data-model
principlePublic: true
principlePublicRationale: Provider activation is the gate to every downstream platform capability. Customer installs cannot tolerate a per-provider activation tour that the operator has to learn.
sources: []
---

## Rule

Provider setup must work with one action: sign in via OAuth, or paste an API key. Everything after that must be automatic — status flips to active, sensitivity clearance is set, model discovery runs, model profiling runs, every discovered family is enabled, routing availability is immediate. Test, Eval, Run Probes, Update Providers, and family-toggle buttons are optional optimization, clearly labeled as such; they are never prerequisites for basic functionality.

## Why

Every manual step is a fresh-install failure point. The admin UI accumulates Test / Eval / Run Probes / Update Providers / model-family toggles that the user doesn't understand, doesn't want to press, and shouldn't need to. Each one is "clutter for a manual process that is perilous and destructively in the way." The OAuth completion callback (or the paste-key handler) is the single point where the platform has all the information it needs to activate the provider end-to-end; any subsequent click is the platform asking the operator to compensate for a missing automation. Worse, the manual surface means different operators end up with subtly different post-activation state, and the support-load tail is set by the worst manual path anyone took.

## Applies To

In-platform coworkers building provider-admin UIs, external coding agents writing OAuth/handler code, and humans operating provider activation flows. Symmetric. Applies to LLM providers, MCP servers requiring auth, integrations with external SaaS (HRIS, CRM, GitHub-as-platform), and any add-on requiring an authentication exchange.

## How To Apply

- The OAuth completion callback (or the equivalent paste-key handler) is the single point of activation. Inside that handler: write the credential, flip status to active, set sensitivity clearance, kick off discovery, kick off profiling, enable all discovered families.
- Never require a separate Test or Configure click for basic functionality. If a Test button exists, it's optional verification of an already-functional setup, not the path to functionality.
- Test / Eval / Run Probes / Update Providers buttons should be clearly labeled as optimization or diagnostic actions, not as activation prerequisites. Their copy should make it obvious that the provider already works.
- If the activation flow has a step that genuinely cannot be automated (e.g. a remote consent flow at the provider), surface it inline in the same flow — do not bounce the operator back to an admin screen to click Continue.
- For bundled services that don't even need OAuth, skip the activation step entirely (see `bundled-services-active-by-default`).

## Decision Dimensions

- `human_cognitive_load: -0.8` — the principle's purpose is to compress operator decision-load to one choice. Every additional button is a load increase.
- `speed_to_value: 0.7` — fresh installs are functional within seconds of OAuth completion, not after a guided activation tour.
- `long_term_maintainability: 0.4` — fewer manual paths means fewer regression points in future activation changes.
- `evidence_density: -0.2` — slight negative. Skipping manual confirmation steps means slightly less explicit operator-recorded confirmation that activation worked; mitigated by the auto-activation flow logging its own steps.

## Examples

- **Positive:** The OAuth callback for an LLM provider runs the full activation sequence (write credential → status active → discovery → profiling → families enabled) in one handler call. The admin returns from OAuth to a provider that is already serving routing requests.
- **Counterexample:** The OAuth callback writes the credential and flips status to active, then the admin screen shows "Click Run Probes to enable model selection." The operator can't tell that probes are required from the wording; they leave the screen, never click probe, and report that "routing doesn't pick the new provider" weeks later.

## See Also

- `bundled-services-active-by-default` (core) — for plumbing that doesn't even need OAuth, skip the activation step entirely.
- `do-the-work-dont-task-the-operator` (commandment) — the broader rule that the agent/platform does the work; this principle is one of its operational manifestations for provider setup.
- `never-ask-user-to-run-commands` (commandment) — Test/Eval/Probe buttons can resemble "run this command yourself"; this principle keeps that surface optional, not mandatory.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
