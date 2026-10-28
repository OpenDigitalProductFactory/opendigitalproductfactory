# Coworker briefing routing repair

Implementation owner: BI-7CF93976. Existing provider readiness work remains BI-2ECA4E9C; durable accepted-chat continuation remains BI-B7E2DD4B.

## Evidence and objective

The production route at 2026-10-28T20:26:37.567Z began internal, then screening matched contact-detail in messages[0] with origin user-briefing and imposed local-only. Anthropic was excluded by residency; local verification capacity refused execution. Current source gathers User.email solely to render the briefing heading. This creates customer-record evidence unrelated to the operator's question. Global Cloud allowed and account company-work approval do not prevent the payload clamp.

OBJ-CHAT: ordinary technical questions must not acquire customer data from platform-generated identity headings.
REQ-CHAT: eliminate unnecessary account identity from user briefing headings, including cached legacy projections, while retaining all facts, notes, checkpoints and their normal data screening. No classifier bypass, provider clearance change, quota reset or reservation override.

## Ordered atomic repair

1. Reproduce the generated email heading through the actual payload screener, retaining a negative control with real contact data in briefing facts.
2. Use a neutral current-user heading at generation and at the read boundary of existing cached user-scoped briefings. Reuse the existing formatter; do not alter organization briefings or arbitrary first lines.
3. Run briefing and screening regression tests plus package typechecks. Inspect exact diff and deliver through protected publication.
4. Verify the served coworker conversation routes to eligible cloud without a manufactured contact match; retain provider exclusions and runtime identity.

FLOW-CHAT: stored user projection -> user briefing formatter -> labelled history -> data screen -> eligible provider routing -> coworker response.
CONTRACT-CHAT: existing BriefingSources, CoworkerBriefing and screenInferencePayload; no schema or new runtime.
VERIFY-CHAT: coworker-briefing-routing.test.ts, existing coworker-briefing tests, screen-inference-payload tests and served portal check.

The steps are one atomic defect repair: testing, generation and cached read compatibility jointly establish REQ-CHAT. Actual contact data remains screened. Provider status visuals and durable continuation are independently owned deliverables and must not be represented as delivered by this repair.
