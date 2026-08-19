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

export function buildListTrackedFilesCommand(): string {
  const includeSpecs = Array.from(CODE_GRAPH_FILE_EXTENSIONS)
    .sort()
    .map((extension) => `"**/*${extension}"`);
  const excludeSpecs = CODE_GRAPH_TRACKED_FILE_EXCLUDES
    .map((pathspec) => `":(exclude)${pathspec}"`);

  return `git ls-files -- ${[...includeSpecs, ...excludeSpecs].join(" ")}`;
}
