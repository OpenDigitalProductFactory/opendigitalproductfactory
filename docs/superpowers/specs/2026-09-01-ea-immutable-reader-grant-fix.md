---
title: Enterprise Architect immutable reader grant fix
status: proposed
backlogItem: BI-0E663867
---

# Enterprise Architect immutable reader grant fix

## Problem

The canonical `AGT-WS-EA` registry entry can write an architecture-review receipt but cannot read the immutable artifact that receipt must assess. On deployed commit `d82741f74cfda83fcf2d82a7d4ac7c6097030bbc`, Phase D TaskRun `TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-2AEEDFB97877` failed closed with `terminal_writer_context_reader_failed` because `read_source_at_version` was outside the coworker's assigned authority.

The source contract is unambiguous:

- `packages/db/data/agent_registry.json` grants `AGT-WS-EA` `initiative_architecture_review` but omits `file_read`.
- `apps/web/lib/tak/agent-grants.ts` and `apps/web/lib/mcp/packs/version-history-pack.ts` map `read_source_at_version` to `file_read`.
- `packages/db/src/workforce-seed.ts` already gives the legacy `ea-architect` seed `file_read`, so the canonical registry is the divergent surface.

## Candidate causes ruled out

- The immutable packet was malformed: ruled out because the same server-issued repository, commit, path, blob, and reader contract resumed other reviewer TaskRuns to governed approval envelopes.
- The reader implementation or Git mount was unavailable: ruled out because the other Phase D reviewers executed the same immutable reader against the same deployed runtime.
- The writer grant was absent: ruled out because `AGT-WS-EA` already holds `initiative_architecture_review`; the refusal names the reader before writer execution.

## Decision

Add `file_read` to the canonical `AGT-WS-EA` registry grant list. Do not widen the terminal-writer packet, reader implementation, token template, or runtime authorization policy. The server-issued packet remains narrowed to `read_source_at_version` plus `record_initiative_architecture_review`.

## Ordered fix sequence

1. Add a registry regression test requiring both `file_read` and `initiative_architecture_review` for `AGT-WS-EA`; prove it fails before the grant change.
2. Add only `file_read` to the canonical registry entry.
3. Run the targeted DB grant-consistency tests, affected guards, and the exact-tree gate.
4. Deploy through the canonical self-upgrade path and replay the exact Phase D architecture-review TaskRun.

## Acceptance

- The new test fails before the registry edit and passes after it.
- Existing grant-source divergence checks remain green.
- The deployed replay reaches a governed receipt or human approval envelope rather than an authority refusal.
- Immutable binding, token intersection, approval behavior, and fail-closed semantics are unchanged.

## Risks and rollback

`file_read` exposes the existing bounded, path-filtered read-tool family to the Enterprise Architect. The live review path further narrows that surface to the server-issued immutable reader. If the grant causes unexpected reachability, revert the single registry grant and the paired regression test; no schema or data migration is involved.

