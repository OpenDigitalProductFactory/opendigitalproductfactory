import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadDeliveryTaskHubPage } from "@/lib/work-capsules/delivery-task-hub-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const cursor = new URL(request.url).searchParams.get("cursor");
  try {
    return Response.json(await loadDeliveryTaskHubPage(prisma, { cursor }));
  } catch (error) {
    if (error instanceof Error && /cursor/i.test(error.message)) {
      return Response.json({ error: "invalid_cursor" }, { status: 400 });
    }
    return Response.json({ error: "delivery_page_failed" }, { status: 500 });
  }
}
