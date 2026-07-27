"use server";

// Parity Engine: on-demand trigger for the SysML projection reconcile — the
// "refresh now" path. Runs the same deterministic reconcile (MCP tool authority +
// AI coworker workforce) the nightly schedule runs, so an operator/agent can
// refresh the live projections immediately after a change instead of waiting for
// the 04:00 UTC pass. Mirrors refreshDataArchitecture.
import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/actions/shared/guards";
import { reconcileSysmlProjections } from "@/lib/ea/reconcile-sysml-projections";

type DomainSummary = { status: string; created: number; updated: number; removed: number };

export type RefreshSysmlProjectionsResult =
  | {
      ok: true;
      mcpAuthority: DomainSummary & { toolCount: number; grantCount: number };
      coworkerAuthority: DomainSummary;
      aiRoutingArchitecture: DomainSummary & {
        crossLayerLinked: number;
        crossLayerUnresolved: number;
      };
    }
  | { ok: false; error: string };

export async function refreshSysmlProjections(): Promise<RefreshSysmlProjectionsResult> {
  await requireCapability("manage_ea_model");

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
      aiRoutingArchitecture: {
        status: result.aiRoutingArchitecture.status,
        created: result.aiRoutingArchitecture.created,
        updated: result.aiRoutingArchitecture.updated,
        removed: result.aiRoutingArchitecture.removed,
        crossLayerLinked: result.aiRoutingArchitecture.crossLayerLinked ?? 0,
        crossLayerUnresolved: result.aiRoutingArchitecture.crossLayerUnresolved ?? 0,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Projection reconcile failed." };
  }
}
