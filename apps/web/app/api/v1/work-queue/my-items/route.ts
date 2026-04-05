// GET /api/v1/work-queue/my-items — personal queue for current user

import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { apiSuccess } from "@/lib/api/response";

export async function GET(request: Request) {
  const { user } = await authenticateRequest(request);

  const items = await prisma.workItem.findMany({
    where: {
      OR: [
        { assignedToUserId: user.id },
        { status: "queued", assignedToUserId: null },
      ],
      status: { notIn: ["completed", "cancelled"] },
    },
    orderBy: [{ urgency: "asc" }, { createdAt: "asc" }],
    take: 100,
  });

  return apiSuccess(items);
}
