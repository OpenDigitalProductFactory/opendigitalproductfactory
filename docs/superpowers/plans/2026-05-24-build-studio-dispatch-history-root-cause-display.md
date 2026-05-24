# Build Studio dispatch history — root-cause display + backfill (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make Build Studio dispatch history show the classified root cause first (`rootCauseSummary` if set, else `failureAxis` text), demote raw stdout/stderr to a collapsed `<details>` audit section, and provide an operator-runnable backfill script that recomputes `rootCauseSummary` on pre-hardening rows.

**Architecture:** Two atomic changes in one PR — (a) a render-layer change in `BuildDispatchHistoryCard.tsx` plus a small symbol-visibility change in `dispatch-attempts.ts` and a new pure `recomputeRootCauseSummary` helper; (b) a one-shot `apps/web/scripts/backfill-dispatch-root-cause-2026-05.ts` that filters rows where the persisted `rootCauseSummary` matches `isCliPrologueLine` and rewrites them. No schema migration. No new columns. No auto-run.

**Tech Stack:** Next.js 15 / React / TypeScript / Vitest / Prisma / pnpm.

**Spec:** [`docs/superpowers/specs/2026-05-24-build-studio-dispatch-history-root-cause-display.md`](../specs/2026-05-24-build-studio-dispatch-history-root-cause-display.md) (BI-594B76AB, EP-BUILD-STUDIO).

---

## Hard constraints (carried from spec §5 + §8)

Out of scope; touching any of these turns this into a different plan:

- No change to `BuildDispatchAttempt` schema (no new columns, no renames, no migrations).
- No reclassification of `failureAxis` on existing rows.
- No matcher logic changes inside `extractRootCauseSummary` — symbol visibility only (private → exported).
- No streaming / live-update work.
- No surfacing of `rootCauseSummary` outside the dispatch history card (no canvas chip, no notification).
- The backfill script does not auto-run at boot or on startup (per `feedback_no_mass_bash`).
- No change to `excerpt()` truncation (500-char limit on `stdoutExcerpt` / `stderrExcerpt` stays).

Scope-violation check: before push, run `git diff origin/main --stat` and verify the diff touches only:
- `apps/web/lib/build/dispatch-attempts.ts`
- `apps/web/lib/build/dispatch-attempts.test.ts`
- `apps/web/components/build/BuildDispatchHistoryCard.tsx`
- `apps/web/components/build/BuildDispatchHistoryCard.test.tsx`
- `apps/web/scripts/backfill-dispatch-root-cause-2026-05.ts`
- `docs/superpowers/specs/2026-05-24-build-studio-dispatch-history-root-cause-display.md` (already committed)
- `docs/superpowers/plans/2026-05-24-build-studio-dispatch-history-root-cause-display.md` (this file)

---

## Task 1 — Export `extractRootCauseSummary` and `isCliPrologueLine`

**Files:**
- Modify: `apps/web/lib/build/dispatch-attempts.ts` (lines 196, 242)

**Step 1: Change `function` to `export function` on both helpers.**

At `apps/web/lib/build/dispatch-attempts.ts` line 196:

```ts
function extractRootCauseSummary(stdout: string, stderr: string, fallback: BuildFailureAxis): string {
```

becomes:

```ts
export function extractRootCauseSummary(stdout: string, stderr: string, fallback: BuildFailureAxis): string {
```

At line 242:

```ts
function isCliPrologueLine(line: string): boolean {
```

becomes:

```ts
export function isCliPrologueLine(line: string): boolean {
```

**Step 2: Typecheck.**

```bash
pnpm --filter web typecheck
```

Expected: clean. (Pure visibility change; no callers should break since adding `export` is strictly additive.)

**Step 3: Commit.**

```bash
git add apps/web/lib/build/dispatch-attempts.ts
git commit -s -m "refactor(build-studio): export extractRootCauseSummary + isCliPrologueLine

Phase 1 of BI-594B76AB. Pure symbol-visibility change — both helpers
remain implementations-of-record in dispatch-attempts.ts; the upcoming
recomputeRootCauseSummary helper and the backfill script consume them
as public API. No logic change."
```

---

## Task 2 — Add `recomputeRootCauseSummary` + unit tests

**Files:**
- Modify: `apps/web/lib/build/dispatch-attempts.ts` (add new exported function)
- Modify: `apps/web/lib/build/dispatch-attempts.test.ts` (add tests for it)

**Step 1: Write the failing tests.**

Append to `apps/web/lib/build/dispatch-attempts.test.ts`:

```ts
describe("recomputeRootCauseSummary", () => {
  it("returns the axis-matched line when the stdout excerpt contains one", () => {
    const result = recomputeRootCauseSummary({
      stdoutExcerpt: "Reading prompt from stdin...\nYou've hit your usage limit for today.",
      stderrExcerpt: null,
      failureAxis: "usage-limit",
    });
    expect(result).toMatch(/usage limit/i);
    expect(result.toLowerCase()).not.toMatch(/reading prompt from stdin/);
  });

  it("falls back to the first non-prologue line when no axis line is found", () => {
    const result = recomputeRootCauseSummary({
      stdoutExcerpt: "Reading prompt from stdin...\nSomething else happened.",
      stderrExcerpt: null,
      failureAxis: "unknown",
    });
    expect(result).toBe("Something else happened.");
  });

  it("falls back to the axis name when both excerpts are null", () => {
    const result = recomputeRootCauseSummary({
      stdoutExcerpt: null,
      stderrExcerpt: null,
      failureAxis: "timeout",
    });
    expect(result).toBe("timeout");
  });

  it("falls back to the axis name when both excerpts are empty strings", () => {
    const result = recomputeRootCauseSummary({
      stdoutExcerpt: "",
      stderrExcerpt: "",
      failureAxis: "rate-limit",
    });
    expect(result).toBe("rate-limit");
  });

  it("reads the stderr excerpt when stdout has only prologue", () => {
    const result = recomputeRootCauseSummary({
      stdoutExcerpt: "Reading prompt from stdin...",
      stderrExcerpt: "auth error: unauthorized request",
      failureAxis: "auth",
    });
    expect(result.toLowerCase()).toContain("unauthorized");
  });
});
```

Add the import at the top of the test file:

```ts
import { recomputeRootCauseSummary } from "./dispatch-attempts";
```

(Adjust to merge with existing imports from `./dispatch-attempts`.)

**Step 2: Run the failing tests.**

```bash
pnpm --filter web exec vitest run lib/build/dispatch-attempts.test.ts
```

Expected: 5 new failures all citing "recomputeRootCauseSummary is not defined" or undefined-import.

**Step 3: Implement `recomputeRootCauseSummary`.**

Append to `apps/web/lib/build/dispatch-attempts.ts` (after the existing `extractRootCauseSummary` and `isCliPrologueLine` block, before `excerpt()`):

```ts
/**
 * Re-derive `rootCauseSummary` for a row using the persisted excerpts and the
 * already-classified failure axis. Used by the 2026-05-24 backfill script to
 * normalize pre-hardening rows whose original `rootCauseSummary` captured the
 * Codex CLI prologue instead of the diagnostic line.
 *
 * Pure. The matcher operates on the 500-char excerpts, not the full original
 * output — this is acceptable because (a) the recomputed result is at least as
 * good as the prologue text it replaces, and (b) it matches what the operator
 * sees when expanding the dispatch history card's raw section. See spec §4.2.
 */
export function recomputeRootCauseSummary(row: {
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  failureAxis: BuildFailureAxis;
}): string {
  return extractRootCauseSummary(row.stdoutExcerpt ?? "", row.stderrExcerpt ?? "", row.failureAxis);
}
```

**Step 4: Run the tests and verify all 5 pass.**

```bash
pnpm --filter web exec vitest run lib/build/dispatch-attempts.test.ts
```

Expected: all green.

**Step 5: Typecheck.**

```bash
pnpm --filter web typecheck
```

Expected: clean.

**Step 6: Commit.**

```bash
git add apps/web/lib/build/dispatch-attempts.ts apps/web/lib/build/dispatch-attempts.test.ts
git commit -s -m "feat(build-studio): add recomputeRootCauseSummary helper (BI-594B76AB)

Pure wrapper around extractRootCauseSummary that accepts a row-shape
(stdoutExcerpt, stderrExcerpt, failureAxis) instead of raw output args.
Consumed by the upcoming backfill script and the dispatch history card
render path. Five unit tests cover prologue-suppression, fallback to
first non-prologue line, fallback to axis name, and stderr-only paths."
```

---

## Task 3 — Render `rootCauseSummary` in `BuildDispatchHistoryCard`

**Files:**
- Modify: `apps/web/components/build/BuildDispatchHistoryCard.tsx`
- Modify: `apps/web/components/build/BuildDispatchHistoryCard.test.tsx`

**Step 1: Write the failing tests.**

Read the existing test file first (it already exercises this component) and append the new assertions. The pattern follows the existing tests:

```ts
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuildDispatchHistoryCard } from "./BuildDispatchHistoryCard";
import type { BuildDispatchAttemptView } from "@/lib/build/dispatch-attempts";

function attempt(overrides: Partial<BuildDispatchAttemptView> = {}): BuildDispatchAttemptView {
  return {
    id: "att-1",
    buildId: "FB-X",
    taskTitle: "Task A",
    specialist: null,
    providerId: null,
    model: null,
    attemptNumber: 1,
    startedAt: "2026-05-24T00:00:00Z",
    completedAt: "2026-05-24T00:00:05Z",
    durationMs: 5000,
    exitCode: 1,
    success: false,
    failureAxis: "usage-limit",
    stdoutExcerpt: "Reading prompt from stdin...\nUsage limit reached for the day.",
    stderrExcerpt: null,
    rootCauseSummary: "Usage limit reached for the day.",
    rootCauseHash: "deadbeefcafe1234",
    ...overrides,
  };
}

describe("BuildDispatchHistoryCard — root-cause display (BI-594B76AB)", () => {
  it("renders rootCauseSummary as the visible diagnosis line when present", () => {
    const html = renderToStaticMarkup(<BuildDispatchHistoryCard attempts={[attempt()]} />);
    expect(html).toContain("Usage limit reached for the day.");
  });

  it("falls back to failureAxis text when rootCauseSummary is null", () => {
    const html = renderToStaticMarkup(
      <BuildDispatchHistoryCard attempts={[attempt({ rootCauseSummary: null, failureAxis: "timeout" })]} />,
    );
    expect(html).toMatch(/\btimeout\b/i);
  });

  it("places stdoutExcerpt inside a <details> element, not the default visible body", () => {
    const html = renderToStaticMarkup(<BuildDispatchHistoryCard attempts={[attempt()]} />);
    expect(html).toMatch(/<details[\s>]/);
    // The prologue text is in stdoutExcerpt, which now lives inside <details>.
    // Capture the substring from <details> open to </details> close and assert
    // the prologue text is inside that range.
    const detailsMatch = html.match(/<details[\s\S]*?<\/details>/);
    expect(detailsMatch).not.toBeNull();
    expect(detailsMatch![0]).toContain("Reading prompt from stdin");
  });

  it("does not duplicate the rootCauseSummary inside the raw <details>", () => {
    const html = renderToStaticMarkup(<BuildDispatchHistoryCard attempts={[attempt()]} />);
    const occurrences = (html.match(/Usage limit reached for the day\./g) ?? []).length;
    // Once in the visible diagnosis line. The stdoutExcerpt also contains this
    // string after the prologue — accept up to 2 occurrences (visible + raw).
    expect(occurrences).toBeGreaterThanOrEqual(1);
    expect(occurrences).toBeLessThanOrEqual(2);
  });

  it("uses a <summary> label that names the raw section", () => {
    const html = renderToStaticMarkup(<BuildDispatchHistoryCard attempts={[attempt()]} />);
    expect(html).toMatch(/<summary[^>]*>.*Raw.*<\/summary>/i);
  });
});
```

**Step 2: Run the failing tests.**

```bash
pnpm --filter web exec vitest run components/build/BuildDispatchHistoryCard.test.tsx
```

Expected: 5 new failures all on the new assertions (current card neither renders `rootCauseSummary` nor uses `<details>`).

**Step 3: Update `BuildDispatchHistoryCard.tsx`.**

Replace the mapped row body (lines 22-37 of the existing file) so each attempt renders:

```tsx
{attempts.map((attempt) => {
  const diagnosis = attempt.rootCauseSummary ?? attempt.failureAxis;
  const rawOutput = attempt.stdoutExcerpt ?? attempt.stderrExcerpt;
  return (
    <div key={attempt.id} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-[var(--dpf-text)]">{attempt.taskTitle}</span>
        <span className="text-[var(--dpf-muted)]">exit {attempt.exitCode ?? "running"} · {attempt.failureAxis}</span>
      </div>
      <div
        className="mt-1 text-[var(--dpf-text)]"
        title="Classified diagnosis — derived from stdout/stderr and the failure axis."
      >
        {diagnosis}
      </div>
      {attempt.model && (
        <div className="mt-1 text-[var(--dpf-muted)]">{attempt.model}</div>
      )}
      {rawOutput && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] uppercase text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
            Raw stdout/stderr
          </summary>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 text-[10px] text-[var(--dpf-muted)]">
            {rawOutput}
          </pre>
        </details>
      )}
    </div>
  );
})}
```

The `<details>` element is native HTML and needs no client state. The component remains `"use client"` (no change to the `"use client"` directive at the top).

**Step 4: Run the tests and verify all pass.**

```bash
pnpm --filter web exec vitest run components/build/BuildDispatchHistoryCard.test.tsx
```

Expected: all green.

**Step 5: Typecheck.**

```bash
pnpm --filter web typecheck
```

Expected: clean.

**Step 6: Commit.**

```bash
git add apps/web/components/build/BuildDispatchHistoryCard.tsx apps/web/components/build/BuildDispatchHistoryCard.test.tsx
git commit -s -m "feat(build-studio): dispatch history shows classified root cause first (BI-594B76AB)

Renders rootCauseSummary (or failureAxis text when null) as the
operator-facing diagnosis line; demotes raw stdout/stderr to a
collapsed <details> audit section. Internal symbols + the underlying
BuildDispatchAttemptView shape unchanged. Five tests cover visible
diagnosis, fallback path, <details> placement, no-duplicate render,
and the raw summary label."
```

---

## Task 4 — Backfill script

**Files:**
- Create: `apps/web/scripts/backfill-dispatch-root-cause-2026-05.ts`

**Step 1: Write the script.**

```ts
// apps/web/scripts/backfill-dispatch-root-cause-2026-05.ts
//
// One-shot operator-runnable backfill for BI-594B76AB.
// Recomputes BuildDispatchAttempt.rootCauseSummary for rows whose persisted
// value is just the Codex CLI prologue, using the post-hardening matcher
// logic. Idempotent — re-running produces the same result because the second
// pass finds no remaining prologue-matched rows.
//
// Run via:
//   pnpm --filter web exec tsx scripts/backfill-dispatch-root-cause-2026-05.ts
//
// Per feedback_no_mass_bash this script is NOT auto-run at boot. Per
// feedback_db_seed_migration_sync, since this normalizes platform diagnostic
// data and does not change schema, it lives here as a script rather than as
// a Prisma migration.

import { createHash } from "crypto";
import { prisma } from "@dpf/db";
import {
  isCliPrologueLine,
  recomputeRootCauseSummary,
  normalizeRootCauseForHash,
} from "../lib/build/dispatch-attempts";
import type { BuildFailureAxis } from "../lib/build/progress-visibility-types";

type Counters = { scanned: number; updated: number; skipped: number; errored: number };

function hashRootCause(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function main(): Promise<Counters> {
  const counters: Counters = { scanned: 0, updated: 0, skipped: 0, errored: 0 };

  // Pull only rows with a non-null rootCauseSummary; client-side filter on the
  // prologue pattern. The table is small (one row per dispatch attempt) so
  // an in-memory filter is acceptable.
  const rows = await prisma.buildDispatchAttempt.findMany({
    where: { rootCauseSummary: { not: null } },
    select: {
      id: true,
      rootCauseSummary: true,
      stdoutExcerpt: true,
      stderrExcerpt: true,
      failureAxis: true,
    },
  });

  for (const row of rows) {
    counters.scanned += 1;
    const summary = row.rootCauseSummary?.trim() ?? "";
    if (!summary) {
      counters.skipped += 1;
      continue;
    }
    if (!isCliPrologueLine(summary)) {
      counters.skipped += 1;
      continue;
    }
    try {
      const recomputed = recomputeRootCauseSummary({
        stdoutExcerpt: row.stdoutExcerpt,
        stderrExcerpt: row.stderrExcerpt,
        failureAxis: row.failureAxis as BuildFailureAxis,
      });
      if (recomputed === row.rootCauseSummary) {
        // Idempotent no-op — same result as already stored.
        counters.skipped += 1;
        continue;
      }
      const hash = hashRootCause(`${row.failureAxis}:${normalizeRootCauseForHash(recomputed)}`);
      await prisma.buildDispatchAttempt.update({
        where: { id: row.id },
        data: { rootCauseSummary: recomputed, rootCauseHash: hash },
      });
      counters.updated += 1;
    } catch (err) {
      counters.errored += 1;
      // eslint-disable-next-line no-console
      console.warn(`[backfill] failed to update row ${row.id}:`, err);
    }
  }

  return counters;
}

main()
  .then((counters) => {
    // eslint-disable-next-line no-console
    console.log("[backfill] done:", counters);
    return prisma.$disconnect();
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[backfill] fatal:", err);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
```

**Step 2: Check that `normalizeRootCauseForHash` is exported.**

```bash
grep -n "export function normalizeRootCauseForHash\|^function normalizeRootCauseForHash" apps/web/lib/build/dispatch-attempts.ts
```

If the function is module-private, add `export` to it (line 263 area). This is the same kind of pure-symbol-visibility change as Task 1.

If a change is needed, modify `dispatch-attempts.ts` and add a one-line `git add` for that file in this commit.

**Step 3: Typecheck.**

```bash
pnpm --filter web typecheck
```

Expected: clean. (The script imports from `@dpf/db` and from sibling `lib/` files; tsc resolves these via the existing `apps/web/tsconfig.json` path aliases.)

**Step 4: Verify the script does not auto-run.**

```bash
grep -n "backfill-dispatch-root-cause" apps/web/server.js docker-entrypoint.sh apps/web/instrumentation.ts 2>/dev/null || echo "no auto-run references found"
```

Expected: "no auto-run references found". Any hit means the script got wired into a boot path by mistake — remove it.

**Step 5: Commit.**

```bash
git add apps/web/scripts/backfill-dispatch-root-cause-2026-05.ts apps/web/lib/build/dispatch-attempts.ts
git commit -s -m "feat(build-studio): one-shot backfill for pre-hardening dispatch root-cause rows (BI-594B76AB)

Operator-runnable script (NOT auto-run at boot per feedback_no_mass_bash)
that recomputes rootCauseSummary on rows where the persisted value
matches isCliPrologueLine. Idempotent. No schema change.

Recomputes rootCauseHash to keep the hash/summary pair consistent.
Logs { scanned, updated, skipped, errored } counts and exits cleanly."
```

---

## Task 5 — Final verification + push + PR

**Step 1: Full vitest run on the touched scope.**

```bash
pnpm --filter web exec vitest run lib/build/dispatch-attempts.test.ts components/build/BuildDispatchHistoryCard.test.tsx
```

Expected: all green.

**Step 2: Broader test slice — make sure nothing adjacent broke.**

```bash
pnpm --filter web exec vitest run lib/build components/build
```

Expected: all green.

**Step 3: Typecheck.**

```bash
pnpm --filter web typecheck
```

Expected: clean.

**Step 4: Scope-violation sanity check.**

```bash
git diff origin/main --stat
```

Expected: only the seven files listed in the Hard constraints section above.

**Step 5: Overlap sweep.**

```bash
git fetch origin main --quiet
git log origin/main --oneline -10 --grep="dispatch\|root.cause\|BI-594B76AB" -i
gh pr list --state open --limit 30 --json number,title --jq '.[] | select(.title | test("dispatch|root.cause|BI-594B"; "i")) | .title'
```

Expected: no overlap with concurrent work. If a sibling PR touches `dispatch-attempts.ts` or `BuildDispatchHistoryCard.tsx`, rebase + re-verify before pushing.

**Step 6: Push.**

```bash
git push -u origin claude/dispatch-history-root-cause
```

**Step 7: Open the PR.**

```bash
gh pr create --title "feat(build-studio): dispatch history root-cause display + backfill (BI-594B76AB)" --body "$(cat <<'EOF'
## Summary

Closes BI-594B76AB. Two complementary changes shipping together:

1. **UI render fallback.** `BuildDispatchHistoryCard` now shows `rootCauseSummary` (or `failureAxis` text when null) as the operator-facing diagnosis line. Raw stdout/stderr moves into a collapsed `<details>` audit section, accessible but not leading.
2. **One-shot backfill.** `apps/web/scripts/backfill-dispatch-root-cause-2026-05.ts` recomputes `rootCauseSummary` on rows whose persisted value matches `isCliPrologueLine` (i.e. pre-hardening rows still carrying the Codex CLI prologue). Idempotent. NOT auto-run at boot (per `feedback_no_mass_bash`).

Spec: `docs/superpowers/specs/2026-05-24-build-studio-dispatch-history-root-cause-display.md`.
Plan: `docs/superpowers/plans/2026-05-24-build-studio-dispatch-history-root-cause-display.md`.

## Out of scope (per spec §5 + §8)

No schema change. No `failureAxis` reclassification. No matcher logic change (symbol visibility only). No streaming. No auto-run.

## Test plan

- [x] `pnpm --filter web exec vitest run lib/build/dispatch-attempts.test.ts components/build/BuildDispatchHistoryCard.test.tsx` — green.
- [x] `pnpm --filter web typecheck` — clean.
- [x] `git diff origin/main --stat` — only 7 expected files touched (5 code/test + 2 spec/plan docs).
- [ ] **Post-merge operator step:** run `pnpm --filter web exec tsx scripts/backfill-dispatch-root-cause-2026-05.ts` on the live install and confirm the printed `{ scanned, updated, skipped, errored }` counters look sane.
- [ ] **Post-merge UX:** open `/build?buildId=<some-pre-hardening-build>` on the Live portal — confirm the dispatch history card shows the classified summary first and the raw output is collapsed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done-criteria (from spec §10)

- [ ] Spec + plan committed.
- [ ] Single PR landing card render change + `recomputeRootCauseSummary` + backfill script + tests.
- [ ] After merge, operator runs the backfill once and confirms the dispatch history card shows clean root-cause lines for a known pre-hardening build.
- [ ] BI-594B76AB closes on merge + post-merge backfill confirmation.
