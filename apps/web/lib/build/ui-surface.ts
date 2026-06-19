// apps/web/lib/build/ui-surface.ts
//
// Build Studio review-phase helper: decide whether a build introduced a
// user-facing surface that browser-driven UX verification can actually exercise.
//
// Why this exists:
//   build-review-verification.ts verifies a build by navigating its sandbox
//   preview with browser-use and checking the build's acceptance criteria. That
//   only makes sense when the build changed a RENDERED UI surface (a page,
//   layout, or React component). For a pure library / backend / doc change — a
//   string helper, a server util, an API route handler, a migration — the
//   acceptance criteria are code-level assertions ("truncateMiddle('abc',1)
//   returns '…'") with no page to drive, so browser-use returns a vacuous 0/1
//   failure. Combined with the auto-ship-only-on-"complete" rule, that stranded
//   non-UI builds in `review` forever (the FB-FD850A2C strand: a ~50-line string
//   helper looped review verification on every portal boot for days). Detect the
//   no-UI case up front and SKIP browser UX verification instead of failing it,
//   consistent with the ratified "UX verification is advisory" gate policy
//   (build-process-matrix.ts `uxVerification-not-blocking`).

/**
 * True when a single changed file is a rendered UI surface that browser UX
 * verification can drive — a React component / Next.js page or layout
 * (`.tsx` / `.jsx`).
 *
 * Pure `.ts` (libraries, server actions, API route handlers), `.md`, `.sql`,
 * `.prisma`, `.json`, and scripts are NOT browser-verifiable via acceptance
 * criteria.
 */
export function isUiSurfaceFile(file: string): boolean {
  const path = file.trim();
  if (!path) return false;
  return /\.(tsx|jsx)$/i.test(path);
}

/**
 * True when at least one changed file is a browser-drivable UI surface.
 *
 * An empty change set returns `false` — there is nothing to drive — but callers
 * deciding whether to SKIP a browser run should treat "no changed files known"
 * as "surface unknown" and preserve legacy behavior rather than skipping (see
 * {@link shouldRunBrowserUxVerification}). This function answers only the
 * positive question "did this build touch UI?".
 */
export function buildHasUiSurface(changedFiles: readonly string[]): boolean {
  return changedFiles.some((file) => isUiSurfaceFile(file));
}

/**
 * Decide whether the review phase should run browser-use UX verification.
 *
 * - No acceptance criteria  → false (nothing to assert; matches the existing
 *   `testCases.length === 0` skip path).
 * - Changed files unknown   → true. We cannot prove the build is non-UI, so we
 *   preserve the legacy behavior (run the check) rather than silently disabling
 *   UX verification fleet-wide if a diff projection is briefly unavailable.
 * - Changed files known and contain a UI surface → true.
 * - Changed files known and contain NO UI surface → false (skip: the build is a
 *   pure library / backend / doc change with no page to drive).
 *
 * @example
 * shouldRunBrowserUxVerification({ testCaseCount: 5, changedFiles: ["apps/web/lib/utils/string-helpers.ts"] })
 * // → false  (library-only build: skip browser UX verification, advance to ship)
 *
 * @example
 * shouldRunBrowserUxVerification({ testCaseCount: 3, changedFiles: ["apps/web/app/(shell)/build/page.tsx"] })
 * // → true   (page changed: drive the preview and check the acceptance criteria)
 */
export function shouldRunBrowserUxVerification(args: {
  testCaseCount: number;
  changedFiles: readonly string[];
}): boolean {
  if (args.testCaseCount <= 0) return false;
  if (args.changedFiles.length === 0) return true;
  return buildHasUiSurface(args.changedFiles);
}
