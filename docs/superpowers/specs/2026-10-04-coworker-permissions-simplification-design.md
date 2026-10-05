---
status: active
---

# Coworker permissions simplification

BI-9BAAD504; WC-2FC67698; fix/coworker-permissions-simplify. One atomic fix extends [canonical authority repair](../plans/2026-10-04-canonical-coworker-authority.md) and [authority model](2026-07-17-coworker-authority-model-completion-design.md). BI-56E9CEC2 retains broader role-room configuration.

## Acceptance

- One permissions editor for fresh and already reconciled installs; no ongoing legacy setup.
- Safe, idempotent migration for unambiguous duplicate records, preserving explicit grants, revocation tombstones and provenance. Never silently union grants or widen access.
- Genuine conflicts require a clear, state-bound administrator preview and explicit approval. Provide a concise summary and efficient bulk choices, with individual decisions only where necessary; reject stale previews.
- Retire duplicate permission authority while retaining necessary execution aliases/FK references. Extend existing identity/grant/reconciliation helpers; no parallel store.
- Clear saved-state and effective-access feedback reflecting token/human/coworker/room intersection, using plain language and existing theme-aware UI primitives.
- Regression coverage: migration reruns, conflicts, grant/revoke visibility, alias routes, reconnect/upgrade persistence, stale previews and unrelated denials. Verify supported themes and keyboard flows.
- Allocate 20% of implementation effort to relevant refactoring.

## Research and reproduction

Named ref: 97f848dbe0db77f14deda8034dd2d89a2e21449e. `CapabilitiesEditor.tsx:293` always mounts the review control; `AuthorityReconciliation.tsx:55` always renders its review button. `reconcileCoworkerGrants` retains alias grant rows after approval. `seed.ts:1205` recreates permission rows on execution aliases. Existing canonical-authority and reconciliation UI tests pass 15/15; they prove neither retirement nor disappearance. Add failing behavioral tests for the empty/completed view and removal of alias authority before repair. Existing canonical resolver/reconnect tests rule out wrong authority selection; the defect is retained duplicate state and unconditional UI. Graph-linked test advice is empty: expand coverage to canonical-authority, grant core, seed invariants, reconciliation and editor tests.

## Design grounding

Canonical identity mapping in `packages/db/src/agent-identity.ts`, `coworkerAuthorityAgentId`, AgentToolGrant and AgentToolGrantRevocation own identity and authority. ToolExecution already owns authority audit provenance. No schema/store addition. Retain Agent execution aliases for skills/service FKs. Extend existing reconciliation and seed helpers. Prototype: [clickable permissions prototype](../../ux-fit/2026-10-04-coworker-permissions-prototype.html).

Automatic cleanup is limited to alias assertions that agree with canonical state, and alias revocations when canonical has no grant. Canonical-only keys are not conflicts: alias absence is not a claim. Alias-only grants and grant-versus-revocation differences require approval. Preserve original actor/time on moved rows; before deleting duplicates, store their bounded per-key original records in the existing authority audit ledger. Audit and cleanup are one transaction. A serializable approval reads and hashes both rows including provenance, validates the exact difference choices, writes an audit of choices, preserves selected provenance, tombstones deliberate removals, and retires alias permission rows. A rerun sees no alias authority and does nothing. Missing canonical provisioning fails closed and retains all records.

Prevent seed recreation by skipping permission seeding for mapped execution aliases; canonical registry defaults remain the existing owner and canonical tombstones remain binding. Do not union alias defaults into canonical defaults. Migration runs before boot seed. Conflict records remain pending until an administrator approves them.

## Ordered implementation

1. Refactor state comparison, deterministic snapshots and retirement transaction helpers (20% effort). Add failing tests; retain canonical identity/resolver and permission intersection.
2. Add forward-only SQL backfill for safe mapped pairs, auditing duplicate provenance and moving safe revocations. Conflicts and missing canonical owners remain unchanged. Apply twice in shared PostgreSQL verification. Seed only canonical owners; test reseeding persistence.
3. Server projects conflict presence; fresh/completed installs show one editor and no cleanup control. Conflicts disclose count, two bulk choices and individual overrides; dialog precedes transaction. Stale preview clears choices and offers a new review. Reuse Surface, Button, Notice and existing Dialog. Saved mutations announce success and explain effective access.
4. Run affected tests, web/db typecheck, data-impact/migration/style guards, docs index. Shared pregate build/migration apply, served themes/mobile/keyboard checks, independent UX/review, DCO PR, merge queue and canonical upgrade. Record actual results and update live BI.

## Traceability and coverage

Atomic deliverable `permissions-authority-retirement` maps to BI-9BAAD504. Requirements: `acceptance-permissions-simplification`. Contract: `canonical-authority-no-widening`. Flow: `preview-approve-retire-reconnect`. Verification: `migration-ui-authority-regressions`. These phases cannot ship independently: cleanup without seed correction returns on upgrade; UI removal without retirement hides conflicts; retirement without state-bound approval loses decisions. Coverage receipt pending immutable publication.

## UX fit and risks

Owning area Platform; administrator persona; existing /platform/ai/agent/[agentId] capabilities panel, contextual controls only. Default has one editor; conflict details are disclosed. No prompt sending. Current access remains authoritative until approval. Audit writes must precede destructive row cleanup. Migration rollback is code revert plus audited recovery, never automatic restoration of discarded grants. Missing provisioning and stale state refuse changes. Effective permission intersection remains unchanged.

The required UX coworker service catalog/engagement route currently returns `agent-grant-missing` for `coworker_catalog_read` and `coworker_engagement_write`. Record this as an unrun independent UX review; no alternative route may substitute for denied authority. Backend work and prototype preparation remain authorized.
