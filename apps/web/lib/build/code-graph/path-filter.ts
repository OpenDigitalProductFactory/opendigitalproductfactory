import { lazyPath } from "@/lib/shared/lazy-node";

import {
  CODE_GRAPH_FILE_EXTENSIONS,
  CODE_GRAPH_TRACKED_FILE_EXCLUDES,
} from "./constants";

export function shouldIndexCodeGraphPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("/.next/") || normalized.startsWith(".next/")) return false;
  if (normalized.includes("/packages/db/generated/") || normalized.startsWith("packages/db/generated/")) return false;
  if (normalized.includes("/node_modules/") || normalized.startsWith("node_modules/")) return false;
  if (normalized.includes("/.pnpm-store/") || normalized.startsWith(".pnpm-store/")) return false;
  return CODE_GRAPH_FILE_EXTENSIONS.has(lazyPath().extname(normalized).toLowerCase());
}

/**
 * `gitRoot` threads a scoped `safe.directory` exception through, for the same
 * reason as every other git call here (BI-86EF5900): the portal container runs
 * as a different uid than the checkout, so an unprefixed git refuses outright.
 * Optional so existing callers and tests keep working unchanged.
 */
export function buildListTrackedFilesCommand(gitRoot?: string): string {
  const includeSpecs = Array.from(CODE_GRAPH_FILE_EXTENSIONS)
    .sort()
    .map((extension) => `"**/*${extension}"`);
  const excludeSpecs = CODE_GRAPH_TRACKED_FILE_EXCLUDES
    .map((pathspec) => `":(exclude)${pathspec}"`);

  const safe = gitRoot ? ` -c safe.directory=${JSON.stringify(gitRoot)}` : "";
  return `git${safe} ls-files -- ${[...includeSpecs, ...excludeSpecs].join(" ")}`;
}
