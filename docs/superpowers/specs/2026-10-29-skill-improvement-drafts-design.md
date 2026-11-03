---
title: Record skill suggestions as internal drafts
status: draft
date: 2026-10-29
backlog: [BI-90CDCCBD]
---

# Record skill suggestions as internal drafts

BI-90CDCCBD is an independently shippable successor under BI-E9555B2D, extending the existing routine-learning design section A and PR6750. That design deliberately excluded `propose_skill_improvement`; this amendment supersedes only that exclusion for recording an inert draft. Actual skill review, application, rollback, seed revision and publication retain their existing controls.

**OBJ-SKILL-DRAFT:** A coworker records a suggestion once without asking a person to approve the act of writing it down. The exact live example is approval cmvubigks3a8x01o2dro6y6ob: the owner had to approve filing a draft that could not change any skill.

## Existing substrate and boundary

`contribution-hive-pack.ts` declares the tool as proposal; its handler calls `submitSkillImprovementProposal`. That service creates only an existing ImprovementProposal with category skill, targetSkillId and status proposed. Full supplied content occupies conversationExcerpt; it is the explicitly supplied target body, not a copied conversation. `approveSkillImprovementProposal` separately updates SkillDefinition/SkillRevision and emits the reviewed seed change. No new table, tool, grant, enum, permission store or scheduler is needed.

Use the existing immediate + coworkerArtifact classification for this inert write, preserving sideEffect and intersected authority, explicit always approval, sensitivity and exact approval bindings. No central tool-name exemption. Existing outward contribution and actual application remain unchanged.

Before changing classification, make the existing submission repeat-safe: normalize the existing stored payload, scope it to submitting user/actor/route/thread/target skill, lock a digest of that scope and complete payload in an existing PostgreSQL serializable transaction, and reuse only identical proposed rows. Validate current thread ownership/cancellation and target skill existence in that transaction. Use the existing rolled-back-conflict classifier for bounded retries; unknown commit acknowledgement propagates without replay. Do not read transcript messages. Reviewed rows, other actors, scopes or content never match. No backlog intake is added to skill suggestions.

## Acceptance and verification

CT-SKILL-DRAFT is the existing proposal/artifact authority contract plus repeat-safe skill submission. FLOW-SKILL-DRAFT is current-authority admission → validate/lock → find-or-create proposed row → return draft identity → separate existing reviewer. VERIFY-SKILL-DRAFT comprises real handler/governor controls, unit characterization, actual PostgreSQL concurrency/isolation, both web TypeScript programs, canonical integration, independent review and protected CI. VERIFY-LIVE is a fresh explicitly labelled inert suggestion on the canonically deployed repair; no replay of the earlier completed approval.

The plan repeats the four live acceptance criteria verbatim. The authority, runtime and source checks are separate facts; source passing never proves installed behavior. Shared runtime admission uses the existing lease. Source-only reviews are separately attributed.

## Risks, compatibility and rollback

Existing proposal readers/reviewers and schema remain compatible. A repeat returns the existing pending draft; a reviewed draft is not revived. An actor or thread change cannot leak another proposal identity. Lock collisions only serialize unrelated writes. Actual application code and grants remain unchanged. Revert the source correction through the protected release path if required; retain existing drafts and all audit/approval history. No data migration or runtime row patch is planned.
