---
title: Governed initiative reviewer immutable reader grant fix
status: proposed
backlogItem: BI-0E663867
---

# Governed initiative reviewer immutable reader grant fix

## Problem

Four canonical initiative-review coworkers can write their role-specific receipt but cannot read the
immutable artifact that receipt must assess. Phase D first exposed the Enterprise Architect failure;
Phase E then reproduced the same fail-closed `terminal_writer_context_reader_failed` authority
refusal for Data Governance, Security Auditor, and Licensing & Permit Specialist.

The source contract is unambiguous:

- `packages/db/data/agent_registry.json` grants each affected coworker its initiative-review writer
  but omits `file_read`:
  - `AGT-WS-EA` — `initiative_architecture_review`;
  - `AGT-902` — `initiative_data_review`;
  - `AGT-190` — `initiative_security_review`;
  - `AGT-905` — `initiative_compliance_review`.
- `apps/web/lib/tak/agent-grants.ts` and `apps/web/lib/mcp/packs/version-history-pack.ts` map `read_source_at_version` to `file_read`.
- Successful initiative reviewers, including Change Reviewer and UX Accessibility, already hold
  `file_read`; `packages/db/src/workforce-seed.ts` also gives the legacy `ea-architect` seed that
  grant. The canonical affected entries are the divergent surface.

## Candidate causes ruled out

- The immutable packets were malformed: ruled out because they are server-issued and bind exact
  repository, commit, path, blob, reader, and writer contracts.
- The reader implementation or Git mount was unavailable: ruled out because Change Reviewer, Build
  Lead, UX Accessibility, and Digital Product Estate Specialist executed the same immutable reader
  on the same runtime.
- The writer grants were absent: ruled out because every affected coworker holds its role-specific
  writer; each refusal names the reader before writer execution.

## Decision

Add `file_read` to the four affected canonical registry grant lists. Do not widen the terminal-writer
packet, reader implementation, token template, or runtime authorization policy. Each server-issued
packet remains narrowed to `read_source_at_version` plus its role-specific receipt writer.

## Ordered fix sequence

1. Add a table-driven registry regression test requiring `file_read` plus the role-specific writer
   for each affected coworker; prove all four cases fail before the grant change.
2. Add only `file_read` to the four canonical registry entries.
3. Run the targeted DB grant-consistency tests, affected guards, and the exact-tree gate.
4. Deploy through the canonical self-upgrade path and replay the exact Phase D/Phase E failed
   TaskRuns.

## Acceptance

- The new test fails before the registry edit and passes after it.
- Existing grant-source divergence checks remain green.
- The deployed replay reaches a governed receipt or human approval envelope rather than an authority refusal.
- Immutable binding, token intersection, approval behavior, and fail-closed semantics are unchanged.

## Risks and rollback

`file_read` exposes the existing bounded, path-filtered read-tool family to four reviewers. The live
review path further narrows that surface to the server-issued immutable reader. If a grant causes
unexpected reachability, revert the four registry additions and paired table-driven test; no schema
or data migration is involved.
