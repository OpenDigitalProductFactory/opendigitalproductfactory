---
status: active
---

# Capability-aware Anthropic thinking compatibility

BI-773518CD / WC-7F8E275D. Small provider-protocol repair under the
operator-company mission in DOC-89BFB246. This extends the existing
[situational parameter design](2026-09-18-situational-llm-call-parameterization-design.md)
and [execution recipes](2026-03-20-execution-recipes-design.md).

## Evidence and overlap

Canonical7396 logged an Anthropic HTTP400 at2026-11-01T05:00:45.720Z:
the selected model rejects `thinking.type: enabled` and requests adaptive
thinking with `output_config.effort`. The subsequent CLI fallback is unsettled;
this API rejection does not establish its effects or authorize replay.

Current source selects adaptive thinking only for medium effort in
`effort-expression.ts` and `recipe-seeder.ts`, even when the model card declares
`adaptiveThinking: true`. High reasoning instead selects a manual token budget.
The chat adapter passes explicit thinking but does not carry adaptive effort
through `output_config`. These source facts require first-failing composition
tests; they do not prove the exact saved model metadata of the failed review.

The [current Anthropic thinking contract](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
and [troubleshooting guide](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting)
document that adaptive-only models reject the manual mode. Existing model-card
capabilities and effort expression are the source of truth; do not add a model
name heuristic or another capability registry.

BI-D81CCC24 remains done. BI-2ECA4E9C owns provider-readiness UI.
BI-D8E7195A and BI-B9AFE0B0 concern forced tool choice, not adaptive-only
thinking. BI-13971A7C concerns quota400 classification and is done.
BI-977B9F36 was retired into runtime-health diagnostic work. No active executor
held the three claimed source paths when WC-7F8E275D claimed them.

## Objectives, boundaries and compatibility

For a capability-aware Anthropic plan, use its supported adaptive mode at each
requested reasoning depth that the existing capability contract accepts. Express
qualitative effort through the existing provider settings and wire field.
Keep manual thinking for legacy capabilities and keep the same admitted total
completion allowance. Never add a reasoning reserve outside that allowance.
Retain explicit valid configuration, sampling restrictions and other providers.

Reuse `resolveEffort` / `expressEffort` for the recipe and dispatch paths. The
adapter serializes that result; it does not infer support from a display name.
An unsupported declared effort remains explicit, not silently lowered. Cover
caller effort precedence and fallback composition before claiming those paths
repaired; if a path loses capability evidence, repair the existing compiler
boundary rather than inventing a transport default.

This changes no schema, account activation, credentials, permissions, budget,
runtime switch or customer data. No migration is selected. Catalog discovery
through the existing active account is ordinary metadata synchronization, not
an inference or execution-readiness proof.

## Implementation and evidence plan

1. Resolve graph-linked and colocated tests for all three claimed source paths.
2. Add first-failing low/medium/high adaptive capability and actual serialized
   wire tests, plus legacy and explicit configuration controls. Include admitted
   completion allowances and caller effort precedence.
3. Extend the existing effort expression, recipe producer and adapter. Keep
   adaptive thinking within the admitted total and preserve other providers.
4. Run affected tests and both TypeScript programs, then obtain independent
   review and the normal canonical gate. Protected publication and deployment
   remain distinct. A fresh permitted served check is required for runtime
   acceptance; source mocks are not provider proof.

The original review TR-GATE-C03BBEE7152FF18EE4F22008 retains its digest,
deadline and three unsettled provider nodes. It cannot be retried because this
source repair exists. The original execution authorities must establish
settlement and fresh scoped health evidence through the existing recovery path.
Full Finance, mailbox/email and MSP business acceptance remain separate.
