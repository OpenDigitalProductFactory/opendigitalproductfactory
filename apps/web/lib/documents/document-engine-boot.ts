// Document engine boot (BI-903D22D0 + BI-153EC72C).
//
// Called once from instrumentation.ts. It reconciles the dpf-doctools pin at
// boot and on its timer (self-upgrade/doctools-release-image.ts), and asks for
// the bounded rendition backfill:
//   - at portal start, whether or not the converter was already available, so
//     documents saved before an upgrade into the engine get their renditions;
//   - whenever the pin changes, so a new release's converter sweeps again.
// The asks are debounced (rendition-trigger.ts) and the job is idempotent per
// (version, rendition kind), so a restart that finds nothing pending costs one
// empty query.

import type { DoctoolsReconcilerOptions } from "@/lib/self-upgrade/doctools-release-image";

type BootDeps = {
  startReconciler: (options: DoctoolsReconcilerOptions) => Promise<void>;
  requestBackfill: (reason: string) => void;
};

async function productionDeps(): Promise<BootDeps> {
  const [{ startDoctoolsReleaseImageReconciler }, { createDebouncedBackfillRequest }] = await Promise.all([
    import("@/lib/self-upgrade/doctools-release-image"),
    import("./rendition-trigger"),
  ]);
  return { startReconciler: startDoctoolsReleaseImageReconciler, requestBackfill: createDebouncedBackfillRequest({}) };
}

export async function startDocumentEngineOnBoot(deps?: BootDeps): Promise<void> {
  const { startReconciler, requestBackfill } = deps ?? (await productionDeps());
  requestBackfill("portal-start");
  await startReconciler({
    onOutcome: (result) => {
      if (result.outcome === "resolved" || result.outcome === "built-locally") requestBackfill("release-change");
    },
  });
}
