import { NextResponse } from "next/server";

import { getSelfUpgradeStatus } from "@/lib/actions/promotions";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { resolveSelfUpgradePurposeScenario } from "@/lib/self-upgrade/purpose-scenario";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_operations",
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = await getSelfUpgradeStatus();
  return NextResponse.json(
    {
      schemaVersion: 1,
      routePath: "/ops/self-upgrade",
      stateKey: resolveSelfUpgradePurposeScenario(status),
      sourceRef: "apps/web/lib/self-upgrade/purpose-scenario.ts",
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
