# Backlog recovery bundles

Version-controlled snapshots of unfinished backlog work, so a reset or teardown
that replaces the coordination database does not destroy identified work.

Git is the durable store. The installation database is not.

## The invariant

**Every epic with at least one not-done item must have a current bundle in this
directory, and that bundle must be merged to `main`.**

Two things follow from it, and both have already cost this project work:

1. **A bundle on an unmerged branch is not a backup.** The branch lives in a
   worktree that teardown deletes. Only `main` survives.
2. **A stale bundle is more dangerous than no bundle.** Bundles are snapshots,
   not live views. An epic that gained five items since its last capture still
   *looks* protected — the file is right there — while exactly those five items
   are the ones that vanish. Absence of a bundle is a visible gap; staleness is
   an invisible one. Re-capture before teardown, never assume.

Items with **no epic** cannot be bundled at all: the bundle format is
epic-scoped and `epicId` is required on every item. Link them to an epic first
(`link_backlog_item_to_epic`), or accept that they are preserved only as the
non-reconcilable record described below.

## Files

| File | What it is |
| --- | --- |
| `<slug>.json` | One reconcilable bundle per epic. Restorable. |
| `unassigned-items.json` | Not-done items with no epic. Preserved verbatim, **not** restorable. |
| `manifest.json` | Capture counts, so coverage is checked against evidence rather than assumption. |

`manifest.json` must satisfy `capturedItemCount + unassignedItemCount ==
unfinishedItemCount`. When that arithmetic does not close, an item is
unaccounted for and teardown is not safe. Check it, do not assume it: the
backlog moves in minutes, and every count in these files is a snapshot.

## Capture

```bash
pnpm --filter @dpf/db backlog:capture -- --out packages/db/recovery/backlog
```

Captures every item that is not `done` — `triaging`, `open`, `in-progress`,
`deferred`, and `retired`. Deferred and retired work is included because a reset
destroys the row either way, and "we decided to stop" is a judgement someone may
revisit. Pass `--all` to include `done` items too (you almost never want this).

Re-capture **overwrites an epic's existing bundle in place**, keeping its
filename, `bundleId`, `description`, and `planPath`. It does not write a second
file under a generated name, which would leave the curated one stale on disk
while still looking authoritative. A genuinely new epic gets a generated
`ep-<id>.json` name; rename it to something meaningful and the next capture will
keep that name.

Do not hand-write a bundle. `buildBacklogRecoveryBundle` round-trips its output
through `parseBacklogRecoveryBundle`, so a bundle that builds is guaranteed to
reconcile; hand-written JSON fails on details the validator cares about and the
eye does not (`null` where a key must be *absent*, timestamps without `Z`).

Capture only what is not done. Completed work is recorded in git as merged PRs,
and re-importing it resurrects closed records.

## Restore

```bash
pnpm --filter @dpf/db backlog:reconcile -- packages/db/recovery/backlog/<slug>.json
pnpm --filter @dpf/db backlog:reconcile -- packages/db/recovery/backlog/<slug>.json --apply
```

Dry-run first. Apply runs in one transaction, creates missing records, and skips
existing epics and items wholesale, so it cannot regress newer status or
evidence. Never import bundles from `packages/db/src/seed.ts` — customer installs
do not inherit DPF's internal roadmap.

## What is deliberately not bundled

`unassigned-items.json` holds not-done items that have no epic. Their bodies are
preserved in version control, but they are **not** reconcilable — restoring them
requires re-filing under an epic by hand.

Two classes currently sit there by decision, not by oversight:

- **`BI-MCP-EFF-*` (automated MCP efficiency observations).** These are derived
  from tool-call telemetry by the "MCP call efficiency — AI Ops review" agent
  task. Their finding identity is deterministic (`high_volume:<tool>`), but each
  filing mints a *random* item id and is bound to an `ImprovementSignal` row that
  the bundle format does not carry. Reconciling them would therefore create
  signal-orphaned duplicates alongside whatever the next review files. Re-running
  the review regenerates the findings from telemetry. Note the scheduled task is
  currently **inactive** and was one-shot, so regeneration is a deliberate act,
  not something that simply happens.
- **Raw `source: self-upgrade-failure` traces.** Machine-captured failure traces
  whose evidence (`SelfUpgradeRun` rows, stderr tails) is install-local and does
  not survive a reset anyway. `self-upgrade-failure` is also outside the bundle
  `SOURCES` vocabulary, so these cannot be represented without rewriting the
  field. Where a trace has been analysed into a human-authored finding, that
  finding is bundled and carries the durable knowledge.

- **Other derived observations: `BI-CAP-*` (capability need), `BI-PIR-*`
  (post-incident report), `BI-SIG-*` (signal), `BI-OBS-*` (observation).** All
  are minted by engines from a live signal — a coworker's tool-surface pressure,
  a route crash, an issue-report spike — with generated ids and a source row the
  bundle format does not carry. They are the same shape as the `BI-MCP-EFF-*`
  items above and regenerate the same way once the signal recurs.

- **`source: build-failure` traces.** Same as the self-upgrade traces above:
  outside the bundle `SOURCES` vocabulary, and the evidence they point at is
  install-local.

A note on scale: these classes grow fast. They went from 6 items to 48 in three
days of dogfooding, while the substantive backlog grew from 43 to 156. Do not
let the volume of derived noise become an argument for skipping the capture —
they are separated from reconcilable work precisely so it stays legible.

Anything else with no epic should be linked to one and captured, not left here.
