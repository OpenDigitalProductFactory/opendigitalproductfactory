# Work Case Wave 4 Ecosystem Autonomy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the Work Case ecosystem/autonomy contracts that let DPF route cases to agents, read graduated autonomy from the existing trust dial, and keep federated actors governed without adding a parallel Work Case table.

**Architecture:** Add pure projection modules under `apps/web/lib/work-management`: an AgentCard-compatible capability descriptor and actor-routing helper, an autonomy envelope resolver over the existing `apps/web/lib/autonomy/trust-graduation.ts` core, and a federation participation policy that keeps external actors propose-only until trust and authority are explicit. Update the EA grounding manifest and the Work Management spec to mark Wave 4 implemented.

**Tech Stack:** Next.js 16 monorepo, TypeScript pure modules, Vitest, existing Work Case source/action/policy/accountability modules, existing progressive autonomy trust core.

---

## File Structure

- Create `apps/web/lib/work-management/agent-capability.ts` for AgentCard-compatible capability descriptors and actor routing.
- Create `apps/web/lib/work-management/autonomy-envelope.ts` for per-transition autonomy-mode resolution from trust level, risk, source, action, and policy ceilings.
- Create `apps/web/lib/work-management/federation-governance.ts` for external/federated participation guardrails.
- Create matching tests for each new module.
- Modify `apps/web/lib/work-management/index.ts` to export the new contracts.
- Modify `apps/web/lib/work-management/architecture-grounding.ts` and test to allocate Wave 4 files and verification cases.
- Modify `docs/superpowers/specs/2026-06-27-work-management-architecture-design.md` to mark Wave 4 complete and set the next step to Wave 5 adoption.

## Task 1: AgentCard-Compatible Descriptor And Actor Routing

**Files:**
- Create: `apps/web/lib/work-management/agent-capability.ts`
- Test: `apps/web/lib/work-management/agent-capability.test.ts`

- [x] Write failing tests proving descriptors require sponsor/authority context for agent actors, expose A2A-style capability fields, match case source/action pairs, and rank routable actors by specificity.
- [x] Run the test and confirm it fails because the module does not exist.
- [x] Implement the minimal descriptor types plus `canActorHandleWorkCase` and `rankWorkCaseActors`.
- [x] Run the test and confirm it passes.

## Task 2: Autonomy Envelope Resolver

**Files:**
- Create: `apps/web/lib/work-management/autonomy-envelope.ts`
- Test: `apps/web/lib/work-management/autonomy-envelope.test.ts`

- [x] Write failing tests proving kernel-floor risk stays supervised/propose-only, supervised actions require a coworker envelope, trust ceilings are read from `recommendTrustChange` inputs, and the Work Case envelope never stores a new autonomy table state.
- [x] Run the test and confirm it fails because the module does not exist.
- [x] Implement `resolveWorkCaseAutonomyEnvelope` over existing trust-graduation types.
- [x] Run the test and confirm it passes.

## Task 3: Federated Actor Governance

**Files:**
- Create: `apps/web/lib/work-management/federation-governance.ts`
- Test: `apps/web/lib/work-management/federation-governance.test.ts`

- [x] Write failing tests proving external/federated actors are refused without authenticated-inbound authority, stay propose-only for outbound/floor risk, and require receipt/stop-condition support.
- [x] Run the test and confirm it fails because the module does not exist.
- [x] Implement pure federation participation decisions that compose with accountability and policy-envelope language.
- [x] Run the test and confirm it passes.

## Task 4: Grounding, Exports, And Spec

**Files:**
- Modify: `apps/web/lib/work-management/index.ts`
- Modify: `apps/web/lib/work-management/architecture-grounding.ts`
- Modify: `apps/web/lib/work-management/architecture-grounding.test.ts`
- Modify: `docs/superpowers/specs/2026-06-27-work-management-architecture-design.md`
- Test: `apps/web/lib/work-management/architecture-grounding.test.ts`

- [x] Add exports for the new modules.
- [x] Register `REQ-WC-7`, `REQ-WC-8`, `REQ-WC-9`, Wave 4 parts, and verification cases.
- [x] Update architecture-grounding tests to expect Wave 0 through Wave 4 allocations and implemented Wave 4 verification.
- [x] Update the spec status and next step to Wave 5 adoption.

## Verification

- [x] `pnpm --filter web exec vitest run lib/work-management/agent-capability.test.ts lib/work-management/autonomy-envelope.test.ts lib/work-management/federation-governance.test.ts lib/work-management/policy-envelope.test.ts lib/work-management/architecture-grounding.test.ts`
- [x] `pnpm --filter web typecheck`
- [x] `pnpm --filter web build`
- [x] Record evidence against `BI-WC-WAVE4` once MCP writes reopen.
