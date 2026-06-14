"use server";

// Parity Engine: on-demand trigger for the SysML projection reconcile — the
// "refresh now" path. Runs the same deterministic reconcile (MCP tool authority +
// AI coworker workforce) the nightly schedule runs, so an operator/agent can
// refresh the live projections immediately after a change instead of waiting for
// the 04:00 UTC pass. Mirrors refreshDataArchitecture.
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { reconcileSysmlProjections } from "@/lib/ea/reconcile-sysml-projections";

type DomainSummary = { status: string; created: number; updated: number; removed: number };

export type RefreshSysmlProjectionsResult =
  | { ok: true; mcpAuthority: DomainSummary & { toolCount: number; grantCount: number }; coworkerAuthority: DomainSummary }
  | { ok: false; error: string };

export async function refreshSysmlProjections(): Promise<RefreshSysmlProjectionsResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Not authorized." };
  }

  try {
    const result = await reconcileSysmlProjections();
    revalidatePath("/ea");
    return {
      ok: true,
      mcpAuthority: {
        status: result.mcpAuthority.status,
        created: result.mcpAuthority.created,
        updated: result.mcpAuthority.updated,
        removed: result.mcpAuthority.removed,
        toolCount: result.mcpAuthority.toolCount,
        grantCount: result.mcpAuthority.grantCount,
      },
      coworkerAuthority: {
        status: result.coworkerAuthority.status,
        created: result.coworkerAuthority.created,
        updated: result.coworkerAuthority.updated,
        removed: result.coworkerAuthority.removed,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Projection reconcile failed." };
  }
}
