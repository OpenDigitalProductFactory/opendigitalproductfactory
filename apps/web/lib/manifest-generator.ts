// apps/web/lib/manifest-generator.ts
// Generates the codebase manifest (SBOM) by merging a human-maintained base
// template with auto-generated dependency, model, and statistics data.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import { isDevInstance } from "@/lib/codebase-tools";

const PROJECT_ROOT = resolve(process.cwd(), "..", "..");

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExternalDependency = {
  name: string;
  version: string;
  license: string;
  purpose: string;
};

export type ManifestStatistics = {
  totalFiles: number;
  totalLines: number;
  moduleCount: number;
  externalDependencyCount: number;
  dataModelCount: number;
};

export type CodebaseManifestData = {
  version: string;
  gitRef: string;
  generatedAt: string;
  platform: Record<string, unknown>;
  modules: Array<Record<string, unknown>>;
  capabilityMap: Record<string, unknown>;
  externalDependencies: ExternalDependency[];
  boundaries: Record<string, unknown>;
  statistics: ManifestStatistics;
};

// ─── Pure Helpers (exported for testing) ─────────────────────────────────────

export function parseDependencies(packageJsonContent: string): ExternalDependency[] {
  try {
    const pkg = JSON.parse(packageJsonContent);
    const deps = pkg.dependencies ?? {};
    return Object.entries(deps).map(([name, version]) => ({
      name,
      version: String(version),
      license: "unknown",
      purpose: "",
    }));
  } catch {
    return [];
  }
}

export function countPrismaModels(schemaContent: string): number {
  const matches = schemaContent.match(/^model\s+\w+\s*\{/gm);
  return matches?.length ?? 0;
}

export function mergeManifest(
  base: Record<string, unknown>,
  auto: { externalDependencies: ExternalDependency[]; statistics: ManifestStatistics },
): CodebaseManifestData {
  return {
    version: "",
    gitRef: "",
    generatedAt: new Date().toISOString(),
    platform: (base.platform ?? {}) as Record<string, unknown>,
    modules: (base.modules ?? []) as Array<Record<string, unknown>>,
    capabilityMap: (base.capabilityMap ?? {}) as Record<string, unknown>,
    externalDependencies: auto.externalDependencies,
    boundaries: (base.boundaries ?? {}) as Record<string, unknown>,
    statistics: auto.statistics,
  };
}

// ─── File Counting ───────────────────────────────────────────────────────────

function countFilesAndLines(dirPath: string): { files: number; lines: number } {
  let files = 0;
  let lines = 0;
  const fullPath = resolve(PROJECT_ROOT, dirPath);
  if (!existsSync(fullPath)) return { files, lines };

  function walk(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === ".next") continue;
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else if (entry.isFile()) {
          files++;
          try {
            const content = readFileSync(entryPath, "utf-8");
            lines += content.split("\n").length;
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* skip inaccessible directories */ }
  }

  walk(fullPath);
  return { files, lines };
}

// ─── Main Generator ──────────────────────────────────────────────────────────

export async function generateManifest(opts?: {
  version?: string;
  gitRef?: string;
  writeFile?: boolean;
}): Promise<CodebaseManifestData> {
  // Read base manifest
  const basePath = resolve(PROJECT_ROOT, "codebase-manifest.base.json");
  let base: Record<string, unknown> = {};
  if (existsSync(basePath)) {
    try { base = JSON.parse(readFileSync(basePath, "utf-8")); } catch { /* use empty base */ }
  }

  // Auto-generate: external dependencies
  const allDeps: ExternalDependency[] = [];
  const pkgPaths = ["package.json", "apps/web/package.json"];
  const seen = new Set<string>();
  for (const rel of pkgPaths) {
    const full = resolve(PROJECT_ROOT, rel);
    if (existsSync(full)) {
      const deps = parseDependencies(readFileSync(full, "utf-8"));
      for (const dep of deps) {
        if (!seen.has(dep.name)) {
          seen.add(dep.name);
          allDeps.push(dep);
        }
      }
    }
  }

  // Auto-generate: model count
  const schemaPath = resolve(PROJECT_ROOT, "packages/db/prisma/schema.prisma");
  let modelCount = 0;
  if (existsSync(schemaPath)) {
    modelCount = countPrismaModels(readFileSync(schemaPath, "utf-8"));
  }

  // Auto-generate: file/line statistics per module
  const modules = (base.modules ?? []) as Array<{ path?: string }>;
  let totalFiles = 0;
  let totalLines = 0;
  for (const mod of modules) {
    if (mod.path) {
      const { files, lines } = countFilesAndLines(mod.path);
      totalFiles += files;
      totalLines += lines;
    }
  }

  const statistics: ManifestStatistics = {
    totalFiles,
    totalLines,
    moduleCount: modules.length,
    externalDependencyCount: allDeps.length,
    dataModelCount: modelCount,
  };

  // Merge
  const manifest = mergeManifest(base, { externalDependencies: allDeps, statistics });
  manifest.version = opts?.version ?? "dev";
  manifest.gitRef = opts?.gitRef ?? "HEAD";
  manifest.generatedAt = new Date().toISOString();

  // Write file if requested
  if (opts?.writeFile !== false && isDevInstance()) {
    const outPath = resolve(PROJECT_ROOT, "codebase-manifest.json");
    writeFileSync(outPath, JSON.stringify(manifest, null, 2), "utf-8");
  }

  return manifest;
}
