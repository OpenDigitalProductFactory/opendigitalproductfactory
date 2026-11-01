---
status: active
backlog_item: BI-D1FB8C4D
workroom: WC-C64BD7BB
---
# Worktree provisioning under GPP: implementation plan

Implement [the canonical design](../specs/2026-10-14-worktree-provisioning-under-gpp-design.md) (merged in #6628) for BI-D1FB8C4D. One branch, one PR: the capability split, the read-only shape, the server admission and bind-before-create are one behaviour change. Shipping the split without the admission would leave external callers ungated, and shipping the hook without the split would refuse nothing.

## Backlog coverage

Single delivery: BI-D1FB8C4D, implementation room WC-C64BD7BB (design room WC-5DD492B9). Research receipt `initiative-49cd9706-6fe9-4700-8c7f-50b6e8a8c1dd`; implementation admission IRD-0BD1D2E56996 (allowed, delivery-medium). Out of scope and filed: BI-293B21F4 (rooms with no shape admit every tool), BI-25A45D5C (raw `git worktree add` bypasses the admission), BI-3DCF0B8E (unregistered worktree directories), BI-88D75BA3 (branch reaper).

Traceability: AC-WPG-1 through AC-WPG-11; OBJ-WPG-1 through OBJ-WPG-4. WWMD decisions DI-C1731313EB9B (capability split, option B) and DI-F603138224BB (fail closed with break-glass, option H1).

## Ordered work

1. **Capability split (AC-WPG-3).** Add `worktree_provision` to `grant_catalog.json`; move `plan_workroom_worktree`, `plan_capsule_worktree`, `claim_workroom_scope` and `claim_capsule_scope` to it in `TOOL_TO_GRANTS`, the work-capsules pack grant map and the catalog's `honored_by_tools`. `GRANT_IMPLICATIONS` maps `work_capsule_adopt` to it, one way. Add the class `worktree-provision` to `WORK_SHAPE_CAPABILITY_GRANTS` and to `DELIVERY_ACTIVITY_GRANTS`; xlarge keeps `tool:read`.
2. **Principal parity (AC-WPG-5).** Add the grant to `WORKROOM_SESSION_SCOPES`, the ephemeral ship scopes and the `dpf.work` OAuth bundle. Every other holder of `work_capsule_write` also holds `work_capsule_adopt`. Test: `worktree-provision-capability.test.ts`.
3. **Delivery reach unchanged (AC-WPG-4).** The same test recomputes each delivery shape's reach under the pre-split requirements and asserts equality, and that the resolved grant set gains only `worktree_provision`.
4. **Read-only shape (AC-WPG-1).** `source-inquiry@1.0.0` in `source-inquiry-shape.ts`, registered last in `ALL_SHAPES`. Update the migration-proof key list and the shape-signature snapshot. The drive golden gains 20 sequences; the 100 changed digests are the five frozen prior-version shapes whose seed index moved by one, with no other digest changed.
5. **Server admission (AC-WPG-2).** `worktree-provision-admission.ts` (pure) and `worktree-provision-gate.ts` (loads rooms). `plan_workroom_worktree` and `claim_workroom_scope` check the target room; `adopt_worktree` checks the requested shape, the branch's live room and the caller session's live rooms, before any write. Test: `worktree-provision-reach.test.ts`.
6. **Bind before create (AC-WPG-6..9).** `scripts/lib/worktree-provision.mjs`: adopt with no git dir, then create, then re-adopt with the observed source identity. The binder returns its refusal `code` and the `marker`. The WorktreeCreate hook loads the library from the main root, keeps its verified-source binder as the after-create step and loses the nested fallback; `new-dev-worktree.sh` calls the library CLI. Tests: `worktree-provision.test.mjs`, `workroom-bind.test.mjs`, `worktree-create.test.mjs` (the copied-package scenarios now assert that a refusal, an outage or an unloadable library creates nothing).
7. **Docs (AC-WPG-11).** GPP §7.1 table and Annex A row; runbook "Read-only work needs no worktree" and "Creating a worktree"; spec §4 records the two-step bind.
8. **Verify and ship.** Targeted vitest and node tests, typecheck, `pnpm gate:local --committed`, `pnpm gate:wait`, DCO-signed PR.
9. **Measure (AC-WPG-10), after release.** New worktrees per day for 7 days before and after, and the share of rooms created on `source-inquiry`, recorded as evidence on the item.

## Rollback

Revert the PR. The grant is additive in the catalog and implied by `work_capsule_adopt`, so no stored grant has to be migrated back. A wedged platform is covered by the break-glass, not by a revert.
