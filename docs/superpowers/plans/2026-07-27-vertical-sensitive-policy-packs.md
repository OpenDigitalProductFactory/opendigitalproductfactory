# Vertical Sensitive-Data Policy Packs Implementation Plan

**Date:** 2026-07-27  
**Backlog:** BI-F6018DB3  
**Epic:** EP-DATA-GOVERNANCE  
**Spec:** `docs/superpowers/specs/2026-07-27-vertical-sensitive-policy-packs-design.md`

> **For agentic workers:** execute this plan one independently reviewable backlog
> item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
> implementation, `dpf-local-merge-ci-before-push` plus the plan's completion
> gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Design grounding

- Existing specs/plans reviewed:
  `2026-07-17-data-management-governance-design.md`,
  `2026-07-19-ai-provider-suitability-routing-design.md`,
  `2026-06-28-regulatory-autonomy-ceiling-policy-design.md`, and
  `2026-07-26-pre-dispatch-sensitive-llm-routing.md`.
- Current code substrate reviewed:
  `apps/web/lib/govern/data/{taxonomy,executable-policies,policy-decision}.ts`,
  `apps/web/lib/inference/data-screening/`, and
  `apps/web/lib/routing/provider-suitability/`.
- Source of truth: one data-governance PDP evaluates all pack rules; the
  inference PEP and provider-suitability compiler only enforce/narrow outcomes.
- Decision: compile data classes to canonical governed profiles and evaluate
  per-class versioned pack rules through the existing PDP (DI-4485266A1EB6).

## Backlog coverage

- Decision: atomic
- Parent: BI-F6018DB3
- Receipt: cms3nlgvi0h5b01p5xgpebe7z
- Dependencies: none
- Rationale: the pack registry, classifier coverage, PDP enforcement, and
  operator guidance form one safety boundary. Shipping a phase alone would
  classify without enforcement, enforce without full regulated-class coverage,
  or document behavior that is not true.

## Phase 1: Canonical profile and pack contract

**Deliverable**

- Export the existing workload-class profile resolver so inference screening and
  provider suitability share one class-to-asset/category/sensitivity mapping.
- Add criminal-justice, safety-sensitive, and youth-sensitive classes.
- Add a pure versioned pack registry with invariant tests.

**Files**

- Modify `apps/web/lib/routing/provider-suitability/types.ts`
- Modify `apps/web/lib/routing/provider-suitability/workload-profile.ts`
- Modify `apps/web/lib/routing/provider-suitability/workload-profile.test.ts`
- Modify `apps/web/lib/inference/data-screening/types.ts`
- Create `apps/web/lib/inference/data-screening/vertical-policy-packs.ts`
- Create `apps/web/lib/inference/data-screening/vertical-policy-packs.test.ts`

**Verification**

- Registry IDs/versions and class coverage are unique and complete.
- Every pack resolves to the same canonical profile used by provider suitability.
- Every obligation is enforceable by `inference-dispatch`.

## Phase 2: Classifier fixtures

**Deliverable**

- Add narrow rules and regression fixtures for clinical, financial, legal, CJI,
  safety, youth, HR, source-code, credential, and customer-record payloads.
- Preserve privacy-safe receipts and benign-work behavior.

**Files**

- Modify `apps/web/lib/inference/data-screening/classify-payload.ts`
- Modify `apps/web/lib/inference/data-screening/classify-payload.test.ts`

**Verification**

- Each acceptance class is detected by a representative value/path fixture.
- Serialized classification never contains fixture values.
- Ordinary public/internal writing remains free of governed classes.

## Phase 3: One-PDP enforcement and safe receipts

**Deliverable**

- Evaluate one canonical PDP context per detected class.
- Compose default policies with relevant pack policies.
- Combine effects and obligations conservatively and deterministically.
- Tighten transformed eligible payloads to `approved_cloud`; keep
  review/deny/never-public packs local-only.
- Add pack versions to the bounded receipt.

**Files**

- Modify `apps/web/lib/inference/data-screening/evaluate-inference-policy.ts`
- Modify `apps/web/lib/inference/data-screening/evaluate-inference-policy.test.ts`
- Modify `apps/web/lib/inference/data-screening/screen-inference-payload.ts`
- Modify `apps/web/lib/inference/data-screening/screen-inference-payload.test.ts`
- Modify affected receipt/fallback/routed-inference tests

**Verification**

- Allow-with-obligations, review, deny, unknown-context, and precedence cases pass.
- A protected customer payload may use approved cloud after evidence checks.
- Legal, CJI, youth, safety, credential, and unknown payloads remain local-only.
- Pack/PDP outcomes never add providers or weaken caller sensitivity/residency.
- Receipts contain no raw prompt or governed values.

## Phase 4: Operator guidance

**Deliverable**

- Explain pack outcomes, provider evidence, retention prompts, masking, refusal,
  and human checkpoints in plain language.
- Link official sources and explicitly avoid legal/compliance overclaims.
- Cross-link provider setup guidance.

**Files**

- Create `docs/user-guide/ai-workforce/sensitive-data-policy-packs.md`
- Modify `docs/user-guide/ai-workforce/connecting-providers.md`
- Modify generated docs index only through the canonical generator if required

**Verification**

- Prose lint and docs-link checks pass.
- Copy never states that DPF or a provider is compliant/certified.
- Guidance distinguishes technical defaults from jurisdiction-specific review.

## Refactoring budget: 20%

- 10%: consolidate duplicate workload data-profile maps.
- 5%: centralize deterministic policy/effect/obligation combination helpers.
- 5%: replace repeated fixture construction with typed test builders while
  preserving explicit expected boundaries.

## Risks and rollback

- Broad classifiers could over-restrict benign work: use narrow patterns and
  regression fixtures.
- A pack rule could conflict with platform defaults: rely on the existing
  precedence lattice and test order independence.
- An obligation could exceed PEP capability: fail registry invariants and runtime
  evaluation closed.
- Rollback removes pack composition and the three new class rules; existing
  generic restricted/confidential screening remains active.

## Completion gate

- Focused classifier, pack, PDP, screen, routed-inference, fallback, and
  provider-suitability suites pass.
- Web typecheck and production build pass.
- `git diff --check`, prose lint, docs-link, design-grounding, data-impact, and
  repository guards pass.
- Exact candidate passes the governed local merged-code gate.
- PR health reports no failing/pending checks or unresolved review threads.

