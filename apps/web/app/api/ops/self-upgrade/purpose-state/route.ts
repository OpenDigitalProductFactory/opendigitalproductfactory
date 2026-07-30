import { NextResponse } from "next/server";

import { getSelfUpgradeStatus } from "@/lib/actions/promotions";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { resolveSelfUpgradePurposeOracle } from "@/lib/ux-budget/oracles/self-upgrade";

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

  const statusResult = await getSelfUpgradeStatus()
    .then((value) => ({ value, statusAvailable: true }))
    .catch(() => ({
      value: {
        statusAvailable: false,
        enabled: false,
        isFresh: true,
        targetSha: null,
        latestRun: null,
      },
      statusAvailable: false,
    }));
  return NextResponse.json(
    {
      schemaVersion: 1,
      routePath: "/ops/self-upgrade",
      stateKey: resolveSelfUpgradePurposeOracle(statusResult.value),
      oracleKey: "self-upgrade-status",
      sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      statusAvailable: statusResult.statusAvailable,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
