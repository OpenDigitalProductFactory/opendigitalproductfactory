// packages/db/src/rebuild-entity-references.ts
// Re-derive every MENTIONS edge from the bodies (BI-A63A9476). Re-runnable.
// Usage: pnpm --filter @dpf/db references:rebuild

import "./load-env.js";
import { prisma } from "./client.js";
import { rebuildEntityReferences } from "./entity-references-rebuild.js";

rebuildEntityReferences()
  .then((result) => {
    console.log(
      `references:rebuild — ${result.sources} sources, ${result.edges} edges, ${result.refused} refused, ` +
        `${result.failures} failed, ${result.pruned} stale edges pruned`,
    );
    if (result.failures > 0) process.exitCode = 1;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
