# Provider-onboarding COO to AGT-902 A2A implementation plan

**Backlog item:** BI-26684747
**Parent acceptance:** BI-AIPS-004, BI-C98C6AB7
**Epic:** EP-AI-PROVIDER-SUITABILITY
**Status:** Implemented; verification in progress

## Outcome

When an owner asks the COO to explain an AI-provider suitability result, the COO uses DPF's existing governed `request_coworker` path to consult AGT-902 with a minimized, typed packet. The owner remains in one COO conversation, sees that specialist consultation occurred, and receives a structured advisory result without customer records, prompts, credentials, secrets, or raw regulated values entering the handoff.

This plan does not create a second chatbot, A2A transport, policy compiler, evidence store, or provider route. It extends `coworker-collaboration`, the existing delegation registry, the existing conversation/thread projection, and the provider-suitability recommendation.

## Grounded substrate

- A2A execution and visible child-thread cards: `apps/web/lib/tak/coworker-collaboration.ts`, `apps/web/lib/mcp-tools.ts`, `apps/web/components/agent/AgentCoworkerPanel.tsx`.
- Authority: `apps/web/lib/tak/collaboration-authority.ts`, `packages/db/data/agent_registry.json`, `apps/web/lib/tak/agent-grants.ts`.
- Owner-facing entry: `apps/web/components/platform/ProviderSuitabilityGuide.tsx`, `/workspace`, and `/setup` route personas.
- Provider recommendation source: `apps/web/lib/routing/provider-suitability/onboarding-recommendation.ts`.
- Audit/provenance: existing `DelegationChain`, child `TaskRun.a2aMetadata`, participant projection, and collaboration events.

Substrate verification found no overlapping open PR and no existing provider-onboarding A2A adapter. AIPS-005 through AIPS-008 already own router controls, work context, evidence/receipts, and continuous remediation, so those concerns remain out of this BI.

## Architecture review

**Decision:** aligned with concerns.

- Extend the existing `request_coworker` authority and child-thread path; do not add a provider-specific transport or table.
- Keep provider policy in the suitability compiler. The consultation packet is a read-only projection and cannot widen activation or routing eligibility.
- Use canonical agent identities and `delegatesTo`; the role-only COO remains the speaker while AGT-902 is visible specialist evidence.
- Keep the packet schema versioned and generic enough to validate at the provider-onboarding boundary, but do not turn arbitrary A2A objectives into a new unbounded metadata store.
- Persist only compact provenance already owned by `DelegationChain` and `TaskRun.a2aMetadata`; raw intake does not become audit payload.

## UX fit review

- **Decision:** fits-with-guardrails.
- **Owning area:** Platform, contextually embedded in setup and provider pages.
- **Route family:** `/setup`, `/platform/ai/providers`, `/workspace` coworker panel.
- **Primary persona:** a nontechnical owner who should only need to ask their COO.
- **Navigation:** contextual action only; no new route, tab, dashboard, or specialist launcher.
- **AI boundary:** the existing “Ask my COO” action is the explicit confirmation. The panel must preview the minimized purpose and show the specialist handoff/result; opening an informational card alone must not transmit data.
- **Failure:** denied/unavailable specialist consultation stays in the COO thread, says what DPF could not substantiate, and leaves provider posture unchanged.
- **Evidence:** component/route tests, A2A authority tests, keyboard/screen-reader assertions for the collaboration card, authenticated desktop/mobile walkthrough.
- **Implementation review (2026-07-19):** still `fits-with-guardrails`. The change reuses the existing provider guide, `AskCoworkerButton`, COO panel, and collaboration cards. It adds no route, navigation item, dashboard, or specialist launcher. The provider recommendation projection remains the visible source truth; the validated packet is the server-owned AI boundary. Unknown, unavailable, or malformed specialist output produces a COO-readable non-approval and cannot change provider policy. The remaining broad comprehension/mobile/accessibility study stays in BI-BF3DFDB8 rather than expanding this delivery concern.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-26684747`
- Governed COO to AGT-902 authority, minimized request, validated advisory, and visible return -> `BI-26684747`
- Local cold-start advice and deterministic no-egress fallback -> `BI-EDAAD429`
- Citation authority, freshness, applicability, and safe abstention -> `BI-CA5B5AB9`
- Accessibility and nontechnical comprehension completion evidence -> `BI-BF3DFDB8`
- Dependencies: `BI-EDAAD429` and `BI-CA5B5AB9` depend on `BI-26684747`; `BI-BF3DFDB8` depends on `BI-26684747`, `BI-EDAAD429`, and `BI-CA5B5AB9`.
- Receipt: `cmrsqgfi8056f01pg1ru7ucru`

This pre-enforcement plan was retrofitted through the deployed governed `record_execution_evidence` path because the live MCP `tools/list` does not yet expose `record_plan_backlog_coverage`. The receipt records the same decomposition, mappings, and dependency graph after live `get_backlog_item` verification of all four items; no Markdown-only backlog placeholders remain.

## Phase 1 — make the existing authority contract truthful

**Status:** Implemented in the first branch checkpoint.

**Deliverable:** both owner-facing COO surfaces can call `request_coworker` for AGT-902, and no broader delegation is granted.

**Files:**

- `packages/db/data/agent_registry.json`
- `packages/db/src/workforce-seed.ts` and `packages/db/src/seed.ts`
- `apps/web/lib/inference/bootstrap-first-run.ts`
- registry, bootstrap, persona, tool-grant, and authority tests
- `prompts/route-persona/onboarding-coo.prompt.md` and the live route persona

**TDD:**

1. Add failing tests proving the standing COO may delegate to AGT-902 and the setup COO receives the existing `thread_write` grant required by `request_coworker`.
2. Prove unrelated targets remain denied.
3. Apply the minimum registry change and rerun persona, grant, and authority tests.

**Verification:** registry audit, coworker persona audit, targeted Vitest, typecheck.

This is the first independently shippable phase.

## Phase 2 — define and minimize the provider-review packet

**Status:** Implemented.

**Deliverable:** a pure, versioned builder/validator produces a bounded consultation objective from the recommendation projection and canonical business-context references.

**Contract:** recommendation status, workload classes, jurisdiction basis identifiers, provider-connection/evidence references, explicit unknowns, and requested advisory fields. It rejects or omits customer records, free-form prompt bodies, credentials, secrets, raw personal data, and regulated values.

**Files:**

- new focused module under `apps/web/lib/routing/provider-suitability/`
- co-located red-first tests
- `apps/web/components/platform/ProviderSuitabilityGuide.tsx` or its server-owned projection boundary

**Verification:** golden packet snapshots, adversarial forbidden-field tests, module-size guard, targeted Vitest, typecheck.

## Phase 3 — execute the governed child consultation

**Status:** Implemented.

**Deliverable:** after the owner's explicit COO action and once the parent thread exists, the COO dispatches the packet to AGT-902 using `requestCoworker`, producing the existing visible collaboration card and chain-of-custody records.

**Files:**

- smallest existing action/panel boundary that already owns thread-aware coworker work
- `apps/web/lib/tak/coworker-collaboration.ts` only for a backward-compatible typed packet extension if Phase 2 proves the current summary/objective fields insufficient
- existing A2A integration tests and provider guide tests

**Verification:** red-first integration test for parent thread → authorized AGT-902 child → visible handoff/provenance; denied/unavailable target leaves posture unchanged and returns a COO-readable failure.

## Phase 4 — return a structured advisory to the COO thread

**Status:** Implemented.

**Deliverable:** AGT-902's result is validated as `recommended | conditional | not-suitable` with concerns, citations, missing facts, human-review needs, workload restrictions, and one safe next action; the COO synthesizes it without changing provider eligibility.

**Verification:** structured-result tests, conversation projection test, no-policy-mutation assertion, authenticated setup/provider walkthrough.

## Risks and rollback

- **Authority over-broadening:** grant only `thread_write` and AGT-902 delegation; registry tests pin the exact target. Roll back the registry lines without schema/data migration.
- **Sensitive packet leakage:** the builder is allowlist-based and tested against forbidden inputs. If validation fails, do not dispatch.
- **Model fails to call the tool:** Phase 3 owns deterministic thread-aware dispatch after explicit user action; BI-EDAAD429 separately owns weak/unavailable local-model fallback and no-egress proof.
- **Specialist result changes policy:** consultation output is advisory only; provider activation/routing remains owned by the existing suitability and activation gates.
- **UI complexity:** reuse collaboration cards and the COO panel. Roll back contextual wiring without affecting provider policy.

## Follow-on backlog map

- BI-EDAAD429 — local cold-start structured advice and deterministic no-egress fallback.
- BI-CA5B5AB9 — citation authority/freshness/applicability validation and golden/adversarial Q&A evaluation.
- BI-BF3DFDB8 — keyboard, screen-reader, failure-state, mobile, and nontechnical comprehension completion evidence.
- BI-AIPS-005 through BI-AIPS-008 — existing canonical owners for OpenRouter, work context, evidence/receipts, drift, remediation, and rollout.
