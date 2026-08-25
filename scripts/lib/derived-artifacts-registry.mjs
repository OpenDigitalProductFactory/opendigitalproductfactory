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
    id: "public-archetype-pages",
    description: "Operator-first public archetype pages projected from canonical storefront definitions",
    sourceGlobs: [
      "docs/business-types/_content.mjs",
      "docs/business-types/_generate.mjs",
      "docs/business-types/_readability.mjs",
      "packages/storefront-templates/src/archetypes/**",
      "packages/storefront-templates/src/operational-value-stream.ts",
      "packages/storefront-templates/src/types.ts",
    ],
    artifactPaths: [
      "docs/business-types/*.html",
      "docs/business-types/archetypes/**",
      "docs/business-types/_readability-report.md",
    ],
    generate: ["pnpm", "docs:business-types"],
    check: ["pnpm", "docs:business-types:check"],
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
    id: "architecture-counts",
    description: "Generated architecture counts include (models/enums/migrations/principles/routes)",
    sourceGlobs: [
      "packages/db/prisma/schema/**",
      "packages/db/prisma/migrations/**",
      "docs/founder-kernel/wiki/principles/*.md",
      "apps/web/lib/ea/route-manifest.json",
      "scripts/gen-architecture-counts.mjs",
    ],
    artifactPaths: ["docs/architecture/architecture-counts.generated.md"],
    generate: ["node", "scripts/gen-architecture-counts.mjs"],
    check: ["node", "scripts/gen-architecture-counts.mjs", "--check"],
  },
  // ─── Route-derived registry chain (BI-34D69270) ────────────────────────────
  //
  // route-manifest -> route-audience -> route-shells -> page-purpose: four
  // artifacts generated from the App Router route tree, in strict dependency
  // order (each reads the one before it from disk). Registered here so a route
  // add/remove/rename regenerates + stages ALL of them at commit time, the way
  // the "Route Manifest Freshness" CI guard checks them.
  //
  // Filed after #4302 inherited latent main-red from #4295: that PR added
  // /ops/stack-currency's page without regenerating route-manifest.json, so the
  // downstream registries never saw the route, all four stayed mutually
  // consistent at the old count, and the staleness sat invisible until an
  // unrelated route-touching PR tripped the required Merge Readiness
  // aggregation and had to absorb the repair. Pre-commit auto-regen closes that
  // class at the source: the committing dev can no longer ship a stale chain.
  //
  // Each entry lists the app route globs (a route change must regenerate the
  // whole chain) plus its own upstream artifact + generator/logic files. Order
  // in this array IS the regeneration order, so downstream entries read the
  // freshly-written upstream artifact.
  {
    id: "route-manifest",
    description: "App Router route manifest (SysML route projection source)",
    sourceGlobs: [
      "apps/web/app/**/page.ts",
      "apps/web/app/**/page.tsx",
      "apps/web/app/**/route.ts",
      "apps/web/app/**/route.tsx",
      "apps/web/scripts/build-route-manifest.ts",
      "apps/web/lib/ea/route-extract.ts",
    ],
    artifactPaths: ["apps/web/lib/ea/route-manifest.json"],
    generate: ["pnpm", "--filter", "web", "run", "build:route-manifest"],
    check: ["pnpm", "--filter", "web", "run", "check:route-manifest"],
  },
  {
    id: "route-audience",
    description: "Per-route audience + destination-kind classification (derives from the manifest)",
    sourceGlobs: [
      "apps/web/app/**/page.ts",
      "apps/web/app/**/page.tsx",
      "apps/web/app/**/route.ts",
      "apps/web/app/**/route.tsx",
      "apps/web/lib/ea/route-manifest.json",
      "apps/web/lib/navigation/route-audience.ts",
      "apps/web/scripts/build-route-audience.ts",
    ],
    artifactPaths: ["apps/web/lib/navigation/route-audience.generated.json"],
    generate: ["pnpm", "--filter", "web", "run", "build:route-audience"],
    check: ["pnpm", "--filter", "web", "run", "check:route-audience"],
  },
  {
    id: "route-shells",
    description: "Intended page-shell + sweep-eligibility registry (derives from manifest + audience)",
    sourceGlobs: [
      "apps/web/app/**/page.ts",
      "apps/web/app/**/page.tsx",
      "apps/web/app/**/route.ts",
      "apps/web/app/**/route.tsx",
      "apps/web/lib/ea/route-manifest.json",
      "apps/web/lib/navigation/route-audience.generated.json",
      "apps/web/lib/ux-budget/route-shells.ts",
      "apps/web/lib/ux-budget/budgets.ts",
      "apps/web/scripts/build-route-shells.ts",
    ],
    artifactPaths: ["apps/web/lib/ux-budget/route-shells.generated.json"],
    generate: ["pnpm", "--filter", "web", "run", "build:route-shells"],
    check: ["pnpm", "--filter", "web", "run", "check:route-shells"],
  },
  {
    id: "page-purpose",
    description: "Per-route purpose-contract registry (derives from the shared route policy)",
    sourceGlobs: [
      "apps/web/app/**/page.ts",
      "apps/web/app/**/page.tsx",
      "apps/web/app/**/route.ts",
      "apps/web/app/**/route.tsx",
      "apps/web/lib/ea/route-manifest.json",
      "apps/web/lib/ux-budget/page-purpose.ts",
      "apps/web/lib/ux-budget/route-policy.ts",
      "apps/web/lib/ux-budget/route-purpose-baseline.json",
      "apps/web/lib/ux-budget/purpose-contracts/**",
      "apps/web/scripts/build-page-purpose.ts",
      "apps/web/scripts/registry-generator-support.ts",
    ],
    artifactPaths: ["apps/web/lib/ux-budget/route-purpose.generated.json"],
    generate: ["pnpm", "--filter", "web", "run", "build:page-purpose"],
    // Freshness only (committed == regenerated + non-diff identity ratchet). The
    // base-ref transition ratchet is the CI workflow's job (audit-route-manifest.yml).
    check: ["pnpm", "--filter", "web", "run", "check:page-purpose"],
  },
  {
    id: "capability-completeness",
    description: "Capability completeness measure (seven planes, per agent identity)",
    sourceGlobs: [
      "packages/db/src/workforce-seed.ts",
      "packages/db/src/agent-identity.ts",
      "packages/db/data/agent_registry.json",
      "packages/db/src/coworker-service-catalog-seed.ts",
      "apps/web/lib/tak/agent-grants.ts",
      "apps/web/lib/tak/decision-routing-governance-hook.ts",
      "apps/web/lib/mcp/packs/**",
      "apps/web/lib/mcp-tools.ts",
      "apps/web/lib/operate/scheduled-jobs/coworker-self-tasks.ts",
      "apps/web/lib/operate/scheduled-jobs/catalog.ts",
      "apps/web/lib/coworker-lifecycle/golden-journeys.ts",
      "docs/professions/registry.json",
      "docs/professions/**",
      "skills/**",
      "packages/dpf-skill-pack/skills/**",
      "scripts/measure-capability-completeness.mjs",
    ],
    artifactPaths: [
      "apps/web/lib/coworker-lifecycle/capability-completeness.generated.json",
      "docs/maintenance/capability-completeness.md",
    ],
    generate: ["node", "scripts/measure-capability-completeness.mjs"],
    check: ["node", "scripts/measure-capability-completeness.mjs", "--check"],
  },
  {
    id: "obligation-cadence-coverage",
    description: "Archetype obligation cadence coverage (common vs archetype packs)",
    sourceGlobs: [
      "packages/storefront-templates/src/archetypes/*.ts",
      "packages/db/src/seed-*compliance*.ts",
      "apps/web/lib/compliance/obligation-cadence.ts",
      "scripts/measure-obligation-cadence-coverage.mjs",
    ],
    artifactPaths: [
      "apps/web/lib/compliance/obligation-cadence-coverage.generated.json",
      "docs/maintenance/obligation-cadence-coverage.md",
    ],
    generate: ["node", "scripts/measure-obligation-cadence-coverage.mjs"],
    check: ["node", "scripts/measure-obligation-cadence-coverage.mjs", "--check"],
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
