---
status: proposed
---

# Approved Design Delivery Lifecycle Implementation Plan

- **Date:** 2026-08-23
- **Backlog item:** BI-AADDF8C1
- **Epic:** EP-129D11FD
- **Workroom:** WC-D3176BAB
- **Design:** `docs/superpowers/specs/2026-08-23-approved-design-delivery-lifecycle-design.md`
- **Kernel decision:** DI-45BF1401AFF7
- **Delivery graph decision:** atomic

## Atomic rationale

This BI has one independently shippable platform concern: establishing the
approved-design delivery boundary. The typed ledger, provider-verified writer,
read projection, cleanup guard, recovery proof, and contributor rule must land
together. Shipping only one seam would either advertise a state that cleanup
can erase, protect a branch without a durable release boundary, or preserve a
payload no operator can discover. Future design documents and their successor
implementations are separate BIs by this feature's contract; they are not
sub-deliverables of this implementation.

## Requirement map

| Requirement | Contract | Flow | Verification |
| --- | --- | --- | --- |
| R-ADL-001: provider-verified merged doc delivery | AC-ADL-001, AC-ADL-002 | F-ADL-001 | V-ADL-001, V-ADL-002 |
| R-ADL-002: successor lifecycle projection | AC-ADL-003, AC-ADL-004 | F-ADL-002 | V-ADL-003, V-ADL-004 |
| R-ADL-003: cleanup protection | AC-ADL-005 | F-ADL-003 | V-ADL-005, V-ADL-006 |
| R-ADL-004: same-PR recovery after origin deletion | AC-ADL-006 | F-ADL-004 | V-ADL-007 |
| R-ADL-005: cross-surface process | AC-ADL-007 | F-ADL-005 | V-ADL-008 |
| R-ADL-006: touched-seam refactoring | AC-ADL-008 | F-ADL-001 through F-ADL-005 | V-ADL-009 |

## Delivery flows

### F-ADL-001 — prepare and finalize an approved design

1. For `prepare`, resolve design BI, successor BI, originating Workroom, current baseline,
   independent approval, and retention pin under a transaction lock.
2. Append a self-contained prepared pair and require the current recovery bundle
   before PR readiness.
3. For `finalize`, locate the provider PR through the prepared head commit and
   resolve merged artifact facts through an injectable provider adapter.
4. Deny draft, unmerged, wrong-base, wrong-head, non-doc, stale-baseline,
   self-successor, cross-epic, missing-pin, blob, or digest mismatches.
5. Append `approved_design_delivered` and
   `approved_design_successor_linked` with one delivery id.
6. Stamp the Workroom when it still exists; absence after a restored prepared
   intent is not a denial.
7. Return the shared successor projection; retry returns the same delivery.

### F-ADL-002 — discover the state

1. Parse activity payloads in one dependency-free module.
2. Project the latest coherent successor delivery and completion state.
3. Add the structured projection to backlog list/get MCP responses.
4. Load it in `/ops` and render a compact evidence badge plus detail disclosure
   beside the ordinary status.

### F-ADL-003 — protect unresolved approved branches

1. Resolve current baseline+pin without matching delivered activity.
2. Expose the typed protection through Workroom inventory.
3. Feed the protection set to the local janitor before classification and branch
   deletion; fail closed for unresolved remote inventory on unmerged cleanup.
4. Exclude protected Workrooms from stale abandonment.

### F-ADL-004 — recover after origin deletion

1. Preserve prepared/delivered successor activities and supporting design
   approval/baseline activities in the existing epic bundle.
2. Delete fixture client-task/worktree/Workroom origin records; retain the done
   design BI only as a supporting recovery dependency.
3. Reconcile into an empty database and query the restored successor.
4. Assert every immutable link and the operator label.

### F-ADL-005 — converge contributor surfaces

1. Update AGENTS and the delivery/recovery runbook only at the new split point.
2. Update existing DPF planning/finishing skills rather than creating a parallel
   client-specific workflow.
3. Add tool definition, grants, lazy disclosure, and executor conformance tests
   for Codex, Claude, Grok, Antigravity, and portal/coworker callers.

## TDD sequence

### Phase 1 — typed contract and projection

1. Add failing tests for prepared, delivered, malformed, duplicate, conflicting,
   and implemented successor activities.
2. Implement the dependency-free parser/projector.
3. Refactor all later consumers to use it; do not duplicate JSON parsing.

Files:

- `apps/web/lib/backlog/approved-design-delivery.ts`
- `apps/web/lib/backlog/approved-design-delivery.test.ts`

### Phase 2 — governed writer and MCP surface

1. Add failing repository tests for prepare/finalize, every F-ADL-001 denial,
   restored-finalization without a Workroom row, and atomic retry.
2. Implement provider observation and transactional writer using existing
   readiness baseline, receipt, retention pin, Workroom, and docs-only helpers.
3. Add the MCP tool definition/handler/grants and parity tests.

Likely files:

- `apps/web/lib/backlog/approved-design-delivery-repository.ts`
- `apps/web/lib/backlog/approved-design-delivery-repository.test.ts`
- `apps/web/lib/mcp/packs/backlog-pack.ts`
- existing MCP pack/grant/parity tests

### Phase 3 — backlog projection and UI

1. Add failing loader/read-tool tests for the structured projection.
2. Add failing accessible component tests for the evidence badge and disclosure.
3. Implement the MCP and `/ops` projections with shared report-kit/theme tokens.
4. Verify desktop and narrow viewports in the governed nonproduction portal.

Likely files:

- `apps/web/lib/mcp/packs/backlog-pack-read-tools.ts`
- `apps/web/lib/explore/backlog-data.ts`
- `apps/web/lib/explore/backlog.ts`
- `apps/web/components/operate/backlog/BacklogItemRow.tsx`
- focused tests beside each file

### Phase 4 — cleanup enforcement

1. Add failing pure janitor tests showing approved unresolved branches KEEP and
   unknown protection fails closed for unmerged live cleanup.
2. Add failing Workroom reaper tests showing protected rows are retained.
3. Implement one protection resolver and adapter payload.
4. Refactor worktree and Workroom cleanup consumers to share its semantics.

Likely files:

- `apps/web/lib/backlog/approved-design-protection.ts`
- `apps/web/lib/work-capsules/liveness-inventory.ts`
- `apps/web/lib/work-capsules/mcp-handlers.ts`
- `apps/web/lib/work-capsules/work-capsule-reaper.ts`
- `scripts/lib/worktree-janitor-core.mjs`
- `scripts/worktree-janitor.mjs`
- focused tests

### Phase 5 — recovery and doctrine

1. Add the failing end-to-end recovery fixture from F-ADL-004.
2. Make capture include the supporting done design BI and preserve/parse the
   typed successor activity without changing unfinished counts.
3. Update recovery documentation, AGENTS, runbook, and the existing planning and
   branch-finishing skills at the new decision point.
4. Add deterministic cross-surface conformance tests.

Likely files:

- `packages/db/test/backlog-recovery-capture.test.ts`
- `packages/db/test/backlog-recovery-bundle.test.ts`
- `packages/db/recovery/backlog/README.md`
- `AGENTS.md`
- `docs/runbooks/approved-design-delivery.md`
- `packages/dpf-skill-pack/skills/dpf-writing-plans/SKILL.md`
- `packages/dpf-skill-pack/skills/dpf-finishing-a-development-branch/SKILL.md`
- skill/conformance tests

### Phase 6 — governed verification and delivery

1. Run focused tests after every red/green cycle.
2. Run typecheck and package suites for affected packages.
3. Run blast-radius checks and cross-surface contract tests.
4. Lease the shared nonproduction environment; verify `/ops` at desktop and
   mobile widths and capture screenshots.
5. Run the full governed local merged-code gate against current `main`.
6. Commit with DCO sign-off, obtain independent semantic review, push, open one
   regular non-draft PR, and wait for every PR check.

## Verification catalog

- **V-ADL-001:** provider and writer rejection matrix.
- **V-ADL-002:** transaction, idempotency, and immutable-link assertions.
- **V-ADL-003:** pure lifecycle projection and conflict handling.
- **V-ADL-004:** MCP/UI read parity and accessible operator text.
- **V-ADL-005:** janitor classification and branch-delete protection.
- **V-ADL-006:** Workroom reaper retention and unavailable-inventory fail-close.
- **V-ADL-007:** capture/delete/reconcile/query end-to-end recovery demonstration.
- **V-ADL-008:** Codex/Claude/Grok/Antigravity/portal tool/grant/result parity.
- **V-ADL-009:** architecture/blast-radius review proves one parser, one
  protection resolver, no parallel lifecycle store, and at least twenty percent
  touched-seam refactoring allocation.

## Risks and controls

| Risk | Control |
| --- | --- |
| A derived state drifts across UI, MCP, cleanup, and recovery | One pure versioned projector; consumers receive typed output. |
| A caller fabricates approval or merge facts | Resolve receipt, pin, PR, blob, bytes, and digest server-side. |
| Activity pairs partially write | One database transaction and idempotent tuple. |
| Cleanup loses approved work while provider/MCP is unavailable | KEEP unresolved known approvals; fail closed for unmerged automatic cleanup when inventory is unknown. |
| Recovery depends on a done design BI | Self-contained successor payload and no-`--all` recovery fixture. |
| New rule becomes client-specific | One MCP contract and existing shared skills; executor matrix test. |
| UI obscures ordinary scheduling state | Evidence badge is adjacent and secondary; ordinary status remains unchanged. |
