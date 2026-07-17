import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { CARE_INTAKE_GRANT_OPERATIONS } from "@/lib/healthcare/care-intake-access";
import { authorizeAndIssueCareIntakeResumeGrant } from "@/lib/healthcare/care-intake-api-repository";
import { resolvePrincipalRecordIdForSessionIdentity } from "@/lib/identity/principal-linking";

const IssueGrantBody = z.object({
  organizationId: z.string().min(1).max(160),
  patientProfileId: z.string().min(1).max(160),
  patientPrincipalId: z.string().min(1).max(160),
  permittedOperations: z
    .array(z.enum(CARE_INTAKE_GRANT_OPERATIONS))
    .min(1)
    .transform((values) => [...new Set(values)]),
  expiresAt: z.coerce.date(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ packetId: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);
    const actorPrincipalId = await resolvePrincipalRecordIdForSessionIdentity({
      type: user.type,
      id: user.id,
    });
    if (!actorPrincipalId) {
      throw apiError("PRINCIPAL_REQUIRED", "A linked principal identity is required", 403);
    }
    const parsed = IssueGrantBody.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      throw apiError("INVALID_REQUEST", "Invalid intake grant request", 400);
    }
    const now = Date.now();
    if (
      parsed.data.expiresAt.getTime() <= now
      || parsed.data.expiresAt.getTime() > now + 24 * 60 * 60 * 1000
    ) {
      throw apiError(
        "INVALID_EXPIRY",
        "Intake grant expiry must be within the next 24 hours",
        400,
      );
    }
    const { packetId } = await params;
    const grant = await authorizeAndIssueCareIntakeResumeGrant({
      ...parsed.data,
      packetId,
      actorPrincipalId,
    });
    return apiSuccess(grant, 201);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (
      error instanceof Error
      && error.message === "Patient authority denied care intake access"
    ) {
      return apiError("PATIENT_AUTHORITY_DENIED", "Patient authority denied", 403).toResponse();
    }
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
