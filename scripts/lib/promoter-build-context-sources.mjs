import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The promoter build closure — the files the CALLER stages into the promoter's
 * docker build context — read from the one TypeScript source of truth,
 * `apps/web/lib/self-upgrade/promoter-build-context.ts`.
 *
 * Guards live in .mjs and cannot import TypeScript, so they parse the exported
 * array literal instead of re-declaring it. This list, NOT `Dockerfile.promoter`,
 * is the closure's source of truth: the Dockerfile copies whole directories on
 * purpose, so that a candidate stays buildable by an already-deployed (N-1)
 * portal whose staged context predates a newly added file (BI-A04D61B9).
 */
export async function readPromoterBuildContextSources(repoRoot) {
  const source = await readFile(
    join(repoRoot, "apps", "web", "lib", "self-upgrade", "promoter-build-context.ts"),
    "utf8",
  );
  const start = source.indexOf("PROMOTER_BUILD_CONTEXT_SOURCES");
  if (start < 0) throw new Error("PROMOTER_BUILD_CONTEXT_SOURCES not found");
  const open = source.indexOf("[", source.indexOf("=", start));
  const close = source.indexOf("]", open);
  if (open < 0 || close < open) throw new Error("PROMOTER_BUILD_CONTEXT_SOURCES array literal malformed");
  const entries = [...source.slice(open + 1, close).matchAll(/"([^"]+)"/g)].map(([, value]) => value);
  if (entries.length === 0) throw new Error("PROMOTER_BUILD_CONTEXT_SOURCES is empty");
  return entries;
}
