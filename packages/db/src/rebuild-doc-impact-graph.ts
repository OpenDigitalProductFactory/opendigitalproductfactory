// packages/db/src/rebuild-doc-impact-graph.ts
// Rebuild the doc-impact projection in the Postgres graph mirror from the
// committed manifest. BI-6C112948.
//
// Usage: pnpm --filter @dpf/db graph:rebuild-doc-impact
//        DOC_IMPACT_MANIFEST=/path/to/doc-impact.generated.json pnpm ... (override)
//
// The manifest is READ FROM DISK rather than imported, on purpose: a static
// import from packages/db into apps/web would invert the dependency direction the
// application-boundary guard enforces, and would drag a generated artifact into
// the @dpf/db bundle. Reading a path at runtime keeps the coupling to "this file
// knows a default location", which is the same shape as every other rebuild
// runner in this package.
//
// Mirrors neo4j-rebuild-documents.ts: clear the labels this projection owns, then
// re-project. Clearing first is what makes an edge REMOVED from the manifest
// actually disappear — projectDocImpactManifest alone is upsert-only.

import "./load-env.js";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "./client.js";
import { clearGraphByLabel } from "./pg-graph.js";
import { DOC_PAGE_LABEL, type DocImpactManifest } from "./doc-impact-graph.js";
import { projectDocImpactManifest } from "./doc-impact-graph-sync.js";

/** Default location of the generated manifest, relative to the repo root. */
export const DEFAULT_MANIFEST_RELPATH = "apps/web/lib/docs/doc-impact.generated.json";

function resolveManifestPath(): string {
  if (process.env.DOC_IMPACT_MANIFEST) return path.resolve(process.env.DOC_IMPACT_MANIFEST);
  // packages/db/src → repo root
  return path.resolve(__dirname, "..", "..", "..", DEFAULT_MANIFEST_RELPATH);
}

async function rebuildDocImpact(): Promise<void> {
  const manifestPath = resolveManifestPath();
  if (!fs.existsSync(manifestPath)) {
    // Fail loudly. A silent skip here would leave a half-empty graph that reads
    // as "this file impacts no docs" — the exact false-negative the whole
    // doc-impact effort exists to remove.
    throw new Error(
      `Doc-impact manifest not found at ${manifestPath}. Run: node scripts/gen-doc-impact.mjs`,
    );
  }

  console.log(`Rebuilding doc-impact graph projection from ${manifestPath}...`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as DocImpactManifest;

  // Clear ONLY the label this projection owns. clearGraphByLabel detaches every
  // edge touching the deleted nodes, and every IMPACTS edge ends at a DocPage, so
  // this removes the whole previous edge set without touching a single node the
  // Code Intelligence Graph owns. Clearing CodeFile here would delete 4,215
  // code-graph nodes and their IMPORTS/TESTED_BY edges — which is exactly why the
  // shared endpoints carry an additive label instead of a claimed one.
  await clearGraphByLabel(DOC_PAGE_LABEL);
  console.log("Dropped existing DocPage nodes and their IMPACTS edges");

  const { nodes, edges } = await projectDocImpactManifest(manifest);
  console.log(`Synced ${nodes} nodes and ${edges} IMPACTS edges`);
  console.log("Doc-impact graph rebuild complete.");
}

rebuildDocImpact()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
