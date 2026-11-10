// @exposure authenticated
// GET /api/v1/work-items/:itemId/sites — the customer sites this job can be at,
// with whether each has a confirmed location (BI-C318C227 §2.2). Assigned staff only.

import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { apiError, toRouteErrorResponse } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { resolveWorkItemSites } from "@/lib/api/work-item-site-resolution";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);
    const { itemId } = await params;
    const row = await prisma.workItem.findUnique({
      where: { itemId },
      select: { assignedToUserId: true, sourceType: true, sourceId: true },
    });
    if (!row) throw apiError("NOT_FOUND", "Work item not found", 404);
    if (row.assignedToUserId !== user.id) throw apiError("FORBIDDEN", "Work item is not assigned to you", 403);
    const sites = await resolveWorkItemSites({ sourceType: row.sourceType, sourceId: row.sourceId });
    return apiSuccess({ sites });
  } catch (e) {
    return toRouteErrorResponse(e);
  }
}
