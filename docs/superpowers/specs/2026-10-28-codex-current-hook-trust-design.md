# Verify current Codex hook trust

Backlog: BI-C2BFB566. Shape: delivery-small@1.0.0. Profile: fix.

## Problem and evidence

At base 631012db62307fa334ca0d0109e78f339050fba5,
`packages/dpf-skill-pack/scripts/update_agent_toolchain.py` accepts any saved DPF
trusted_hash record. A single obsolete record reports healthy. The real Codex
hooks/list inventory presently reports 33 enabled, trusted DPF hooks after the
operator manually approved them. Saved records alone cannot prove current trust.

## Design grounding

Extend the existing updater and Codex app-server protocol. Reuse the delivered
hooks/hooks.json as the required roster and Codex hooks/list as the trust authority.
The duplicate-plane fix BI-2B634E68 remains intact. The initial trust notice from
BI-66EBEA06 remains the operator review path. The self-converging toolchain design
of 2026-10-27 owns ongoing refresh. No new trust store or permission bypass.
Official contract: https://learn.chatgpt.com/docs/hooks.

## Outcome

**OBJ-1:** The updater identifies current missing, disabled or untrusted DPF hooks.
**OBJ-2:** Updates preserve operator trust decisions and never infer trust from old records.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | One obsolete saved record and partial current trust cannot report healthy. |
| AC-2 | OBJ-1 | Every supported delivered handler must appear enabled and trusted in the current inventory; missing handlers, errors and unavailable inventory are unverified. |
| AC-3 | OBJ-2 | Trust audit is read-only, bounded and runs no model turn or hook commands. |
| AC-4 | OBJ-1, OBJ-2 | All-current trust passes, unchanged repeated audits preserve configuration bytes, and diagnostics name pending hook keys without exposing raw commands or secrets. |

## Ordered implementation (one atomic deliverable)

1. REQ-TRUST: Add inventory regression tests for stale-only, partial, disabled,
   missing, malformed, unavailable and all-current trusted states.
2. CONTRACT-HOOKS: Query supported hooks/list through a bounded stdio app server
   using the selected user's CODEX_HOME and actual project cwd. Compare the
   supported delivered roster, excluding WorktreeCreate which Codex does not
   expose in its lifecycle inventory. Retain the user-file fallback and filter
   it to DPF-owned handlers. Do not trust unrelated hooks or stale user entries.
3. FLOW-UPGRADE: Replace the regex existence check with the audit result, keep
   explicit --require-codex-hook-trust behavior and print actionable reasons.
   Preserve dry-run behavior and return unverified on unavailable inventory.
4. VERIFY-TRUST: Run focused and complete Python toolchain suites, compile changed
   Python, query the real inventory read-only, compare config bytes, and obtain
   the governed publication gate and independent review before the ready PR.

These steps are sequencing of one corrected trust verdict, not independent work.
A separate permissions serializer defect that quotes notify is outside this BI.

## Risks and rollback

Older Codex versions may lack hooks/list: report unverified and retain the trust
notice. Bound startup/read time and terminate only the spawned audit server.
Do not start threads, execute hooks, modify trust hashes or grant trust. Revert
this scoped commit to restore the prior checker; no database changes are needed.

## Backlog coverage

REQ-TRUST, CONTRACT-HOOKS, FLOW-UPGRADE and VERIFY-TRUST map to BI-C2BFB566.
The immutable coverage receipt is recorded in the live backlog after publication.
