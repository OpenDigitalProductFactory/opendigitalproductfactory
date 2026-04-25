import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { bootstrapAuthorityBindings } from "@/lib/authority/bootstrap-bindings";
import { can } from "@/lib/permissions";

async function requireEditor() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_platform",
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

export async function POST(request: Request) {
  const denied = await requireEditor();
  if (denied) {
    return denied;
  }

  let writeMode: "dry-run" | "commit" = "dry-run";

  try {
    const payload = (await request.json().catch(() => null)) as { writeMode?: unknown } | null;
    if (payload?.writeMode === "commit") {
      writeMode = "commit";
    }
  } catch {
    // Keep dry-run default if the payload is absent or malformed.
  }

  const report = await bootstrapAuthorityBindings({ writeMode });
  return NextResponse.json({ report });
}
