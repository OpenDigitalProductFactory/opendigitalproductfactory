# Canonical coworker authority repair

BI-CAP-437F7745; atomic repair. BI-56E9CEC2 depends on this identity correction and retains role/room configuration scope.

## Acceptance
- AC-1: Canonical and alias admin routes edit and display the same canonical authority record used by OAuth/PAT, MCP authorization and diagnostics.
- AC-2: Grant and revoke changes are visible on subsequent requests and reconnects; explicit grants and revocation tombstones persist across provisioning.
- AC-3: Existing conflicting records require a fresh administrator reconciliation preview and explicit approval; no grant union occurs automatically.
- AC-4: Token, human, coworker and room permission intersection and unrelated denials remain enforced.
- AC-5: Both diagnostic read tools load and execute after canonical deployment, with source and deployment evidence reported separately.

## Research and design
Observed: the record editor uses the execution slug's Agent.id while MCP reads AGT-EXT-CODEX. Existing canonical identity mapping and AgentToolGrant/AgentToolGrantRevocation remain the owning substrate. OAuth consent already excludes mirror rows. Reject automatic grant union, alias fallback, and a parallel authority store. Canonical persisted grants remain effective until a human administrator approves a state-bound reconciliation. No deployment grants or self-grants are added.

## Sequence
1. Refactor authority resolution through existing identity helpers (20% effort). Resolve business references and cuids to canonical row; fail closed if missing. Preserve execution identity for skills and service FKs.
2. Route grant mutation, effective authorization, MCP diagnostic profile, admin display, and PAT context through canonical identity. Filter tombstones and retain token/human/room checks.
3. Add administrator-only reconciliation preview: compare explicit grants and tombstones on canonical and alias rows, require explicit choices, reject stale state under a serializable transaction, preserve provenance. Existing aliases keep their records; no automatic data merge.
4. Compose existing themed UI primitives for persisted grants, authority identity, reconciliation and effective-access explanation. Update operator docs.
5. Targeted tests for canonical/alias/cuid routes, missing canonical, grant/revoke/reconnect, conflict/stale approval, self-target, and unrelated denial; typecheck locally. Shared/cloud build and served UX gate, merge queue, canonical self-upgrade, diagnostic execution and reconnect checks.

## Traceability
Requirements: AC-1, AC-2, AC-3, AC-4, AC-5.
Contract: canonical-authority-owner.
Flow: administrator-preview-approve-reconnect.
Verification: canonical-authority-regressions-and-live-diagnostics.

## Risks and rollback
Canonicalization may expose missing canonical provisioning; refuse rather than use another row's grants. Alias-only grants remain inactive pending independent approval. Roll back code through a revert PR; do not erase administrator grants or tombstones. Runtime gates unavailable through this connection remain unrun and require an authorized release executor.

## Backlog coverage
One atomic deliverable mapped to BI-CAP-437F7745: editor/read/mutation coherence and reconciliation must ship together to avoid another split authority. Receipt pending immutable publication.
