// POST /api/v1/work-queue/:itemId/claim — claim a work item

import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { apiSuccess } from "@/lib/api/response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { user } = await authenticateRequest(request);
  const { itemId } = await params;

  const item = await prisma.workItem.update({
    where: { itemId, status: "queued" },
    data: {
      status: "assigned",
      assignedToType: "human",
      assignedToUserId: user.id,
      claimedAt: new Date(),
    },
  });

  return apiSuccess(item);
}
