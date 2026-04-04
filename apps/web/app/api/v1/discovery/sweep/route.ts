import { executeBootstrapDiscovery, prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptSecret } from "@/lib/govern/credential-crypto";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const summary = await executeBootstrapDiscovery(prisma as never, {
      trigger: "manual_api",
      decrypt: decryptSecret,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Discovery sweep failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
