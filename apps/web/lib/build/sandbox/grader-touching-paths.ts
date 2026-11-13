// apps/web/lib/build/sandbox/grader-touching-paths.ts
//
// Name the parts of a build's change that touch what grades it: deleted or
// newly skipped tests, the guard scripts, test runner configuration, CI
// workflows and coverage thresholds. Such a change may be legitimate. It still
// must not be graded only by the code it changed, so it is surfaced to review
// as its own item (docs/superpowers/specs/2026-10-21-agent-sandbox-containment-and-grader-integrity-design.md, AC-7).
//
// Pure: it reads the unified diff the finalize stage already captures.

export type GraderTouchKind =
  | "test-deleted"
  | "test-skipped"
  | "guard-script"
  | "test-config"
  | "ci-workflow"
  | "coverage-threshold";

export type GraderTouch = { kind: GraderTouchKind; path: string; detail?: string };

const TEST_FILE = /(^|\/)(__tests__\/|[^/]+\.(test|spec)\.[cm]?[jt]sx?$)/;
const GUARD_SCRIPT = /^scripts\/(lib\/)?(check-|pregate-)[^/]+$/;
const TEST_CONFIG = /(^|\/)(vitest|jest)\.config\.[cm]?[jt]s$|(^|\/)vitest\.workspace\.[cm]?[jt]s$/;
const CI_WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
/** An added line that turns a test off or narrows a run to one test. */
const SKIP_MARKER = /\b(?:(?:describe|it|test)\.(?:skip|only|todo)|x(?:it|describe|test))\s*\(/;
/** An added line that sets a coverage threshold. */
const THRESHOLD_MARKER = /\b(?:thresholds?|coverageThreshold|branches|functions|lines|statements)\s*:\s*\d/;

type FileDiff = { path: string; deleted: boolean; added: string[]; removed: string[] };

/** Split a unified diff (`git diff` output) into per-file added/removed lines. */
export function parseUnifiedDiff(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const line of patch.split(/\r?\n/)) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2]!, deleted: false, added: [], removed: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("deleted file mode")) current.deleted = true;
    else if (line.startsWith("+++") || line.startsWith("---")) continue;
    else if (line.startsWith("+")) current.added.push(line.slice(1));
    else if (line.startsWith("-")) current.removed.push(line.slice(1));
  }
  return files;
}

/** Count lines matching `marker`, so a moved skip is not mistaken for a new one. */
function count(lines: readonly string[], marker: RegExp): number {
  return lines.filter((l) => marker.test(l)).length;
}

export function classifyGraderTouches(patch: string): GraderTouch[] {
  const touches: GraderTouch[] = [];
  for (const file of parseUnifiedDiff(patch)) {
    const { path } = file;
    if (TEST_FILE.test(path)) {
      if (file.deleted) touches.push({ kind: "test-deleted", path });
      else {
        const newSkips = count(file.added, SKIP_MARKER) - count(file.removed, SKIP_MARKER);
        if (newSkips > 0) touches.push({ kind: "test-skipped", path, detail: `${newSkips} test(s) newly skipped or narrowed with .only` });
      }
    }
    if (GUARD_SCRIPT.test(path)) touches.push({ kind: "guard-script", path });
    if (CI_WORKFLOW.test(path)) touches.push({ kind: "ci-workflow", path });
    if (TEST_CONFIG.test(path)) {
      touches.push({ kind: "test-config", path });
      if (count(file.added, THRESHOLD_MARKER) > 0 || count(file.removed, THRESHOLD_MARKER) > 0) {
        touches.push({ kind: "coverage-threshold", path });
      }
    }
  }
  return touches;
}

/** One line for the build's activity trail, or null when nothing was touched. */
export function summarizeGraderTouches(touches: readonly GraderTouch[]): string | null {
  if (touches.length === 0) return null;
  const listed = touches.slice(0, 8).map((t) => `${t.kind} ${t.path}`).join("; ");
  const more = touches.length > 8 ? `; and ${touches.length - 8} more` : "";
  return `This change touches what grades it (${touches.length}): ${listed}${more}. A reviewer must accept these parts explicitly; the guard gauntlet used the base commit's scripts/, not this change's.`;
}
