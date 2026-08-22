// Guard: every build-time static import in apps/web must resolve to a path that
// the production Dockerfile actually COPYs into the `next build` stage.
//
// WHY THIS EXISTS (self-upgrade failure SUR-BCFB72BB, 2026-07-11 / BI-062CFB41):
// PR #2776 added `config/seed-content-paths.json` at the repo root and statically
// imported it from apps/web/lib/build/seed-contribution-fit.ts. The production
// Dockerfile's build stage COPYs a NARROW allowlist (apps/web/, packages/,
// docs/professions/, a few named root files) and never copied `config/`. So:
//   - CI's "Production Build" gate runs plain `next build` against the full
//     checkout, where the file is on disk → GREEN.
//   - The real Docker image build (only exercised at self-upgrade / tag-release,
//     never on PRs) can't resolve the import → `next build` fails
//     "Module not found" → every self-upgrade to that target detonates.
//
// This is a RECURRING class (cf. docs/professions/registry.json, packages/db
// data JSON — all previously bitten). The kernel (principle_decide, 2026-07-11,
// "Architecture Over Shortcuts") chose this cheap static guard over building the
// real image on every PR. The guard derives the allowlist FROM the Dockerfile,
// so adding a `COPY <dir>/ ...` line automatically satisfies it — no duplicated
// list to drift.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { extractStaticImports } from "./bundle-boundary";

// apps/web/lib/verify → repo root is four levels up.
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const APPS_WEB = join(REPO_ROOT, "apps", "web");
const DOCKERFILE = join(REPO_ROOT, "Dockerfile");
const DOCKER_ENTRYPOINT = join(REPO_ROOT, "docker-entrypoint.sh");

type Stage = { name: string; parent: string | null; body: string[] };

/** Split the Dockerfile into named build stages, preserving FROM parentage. */
function parseStages(dockerfile: string): Stage[] {
  const stages: Stage[] = [];
  let current: Stage | null = null;
  for (const line of dockerfile.split("\n")) {
    const from = line.match(/^\s*FROM\s+(\S+)\s+AS\s+(\S+)/i);
    if (from) {
      current = { name: from[2], parent: from[1], body: [] };
      stages.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  return stages;
}

/**
 * The set of build-context path prefixes available when `next build` runs —
 * the union of COPY sources in the build stage AND every ancestor stage it
 * FROMs (filesystem is inherited down the chain). `--from=<stage>` COPYs pull
 * from other image stages, not the build context, so they're excluded.
 */
function copyAllowlistForStage(stages: Stage[], stageName: string): {
  dirPrefixes: string[];
  exactFiles: string[];
} {
  const byName = new Map(stages.map((s) => [s.name, s]));
  const targetStage = byName.get(stageName);
  if (!targetStage) {
    throw new Error(`Dockerfile: could not find stage \`${stageName}\``);
  }

  // Walk the FROM chain from the build stage up to the base image.
  const chain: Stage[] = [];
  let cursor: Stage | undefined = targetStage;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.name)) {
    seen.add(cursor.name);
    chain.push(cursor);
    cursor = cursor.parent ? byName.get(cursor.parent) : undefined;
  }

  const dirPrefixes: string[] = [];
  const exactFiles: string[] = [];
  for (const stage of chain) {
    for (const raw of stage.body) {
      const line = raw.trim();
      if (!/^COPY\b/i.test(line)) continue;
      if (/--from=/.test(line)) continue; // from another image stage, not context
      // Tokens after COPY, minus flags, minus the final dest arg.
      const tokens = line
        .replace(/^COPY\s+/i, "")
        .split(/\s+/)
        .filter((t) => t.length > 0 && !t.startsWith("--"));
      if (tokens.length < 2) continue; // need at least <src> <dest>
      const sources = tokens.slice(0, -1);
      for (const src of sources) {
        const norm = src.replace(/^\.\//, "").replace(/\/+$/, "");
        if (src.endsWith("/")) dirPrefixes.push(norm);
        else exactFiles.push(norm);
      }
    }
  }
  return { dirPrefixes, exactFiles };
}

function copyAllowlistForBuildStage(stages: Stage[]): {
  dirPrefixes: string[];
  exactFiles: string[];
} {
  const buildStage = stages.find((s) => s.body.some((l) => /\bnext build\b/.test(l)));
  if (!buildStage) {
    throw new Error("Dockerfile: could not find the stage that runs `next build`");
  }
  return copyAllowlistForStage(stages, buildStage.name);
}

function isCovered(
  repoRelPath: string,
  allow: { dirPrefixes: string[]; exactFiles: string[] },
): boolean {
  const p = repoRelPath.split(sep).join("/");
  if (allow.exactFiles.includes(p)) return true;
  return allow.dirPrefixes.some((dir) => p === dir || p.startsWith(`${dir}/`));
}

/** Recursively collect production .ts/.tsx source files under apps/web. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSourceFiles(full, acc);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    // Test/spec files are not part of the `next build` graph — their imports
    // (fixtures, scripts/*.mjs) never enter the production bundle.
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;
    acc.push(full);
  }
  return acc;
}

function escapingImportViolations(
  files: string[],
  allow: { dirPrefixes: string[]; exactFiles: string[] },
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const specs = extractStaticImports(readFileSync(file, "utf8"));
    for (const spec of specs) {
      if (!spec.startsWith(".")) continue;
      const resolved = resolve(join(file, ".."), spec);
      const repoRel = relative(REPO_ROOT, resolved);
      if (repoRel.startsWith("..")) continue;
      if (isCovered(repoRel, allow)) continue;
      violations.push(
        `${relative(REPO_ROOT, file)} imports "${spec}" → ${repoRel} (not COPYed into the stage)`,
      );
    }
  }
  return violations;
}

describe("Dockerfile build context covers every escaping build-time import", () => {
  const allow = copyAllowlistForBuildStage(parseStages(readFileSync(DOCKERFILE, "utf8")));
  const files = collectSourceFiles(APPS_WEB);

  it("finds a non-empty allowlist and a non-empty source set (sanity)", () => {
    expect(allow.dirPrefixes).toContain("apps/web");
    expect(allow.dirPrefixes).toContain("packages");
    expect(files.length).toBeGreaterThan(100);
  });

  it("every static import that escapes apps/web resolves inside a COPYed path", () => {
    const violations = escapingImportViolations(files, allow);
    expect(
      violations,
      `These build-time imports point at repo paths the production Dockerfile never COPYs into the \`next build\` stage, so the Docker image build fails "Module not found" at self-upgrade/deploy even though plain \`next build\` (CI) passes. Fix by adding a COPY for the containing directory to the build stage of the Dockerfile:\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("Docker runtime source bundle is complete for Build Studio", () => {
  const dockerfile = readFileSync(DOCKERFILE, "utf8");
  const stages = parseStages(dockerfile);
  const initAllow = copyAllowlistForStage(stages, "init");
  const files = collectSourceFiles(APPS_WEB);

  it("packages every repo-relative dependency imported by the web source", () => {
    const violations = escapingImportViolations(files, initAllow);
    expect(
      violations,
      `These imports are present in apps/web-src but absent from the init stage copied into the runner, so a fresh Build Studio sandbox exits with \"Module not found\":\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });

  it("bootstraps profession data and maps it back to its image source", () => {
    const entrypoint = readFileSync(DOCKER_ENTRYPOINT, "utf8");
    expect(entrypoint).toContain('cp -r /app/docs/professions/. "$WORKSPACE/docs/professions/"');
    expect(entrypoint).toContain('docs/professions/*)');
    expect(entrypoint).toContain("${1#docs/professions/}");
  });
});
