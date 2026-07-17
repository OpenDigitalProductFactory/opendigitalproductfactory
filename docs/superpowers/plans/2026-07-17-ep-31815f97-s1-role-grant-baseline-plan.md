# EP-31815F97 S1 — role-derived RBAC baseline (coworker-first)

**Epic:** EP-31815F97 · **BI:** BI-56E9CEC2 · **Spec:** `docs/superpowers/specs/2026-07-17-coworker-authority-model-completion-design.md` (§3 S1) · **Kernel scope:** DI-B812A3E7713C (option A, high confidence)

## Goal

Replace the hand-listed, per-agent flat ~74-key grant set (which is *why* 19/20 coworker grant sources diverge, and *why* the CapabilitiesEditor is a flat dropdown) with a conservative **role-derived baseline + deltas**: default authority = universal read baseline + the role's read baseline; every write/act grant is an explicit, visible escalation (INV-A1, least-privilege). Built on the `valueStream` key that also keys `ValueStreamTeamRole` (workerType ai-agent|human|either), so it extends to human roles in a follow-on rather than being rewritten.

## Design grounding

Existing specs/plans reviewed (via search_specs_and_plans): docs/superpowers/specs/2026-07-17-coworker-authority-model-completion-design.md; docs/superpowers/specs/2026-04-02-ai-workforce-consolidation-design.md ("two authorization models… no unified way to determine what an agent is allowed to do"); docs/superpowers/specs/2026-06-26-coworker-management-consolidation-design.md ("5–7 surfaces, ~15–20 clicks"). Current code substrate reviewed: apps/web/lib/tak/agent-grants.ts (COWORKER_READ_BASELINE_GRANTS, TOOL_TO_GRANTS, GRANT_IMPLICATIONS, knownGrantKeys), packages/db/src/workforce-seed.ts (HARDCODED_COWORKER_GRANTS, valueStream seeds), packages/db/prisma/schema.prisma (ValueStreamTeamRole ~10038 — the shared abstraction), apps/web/components/platform/coworker-record/CapabilitiesEditor.tsx.

Design-Grounding-Decision: extends the EP-31815F97 spec §3 S1 (kernel scope DI-B812A3E7713C, option A); no authority change in this slice — the baseline is READ-ONLY and display-only (describeAgentGrants); no enforcement path consumes it yet. Coworker authority unchanged (INV-3).

## What shipped (this PR — the mechanism)

`apps/web/lib/tak/role-grant-baseline.ts` (pure):
- `VALUE_STREAM_READ_BASELINE: Record<ValueStream, grantKey[]>` — conservative, **read-only** per-stream reads on top of `COWORKER_READ_BASELINE_GRANTS`. DRAFT — founder-reviewable (it defines what every coworker of a stream may READ).
- `deriveRoleBaselineGrants(role)` — universal ∪ stream read baseline; unknown stream → universal only.
- `computeGrantDelta` / `resolveEffectiveGrants` — express/reconstruct effective grants as baseline ⊕ delta.
- `describeAgentGrants(role, effective)` → `{ baseline, escalations, withheld, effective, writeEscalations }` — the operator surface: baseline is context, `escalations` are the edit surface, `writeEscalations` (non-`*_read` adds) are the least-privilege attention set.
- A test enforces **the baseline is read-only** (no `*_write`/act grant ever in any baseline).

## Follow-on (next PRs, founder-steered)

1. **CapabilitiesEditor UX** — render `describeAgentGrants`: role baseline chips (read-only context) + "Escalations beyond baseline" (the editable delta, write-escalations flagged), replacing the flat ~74-key dropdown. Needs dpf-ux-fit-review + portal verification.
2. **Divergence reconciliation (BI-56E9CEC2)** — make effective coworker grants = role baseline ⊕ per-agent delta at resolution, so the DB-seed vs JSON divergence collapses to a single delta source over a shared baseline (authority-sensitive; founder confirms the table first).
3. **Human extension (S4)** — apply the same baseline/delta over `ValueStreamTeamRole` for `workerType: human|either`, bridging the PERMISSIONS namespace.

## Verification

- `pnpm --filter web exec vitest run lib/tak/role-grant-baseline.test.ts`
- `pnpm --filter web typecheck && pnpm --filter web build`

## Non-regression

Display-only + read-only baseline; nothing consumes it to change authority yet (INV-3). The value-stream table is conservative by construction (a test fails if any baseline grant is not `*_read`).
