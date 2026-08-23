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
 * BI-910C37B1: paths whose churn is noise, not work. A hook or a generator
 * rewrites these, so warning about them trains the reflex of waving the guard
 * away — and that reflex is what loses the real work.
 */
const REGENERATED_PATTERNS = [
  /(^|\/)[^/]*\.generated\.(json|ts|mjs)$/,
  /(^|\/)[^/]*-baseline\.(json|txt)$/,
  /(^|\/)\.DS_Store$/,
  /^docs\/user-guide\/assets\/diagrams\//,
];

function isRegenerated(relPath) {
  const norm = String(relPath ?? "").replace(/\\/g, "/");
  return REGENERATED_PATTERNS.some((re) => re.test(norm));
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
 * BI-910C37B1: every losable modification, not just spec/plan paths.
 *
 * The guard's own message called uncommitted spec/plan edits "the #1 silent-loss
 * vector". The 2026-08-21 incident falsified that: it fired for a plan file and
 * stayed silent about the uncommitted SOURCE edits that were actually destroyed.
 * Any tracked modification is losable.
 *
 * @param {string[]} porcelainLines
 * @returns {Array<{ path: string, xy: string, durable: boolean }>}
 */
export function findLosableWork(porcelainLines) {
  const hits = [];
  for (const line of porcelainLines) {
    const parsed = parsePorcelainLine(line);
    if (!parsed) continue;
    if (isRegenerated(parsed.path)) continue;
    hits.push({
      path: parsed.path,
      xy: parsed.xy,
      durable: isDurableArtifactPath(parsed.path),
    });
  }
  return hits;
}

/**
 * BI-910C37B1: split what this session touched from what it did not.
 *
 * The guard reports on whatever tree it is pointed at, with no notion of whose
 * work it found. In a shared clone that produced the worst possible advice:
 * "commit, stash, or copy these files" — aimed at another session's in-flight
 * spec. Acting on it would have swept their work into a stash they do not know
 * exists. Never recommend a mutating recovery for work this session did not author.
 *
 * @param {Array<{ path: string, xy: string, durable?: boolean }>} hits
 * @param {Iterable<string>} sessionTouchedPaths
 */
export function attributeWork(hits, sessionTouchedPaths) {
  const touched = new Set(
    Array.from(sessionTouchedPaths ?? [], (p) => String(p).replace(/\\/g, "/")),
  );
  const mine = [];
  const theirs = [];
  for (const hit of hits) {
    (touched.has(hit.path) ? mine : theirs).push(hit);
  }
  return { mine, theirs };
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

/**
 * BI-910C37B1: two audiences, two messages.
 *
 * Work this session authored gets the recovery advice. Work it did not gets a
 * hands-off notice instead — surfacing it to the operator is the only safe move,
 * because the session cannot know what the other one is mid-way through.
 *
 * @param {{ mine: Array<{path:string,xy:string,durable?:boolean}>, theirs: Array<{path:string,xy:string,durable?:boolean}> }} attributed
 * @param {{ context?: "session-end" | "post-checkout" }} [opts]
 */
export function buildAttributedWarning(attributed, opts = {}) {
  const list = (rows) =>
    rows.map((d) => `  - ${d.path} (${d.xy.trim() || "dirty"})`).join("\n");
  const when =
    opts.context === "post-checkout"
      ? "You are switching branches with uncommitted work"
      : "This session is ending with uncommitted work";
  const parts = [];

  if (attributed.mine.length > 0) {
    parts.push(
      `[uncommitted-work-guard] ${when} that THIS session made:\n` +
        `${list(attributed.mine)}\n` +
        `Commit, stash, or copy it before switching branches or closing the session.`,
    );
  }
  if (attributed.theirs.length > 0) {
    parts.push(
      `[uncommitted-work-guard] Uncommitted work here was NOT made by this session:\n` +
        `${list(attributed.theirs)}\n` +
        `Do not commit or stash it — another session may be mid-way through it. Surface it to the operator instead. ` +
        `If you are working in a shared clone, that is the defect to fix first: take a worktree.`,
    );
  }
  if (parts.length === 0) return "";
  return `${parts.join("\n\n")}\nBypass only when intentional: DPF_SKIP_UNCOMMITTED_WORK_GUARD=1.`;
}

/**
 * BI-910C37B1: the honest message when the session's own touched-set is unknown.
 *
 * Lists what could be lost without asserting who made it, and names the shared
 * clone as the thing to fix — because in a private worktree everything here is
 * yours, and in a shared clone some of it is not.
 *
 * @param {Array<{path:string,xy:string,durable?:boolean}>} losable
 * @param {{ context?: "session-end" | "post-checkout" }} [opts]
 */
export function buildUnattributedWarning(losable, opts = {}) {
  if (losable.length === 0) return "";
  const paths = losable.map((d) => `  - ${d.path} (${d.xy.trim() || "dirty"})`).join("\n");
  const when =
    opts.context === "post-checkout"
      ? "You are switching branches with uncommitted work"
      : "This session is ending with uncommitted work";
  return (
    `[uncommitted-work-guard] ${when}:\n${paths}\n` +
    `If this is your work, commit, stash, or copy it now. If you are in a shared clone, some of it may belong to another session — ` +
    `check before you commit or stash anything, and take a worktree so this cannot happen again. ` +
    `Bypass only when intentional: DPF_SKIP_UNCOMMITTED_WORK_GUARD=1.`
  );
}
