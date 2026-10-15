---
status: active
---

# Bound generated immutable-source pages

Existing backlog: BI-CAP-EF2B04BB. Workroom: WC-CC546381.

## Observed failure

On served Recovery 9, fresh routing-plan Task60633F54F73E successfully read the original plan with generated maxChars=79040. Its governed writer rejected that recorded pagination value against the canonical 16000-character maximum. No receipt exists. The independent review's parent/child-plan finding remains a separate, unresolved assessment; fixing pagination does not approve the plan.

## Design grounding

Reuse `source-page-lines.ts` as the source of pagination bounds and `readerPageCharsForModelView` as the owner of generated reader pages. Reviewed the provider multi-account plan, terminal tool policy, agentic-loop normalizer and terminal-writer context validation. Cap generated pages at the canonical maximum without weakening provider argument validation, artifact binding, evidence completeness or writer independence.

## Delivery and verification

1. Reproduce the successful-generation/failed-revalidation mismatch in the existing terminal policy suite.
2. Cap the shared page-size helper; verify recorded arguments survive writer-side validation.
3. Run graph-linked reader, policy, agentic-loop and writer-context tests, both web TypeScript programs and required guards. Preserve RED and PASS evidence.
4. Freeze and independently review the narrow delta, publish through the protected PR process and canonical release, then recover only through the supported same-task path. Live recovery is unrun until the fix is served; do not reset task attempts or reuse a cached assessment as a receipt.

Rollback is the single helper change; all historical executions and review findings remain intact.
