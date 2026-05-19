import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { getMatrixByOrg } from "@/lib/actions/integration-coverage";
import { apiSuccess } from "@/lib/api/response";
import { apiErrorResponse } from "@/lib/api/error";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
  } catch {
    return apiErrorResponse("UNAUTHENTICATED", "Authentication required", 401);
  }

  // Single-org install: always fetch the one organization
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return apiErrorResponse("ORG_MISSING", "No organization found", 500);
  }

  return apiSuccess(await getMatrixByOrg(org.id));
}
