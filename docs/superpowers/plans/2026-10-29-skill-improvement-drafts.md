---
title: Deliver repeat-safe skill suggestion drafts
status: draft
date: 2026-10-29
backlog: [BI-90CDCCBD]
---

# Deliver repeat-safe skill suggestion drafts

For agentic workers: execute one independently reviewable backlog item on one branch and PR. Use dpf-tdd, the canonical integration gate and dpf-pr-with-dco. Workroom WC-78A66B61; design docs/superpowers/specs/2026-10-29-skill-improvement-drafts-design.md. One atomic deliverable: classification and safe persistence must ship together so automatic recording cannot create duplicate or foreign drafts. No separate feature or schema change.

## Verbatim acceptance

- AC-SKILL-DRAFT-1: Under permitted current authority, filing an internal skill suggestion creates a proposed draft without a generic proposal approval; explicit always and missing/changed authority continue to gate or refuse.
- AC-SKILL-DRAFT-2: Same user, actor, route/thread, target skill and complete submitted content reuse one pending draft under concurrent repeats; different or reviewed drafts are not reused, and uncertain commit acknowledgements are not blindly replayed.
- AC-SKILL-DRAFT-3: Foreign/stale thread or missing target skill creates no draft, no transcript is read, and actual approveSkillImprovementProposal revision/publication controls remain unchanged.
- AC-SKILL-DRAFT-4: Handler/governor regressions, real PostgreSQL repeat/isolation tests, both web typechecks and exact protected release checks pass; live filing is verified only after canonical deployment.

## Sequence

1. Publish this proportional amendment and plan before implementation admission. Reuse CT-SKILL-DRAFT / FLOW-SKILL-DRAFT / VERIFY-SKILL-DRAFT / VERIFY-LIVE from the design. Record immutable atomic backlog coverage for BI-90CDCCBD. Independent challenge must check the prior explicit exclusion and actual skill application boundary.
2. Resolve graph-linked tests for contribution-hive-pack.ts and skills/proposals.ts. First reproduce current proposal interception and duplicate pending rows. Add foreign/cancelled-thread, target, payload/actor isolation and uncertain-ack cases; use actual PostgreSQL for concurrency rather than claiming an in-memory proof.
3. Implement scoped transactional repeat safety in the existing submission service, then classify the inert draft through the existing artifact lane. Update the handler result to distinguish reused draft identity; retain reviewed application and explicit always policy. Update authority characterization that currently deliberately expects skill suggestions to remain proposal.
4. Check derived doc-index and capability-completeness freshness before any generated-file claim. Only edit a stale generated artifact. Keep contribution-hive-pack below its baselined 862-line limit. Run the style guard, all affected tests and both web typechecks, then freeze a signed clean source commit for canonical integration, exact independent semantic review and protected publication. Record unrun or unavailable checks faithfully.
5. Verify merged SHA on the canonical installation using its governed update procedure and existing release coordination. Only then verify one fresh explicitly labelled internal skill suggestion and exact pending reuse, with the ordinary consequential control still gated. Preserve the completed original approval and all uncertain COO/watch/update executions without replay.

## Backlog coverage

Initial atomic receipt cmvudedix3m7x01o2puycjnxn binds this plan at f6776617b429739de1d4d920eb9eccb850011aec / blob f205cccb35626fb33a8cbe11f04dd4c831a3b5c2. Its four criteria, contract, flow and verification references map to the single internal skill-draft deliverable. Research receipt initiative-e84da5ca-167e-4993-a976-1afd07628c73 confirms the named live/source reproduction; it is not product test or runtime acceptance. No implementation-ready claim until admitted. Rollback is a protected source revert preserving drafts/history; no data migration, grant change, provider call or automatic skill application is authorized by this plan.
