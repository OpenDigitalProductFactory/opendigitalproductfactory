// Weekly rebuild of the reference projection (BI-A63A9476; spec 2026-10-14 §5,
// "Rebuild"). Re-derives every MENTIONS edge from the bodies and prunes edges of
// sources that are gone: the repair for any save whose reference write failed.
// The writer is idempotent, so a re-run changes nothing when nothing drifted.

import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

export const entityReferencesRebuild = jobs.createFunction(
  { id: "knowledge/entity-references-rebuild", retries: 1, triggers: [cron("40 4 * * 0")] }, // Sun 04:40, after infra-prune
  async ({ step }) => {
    const gate = await gateAtEntry(step, "knowledge/entity-references-rebuild");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    const result = await step.run("rebuild-entity-references", async () => {
      const { rebuildEntityReferences } = await import("@dpf/db");
      return rebuildEntityReferences();
    });
    return { ok: result.failures === 0, ...result };
  },
);
