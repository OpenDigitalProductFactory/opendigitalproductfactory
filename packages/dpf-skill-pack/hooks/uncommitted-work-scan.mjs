// Pure scan helpers for uncommitted-work-guard (unit-tested).

import { isDurableArtifactPath } from "./durable-artifact-paths.mjs";

/**
 * Parse one `git status --porcelain` line into status + repo-relative path.
 * @param {string} line
 * @returns {{ xy: string, path: string } | null}
 */
export function parsePorcelainLine(line) {
  if (!line || line.length < 4) return null;
  const xy = line.slice(0, 2);
  let pathPart = line.slice(3).trim();
  if (pathPart.includes(" -> ")) {
    pathPart = pathPart.split(" -> ").pop()?.trim() ?? pathPart;
  }
  // Quoted paths from git status -z are rare in --porcelain without -z; strip quotes.
  if (pathPart.startsWith('"') && pathPart.endsWith('"')) {
    pathPart = pathPart.slice(1, -1);
  }
  return { xy, path: pathPart };
}

/**
 * @param {string[]} porcelainLines
 * @returns {Array<{ path: string, xy: string }>}
 */
export function findDurableArtifactDrift(porcelainLines) {
  const hits = [];
  for (const line of porcelainLines) {
    const parsed = parsePorcelainLine(line);
    if (!parsed || !isDurableArtifactPath(parsed.path)) continue;
    hits.push({ path: parsed.path, xy: parsed.xy });
  }
  return hits;
}

/**
 * @param {Array<{ path: string, xy: string }>} drift
 * @param {{ context?: "session-end" | "post-checkout" }} [opts]
 */
export function buildWarning(drift, opts = {}) {
  const paths = drift.map((d) => `  - ${d.path} (${d.xy.trim() || "dirty"})`).join("\n");
  const when =
    opts.context === "post-checkout"
      ? "You are switching branches with uncommitted durable-artifact work"
      : "This session is ending with uncommitted durable-artifact work";
  return (
    `[uncommitted-work-guard] ${when} under docs/superpowers/specs/ or docs/superpowers/plans/:\n` +
    `${paths}\n` +
    `Commit, stash, or copy these files before switching branches or closing the session — uncommitted spec/plan edits are the #1 silent-loss vector (process-spine §2). ` +
    `Bypass only when intentional: DPF_SKIP_UNCOMMITTED_WORK_GUARD=1.`
  );
}