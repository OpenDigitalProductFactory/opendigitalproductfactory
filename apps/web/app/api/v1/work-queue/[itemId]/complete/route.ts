// POST /api/v1/work-queue/:itemId/complete — complete a work item

import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { apiSuccess } from "@/lib/api/response";
import { inngest } from "@/lib/queue/inngest-client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  await authenticateRequest(request);
  const { itemId } = await params;

  const body = await request.json().catch(() => ({}));
  const evidence = body.evidence ?? null;

  const item = await prisma.workItem.update({
    where: { itemId },
    data: {
      status: "completed",
      evidence,
      completedAt: new Date(),
    },
  });

  await inngest.send({
    name: "cwq/item.completed",
    data: { workItemId: itemId, outcome: "success" },
  });

  return apiSuccess(item);
}
