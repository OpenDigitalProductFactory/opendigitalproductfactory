# Tiered Model Routing Refresh Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-27-tiered-model-routing-refresh-design.md`  
**Umbrella backlog item:** BI-D964397F  
**Related bug:** BI-78043BA3  
**Workroom:** WC-FB12308F

## Goal

Refresh DPF's static model posture for GLM-5.3-Flash and Grok 4.6, correct Grok authentication classification, and make Build Studio's Grok guidance current without replacing Auto routing or claiming unverified model quality.

## Traceability

### Requirements

- **REQ-CATALOG-01:** Catalog GLM-5.3-Flash for both Z.ai transports with conservative, non-automatic posture.
- **REQ-CATALOG-02:** Catalog Grok 4.6 as the current active xAI agentic model while retaining compatibility models.
- **REQ-SEED-01:** Refresh provider families and owner-facing descriptions without model-wide pricing distortion.
- **REQ-AUTH-01:** Let Grok device sign-in pass business-alignment classification while preserving external-access, capability, and grant controls.
- **REQ-UX-01:** Suggest Grok 4.6 from one shared constant while keeping Server default first.
- **REQ-PROMPT-01:** Remove the unsupported assumption that Grok has current knowledge without retrieval.
- **REQ-LIVE-01:** Exercise provider, Build Studio, and coworker paths only after the canonical live preflight allows testing.

### Flows

- **FLOW-CATALOG-01:** source catalog -> startup reconciliation -> ModelProfile -> router eligibility.
- **FLOW-AUTH-01:** MCP tool discovery -> external-access filter -> capability/grant check -> device authorization -> credential activation.
- **FLOW-BUILD-01:** Build Studio Auto/custom choice -> engine readiness -> Grok dispatch -> route and attempt evidence.
- **FLOW-COWORKER-01:** coworker request -> governed tool set -> selected endpoint -> tool-use outcome.

### Contracts

- **CONTRACT-CATALOG-01:** discovery/admin ownership outranks static catalog data.
- **CONTRACT-ROUTING-01:** model preference never bypasses policy, capability, capacity, or sensitivity filters.
- **CONTRACT-AUTH-01:** external network access is not automatically an outward business consequence.
- **CONTRACT-UX-01:** Server default remains the default; custom selection is explicit.
- **CONTRACT-EVIDENCE-01:** vendor benchmarks are hypotheses; DPF scores and live success require DPF evidence.

## Deliverable 1: Fix Grok sign-in classification

**Backlog:** BI-78043BA3  
**Traceability:** REQ-AUTH-01; FLOW-AUTH-01; CONTRACT-AUTH-01; VERIFY-AUTH-01

1. Add a failing regression to `apps/web/lib/mcp/packs/grok-signin-pack.test.ts` that classifies the real sign-in definition and expects external access without business alignment.
2. Update `apps/web/lib/mcp/packs/grok-signin-pack.ts`:
   - add `requiresExternalAccess: true` to start and status;
   - remove `consequence: "outward"` from start;
   - retain `sideEffect`, `requiredCapability`, and grants.
3. Run the Grok sign-in pack and consequential-tool-policy tests.

## Deliverable 2: Refresh the model portfolio and Build Studio guidance

**Backlog:** BI-D964397F  
**Traceability:** REQ-CATALOG-01, REQ-CATALOG-02, REQ-SEED-01, REQ-UX-01, REQ-PROMPT-01, REQ-LIVE-01; FLOW-CATALOG-01, FLOW-BUILD-01, FLOW-COWORKER-01; CONTRACT-CATALOG-01, CONTRACT-ROUTING-01, CONTRACT-UX-01, CONTRACT-EVIDENCE-01; VERIFY-CATALOG-01, VERIFY-SEED-01, VERIFY-UX-01, VERIFY-PROMPT-01, VERIFY-GATES-01, VERIFY-LIVE-01

### Task 2.1: Write catalog tests first

1. Update `apps/web/lib/routing/known-provider-models.test.ts` to require:
   - disabled strong-tier GLM-5.3-Flash entries on `zai` and `zai-coding`;
   - image input and one-million-token context;
   - active strong-tier Grok 4.6 with a 500,000-token context and low/medium/high/xhigh effort levels;
   - retention of older xAI compatibility entries.
2. Update `packages/db/test/model-profile-seed-contract.test.ts` to require current GLM/Grok families and operator copy that does not claim unassisted real-time knowledge.
3. Run the two targeted tests and record the expected Red failures.

### Task 2.2: Implement catalog and seed changes

1. Update `apps/web/lib/routing/known-provider-models.ts` with the documented model entries and conservative scoring posture.
2. Update `packages/db/data/providers-registry.json` family lists and user-facing copy. Preserve provider-wide prices where model-specific pricing cannot be represented safely.
3. Run the catalog, auto-discovery, reconciliation, and seed-contract tests.

### Task 2.3: Refactor the Build Studio suggestion

1. Add a failing assertion for `DEFAULT_GROK_BUILD_MODEL` to `apps/web/components/platform/BuildStudioConfigForm.test.ts`.
2. Export the constant from `apps/web/components/platform/build-studio-config-form-model.ts`.
3. Replace both the custom-radio value and placeholder literal in `apps/web/components/platform/BuildStudioConfigForm.tsx` with that constant.
4. Run the form-model tests and prose/style guards. Confirm no new control was added; UX-fit evidence is therefore conditional rather than mandatory.

### Task 2.4: Correct Grok coworker instructions

1. Add `apps/web/lib/build/grok-dispatch.test.ts` with a failing contract that requires retrieval for current-event claims.
2. Export the specialist instruction builder from `apps/web/lib/build/grok-dispatch.ts` and replace the stale real-time-knowledge instruction.
3. Run the new test and the Build Studio dispatch/config suites.

## Verification

Run in this order:

1. Targeted Vitest files for each Red/Green loop.
2. `pnpm run check:prose-lint:test`
3. `pnpm run check:prose-lint`
4. `node scripts/check-style-drift.mjs`
5. relevant web typecheck/build and DB tests required by `AGENTS.md`.
6. `pnpm run pregate:preflight`
7. commit and push the exact tree with DCO sign-off.
8. `pnpm run pregate`
9. open the PR with Design Grounding and Seed-Fit decisions.
10. `pnpm pr:health`, inspect bot review findings, and obtain independent semantic review.

## Live verification

After the code is available on the live install:

1. Run `verify_live_install_readiness` for the feature SHA. Stop unless it returns `CAN-TEST`.
2. Run Grok sign-in and complete human device authorization, or confirm an existing xAI API key through the governed provider path.
3. Run Grok 4.6 endpoint probes.
4. Select Grok 4.6 explicitly and execute one bounded Build Studio task.
5. Execute one bounded AI-coworker task that requires tool use.
6. Inspect route decisions, capacity/fallback outcomes, and produced artifacts.
7. Re-run the GLM-5.3-Flash probes only after the Z.ai account has usable balance or Coding Plan entitlement; do not enable it from vendor claims alone.

## Stop conditions

- Do not edit the consumer runtime installation as source.
- Do not bypass the live ancestry preflight.
- Do not weaken global alignment policy to fix one tool declaration.
- Do not mark GLM-5.3-Flash active until successful DPF probes and evaluations exist.
- Do not claim Build Studio or coworker success from source tests alone.

