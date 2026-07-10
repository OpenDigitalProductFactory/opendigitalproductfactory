// Static bundle-boundary detector — catch the Docker-only build failure class in
// seconds, source-local, instead of serially across 40-90s Docker builds.
//
// Spec: docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md (§3.3)
// BI-98AF1066.
//
// The §2.1 trace's two bundle-boundary violations were found one-at-a-time across
// two Docker builds: a route/Inngest/page/action entrypoint STATICALLY imported
// the promoter (which spawns docker), dragging its host-only graph into the
// server bundle and triggering Turbopack/NFT failures. A static import is the
// problem; a dynamic `import()` (the fix) is fine. This module provides the pure
// detectors; the guard test runs them over the real entrypoint set.

/**
 * Extract the specifiers a module pulls into the BUNDLE: top-level static
 * `import ... from` and re-export `export ... from`. Deliberately excludes:
 *  - `import type` / `export type` — erased at build, never in the bundle;
 *  - dynamic `import("x")` — the sanctioned lazy boundary, not a bundle edge;
 *  - bare side-effect `import "x"` IS included (it loads the module).
 */
export function extractStaticImports(source: string): string[] {
  // Drop type-only import/export first (bounded at the `from "..."` terminator).
  const noType = source.replace(
    /\b(?:import|export)\s+type\b[\s\S]*?from\s*["'][^"']+["']/g,
    "",
  );
  const specs = new Set<string>();
  // import/export … from "spec" — default, named, namespace, multiline.
  for (const m of noType.matchAll(/\bfrom\s*["']([^"']+)["']/g)) specs.add(m[1]);
  // bare side-effect import "spec"
  for (const m of noType.matchAll(/\bimport\s+["']([^"']+)["']/g)) specs.add(m[1]);
  return [...specs];
}

/**
 * Modules that must never be statically imported into a server-bundle entrypoint
 * — they carry host-only/docker concerns and must be reached via dynamic import.
 * Matched against the raw specifier string.
 */
export const DEFAULT_HOST_ONLY_MATCHERS: RegExp[] = [
  /self-upgrade\/promoter(?:\.[tj]s)?$/, // spawns docker; lazy-load only
  /(?:^|\/)dockerode$/, // docker SDK
];

export function isHostOnlyModule(
  specifier: string,
  matchers: RegExp[] = DEFAULT_HOST_ONLY_MATCHERS,
): boolean {
  return matchers.some((re) => re.test(specifier));
}

export type BoundaryViolation = {
  /** The entrypoint that pulls a host-only module into the bundle. */
  entrypoint: string;
  /** The offending specifier. */
  specifier: string;
  /** "direct" — imported the host-only module itself; "barrel" — via a re-exporting barrel. */
  via: "direct" | "barrel";
};

export type EntrypointImports = {
  path: string;
  /** Specifiers this entrypoint statically imports (from extractStaticImports). */
  imports: string[];
};

/**
 * Given each entrypoint's static imports, plus the set of barrel specifiers that
 * are known to re-export a host-only module (resolved one level by the caller),
 * return every boundary violation. Pure — all IO (glob/read/resolve) is the
 * caller's job, so this is a truth table under test.
 */
export function findBoundaryViolations(
  entrypoints: EntrypointImports[],
  hostOnlyBarrelSpecifiers: Set<string> = new Set(),
  matchers: RegExp[] = DEFAULT_HOST_ONLY_MATCHERS,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const entry of entrypoints) {
    for (const spec of entry.imports) {
      if (isHostOnlyModule(spec, matchers)) {
        violations.push({ entrypoint: entry.path, specifier: spec, via: "direct" });
      } else if (hostOnlyBarrelSpecifiers.has(spec)) {
        violations.push({ entrypoint: entry.path, specifier: spec, via: "barrel" });
      }
    }
  }
  return violations;
}
