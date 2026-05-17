# Backlog Recovery Plan

> **For agentic workers:** This plan does NOT touch the live database until §Phase A has explicit written approval from Mark. Phases B + C proceed only after Phase A succeeds. Each step is a checkpoint. Use the dispatched-subagent pattern for Phase B reconstruction once it begins.

**Goal:** Recover the DPF backlog substrate (`Epic`, `BacklogItem`, `EpicPortfolio`, `BacklogItemActivity`) as completely as possible after a 2026-05-17 `dpf_pgdata` volume recreation wiped all user-created records. Restore the 2026-04-27 baseline, then reconstruct the 20 days of post-2026-04-27 work from durable evidence (specs, plans, migrations, merged PRs, worktrees).

**Architecture:** Three phases (A → baseline restore, B → reconstruction, C → verification) executed against a temporary recovery postgres FIRST, then promoted to the live `dpf-postgres-1` instance under explicit Mark approval. No writes to live DB before the pre-write evidence report is signed off. Reuse the governed DPF MCP backlog tools when functional; document any DB fallback explicitly per AGENTS.md §6.

**Tech Stack:** Postgres 16, Prisma 7, the existing snapshot at `D:\Backups\Backlog-20260427T035724Z.{sql,json}`, the `RESTORE.md` runbook authored 2026-04-26 at `D:\Backups\RESTORE.md`, the DPF MCP backlog tools, git history since `2026-04-27`.

---

## Pre-Implementation Evidence (binding context — do not skip)

Captured 2026-05-17T04:52Z. All counts and file references are reproducible from the commands listed in §Phase 0 below.

### Current live state

| Source | Epic | BacklogItem | BacklogItemActivity | EpicPortfolio |
|---|---|---|---|---|
| `dpf-postgres-1` (live, port 5432) | 0 | **1** (`BI-PIR-7c88a36c` auto-created by post-init probe at 04:46Z; not part of user history) | 0 | 0 |
| `dpf-dev-postgres-1` (dev, port 5433) | 0 | 0 | 0 | 0 |
| 7 orphaned anonymous postgres volumes (audited 2026-05-17T04:50Z) | all 0 | all 0 | all 0 | all 0 |

**Conclusion:** No live or orphaned volume contains any usable backlog data. The April 27 backup is the most recent surviving snapshot.

### Available backups

| File | Date | Counts |
|---|---|---|
| `D:\Backups\Backlog-20260427T035724Z.sql` | 2026-04-27 | 70 BacklogItem, 9 Epic, 1 EpicPortfolio, 0 Activity |
| `D:\Backups\Backlog-20260427T035724Z.json` | 2026-04-27 | (twin of above) |
| `D:\Backups\BacklogItem-20260418T230549Z.sql` | 2026-04-18 | Per the runbook: "69 rows, mostly `deferred` — pre-wipe snapshot; IDs do NOT match 2026-04-27 set." **Treat as historical only — do not import.** |
| `D:\Backups\full-20260427T035517Z\dpf-portal.dump` | 2026-04-27 | Whole-DB pg_dump custom format (1.9 MB) — insurance for catastrophic restore. Not used by this plan. |
| `D:\Backups\RESTORE.md` | 2026-04-26 | Authoritative runbook for the 2026-04-27 restore. This plan extends, does not replace. |

### Live-state snapshot captured before wipe (in-session evidence)

During this Claude session, **before** the wipe, I called `mcp__dpf__list_epics` (results captured in conversation memory). Numbers reflect the live state at that point in time, ~20:00Z on 2026-05-16, ~8 hours before the wipe:

| Epic ID | Title | Total | Open | In-progress | Done |
|---|---|---|---|---|---|
| EP-INT-2E7C1A | Integration Harness: Benchmarking + Private Deployment Foundation | 19 | 15 | 0 | 4 |
| EP-DOCS-6B9F2A | Current-State Documentation, README, and Public Website Refresh | 6 | 6 | 0 | 0 |
| EP-BUILD-CYCLE-0514 | Build Studio graph-assisted cycle smoke check | 10 | 8 | 2 | 0 |
| EP-LIC-C64FC2 | Licensing, Permit, and Jurisdictional Readiness | 5 | 0 | 1 | 4 |
| EP-TAK-3F9A21 | TAK/GAID Refresh: Auth, Agent Identity, Governed Memory Alignment | 11 | 4 | 0 | 1 |
| EP-ARCH-8D4F2A | Archetype Model V2 | 1 | 1 | 0 | 0 |
| EP-PORTAL-B1E969 | Portal stability: portfolio render + Prisma select drift | 1 | 1 | 0 | 0 |
| EP-CTRL-5E21A4 | Automated Control Utility: Desktop QA + Remote Assist Foundation | 10 | 10 | 0 | 0 |
| EP-SITE-7C4D2B | Customer Site Records & Location Validation | 9 | 7 | 1 | 1 |
| EP-LAB-6A91C2 | Integration Lab Sandbox & Private Connectivity Foundation | 6 | 5 | 0 | 1 |

**Pre-wipe live totals: 10 Epics / ~78 BacklogItems.** Compared to April 27 baseline (9 Epics / 70 BacklogItems), the delta is:
- 4 **new epics** post-April-27: `EP-PORTAL-B1E969`, `EP-DOCS-6B9F2A`, `EP-BUILD-CYCLE-0514`, `EP-LIC-C64FC2`.
- 1 April 27 epic absent from the live state at query time: `EP-BUILD-9F749C` (was `done` in April 27 backup — may have been archived / cleaned).
- 1 more: `EP-TAX-6C82D1` (was `done` in April 27 backup — same).
- ~8 net new items across surviving epics.

This is the **highest-confidence input** for Phase B reconstruction. Mark, this is also why the wipe is recoverable to a meaningful state — the live MCP captured the shape ~8h before the wipe.

### Schema compatibility

Verified 2026-05-17T04:52Z by restoring `Backlog-20260427T035724Z.sql` into an isolated recovery postgres (`dpf-pg-recovery` on 127.0.0.1:5499) pre-populated with the current Prisma schema dumped from `dpf-postgres-1`:

- **`BacklogItem` columns:** all 33 columns in the April 27 dump exist in the current schema with matching names. **Zero schema drift on this table.**
- **`Epic` columns:** all 18 columns match. **Zero schema drift.**
- **`EpicPortfolio` columns:** match.
- **`BacklogItemActivity`:** empty in backup; schema present.

**Restore result against the current schema** (`dpf-pg-recovery`):

| Table | Loaded | Failed | Reason for failure |
|---|---|---|---|
| Epic | 9 / 9 | 0 | — |
| BacklogItem | 55 / 70 | 15 | FK violations: `digitalProductId`, `activeBuildId`, `submittedById` point at IDs from Mark's prior install (different cuids in seed) |
| EpicPortfolio | 0 / 1 | 1 | `portfolioId` references missing Portfolio |
| BacklogItemActivity | 0 / 0 | 0 | (empty source) |

**15 BacklogItem failures + 1 EpicPortfolio failure are recoverable** by NULLing the dangling FKs at insert time — the FK columns are nullable per the current schema. The original IDs preserve as `itemId` / `id`; only the FK attribution is sacrificed. This matches RESTORE.md §"Customer 0 reinstall risk" Option 1 ("accept the dangle").

### Evidence sources for Phase B reconstruction (volume only — enumeration happens during Phase B execution)

| Source | Count since 2026-04-27 |
|---|---|
| Specs added to `docs/superpowers/specs/` | **46** |
| Plans added to `docs/superpowers/plans/` | **52** |
| Migrations added to `packages/db/prisma/migrations/` | **36** |
| GitHub PRs merged | **≥300** (gh capped at 300; possibly more) |
| Local active worktrees | 8 in `.claude/worktrees/`, 6 in `.worktrees/`, ≥1 in `D:/DPF-*/` |

These are the evidence corpora to scan for Phase B. Each spec or plan typically corresponds to 1 Epic (when durable workstream) and 1–N BacklogItems. Merged PRs are the strongest evidence for `done` status. Worktrees are the strongest evidence for `in-progress` status.

---

## Files And Responsibilities

**New files (this PR):**

- `docs/superpowers/plans/2026-05-17-backlog-recovery.md` — this plan.
- `D:\Backups\pre-recovery\empty-live-backlog-20260517T045206Z.sql` — fresh dump of current empty live DB (already created during evidence capture; **outside the repo** for backup hygiene; ~10 KB).
- `D:\Backups\pre-recovery\empty-live-full-20260517T045206Z.dump` — full pg_dump custom format of current live DB; **outside the repo** (~1.9 MB).
- `docs/superpowers/audits/2026-05-17-backlog-recovery-evidence-pre-write.md` (Phase 0 deliverable; written during execution before any DB writes).
- `docs/superpowers/audits/2026-05-17-backlog-recovery-evidence-post-write.md` (Phase C deliverable; written after restore).

**Modified files:** none. This is a data-only recovery; no application code changes.

**Tooling reused (no modifications):**

- `D:\Backups\RESTORE.md` — runbook authored 2026-04-26. Follow Phase A steps exactly.
- DPF MCP backlog tools at `/api/mcp/v1`: `list_backlog_items`, `get_backlog_item`, `create_backlog_item`, `update_backlog_item_status`, `list_epics`, `link_backlog_item_to_epic` (per AGENTS.md §6). Phase B prefers these.
- `apps/web/lib/backlog.ts` — canonical status enums (`EPIC_STATUSES`, `BACKLOG_ITEM_STATUSES`). Use exactly.

---

## Reality Check (binding context for the executor)

- **Mark does not touch the command line on this project.** All restore commands are executed by the Claude session per [feedback_never_ask_about_infra_state](../../../.claude/projects/D--DPF/memory/feedback_never_ask_about_infra_state.md). The executor confirms before destructive actions only; reads + temp-DB writes proceed.
- **The portal is running.** The current `dpf-portal-1` was built ~04:35Z and is serving the empty DB. **Stop the portal-init service from re-running during recovery** — its post-init probe creates an auto-generated `BI-PIR-*` BacklogItem that contaminates clean counts. Phase A starts with `docker compose stop portal portal-init` (non-destructive — volumes survive).
- **The recovery postgres `dpf-pg-recovery` is already running** on 127.0.0.1:5499 with the April 27 backup partially restored (55 items + 9 epics). Phase B uses it as the staging table. Tear down with `docker stop dpf-pg-recovery && docker rm dpf-pg-recovery` ONLY after Phase C verifies the live DB.
- **No feature work proceeds until backlog recovery is stable.** Voice Slice 1 (already merged through Chunk 4), manual UX checklist, and Slice 2 planning are all on hold per Mark's recovery directive.
- **The DPF MCP server may be offline during recovery.** Phase B prefers MCP tools but documents the DB-fallback path per AGENTS.md §6.

---

## Scope Check

This plan covers ONLY backlog recovery. Out of scope for this plan but tracked as immediate follow-up:

- **Root-cause analysis of the volume wipe.** Suspected: `docker-compose.yml` edit in PR #686 (added the `dpf-stt` service) caused docker compose to recreate the `dpf_pgdata` named volume during subsequent `up` cycles. The 7 orphaned postgres volumes (5 clustered 22:26–22:32Z on 2026-05-16) suggest repeated recreations over the day. Investigation + fix is a separate spec.
- **Postgres backup mechanism (Q2 yes-recommended).** Mark has standing OK to spec an automated `pg_dump` + retention policy. Owned by a separate plan, opened immediately after this recovery completes.
- **MCP backlog tool grant verification.** If the executor cannot reach the DPF MCP tools, Phase B falls back to direct DB writes — but the executor must verify MCP first and document the fallback choice.

---

## Phase 0 — Already complete (evidence capture)

These steps were executed during evidence-gathering (2026-05-17T04:30Z–05:00Z) and produced this plan's data:

- [x] **0.1 Read AGENTS.md** — done. Compliance: §6 backlog-lives-in-postgresql, §6 use-MCP-first-DB-fallback-explicit, §3 strongly-typed-enums, §11 keep Epic / BacklogItem / TaxonomyNode / DigitalProduct semantics distinct.
- [x] **0.2 Inventory `D:\Backups\`** — see "Available backups" table above.
- [x] **0.3 Fresh dump of current live DB** — `D:\Backups\pre-recovery\empty-live-{backlog,full}-20260517T045206Z.{sql,dump}`. Both confirm: 0 epics, 1 auto-generated BacklogItem.
- [x] **0.4 Audit 7 orphaned postgres volumes** — none contain user backlog data.
- [x] **0.5 Stand up isolated recovery postgres** — `dpf-pg-recovery` on 127.0.0.1:5499 with current Prisma schema loaded.
- [x] **0.6 Trial-restore April 27 SQL into recovery DB** — 9/9 Epic + 55/70 BacklogItem + 0/1 EpicPortfolio. 15 failures classified by FK type.
- [x] **0.7 Schema-drift compare** — zero drift on `Epic`, `BacklogItem`. Both tables import cleanly modulo FK dangle.

---

## Phase A — Restore April 27 baseline into live DB (requires Mark approval before execution)

**Goal:** Live `dpf-postgres-1` ends Phase A with 9 Epics + 70 BacklogItems + 1 EpicPortfolio, with dangling FKs nulled and provenance noted. Identical to the April 27 snapshot in semantic content; identical IDs preserved.

### Task A1 — Quiesce all backlog-writing processes

The `apps/web/lib/operate/process-observer-hook.ts` and hive-scout ingest paths both write to `BacklogItem`. Today only `portal` + `portal-init` are running, but future hive-scout / build-orchestrator containers would silently overwrite the in-progress restore.

- [ ] **A1.1** Sweep for any additional backlog-writing containers:
  ```bash
  docker ps --format '{{.Names}}' | grep -iE 'hive|build.orchestr|scout|coworker'
  ```
  Stop any that appear with `docker compose stop <service>`. **Today's expected output: empty.**
- [ ] **A1.2** `docker compose stop portal portal-init` — stops the live portal cleanly. Volumes survive. **Non-destructive.**
- [ ] **A1.3** Verify postgres still healthy: `docker compose ps postgres`.
- [ ] **A1.4** Capture a second fresh dump (timestamped) of `dpf-postgres-1` after the portal stops, in case any post-init writes happened between Phase 0 capture and now:
  ```bash
  docker exec dpf-postgres-1 pg_dump -U dpf -d dpf -Fc > "D:/Backups/pre-recovery/empty-live-full-quiesced-$(date -u +%Y%m%dT%H%M%SZ).dump"
  ```

### Task A2 — Truncate the contaminating auto-row

- [ ] **A2.1** Confirm current `BacklogItem` is only the auto-generated `BI-PIR-7c88a36c`:
  ```bash
  docker exec dpf-postgres-1 psql -U dpf -d dpf -c \
    'SELECT "itemId", title FROM "BacklogItem";'
  ```
  Expected: 1 row, `BI-PIR-*`, title "Investigate intermittent failure during model warmup ping". **If any other rows exist, halt and update this plan.**
- [ ] **A2.2** Truncate per RESTORE.md §Step 1:
  ```bash
  docker exec dpf-postgres-1 psql -U dpf -d dpf -c \
    'TRUNCATE "BacklogItemActivity", "EpicPortfolio", "BacklogItem", "Epic" RESTART IDENTITY CASCADE;'
  ```
  Note: the auto-generated `BI-PIR-*` is intentionally discarded — the post-init probe will re-create an equivalent on the next portal-init run if the underlying condition persists; it is not user-authored history.

### Task A3 — Restore April 27 baseline with FK nulling

- [ ] **A3.0** Confirm the exact nullable-FK column set on the live `BacklogItem` table before generating the patch. The plan lists the columns from session memory; production-truth is the live schema:
  ```bash
  docker exec dpf-postgres-1 psql -U dpf -d dpf -c '\d "BacklogItem"' | grep -E 'Foreign-key|fkey'
  ```
  Cross-check against the per-row FK targets in the April 27 JSON. **Update the column list in A3.1 if the schema reveals additional nullable FKs beyond the eight currently named.**
- [ ] **A3.1** Generate a patched restore SQL that NULLs the failing FK columns for the 15 affected items + 1 EpicPortfolio row. Script generates from `Backlog-20260427T035724Z.json` so we don't hand-edit. Output: `D:/Backups/pre-recovery/april27-patched.sql`. Logic:
  - For each `BacklogItem` row whose `digitalProductId`, `taxonomyNodeId`, `submittedById`, `agentId`, `activeBuildId`, `claimedById`, `claimedByAgentId`, `accountableEmployeeId`, or `duplicateOfId` references a non-existent target in the live DB (cross-checked at script time using a JOIN against the relevant target table), substitute NULL.
  - Append a `[recovery-note:fk-nulled:{column}={old-value}]` token to `BacklogItem.body` for audit traceability.
  - For the 1 `EpicPortfolio` row, NULL `portfolioId` if it references a missing Portfolio (else keep).
- [ ] **A3.2** Load the patched SQL:
  ```bash
  cat D:/Backups/pre-recovery/april27-patched.sql | docker exec -i dpf-postgres-1 psql -U dpf -d dpf
  ```
- [ ] **A3.3** Verify counts (matches RESTORE.md §Step 3):
  ```bash
  docker exec dpf-postgres-1 psql -U dpf -d dpf -t -c \
    'SELECT '\''BacklogItem'\'', count(*) FROM "BacklogItem" UNION ALL SELECT '\''Epic'\'', count(*) FROM "Epic" UNION ALL SELECT '\''EpicPortfolio'\'', count(*) FROM "EpicPortfolio";'
  ```
  Expected: `BacklogItem=70 Epic=9 EpicPortfolio=1`. **Any mismatch halts Phase A.**

### Task A4 — Restart the portal + verify backlog UI

- [ ] **A4.1** `docker compose start portal portal-init`.
- [ ] **A4.2** Wait for `dpf-portal-1` healthy.
- [ ] **A4.3** Open the portal backlog view (browser, manual): confirm 70 items + 9 epics render. Confirm a sample item's body shows the `[recovery-note:fk-nulled:...]` token if it was one of the 15.
- [ ] **A4.4** Confirm via MCP: `mcp__dpf__list_epics` returns 9 epics; spot-check `mcp__dpf__get_backlog_item` on one restored item.

---

## Phase B — Reconstruct post-April-27 work from evidence

**Goal:** Add the missing 4 epics + ~8 net new items (+ any items added against surviving epics) by mining 46 specs / 52 plans / 36 migrations / 300+ PRs / multiple worktrees for evidence. Output ends with live state matching the pre-wipe MCP snapshot (10 epics, ~78 items) plus any net work that's accumulated since that pre-wipe snapshot and the wipe (~8 hours of activity).

Phase B writes one item at a time via the DPF MCP (`create_backlog_item`, `link_backlog_item_to_epic`, `update_backlog_item_status`). Each write is logged in the evidence report. **If the MCP is unreachable, the executor halts and surfaces to Mark — direct DB writes only on Mark's explicit say-so.**

### Task B1 — Re-create the 4 missing epics

Evidence: my pre-wipe MCP capture above lists the 4 missing epic IDs and titles. The descriptions can be reconstructed from the specs that name them (see B2).

**MCP tool gap — known at plan-authoring time.** The DPF MCP exposes `create_backlog_item`, `create_build_epic`, `list_epics`, `link_backlog_item_to_epic`, etc., but **does not appear to expose a generic `create_epic` tool** (`create_build_epic` is for FeatureBuild epics, the wrong semantic for these workstream epics). Two options for B1; pick at B1.0 before any writes:

- **Option B1-MCP:** Verify by calling `mcp__dpf__list_epics` + searching `apps/web/lib/mcp-tools.ts` for an epic-creation tool I missed. If one exists, use it.
- **Option B1-DB:** Direct DB INSERT into `Epic` via `docker exec dpf-postgres-1 psql ...`. This is the documented AGENTS.md §6 fallback. Each INSERT is logged in the post-write evidence report. Use this option **only** if Option B1-MCP returns no usable tool.

- [ ] **B1.0** Resolve the tool gap. `grep -n "create.*[Ee]pic\|Epic.*create" apps/web/lib/mcp-tools.ts apps/web/lib/agent-grants.ts` and `mcp__dpf__list_epics --limit 1` to confirm MCP availability. Record which path B1 will use.
- [ ] **B1.1** For each of `EP-PORTAL-B1E969`, `EP-DOCS-6B9F2A`, `EP-BUILD-CYCLE-0514`, `EP-LIC-C64FC2`:
  - Search `docs/superpowers/specs/` and `docs/superpowers/plans/` for the most recent spec/plan that references this epicId in frontmatter or body.
  - Read the spec; extract the `description` + `status` from frontmatter or context.
  - Create the epic via the path chosen in B1.0. Use the preserved `epicId` exactly as listed (preserves the FK target on any restored `BacklogItem.epicId`).
  - Add a `[recovery-note:provenance:<spec-path>:<commit-sha>]` token to the epic description for audit.
- [ ] **B1.2** Cross-check that no BacklogItem from the April 27 restore references these epic IDs (it shouldn't — they didn't exist yet on April 27). If any does, that's evidence the spec/plan introduced the epic ID in advance and a BacklogItem was filed against it — link as appropriate.

### Task B2 — Enumerate proposed reconstructed items

The output of this task is a written **proposed-items report**, NOT a series of DB writes. Mark reviews the proposal before any items land.

- [ ] **B2.1** Scan all 46 specs (`ls docs/superpowers/specs/2026-04-27..2026-05-16-*.md`). For each spec, extract:
  - Spec date, title, status (frontmatter), and (when present) parent epic ID.
  - The work the spec describes (its goal section).
  - Whether a plan was written for it (search `docs/superpowers/plans/` for the same date prefix).
  - Whether implementation work landed (git log against `apps/`, `packages/`).
- [ ] **B2.2** Scan all 52 plans similarly.
- [ ] **B2.3** Scan all 36 migrations — each migration ≈ implementation work that almost certainly had a backlog item.
- [ ] **B2.4** Scan merged PRs since 2026-04-27 via `gh pr list --state merged --limit 500 --search "mergedAt:>2026-04-27"`. For each merged PR title that maps to a known work area (voice, edge-node, wiki, principles, hive-scout, etc.):
  - PR == 1 backlog item with status `done` (PR evidence is strong).
  - Provenance token: `[recovery-note:provenance:pr-<number>:<merged-sha>]`.
- [ ] **B2.5** Scan local worktrees:
  - `.claude/worktrees/*`, `.worktrees/*`, `D:/DPF-*/` — each non-stale worktree indicates `in-progress` work.
  - Provenance: `[recovery-note:provenance:worktree-<name>:<branch>]`.
- [ ] **B2.6** Deduplicate proposed items against the 70 restored April 27 items by:
  - `itemId` match (skip — already restored).
  - **Auto-skip ONLY when both** title similarity (normalized Levenshtein < 0.3 on lowercased title) **AND** the same `parentEpicId`. Title-only matches across different epics are NOT auto-skipped — two epics can legitimately have items with similar titles (e.g., "add manual UX checklist" appearing under multiple slices).
  - Title similarity within the same epic but with materially different status / body / provenance: flag for Mark, do not auto-skip.
  - Same parent epic + similar work area + status overlap: flag for Mark.
- [ ] **B2.7** Write the proposed-items report at `docs/superpowers/audits/2026-05-17-backlog-recovery-evidence-pre-write.md` containing:
  - Final epic list (existing 9 from Apr 27 + 4 new).
  - Proposed new BacklogItem list (estimate ~50–100 items depending on dedup outcome).
  - For each item: title, status, parent epic, provenance, evidence-confidence (`high` if PR-merged / `medium` if spec+plan exist / `low` if spec-only).
  - Flagged items requiring Mark's judgment (e.g., similar titles in restored set).

### Task B3 — Submit proposal to Mark

- [ ] **B3.1** PR-comment Mark with the proposed-items report link. **Halt until Mark approves the proposal or returns edits.**
- [ ] **B3.2** On approval: proceed to B4. On edits: revise B2.7 + resubmit.

### Task B4 — Create approved items via MCP

- [ ] **B4.1** For each approved proposed item, call `mcp__dpf__create_backlog_item`. Append the `[recovery-note:provenance:*]` token to the body verbatim.
- [ ] **B4.2** For each item with strong PR-merged evidence, call `mcp__dpf__update_backlog_item_status` with `done` (or `deferred` per Mark's annotations). Items without strong evidence default to `open` with `[recovery-note:status-default-open]`.
- [ ] **B4.3** Link items to epics: `mcp__dpf__link_backlog_item_to_epic` per the proposal.
- [ ] **B4.4** Track each MCP response (success/failure) in the post-write evidence report (Phase C).

---

## Phase C — Verification + post-write report

**Goal:** Confirm the recovery is stable and produce the audit report.

### Task C1 — Counts + content verification

- [ ] **C1.1** `mcp__dpf__list_epics` returns the expected 13 epics (9 from Apr 27 + 4 reconstructed). Two of the Apr 27 epics (`EP-BUILD-9F749C`, `EP-TAX-6C82D1`) were `done` and may or may not have surfaced in the live MCP at pre-wipe time — flag this in the report.
- [ ] **C1.2** `mcp__dpf__query_backlog --limit 200` returns the expected item count (70 restored + N reconstructed; expected ~100–170 depending on Phase B2 outcome).
- [ ] **C1.3** Spot-check 10 random items via `mcp__dpf__get_backlog_item`: title matches, status matches, epic link works, provenance token present where expected.

### Task C2 — UI + API smoke test

- [ ] **C2.1** Browser: open the portal backlog view. Confirm items render with expected counts.
- [ ] **C2.2** Browser: filter by status `open`, `in-progress`, `done`, `deferred`. Each filter returns items.
- [ ] **C2.3** Browser: open one item, edit body, save. Confirm write path works.

### Task C3 — Post-write evidence report

- [ ] **C3.1** Write `docs/superpowers/audits/2026-05-17-backlog-recovery-evidence-post-write.md` covering:
  - Final live state counts.
  - Samples of restored + reconstructed records.
  - Duplicate-check audit (Phase B2.6 outputs).
  - MCP + portal UI verification status.
  - List of items requiring follow-up (e.g., re-link DigitalProduct / Portfolio IDs once those records are re-created).

### Task C4 — Tear down recovery infrastructure

- [ ] **C4.1** Stop + remove the temp `dpf-pg-recovery` container: `docker stop dpf-pg-recovery && docker rm dpf-pg-recovery`. **Only after C1 + C2 pass.**
- [ ] **C4.2** Move the in-process `april27-patched.sql` to `D:\Backups\` for permanent retention.
- [ ] **C4.3** Update `D:\Backups\RESTORE.md` with a "2026-05-17 recovery event" annotation referencing this plan.

---

## Build Gate (this plan introduces no application code; gate is per-deliverable)

- **No `next build` / `vitest` gate applies** — this plan is a data-recovery sequence. No code changes.
- **The plan-document is reviewed by the `plan-document-reviewer` subagent** (next step after I commit this plan).
- **Each Phase A/B/C task ends in a verification step** — see the embedded check lines.

---

## Decisions made (formerly open questions)

These were resolved during plan review on 2026-05-17:

1. **The 2 `done` epics from April 27** (`EP-BUILD-9F749C`, `EP-TAX-6C82D1`) were NOT in the pre-wipe MCP snapshot. **Decision: restore them as `done` per the backup.** Most likely `list_epics` filters `done` epics from default views — they still exist in DB. Phase C C1.1 confirms they survive the restore.
2. **Provenance token format:** Locked in as `[recovery-note:fk-nulled:<column>=<value>]` (Phase A) and `[recovery-note:provenance:<source>:<sha>]` (Phase B). Mark approved this format in the recovery directive.
3. **8-hour gap evidence:** Items created between the pre-wipe MCP snapshot (~20:00Z 2026-05-16) and the wipe (04:35Z 2026-05-17) include Voice Slice 1 chunk PRs (#686, #692, #696, #700) and the work-capsules / hive-scout PRs that landed in that window. All are reconstructable from merged-PR evidence. Phase B catches them via `gh pr list --search "mergedAt:>2026-05-16T20:00"`.
4. **MCP availability is a halt condition, not an open question.** §Phase B intro paragraph already specifies: prefer MCP, halt and surface to Mark if unavailable, direct DB writes only on Mark's explicit say-so. B1.0 verifies tool availability before any writes.

---

## Recommended Execution Path

1. **Mark reviews this plan.** Approve / edit / counter-propose.
2. **Plan-document-reviewer subagent reviews** the plan. Iterate to approval.
3. **Execute Phase A** (small — restore + verify; ~10 min). Mark approves Phase A before any live DB write.
4. **Execute Phase B2** (largest task — proposed-items report). Output is `2026-05-17-backlog-recovery-evidence-pre-write.md`. Mark approves the proposal.
5. **Execute Phase B4** (create items via MCP). Phase C runs immediately after.
6. **Execute Phase C** (verification + post-write report).
7. **Close the recovery branch with PR to main.** Land this plan + both evidence audit docs.
8. **Open the follow-up backup-mechanism spec** (Mark's Q2 yes — separate PR).

## What This Plan Does NOT Cover

- Restoration of any data **outside the four backlog tables** (Epic, BacklogItem, EpicPortfolio, BacklogItemActivity). User accounts, OAuth tokens, FeatureBuild rows, DigitalProduct rows, Organization-derived state, AgentThread history, ToolExecution audit trail — these are not in any backup and are not part of this recovery. The portal-init seed rebuilds the skeleton automatically; user-specific state must be re-derived by usage.
- Resumption of feature work. Voice Slice 1 Chunk 4 PR (#700) is merged but the manual UX checklist (`docs/superpowers/audits/2026-05-16-voice-slice-1-manual-verification.md`) remains pending. **This plan blocks that checklist** until recovery is stable.
- Root cause analysis of the volume wipe. See §Scope Check.
- The postgres backup mechanism spec (Mark's Q2 yes). See §Scope Check.
