"use server";

// EP-DATA-ARCH Phase 6 (BI-8E274CD3): on-demand trigger for the data-model
// mirror — the "callable even here" path. Runs the same deterministic
// reconcile + steward pass the nightly schedule runs.
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { runDataModelMirror } from "@/lib/ea/run-data-model-mirror";

export type RefreshDataArchitectureResult =
  | { ok: true; status: string; created: number; updated: number; removed: number; stewardFindings: number }
  | { ok: false; error: string };

export async function refreshDataArchitecture(): Promise<RefreshDataArchitectureResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Not authorized." };
  }

  try {
    const result = await runDataModelMirror();
    revalidatePath("/ea/data-model");
    return {
      ok: true,
      status: result.mirror.status,
      created: result.mirror.summary.created,
      updated: result.mirror.summary.updated,
      removed: result.mirror.summary.removed,
      stewardFindings: result.steward.created + result.steward.updated,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Mirror run failed." };
  }
}
