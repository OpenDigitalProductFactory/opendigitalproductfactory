---
title: Never wipe the DB to fix code
slug: never-wipe-db-for-code-fixes
pageKind: principle
status: published
abstract: A code bug is fixed with a code change. Wiping the DB volume to "reset" destroys operator-created state — credentials, backlog, brand context, the governance ledger.
principleTier: commandment
principleDirection: Fix code bugs with code changes; never use docker compose down -v or prisma migrate reset as a debugging shortcut because volumes hold real operator state.
principleDimensionVector: {"blast_radius": -1.0, "data_privacy": 0.7, "governance_compliance": 0.7, "evidence_density": 0.5, "reversibility": 0.6, "business_disruption": -0.75}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - universal-ring
principleConsumerArchetype: ai-coworker-universal
principlePublic: false
authoredAt: 2026-05-18
authoredBy: mark-bodman
principleRuntimeEnforcement: {"interactiveMode":"confirm","autonomousMode":"refuse","patterns":[{"kind":"shell","regex":"^docker\\s+compose\\b.*\\bdown\\b.*\\s(-v|--volumes?)(\\s|$)","rationale":"docker compose down with any volume flag drops named volumes including dpf_pgdata"},{"kind":"shell","regex":"^docker\\s+volume\\s+(rm|prune)\\b","rationale":"Removes Docker volumes including operator state"},{"kind":"shell","regex":"^docker\\s+system\\s+prune\\b.*\\s--volumes?(\\s|$)","rationale":"docker system prune --volumes removes unused volumes including dpf_pgdata"},{"kind":"shell","regex":"^prisma\\s+migrate\\s+reset\\b","rationale":"Drops + recreates schema; wipes all rows"},{"kind":"shell","regex":"^pnpm\\s+(--filter\\s+\\S+\\s+)?(exec\\s+)?prisma\\s+migrate\\s+reset\\b","rationale":"pnpm-wrapped prisma migrate reset"},{"kind":"sql","regex":"(?i)^\\s*DROP\\s+DATABASE\\s+dpf\\b","rationale":"Drops the operator's production database"}]}
---

# Never wipe the DB to fix code

**A code bug is fixed with a code change, not by deleting the DB and
reseeding.** Volumes hold operator-created state: backlog items,
provider credentials, brand context, governance ledger, employee
records. Wiping the volume to "reset" state destroys real work.

This is the data-tier specific case of
[`destructive-actions-require-explicit-go`](destructive-actions-require-explicit-go.md).
Where that principle governs all destructive actions, this one
specifically forbids the most common destructive shortcut: `docker
compose down -v` or `prisma migrate reset` as a debugging step.

## What to do instead

When a bug surfaces in the DB layer:

1. **Read the offending row directly** to confirm the bug is in the
   data, not in the query
2. **If the data is wrong, fix THAT ROW** with a targeted UPDATE, not
   a table-wide reset
3. **If the schema is wrong, write a migration** that corrects it
   without dropping the table
4. **If the seed produced the wrong defaults**, fix the seed AND write
   a one-shot data migration for installs that already have the bad
   default
5. **Rebuild images, not volumes.** `docker compose build portal`
   does not touch volumes. `docker compose up -d portal` only recreates
   the container, not the data.

## What "wipe the DB" looks like (and why it's wrong)

- `docker compose down -v` — drops named volumes including `dpf_pgdata`
- `docker volume rm dpf_pgdata` — same outcome, more direct
- `prisma migrate reset` — drops + recreates the schema, wipes all
  rows
- `DROP DATABASE dpf; CREATE DATABASE dpf;` — same thing via SQL
- Manually deleting `~/Library/Application Support/Docker/...` /
  `\\wsl$\docker-desktop-data\...` filesystem paths

Every one of these has produced real operator data loss in DPF's
history. The first time it happened, the recovery took 6+ hours of
reconstructing 43 epics and 280 backlog items from PRs, specs, and
chat transcripts.

## Acceptable exceptions (none common)

- **Sandbox `dpf-sandbox-postgres-1`** — by design ephemeral, not used
  for operator state. Wiping it is fine.
- **Genuinely fresh-install testing** in a throwaway directory the
  operator deliberately set up as a test environment. The path must
  be clearly out-of-band — not the operator's primary DPF clone.

## Penalty

This is a **commandment-tier** principle. The recovery cost of a
single wipe of `dpf_pgdata` exceeded the entire savings of every
"just gonna reseed real quick" shortcut combined. There is no
acceptable shortcut.

## Related principles

- [`destructive-actions-require-explicit-go`](destructive-actions-require-explicit-go.md) —
  destructive actions need a fresh OK
- [`fix-the-seed-not-the-runtime`](../../../professions/data-architect/wiki/fix-the-seed-not-the-runtime.md) —
  fix the seed + add an invariant, do not patch the runtime
- [`live-state-over-seed-data`](../../../professions/data-architect/wiki/live-state-over-seed-data.md) — the
  reason the live DB is the source of truth
