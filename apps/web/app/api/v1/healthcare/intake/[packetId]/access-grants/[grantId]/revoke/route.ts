import { z } from "zod";

import { requireCapability, requireEmployeeAuth } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { revokeCareIntakeAccessGrant } from "@/lib/healthcare/care-intake-review-repository";

const RevokeBody = z.object({
  organizationId: z.string().min(1).max(128),
  reason: z.string().trim().min(1).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ packetId: string; grantId: string }> },
) {
  try {
    const { capabilities, authContext } = await requireEmployeeAuth(request);
    requireCapability(capabilities, "operate_customer");
    if (!authContext.principalId) return apiError("PRINCIPAL_REQUIRED", "Relational principal required", 403).toResponse();
    const parsed = RevokeBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("INVALID_REQUEST", "Invalid grant revocation", 400).toResponse();
    const { packetId, grantId } = await params;
    return apiSuccess(await revokeCareIntakeAccessGrant({
      ...parsed.data,
      packetId,
      grantId,
      actorPrincipalId: authContext.principalId,
    }));
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof Error) {
      if (error.message === "stale-intake-grant") {
        return apiError("STALE_INTAKE_GRANT", "The intake grant changed; refresh before revoking", 409).toResponse();
      }
      if (error.message.includes("not found")) {
        return apiError("INTAKE_GRANT_NOT_FOUND", "Active intake grant not found", 404).toResponse();
      }
    }
    return apiError("INTERNAL_ERROR", "An unexpected error occurred", 500).toResponse();
  }
}
