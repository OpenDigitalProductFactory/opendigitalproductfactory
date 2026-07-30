import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

import type { RoutePolicyManifestRow } from "../lib/ux-budget/route-policy";

export const ROUTE_MANIFEST_REL = "apps/web/lib/ea/route-manifest.json";

export function findRepoRoot(startDir = process.cwd()): string {
  let dir = startDir;
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return startDir;
}

export function readJsonFile<T>(root: string, relativePath: string): T {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8")) as T;
}

export function readRouteManifestRows(
  root: string,
): RoutePolicyManifestRow[] {
  return readJsonFile<{ routes: RoutePolicyManifestRow[] }>(
    root,
    ROUTE_MANIFEST_REL,
  ).routes;
}

export function readJsonFromGitRef<T>(
  root: string,
  ref: string,
  relativePath: string,
): T | undefined {
  try {
    execFileSync("git", ["rev-parse", "--verify", ref], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    throw new Error(`[registry-generator] Invalid Git base ref ${ref}.`);
  }

  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:${relativePath}`], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    const detail =
      error instanceof Error && "stderr" in error
        ? String(error.stderr)
        : String(error);
    if (/does not exist in|exists on disk, but not in/i.test(detail)) {
      return undefined;
    }
    throw new Error(
      `[registry-generator] Could not read ${relativePath} from ${ref}: ${detail}`,
    );
  }
  const source = execFileSync("git", ["show", `${ref}:${relativePath}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(source) as T;
}

export function serializeStableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeOrCheckGeneratedJson(options: {
  root: string;
  relativePath: string;
  value: unknown;
  check: boolean;
  label: string;
  buildCommand: string;
}): void {
  const outputPath = join(options.root, options.relativePath);
  const serialized = serializeStableJson(options.value);

  if (options.check) {
    const current = existsSync(outputPath)
      ? readFileSync(outputPath, "utf8")
      : "";
    if (current !== serialized) {
      throw new Error(
        `[${options.label}] STALE - ${options.relativePath} is out of date. Run: ${options.buildCommand}`,
      );
    }
    return;
  }

  writeFileSync(outputPath, serialized, "utf8");
}
