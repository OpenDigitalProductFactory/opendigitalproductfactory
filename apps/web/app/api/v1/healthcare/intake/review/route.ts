import { z } from "zod";

import { requireCapability, requireEmployeeAuth } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { listCareIntakeReviewQueue } from "@/lib/healthcare/care-intake-review-repository";

const Query = z.object({
  organizationId: z.string().min(1).max(128),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(["assigned", "in-progress", "amended"]).array().optional(),
});

export async function GET(request: Request) {
  try {
    const { capabilities, authContext } = await requireEmployeeAuth(request);
    requireCapability(capabilities, "view_customer");
    if (!authContext.principalId) return apiError("PRINCIPAL_REQUIRED", "Relational principal required", 403).toResponse();
    const url = new URL(request.url);
    const parsed = Query.safeParse({
      organizationId: url.searchParams.get("organizationId"),
      limit: url.searchParams.get("limit") ?? undefined,
      status: url.searchParams.getAll("status").length ? url.searchParams.getAll("status") : undefined,
    });
    if (!parsed.success) return apiError("INVALID_REQUEST", "Invalid intake review query", 400).toResponse();
    return apiSuccess(await listCareIntakeReviewQueue({
      organizationId: parsed.data.organizationId,
      actorPrincipalId: authContext.principalId,
      limit: parsed.data.limit,
      statuses: parsed.data.status,
    }));
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return apiError("INTERNAL_ERROR", "An unexpected error occurred", 500).toResponse();
  }
}
