// scripts/lib/room-addressing-detect.mjs — pure detection for the room-addressing
// guard (BI-00727E59). Kept separate from the guard so the guard's own self-test
// can exercise red and green fixtures without touching the repository.
//
// WHY THIS EXISTS. An operator reported that no "Open room" button on the
// Needs-you inbox worked. It was three defects stacked on one button, and all
// three were the same missing rule wearing different clothes: nothing guarantees
// a room is reachable, so each surface re-derived how to address one and each got
// it wrong differently. The attention lens invented `/ea/workrooms/<id>`, a path
// with no dynamic segment behind it, so every card 404'd — and no test failed,
// because nothing asserted the link resolved.
//
// Two rules, both statically decidable:
//
//   1. ADDRESSABILITY — a work-case path is composed by the canonical helper,
//      never spelled out. `/workspace/cases/${x}` where x does not come from
//      encodeWorkCaseKey is a second home for the addressing rule.
//
//   2. REACHABILITY — an interpolated app path whose static prefix names a real
//      App Router directory that has NO dynamic child cannot resolve, ever. That
//      is the BI-6F2CC21B defect generalized: provably 404 at author time.

/** A route group "(shell)" adds nesting without consuming a URL segment. */
const isRouteGroup = (name) => name.startsWith("(") && name.endsWith(")");
const isDynamic = (name) => name.startsWith("[") && name.endsWith("]");

/**
 * Walk an App Router tree description to the directory a static path prefix
 * names. `tree` is a map of dirPath -> child directory names, so the caller
 * supplies the filesystem and this stays pure.
 * Returns the resolved directory paths (a prefix can resolve through more than
 * one route group), or [] when the prefix names nothing.
 */
export function resolveRouteDirs(tree, root, segments) {
  let frontier = [root];
  for (const segment of segments) {
    const next = [];
    for (const dir of frontier) {
      for (const child of tree[dir] ?? []) {
        const childPath = `${dir}/${child}`;
        if (isRouteGroup(child)) {
          frontier.push(childPath); // transparent: re-examine at this same segment
          continue;
        }
        if (child === segment) next.push(childPath);
      }
    }
    if (next.length === 0) return [];
    frontier = next;
  }
  return frontier;
}

/** Does any resolved directory accept a further dynamic segment? */
export function acceptsDynamicChild(tree, dirs) {
  return dirs.some((dir) =>
    (tree[dir] ?? []).some(
      (child) =>
        isDynamic(child)
        || (isRouteGroup(child) && acceptsDynamicChild(tree, [`${dir}/${child}`])),
    ),
  );
}

/** Interpolated absolute paths in a source file: `/a/b/${...}`. */
export function findInterpolatedPaths(source) {
  const found = [];
  const pattern = /`(\/[A-Za-z0-9._~\-/]*?)\$\{([^`]*?)\}/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const prefix = match[1];
    if (!prefix.endsWith("/")) continue; // interpolation mid-segment, not a path join
    const segments = prefix.split("/").filter(Boolean);
    // `/${x}` is a computed whole path, not a route join — every route would
    // "match" its empty prefix, so it carries no signal.
    if (segments.length === 0) continue;
    found.push({ prefix, expression: match[2], index: match.index, segments });
  }
  return found;
}

/** Is this interpolation used as a link a person can follow?
 *
 *  Only a LINK can 404 at a user. revalidatePath, fetch and cache keys take the
 *  same shape and are out of scope: a wrong path there is a different defect
 *  with a different fix, and folding them in would make the guard noisy enough
 *  to be ignored. */
export function isLinkContext(source, index) {
  const window = source.slice(Math.max(0, index - 120), index);
  return /\b(href|deepLink|linkTo|connectHref|actionHref|url)\s*[:=]\s*$|\b(href|deepLink|connectHref)\s*[:=]\s*$/i.test(
    window.replace(/\s+$/, "") + "",
  ) || /\b(href|deepLink|connectHref|linkTo|actionHref)\b[^;]{0,40}$/i.test(window);
}

export function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/** Rule 1: a work-case path must come from the canonical helper. */
export function findHandBuiltCaseKeys(source) {
  return findInterpolatedPaths(source)
    .filter((hit) => hit.prefix === "/workspace/cases/")
    .filter((hit) => !/encodeWorkCaseKey|caseKey|canonicalKey/.test(hit.expression))
    .map((hit) => ({ kind: "hand-built-case-key", line: lineOf(source, hit.index), ...hit }));
}

/** Rule 2: an interpolated path whose prefix cannot accept a dynamic segment. */
export function findUnreachablePaths(source, tree, root) {
  return findInterpolatedPaths(source)
    .filter((hit) => isLinkContext(source, hit.index))
    .map((hit) => ({ hit, dirs: resolveRouteDirs(tree, root, hit.segments) }))
    // A prefix that names no route directory at all is not this guard's business:
    // it may be an API path, an external URL, or a non-route string.
    .filter(({ dirs }) => dirs.length > 0)
    .filter(({ tree: _t, dirs }) => !acceptsDynamicChild(tree, dirs))
    .map(({ hit }) => ({ kind: "unreachable-path", line: lineOf(source, hit.index), ...hit }));
}
