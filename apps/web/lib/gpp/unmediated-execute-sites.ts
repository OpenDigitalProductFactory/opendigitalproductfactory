// Direct `executeTool(` call sites that bypass the reference monitor.
//
// GPP Phase 1, T3 (docs/superpowers/plans/2026-10-01-gpp-phase-1-see-and-ratchet.md).
// Scope baseline: OBJ-MEDIATION; acceptance AC-RATCHET-REACH. GPP check C-9.
//
// `governedExecuteTool` (lib/mcp-governed-execute.ts) is the reference monitor.
// `executeTool` (lib/mcp-tools.ts) runs a handler after the kernel runtime gate
// but without the governed authority ladder or audit. Every call to it outside
// the monitor is a path around mediation. This module counts those paths per
// file so that the count can only fall.
//
// Counting is per file, not per line, so an ordinary edit that moves a call
// never breaks the ratchet. Comment lines are ignored.

/** Files that ARE the mediation boundary, or define executeTool itself. */
export const MEDIATION_BOUNDARY_FILES: readonly string[] = [
  "lib/mcp-governed-execute.ts",
  "lib/mcp-tools.ts",
];

export type SourceFile = { path: string; content: string };
export type CallSite = {
  path: string;
  line: number;
  /** The literal tool name passed, or "dynamic" when the name is a variable. */
  toolName: string;
};

const CALL = /(?<![A-Za-z0-9_$])executeTool\s*\(/g;
const CALL_START = /(?<![A-Za-z0-9_$])executeTool\s*\(/;

function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** Every direct executeTool call site outside tests and the mediation boundary. */
export function findUnmediatedExecuteSites(files: readonly SourceFile[]): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of files) {
    if (MEDIATION_BOUNDARY_FILES.includes(file.path)) continue;
    if (/\.test\.tsx?$/.test(file.path)) continue;
    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (isCommentLine(line)) return;
      if (/function\s+executeTool\s*\(/.test(line)) return;
      const matches = line.match(CALL);
      if (!matches) return;
      // The tool name is the first string literal after the call, possibly on the next line.
      const window = lines.slice(index, index + 3).join(" ");
      const after = window.slice(window.search(CALL_START));
      const literal = after.match(/executeTool\s*\(\s*["'`]([a-zA-Z_][a-zA-Z0-9_]*)["'`]/);
      for (let i = 0; i < matches.length; i++) {
        sites.push({ path: file.path, line: index + 1, toolName: literal?.[1] ?? "dynamic" });
      }
    });
  }
  return sites;
}

/** Per-file counts, the unit the ratchet compares. */
export function countByFile(sites: readonly CallSite[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const site of sites) counts[site.path] = (counts[site.path] ?? 0) + 1;
  return counts;
}

/**
 * SHRINK-ONLY. Seeded 2026-10-01 from origin/main 93a75c07 (28 sites, 15 files;
 * the plan inventory's row 2, build-review-verification.ts, no longer calls
 * executeTool on that ref).
 * The Phase 1 plan's call-site inventory assigns each site a phase: rows 1–10
 * (outward, authority, irreversible or dynamic tools) move behind the monitor
 * in Phase 2; the rest are internal writes that stay allowlisted, because read
 * and internal-write tools never need a permit.
 *
 * unmediated-reach-ratchet.test.ts fails when a file appears here that has no
 * sites, when a count here exceeds the live count (shrink it), and when a live
 * file or count exceeds this list (a new path around the monitor).
 */
export const KNOWN_UNMEDIATED_EXECUTE_SITES: Readonly<Record<string, number>> = {
  "app/api/admin/ops/execute-proposal/route.ts": 1,
  "lib/actions/agent-coworker.ts": 5,
  "lib/actions/build.ts": 1,
  "lib/actions/demand-activation.ts": 1,
  "lib/actions/demand-estimate.ts": 1,
  "lib/actions/proposals.ts": 1,
  "lib/actions/request-brand-extraction.ts": 1,
  "lib/build/auto-open-build-pr.ts": 1,
  "lib/build/build-on-plan-approval.ts": 1,
  "lib/build/build-orchestrator.ts": 3,
  "lib/build/ideate-on-approval.ts": 4,
  "lib/build/plan-on-approval.ts": 1,
  "lib/build/resume-pre-build-phase.ts": 3,
  "lib/build/ship-on-review-approval.ts": 3,
  "lib/mcp/packs/screen-pack.ts": 1,
};
