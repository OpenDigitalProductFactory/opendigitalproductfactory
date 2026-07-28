// scripts/lib/derived-artifacts-registry.mjs
//
// BI-48768E05 — declarative registry of derived (generated-from-source,
// committed-to-git) artifacts: source globs -> generator command -> check
// command, one entry per artifact. Single source of truth consumed by
// .githooks/pre-commit (regenerate + stage), .githooks/pre-push-gate
// (dependency-graph-derived push exemption), and CI
// (scripts/derived-artifacts-gate.mjs check-all).
//
// Filed after PR #3284 turned main red: it added a docs page without
// regenerating apps/web/lib/docs/doc-index.generated.json, and the pre-push
// gate's docs-only path-regex exemption assumed docs changes are always
// runtime-safe -- false precisely for a generated artifact whose SOURCE is
// docs/. Adding a generator here is what makes a new derived artifact
// covered by construction; no hook or CI file needs to change.
//
// Zero external dependencies -- pure data plus a hand-rolled glob matcher
// (the only patterns in use are literal segments, `*`, and `**`, so a full
// glob library would be dead weight).

/**
 * Convert a repo-relative glob (`*`, `**`, literal segments) to a RegExp
 * anchored on both ends. `**\/` collapses to "zero or more path segments,
 * including none" so `docs/**\/*.md` matches `docs/foo.md` as well as
 * `docs/a/b/foo.md`. `**` at the end of a pattern (no trailing slash, used
 * for "this whole directory") matches any suffix, including into
 * subdirectories.
 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++; // consume the second '*'
      if (glob[i + 1] === "/") {
        i++; // consume the following '/'
        re += "(?:.*/)?";
      } else {
        re += ".*";
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** True if a repo-relative POSIX path matches a repo-relative glob. */
export function matchesGlob(filePath, glob) {
  return globToRegExp(glob).test(filePath);
}

/** True if `filePath` matches at least one glob in `globs`. */
export function matchesAnyGlob(filePath, globs) {
  return globs.some((g) => matchesGlob(filePath, g));
}

export const DERIVED_ARTIFACTS = [
  {
    id: "doc-index",
    description: "Doc corpus index (link/anchor resolution)",
    sourceGlobs: ["docs/**/*.md", "apps/web/lib/docs/doc-link-resolver.mjs"],
    artifactPaths: ["apps/web/lib/docs/doc-index.generated.json"],
    generate: ["node", "scripts/gen-doc-index.mjs"],
    check: ["node", "scripts/gen-doc-index.mjs", "--check"],
  },
  {
    id: "doc-impact",
    description: "Doc-impact manifest (route/code -> user-guide page edges)",
    sourceGlobs: [
      "docs/user-guide/**/*.md",
      "apps/web/lib/docs-route-map.ts",
      "scripts/check-docs-impact.mjs",
    ],
    artifactPaths: ["apps/web/lib/docs/doc-impact.generated.json"],
    generate: ["node", "scripts/gen-doc-impact.mjs"],
    check: ["node", "scripts/gen-doc-impact.mjs", "--check"],
  },
  {
    id: "doc-diagrams",
    description: "Rendered Mermaid diagram SVGs + manifest",
    sourceGlobs: ["docs/user-guide/**/*.md", "docs/architecture/**/*.md"],
    artifactPaths: ["docs/user-guide/assets/diagrams/**"],
    generate: ["node", "scripts/render-doc-diagrams.mjs"],
    check: ["node", "scripts/render-doc-diagrams.mjs", "--check"],
    // Rendering shells out to mmdc (@mermaid-js/mermaid-cli), which is only
    // installed in a compile-ready environment, not every source-only
    // worktree. Pre-commit skips (loudly) rather than blocking when it's
    // absent; CI (a compile-ready runner) is the backstop via --check.
    requiresBinary: "mmdc",
  },
  {
    id: "capability-service-catalog",
    description: "Compiled capability/service catalog",
    sourceGlobs: [
      "scripts/platform-substrate-manifest.json",
      "packages/db/data/platform-runtime-capabilities.json",
      "scripts/lib/capability-service-projection.mjs",
    ],
    artifactPaths: ["scripts/capability-service-catalog.generated.json"],
    generate: ["node", "scripts/compile-capability-service-catalog.mjs"],
    check: ["node", "scripts/compile-capability-service-catalog.mjs", "--check"],
  },
  {
    id: "sbom-baseline",
    description: "SBOM dependency-shape drift baseline (first-party version splits)",
    sourceGlobs: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
    artifactPaths: ["sbom/baseline.json"],
    generate: ["node", "scripts/sbom/check-sbom-drift.mjs", "--update-baseline"],
    check: ["node", "scripts/sbom/check-sbom-drift.mjs"],
    // NOT a pure function of its sources: the baseline records which
    // first-party version splits are DELIBERATELY accepted. Its own guard
    // comment is explicit: "Update intentionally ... never to silence a
    // real regression." Auto-staging on every lockfile touch would launder
    // a judgment call the check exists to force a human to make, so this
    // entry is registered (for CI's check-all and for push-exemption
    // awareness) but pre-commit only advises -- it never runs `generate`
    // for this entry on its own.
    autoStage: false,
  },
];

/** Registry entries whose sourceGlobs match at least one of `files`. */
export function affectedEntries(files, registry = DERIVED_ARTIFACTS) {
  return registry.filter((entry) => files.some((f) => matchesAnyGlob(f, entry.sourceGlobs)));
}
