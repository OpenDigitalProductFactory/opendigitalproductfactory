---
title: Build Studio dispatch history — show classified root cause, backfill old rows
date: 2026-05-24
status: proposal — awaiting operator review
owner: Mark Bodman (CEO) — proposed by agent
backlog-item: BI-594B76AB
epic: EP-BUILD-STUDIO
supersedes: (none — additive to the 2026-05-19 command-spine slice)
relates-to:
  - docs/superpowers/specs/2026-05-19-build-studio-single-status-command-spine-design.md (the matcher hardening this spec follows up on)
  - docs/superpowers/plans/2026-05-19-build-studio-single-status-command-spine.md
  - apps/web/lib/build/dispatch-attempts.ts (extractRootCauseSummary, isCliPrologueLine)
  - apps/web/components/build/BuildDispatchHistoryCard.tsx
  - packages/db/prisma/schema.prisma (BuildDispatchAttempt model)
---

# Build Studio dispatch history — show classified root cause, backfill old rows

## 1. Problem (from BI-594B76AB)

Live verification on 2026-05-20 against `/build?buildId=FB-71FB3A53` showed dispatch attempts correctly classified as `usage-limit`, but:

- Historical `BuildDispatchAttempt.rootCauseSummary` values still contained Codex CLI prologue text (e.g. `"Reading prompt from stdin..."`) rather than the actual diagnostic line.
- The dispatch history UI displays `stdoutExcerpt` directly — so even when the matcher writes a clean `rootCauseSummary` today, the operator still sees the prologue-laden raw output first.

The 2026-05-19 command-spine slice hardened `extractRootCauseSummary` for future attempts (added `isCliPrologueLine` filtering, `lineMatchesFailureAxis` lookup). Two gaps remain:

1. **Persisted rows are stale.** Pre-hardening rows still carry prologue text in `rootCauseSummary`.
2. **The UI never reads `rootCauseSummary`.** `BuildDispatchHistoryCard.tsx` renders `stdoutExcerpt ?? stderrExcerpt` in a `<pre>` block; the classified field is never surfaced.

Both gaps are small. They are complementary, not alternatives.

## 2. Repo truth check (verified 2026-05-24 in this worktree)

- `BuildDispatchAttempt.rootCauseSummary` is `String? @db.Text` in `packages/db/prisma/schema.prisma`. The matcher slices output at 200 chars in `extractRootCauseSummary` (line 204/207); `stdoutExcerpt` / `stderrExcerpt` are independently sliced at 500 chars in the `excerpt()` helper (line 252). These two truncation lengths are intentional and distinct — they appear in adjacent sections of this spec without conflation.
- `extractRootCauseSummary` (apps/web/lib/build/dispatch-attempts.ts:196-208) is **pure** — depends only on stdout, stderr, and the already-classified `failureAxis`. Re-running it over existing rows is deterministic. **It is currently module-private** (declared as `function`, not `export function`); ditto `isCliPrologueLine` (line 242). Phase-1 implementation must add `export` to both — they become public API the moment the backfill script and `recomputeRootCauseSummary` consume them. This is a small symbol-visibility change, not a logic change.
- `BuildDispatchHistoryCard` (apps/web/components/build/BuildDispatchHistoryCard.tsx:31-34) currently renders `stdoutExcerpt ?? stderrExcerpt` raw. `rootCauseSummary` and `failureAxis` are both available on the row but unused in the card; `failureAxis` is shown as a tiny label on the header row.
- `getDispatchHistoryForBuild` (dispatch-attempts.ts:180-194) projects all fields including `rootCauseSummary` and `rootCauseHash`. No projection change needed.
- Existing tests live in `apps/web/lib/build/dispatch-attempts.test.ts`, `apps/web/components/build/BuildDispatchHistoryCard.test.tsx` (Phase-1 regression file already in place from PR #1083 sibling change is unrelated). New tests slot beside these.

No part of this work touches schema, MCP contracts, RuntimeTarget kinds, or sandbox isolation — it is render-layer + idempotent data normalization only.

## 3. Designs evaluated

### Design A — UI-only display fallback

Render `rootCauseSummary` as the primary user-facing line; keep `stdoutExcerpt`/`stderrExcerpt` as a collapsible "raw output" section. Leave persisted rows untouched.

- **Pro:** Smallest diff. No data migration. Reversible.
- **Pro:** Even pre-hardening rows benefit somewhat — the classified `failureAxis` chip is already shown; the `rootCauseSummary` text will still be wrong on old rows, but the prologue text gets demoted to a "raw" section the operator opens deliberately.
- **Con:** Pre-hardening rows still display prologue text as their `rootCauseSummary`. The fix lands halfway.
- **Verdict:** Necessary but not sufficient.

### Design B — Backfill-only

One-time migration: re-run `extractRootCauseSummary` over existing rows using their stored `stdoutExcerpt` and `stderrExcerpt` plus the already-classified `failureAxis`. Don't touch the UI.

- **Pro:** Cleans up persisted state once.
- **Con:** The UI still shows `stdoutExcerpt` raw, so today's behavior is unchanged for operators reading the card. Backfilled `rootCauseSummary` sits unused.
- **Con:** The matcher needs the *full* stdout/stderr, not the 500-char excerpt that was persisted. Backfilling against the excerpt may produce a different result than running against the original output. (This is acceptable for `lineMatchesFailureAxis` lookup since per-line matching works on excerpts, but worth naming.)
- **Verdict:** Necessary but not sufficient.

### Design C — UI display fallback + backfill (RECOMMENDED)

Both at once. UI rendering changes so the classified summary leads; backfill normalizes persisted rows so old attempts also benefit.

- **Pro:** Closes both gaps in one slice.
- **Pro:** The backfill is idempotent — re-running it produces the same result; future schema migrations cannot accidentally regress prior fixes.
- **Pro:** Test coverage is straightforward: unit test the new render branch, unit test the backfill function, snapshot-test the card with a row that has prologue-y stdout but a clean classified summary.
- **Con:** Two areas of change in one PR. Mitigated by keeping each change atomic in its own commit.
- **Verdict:** Recommended.

## 4. Specification (Design C)

### 4.1 UI render change

Modify `apps/web/components/build/BuildDispatchHistoryCard.tsx` so each attempt row shows, in order:

1. **Header line (unchanged):** task title, `exit {n} · {failureAxis}` chip.
2. **Root-cause line (NEW):** `rootCauseSummary` rendered as a single-line, lightly emphasized string. When `rootCauseSummary` is `null` (success or matcher returned nothing useful), fall back to the `failureAxis` value itself (`"timeout"`, `"usage-limit"`, etc.). Show a short tooltip on hover indicating this is the classified diagnosis.
3. **Model line (unchanged):** model identifier, if any.
4. **Raw output (DEMOTED):** the existing `<pre>` block with `stdoutExcerpt ?? stderrExcerpt` is hidden behind a `<details><summary>Raw output</summary>…</details>` so it stays available for audit but doesn't lead. The `<summary>` reads `"Raw stdout/stderr"` with a chevron.

The card is a `"use client"` component but uses `<details>` (native HTML — no React state needed). No new dependencies.

### 4.2 Backfill — pure function + one-time runner

Add a new exported pure function `recomputeRootCauseSummary(row)` to `apps/web/lib/build/dispatch-attempts.ts`. It accepts a row with `stdoutExcerpt`, `stderrExcerpt`, and `failureAxis`, and returns the value `extractRootCauseSummary` would produce today.

Note the **excerpt-vs-full-output asymmetry**: when the row was originally written, the matcher saw full stdout/stderr; the persisted excerpts are 500-char truncations. The backfill therefore operates on the 500-char view, which may produce a slightly different result than the original full-output run. This is acceptable because (a) the new result is at least as good as the old prologue text, and (b) the recomputed value matches what an operator would see when reading the stored excerpt — making the UI and the persisted field consistent.

Add a one-time runner script `apps/web/scripts/backfill-dispatch-root-cause-2026-05.ts` that:

1. Reads all `BuildDispatchAttempt` rows where `rootCauseSummary` is non-null AND matches the prologue-detection pattern (`isCliPrologueLine` returns true on the trimmed value — this requires `isCliPrologueLine` to be exported from `dispatch-attempts.ts` per §2 above).
2. Recomputes `rootCauseSummary` via `recomputeRootCauseSummary`.
3. If the recomputed value differs, updates `rootCauseSummary` and `rootCauseHash` in place.
4. Logs `{ updated, skipped, errored }` counts and exits.

The script is **operator-runnable**, not a Prisma migration — Prisma migrations are reserved for schema changes (cf. `feedback_db_seed_migration_sync`). The script is idempotent: running it twice produces the same result as running it once because the second run finds no remaining prologue-matched rows.

The script lands as a documented one-shot under `apps/web/scripts/` alongside existing utility scripts. It is NOT wired into the boot path (per `feedback_no_mass_bash` — no auto-run heavy commands at startup). The operator runs it via `pnpm --filter web exec tsx scripts/backfill-dispatch-root-cause-2026-05.ts` after this PR ships.

### 4.3 Tests

- `apps/web/lib/build/dispatch-attempts.test.ts` — add unit tests for `recomputeRootCauseSummary`:
  - Prologue-only stdout + classified `usage-limit` axis → returns the axis-matched line if present, else returns the axis name as fallback.
  - Already-clean stdout + axis match → returns the matching line (no regression on already-clean data).
  - Empty/null excerpts → returns the axis name.
- `apps/web/components/build/BuildDispatchHistoryCard.test.tsx` — extend the existing test file:
  - Renders `rootCauseSummary` as the visible diagnosis line when present.
  - Falls back to `failureAxis` text when `rootCauseSummary` is null.
  - Raw output is inside a `<details>` and is NOT in the default-rendered text path (assert by querying for `<details>` element + checking that `stdoutExcerpt` content is inside its DOM subtree).

### 4.4 What stays unchanged

- `BuildDispatchAttempt` schema — no column changes, no new columns. `rootCauseHash` continues to be the post-normalization SHA hash; the backfill updates it alongside `rootCauseSummary` to keep the pair consistent.
- `extractRootCauseSummary` itself — already correct. `recomputeRootCauseSummary` is a thin wrapper that constructs the args from a row shape.
- `classifyDispatchFailureAxis` — already correct.
- Any MCP tool or external contract — none reference `rootCauseSummary` shape; this is internal.

## 5. Non-goals

- Streaming dispatch updates from in-flight builds (separate effort; live progress is the command-spine slice's other half).
- Re-classifying `failureAxis` for old rows. The axis was correctly classified by `classifyDispatchFailureAxis` at write time; only the *summary line* was sometimes wrong.
- Schema migrations. No new columns, no renames.
- Touching the `stdoutExcerpt` / `stderrExcerpt` storage (still 500-char truncation, still in the same column).

## 6. Verification

Per `feedback_structural_not_functional` / `feedback_dynamic_analysis_is_evidence`:

- Vitest on `apps/web/lib/build/dispatch-attempts.test.ts` and `apps/web/components/build/BuildDispatchHistoryCard.test.tsx` — must pass with the new assertions.
- `pnpm --filter web typecheck` — must pass.
- After merge, on the running Live portal (`localhost:3000/build?buildId=…`): the dispatch history card shows the classified summary line first; the raw output section is collapsed; on a build with a known pre-hardening attempt, running the backfill script then refreshing the page shows the rewritten summary text.

## 7. Migration / rollback

- No schema migration; the backfill script is operator-runnable and reversible if needed (re-run is idempotent; the old prologue text is preserved in `stdoutExcerpt` and can be observed via the `<details>` raw section).
- No customer install impact at boot — script does not auto-run.
- UI render change is pure rendering; rollback is git revert of the card component.

## 8. Out of scope (carry to follow-on BIs if surfaced during review)

- Reclassifying `failureAxis` retroactively.
- Surfacing `rootCauseSummary` outside the dispatch history card (e.g., as a Build Studio canvas chip).
- Improving the `extractRootCauseSummary` matcher itself — the 2026-05-19 slice owns that.
- Streaming live updates while a dispatch is mid-flight.

## 9. Open decisions

1. **Approve Design C (UI + backfill in one PR)?** Recommendation: yes.
2. **Operator-run backfill vs. boot-time backfill?** Recommendation: operator-run, per `feedback_no_mass_bash`.
3. **Surface the recomputed `rootCauseSummary` with a small "recomputed 2026-05-24" tag in the UI?** Recommendation: no — the recomputed result is the *correct* result; tagging it as "recomputed" implies it's somehow lower-quality than a freshly-written row, which is misleading. The script's exit log carries the audit trail.

## 10. Definition of done

- Spec reviewed and accepted or revised.
- Plan file under `docs/superpowers/plans/2026-05-24-build-studio-dispatch-history-root-cause-display.md`.
- Single PR landing: card render change + `recomputeRootCauseSummary` + backfill script + tests.
- After merge, operator runs the backfill once and confirms the dispatch history card shows clean root-cause lines for a known pre-hardening build.
- BI-594B76AB closes on merge + post-merge backfill confirmation.
