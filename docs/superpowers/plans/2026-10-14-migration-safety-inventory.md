---
status: active
---

# Batch migration-safety inventory

Backlog: BI-9775778F. Workroom: WC-A45355AA. Delivery: small.
Base: e74ab9d0b5da4233dd2f9a5759f75ef152453e8c.

## Design grounding

Extend the existing fleet-safe schema evolution guard and its SQL tests
(`2026-07-03-fleet-safe-schema-evolution-design.md`,
`packages/db/scripts/migration-safety-guard.mjs`). Historical path presence,
not changed SQL or commit age, determines whether a tracked migration is new.
The current driver performs one Git subprocess per historical migration.
Replace that lookup with one immutable base-tree inventory, compared with the
tracked working-tree inventory. Do not change SQL detection or attestations.

## Delivery and verification

This is one atomic refactor: driver and its regression tests ship together.
Use NUL-delimited Git output so spaces and quoted filenames remain exact.
Failure to read the base must exit as invocation error, not claim a pass.
Test real Git repositories with unchanged, added, renamed, staged-deleted,
unstaged-deleted and untracked paths; also test a missing base and a large
history with a constant subprocess count. Retain existing SQL regressions.
Run source checks and protected GitHub CI; report unavailable integration or
native review separately. No migration, runtime, grant or gate policy changes.

Implementation admission IRD-8E4034C86415 is allowed after the independently
stored research receipt initiative-448db009-2ab9-4a2b-af27-9c7c96424521.
The small shape owes no scope/spec baseline; no larger-item evidence is claimed.
