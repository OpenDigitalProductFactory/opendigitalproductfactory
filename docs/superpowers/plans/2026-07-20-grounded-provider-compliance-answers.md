# Grounded provider-compliance answers implementation plan

**Backlog item:** BI-CA5B5AB9
**Epic:** EP-AI-PROVIDER-SUITABILITY
**Work capsule:** WC-E88505BB
**Status:** Implemented; verification in progress

## Outcome

The owner-facing COO may render a provider-compliance answer only after a pure validator proves that each material external claim maps to a current, authoritative, applicable source claim. Missing, stale, conflicting, mismatched, or unsupported evidence narrows the answer to `conditional` or `cannot_substantiate`, preserves the safe interim posture, and enters the existing profession-corpus gap loop.

## Grounded substrate

- `RawSource`, `WikiPageSource`, and the profession source registry own source identity and retrieval dates.
- `ProfessionCorpusUsageStat` and `ProfessionCorpusGap` own usage and learning feedback; no new gap table is needed.
- `provider-compliance-advisory.v1` and the deterministic local fallback own the existing provider-review result.
- The provider-suitability compiler remains the only provider-policy authority; an answer cannot widen routing posture.
- The COO and AGT-902 continue through the existing `requestCoworker`/`DelegationChain` A2A path.

## Architecture decision

Create a focused, pure answer-validation contract beside the provider-suitability advisory. Move the five provider-review source definitions into a small shared `@dpf/db` registry so the seed path and runtime validator consume one source of truth. Use stable source-claim ids for deterministic entailment: a citation supports a claim only when the canonical registry explicitly maps that source to that claim id. Persist the structured source scope in the existing `RawSource.locator` JSON; do not add a table or migration.

## Backlog coverage

- Decision: atomic
- Parent: `BI-CA5B5AB9`
- Rationale: The source registry, exact claim-citation entailment, safe abstention, corpus-gap feedback, and owner-facing referenced answer form one independently shippable evidence boundary; separating them would either expose unvalidated guidance or leave the validator without an owner-visible governed answer path.
- Grounded provider-compliance source registry, validator, advisory integration, repair feedback, owner rendering, tests, and documentation -> `BI-CA5B5AB9`
- Dependencies: `BI-26684747` and `BI-EDAAD429`, both completed and runtime-verified.
- Receipt: `cmrsuwp7e0alg01pgxaxkeulu`

The deployed MCP `tools/list` does not expose `record_plan_backlog_coverage`, so this compatibility-state receipt was recorded through the governed `record_execution_evidence` path documented by the earlier provider-onboarding plan. The live BI and both dependencies were already verified before recording it; no Markdown-only backlog placeholder remains.

## TDD slices

1. [x] Add red tests for direct-answer vocabulary and separation of sourced facts, operator declarations, technical verification, recommendations, and uncertainty.
2. [x] Add red tests rejecting missing, stale, non-authoritative, provider/service/account/jurisdiction/region/workload-mismatched, and unsupported claim citations.
3. [x] Add red tests for conflicting current evidence, smallest-safe follow-up, no automatic posture change, and deterministic/local fallback equivalence.
4. [x] Add a versioned golden/adversarial suite covering personal accounts, business/API accounts, EMEA/UK transfer, health, finance, employment, public sector, local-only, stale evidence, similarly named services, and missing account/jurisdiction facts.
5. [x] Extend the existing corpus-gap vocabulary for missing-topic, stale-source, citation-mismatch, and conflicting-evidence feedback, with dedupe tests.
6. [x] Wire validated answers into the provider-compliance advisory boundary and render compact references from the validated structure.

## Verification

- Targeted web and DB Vitest suites.
- Profession source seed validation.
- Web and DB typecheck.
- Module-size and diff guards.
- Full merged-code local-CI production gate.
- Authenticated referenced-answer walkthrough showing direct answer, source disclosure, safe abstention, and unchanged provider posture.

## Documentation impact

Update the governed onboarding plan with the implemented validation contract and evidence. The user-facing provider guide already owns onboarding explanation; update it only if the rendered answer interaction changes materially. No schema documentation or migration note is required because structured provenance uses the existing `RawSource.locator` field.
