---
status: active
---

# Coworker routing readiness and voice truth implementation plan

Date: 2026-08-24
Epic: `EP-56AE0F69`
Backlog items: `BI-D25F867D`, `BI-45B95929`
Workroom: `WC-BB6874E6`

## Outcome

One cohesive PR will repair the dogfood failure captured in decision thread `DI-2B3156C625AD`: routing will recover once from a stale model, report the actual terminal constraint as a platform failure, keep standing coworker conversation out of setup routing, establish coworker identity once, and expose voice controls only when their independent capabilities are usable.

The two deliverables remain independently testable and retain separate backlog ownership. They share one PR because the operator explicitly requested one delivery and because both defects meet at the same coworker turn boundary.

## Design grounding

- Existing routing authority: `loadEndpointManifests`, `routeEndpointV2`, `callWithFallbackChain`, `NoEligibleEndpointsError`, `ProviderCapacityStatus`, `DiscoveredModel`, `ModelProfile`, `ModelProvider`, `AiProviderConnection`, and `CredentialEntry`.
- Existing presentation authority: `AgentPanelHeader`, `AgentCoworkerPanel`, `AgentMessageBubble`, `AgentMessageInput`, `presentStandingCoo`, `useVoiceSynth`, and `/api/voice/service-status`.
- Existing provider UX authority: `deriveRoutingEligibility`; runtime and admin projections must consume the same credential/model facts instead of creating a second readiness state.
- No new table, enum, route family, or parallel provider-health store is required.
- Related work remains separate: `BI-1FFDF4B1` owns local model install/delete, `BI-BB337746` owns local compliance policy, `BI-2EFF90F2` owns the discovery-sweep decision gate, and `BI-2C50F548` owns attention projection.
- Open-PR sweep on 2026-08-24 found no overlapping routing/coworker PR. The unmerged `fix/local-model-ux` worktree is outside this edit scope.

## Change-impact contract

The Workroom returned `status=resolved` for all claimed paths.

- Large-module ratchets: `AgentCoworkerPanel.tsx`, `AgentMessageInput.tsx`, `agent-coworker.ts`, and `agentic-loop.ts` must not grow.
- Provider route budget: `/platform/ai/providers` has zero visible-word growth and must preserve heading/landmark shape.
- Required guards: `pnpm run check:prose-lint:test`, `pnpm run check:prose-lint`, and `node scripts/check-style-drift.mjs`.
- Required gate: affected unit tests, `pnpm run pregate:preflight`, exact-tree `pnpm run pregate`, then `pnpm pr:health`.
- The source-code graph is missing, so every colocated and directly imported test suite named below is in scope.

## Phase 1 — Red: reproduce routing and attribution failures

Deliverable: `BI-D25F867D` behavior is executable as failing tests before production edits.

Tests:

- `apps/web/lib/routing/fallback.test.ts`: a selected model returning `model_not_found` completes reconciliation before signaling one route rebuild.
- `apps/web/lib/inference/routed-inference.activity-overrides.test.ts`: foreground dispatch rebuilds the route once, never loops, and can select the newly discovered model.
- `apps/web/lib/routing/loader.test.ts`: active providers without usable credentials do not become runtime manifests; no-auth local endpoints remain eligible.
- `apps/web/lib/tak/inference-dead-ends.test.ts`: model missing, credentials, capacity, policy/capability, context, busy, and unknown failures produce different typed outcomes.
- `apps/web/lib/tak/task-classifier.test.ts`: “misconfigured” in an assistant fallback cannot classify a standing thread as platform onboarding.
- `apps/web/components/agent/AgentMessageBubble.test.tsx`: a platform inference failure is a system recovery card with no coworker or provider attribution.

Verification: run each targeted test and confirm it fails for the intended missing behavior.

## Phase 2 — Green/refactor: canonical executable routing

Deliverable: stale routes self-heal once and provider readiness is honest.

Implementation:

- Make provider/model reconciliation an awaited dispatch boundary and emit a typed reroute signal only when the fixed fallback chain cannot recover.
- Rebuild the route once from fresh manifests; the second failure is terminal.
- Reuse credential-material resolution in `loadEndpointManifests` and the provider admin projection, keeping no-auth local endpoints valid.
- Add a typed dead-end outcome while preserving the existing string helper for compatible callers.
- Carry the failure outcome through `AgenticResult`; persist it as a system message with null agent/provider/model attribution.
- Classify task context from user turns and gate the platform-onboarding task to `/setup`.
- Refactor duplicated failure-copy branches into the typed outcome presenter.

Verification: rerun Phase 1 tests, routing loader tests, provider eligibility/data tests, agentic-loop tests, and agent-coworker tests.

## Phase 3 — Red: reproduce identity and voice capability failures

Deliverable: `BI-45B95929` behavior is executable as failing tests before production edits.

Tests:

- `apps/web/lib/coworker-presentation/coo-name.test.ts`: standing COO presentation exposes primary name and secondary role separately.
- `apps/web/components/agent/AgentPanelHeader.test.tsx`: the header renders that hierarchy once.
- `apps/web/components/agent/AgentMessageBubble.test.tsx`: same-agent turns retain accessible authorship without repeated visual labels.
- `apps/web/components/agent/AgentMessageInput.test.tsx`: playback distinguishes checking, preference-off, missing profile, and TTS unavailable; dictation remains independent.
- `apps/web/app/api/voice/service-status/route.test.ts` and `apps/web/lib/voice-synthesis/service-status.test.ts`: the capability response combines profile readiness with service health.
- `apps/web/components/agent/hooks/useVoiceSynth.test.ts`: mount-time capability probing disables playback before the first failed synthesis call.

Verification: run each targeted test and confirm it fails for the intended missing behavior.

## Phase 4 — Green/refactor: identity hierarchy and truthful voice controls

Deliverable: the coworker panel establishes identity once and presents independent voice capabilities.

Implementation:

- Add one shared presentation-identity resolver; keep canonical identity and audit fields unchanged.
- Render conversational name as primary and `AI COO` as secondary in the header.
- Suppress the active header coworker’s repeated visual label while keeping per-message accessible authorship; continue labeling genuinely different collaborators.
- Extend the existing voice status response with ready-profile state and an explicit reason.
- Probe playback capability on mount in `useVoiceSynth`; expose checking, available, and unavailable states.
- Keep microphone support/state independent of playback health.
- Normalize action labels and `aria-pressed`; remove hardcoded color fallbacks from the touched mic control.
- Extract state derivation so the large panel/input modules shrink or stay flat.

Verification: rerun Phase 3 tests plus coworker-panel UX smoke and accessibility-focused component suites in light/dark compatible tokens.

## Phase 5 — Functional and blast-radius verification

- Run all affected Vitest files with the absolute worktree root and reconcile reported counts.
- Run web typecheck, prose guards, style-drift guard, and `pnpm run pregate:preflight`.
- Apply the DPF blast-radius review to routing callers, persisted message shape, provider admin status, and both voice surfaces.
- Apply the DPF UX-fit review to first viewport, identity hierarchy, disabled reasons, keyboard focus, accessible names, and light/dark themes.
- Run exact-tree `pnpm run pregate` through the shared local-integration lease and require the recorded candidate SHA to match the committed head.
- Treat post-merge live-install exercise of the original coworker-decision path as release verification, not as pre-PR evidence.

## Phase 6 — One-PR delivery

- Record Workroom evidence for tests, guards, UX, and runtime behavior.
- Commit with DCO sign-off, obtain an independent semantic review of the stable commit, and run local merged-code CI.
- Re-sweep open PRs immediately before push.
- Push `fix/coworker-routing-readiness-and-voice-truth`, open one ready PR referencing both BIs, and run `pnpm pr:health`.

## Backlog coverage

Decision: `decomposed` — each independently shippable deliverable maps to its live BI; operator direction binds them into one PR.

- `routing-readiness`: `BI-D25F867D`; independent; verifies route reconciliation, readiness, classification, and system attribution.
- `identity-voice`: `BI-45B95929`; independent; verifies identity hierarchy and independent TTS/STT capability states.

Coverage receipt: blocked by `BI-MCP-EFF-3E441834`. The live coverage service resolved the signed,
provider-verified plan blob at commit `2bb0b9772d7af23e9def4ea7a34be5a47c909829`,
then reported that `BI-D25F867D` has no initiative-scope baseline and that this baseline is
not currently recordable from an MCP session. Per the service's required fallback, this
section is the authoritative coverage table until that live MCP-efficiency gap is repaired.

Traceability:

- `routing-readiness` -> `BI-D25F867D`; contracts: Workroom `WC-BB6874E6` impact contract
  and the BI acceptance contract; requirements: executable readiness, system attribution,
  and onboarding isolation; flows: route -> fallback -> reconciliation -> bounded reroute,
  then agentic loop -> typed dead-end -> system timeline message; verification: Phase 1 and
  Phase 2 suites.
- `identity-voice` -> `BI-45B95929`; contracts: Workroom `WC-BB6874E6` impact contract and
  the BI acceptance contract; requirements: identity hierarchy, accessible authorship, and
  independent TTS/STT readiness; flows: standing-COO presentation -> header/message
  authorship and voice status -> synthesis hook -> speaker control; verification: Phase 3
  and Phase 4 suites.
- Dependencies: neither deliverable depends on the other for correctness; the shared PR is
  an operator-requested delivery boundary.

## Architecture and UX review

Architecture decision: aligned.

- The repair extends the existing route/fallback boundary, `AgentMessage` role projection,
  provider credential authority, standing-COO presenter, and voice service-status endpoint.
  It adds no schema, enum, route family, provider-health store, or second identity source.
- Reconciliation is bounded to one route rebuild. Credential checks are deduplicated by
  provider before execution, so profile count does not multiply credential lookups.
- Build Studio retains the full route-selection reason as diagnostic evidence, while its
  first viewport projects that variable internal text to a stable ready/blocked sentence.
  Credential truth can therefore change without leaking task types, provider identifiers,
  or endpoint counts into the operator-facing setup summary.
- Terminal platform failures remain in the existing timeline as `system` messages and are
  excluded from coworker semantic memory. This preserves the audit trail without teaching
  later turns that the coworker authored a platform failure.
- The voice endpoint now distinguishes coworker playback from profile preview. Narration
  preference governs the speaker; a ready profile can still be previewed while narration is
  off. Dictation continues to use its independent capture capability.

UX-fit decision: `truthful-contextual-recovery`, recorded as `DI-ADB42335FC3E` with a high-
confidence kernel margin of 7.336. The review is `fits-with-guardrails`: keep the existing
panel and controls, establish name and role once, preserve accessible authorship, present
terminal inference failures as platform status with one contextual recovery link, and state
why playback is checking or unavailable. The measured decision manifest is
`docs/ux-fit/2026-08-24-coworker-routing-readiness-and-voice-truth.ux-fit.json`.

## Risks and rollback

- Credential preflight could exclude a provider that uses a nonstandard credential parent. Mitigation: reuse `resolveCredentialProviderId` and keep no-auth endpoints explicit; rollback the loader filter independently.
- Discovery can fail during reconciliation. Mitigation: only one reroute is allowed; terminal copy states model/service unavailability without claiming “busy.”
- Changing persisted failure role can affect message consumers. Mitigation: retain the existing `AgentMessage` schema and exercise serializers, SSE recovery, and transcript rendering; rollback the role projection without reverting typed classification.
- Voice health probing adds one authenticated GET on panel mount. Mitigation: lightweight no-synthesis probe, fail closed with an explanation, and no polling loop.
- Identity suppression could hide collaborator provenance. Mitigation: suppress only the panel’s active header agent and retain accessible names plus labels for other agents.

No migration is required. Rollback is a normal PR revert; no data rewrite or destructive runtime action is involved.
