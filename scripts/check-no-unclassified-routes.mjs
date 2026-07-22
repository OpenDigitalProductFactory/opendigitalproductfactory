#!/usr/bin/env node
// Route-classification ratchet (BI-8C0F219A).
//
// Auto-discovered by scripts/check-guards.mjs (Repo Guard Loop) because it is
// named `check-no-*.mjs`. Fails when a NEW page route is added that is not
// represented in the canonical portal navigation model (and is not a dynamic
// detail route or a legacy redirect shim). The current backlog of unclassified
// routes is frozen in a shrink-only baseline, so the IA debt can only decrease.
//
//   node scripts/check-no-unclassified-routes.mjs           # check (CI)
//   node scripts/check-no-unclassified-routes.mjs --update  # re-baseline

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { buildRouteManifest, unclassifiedRoutes } from "./lib/route-classification.mjs";

const BASELINE = "scripts/unclassified-routes-baseline.txt";
const update = process.argv.includes("--update");

const current = unclassifiedRoutes(buildRouteManifest());

if (update) {
  writeFileSync(BASELINE, current.join("\n") + (current.length ? "\n" : ""));
  console.log(`[route-classification] baseline updated: ${current.length} unclassified route(s)`);
  process.exit(0);
}

const baseline = existsSync(BASELINE)
  ? readFileSync(BASELINE, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  : [];
const baselineSet = new Set(baseline);
const currentSet = new Set(current);

const newlyUnclassified = current.filter((r) => !baselineSet.has(r));
if (newlyUnclassified.length) {
  console.error("[route-classification] FAILED — new page route(s) not classified in the");
  console.error("canonical navigation model (apps/web/lib/navigation/portal-navigation-model.ts):");
  for (const r of newlyUnclassified) console.error("  • " + r);
  console.error("");
  console.error("Add a PortalNavRecord with `audienceModes` + `destinationKind` for each, or —");
  console.error("if it is genuinely a detail or legacy-redirect route — it is auto-classified.");
  console.error("After a deliberate reduction, re-baseline with:");
  console.error("  node scripts/check-no-unclassified-routes.mjs --update");
  process.exit(1);
}

const resolved = baseline.filter((r) => !currentSet.has(r));
if (resolved.length) {
  console.log(
    `[route-classification] ${resolved.length} baselined route(s) are now classified or gone — run --update to tighten the baseline.`,
  );
}
console.log(
  `[route-classification] OK — ${current.length} unclassified route(s) (baseline ${baseline.length}); no new unclassified routes.`,
);
process.exit(0);
