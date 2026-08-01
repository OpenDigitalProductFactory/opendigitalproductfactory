import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/error";
import { auth } from "@/lib/auth";
import {
  expandGraphNeighbourhood,
  getGraphCensus,
  getGraphNodeDetail,
} from "@/lib/graph/explorer-queries";
import { parseGraphPurposeContext } from "@/lib/graph/explorer-purpose-context";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request?: Request): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user) {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }
  if (
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_admin",
    )
  ) {
    return apiErrorResponse("FORBIDDEN", "Forbidden", 403);
  }

  const census = await getGraphCensus();
  const url = new URL(
    request?.url ?? "http://localhost/api/admin/graph-explorer/purpose-state",
  );
  const { seedKeys, inspectedKey, depth } = parseGraphPurposeContext(
    url.searchParams,
  );
  let stateKey = census.nodeTotal === 0 ? "empty-corpus" : "no-starting-point";
  let sourceRef = "apps/web/lib/graph/explorer-queries.ts#getGraphCensus";

  if (census.nodeTotal > 0 && seedKeys.length > 0 && inspectedKey) {
    const [subgraph, detail] = await Promise.all([
      expandGraphNeighbourhood({ seedKeys, depth }),
      getGraphNodeDetail(inspectedKey),
    ]);
    if (detail && subgraph.nodes.some((node) => node.key === inspectedKey)) {
      stateKey = "neighbourhood-drawn";
      sourceRef =
        "apps/web/lib/graph/explorer-queries.ts#expandGraphNeighbourhood";
    }
  }
  return NextResponse.json(
    {
      schemaVersion: 1,
      routePath: "/admin/graph-explorer",
      stateKey,
      oracleKey: "route-owned-read-model",
      sourceRef,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
