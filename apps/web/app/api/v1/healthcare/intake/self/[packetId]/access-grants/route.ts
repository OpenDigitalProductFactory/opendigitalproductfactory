import { apiError } from "@/lib/api/error";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { apiSuccess } from "@/lib/api/response";
import { resolveCarePortalIdentity } from "@/lib/healthcare/care-portal-session";
import { issuePatientCareIntakeGrant } from "@/lib/healthcare/care-intake-portal-repository";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ packetId: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);
    const identity = await resolveCarePortalIdentity(user);
    if (!identity) {
      return apiError("PATIENT_IDENTITY_REQUIRED", "A linked patient identity is required", 403).toResponse();
    }
    const { packetId } = await params;
    return apiSuccess(await issuePatientCareIntakeGrant({ ...identity, packetId }), 201);
  } catch (error) {
    if (error && typeof error === "object" && "toResponse" in error) {
      return (error as { toResponse(): Response }).toResponse();
    }
    if (error instanceof Error) {
      if (error.message === "Patient portal identity is not linked") {
        return apiError("PATIENT_IDENTITY_REQUIRED", error.message, 403).toResponse();
      }
      if (error.message === "Patient authority denied care intake access") {
        return apiError("PATIENT_AUTHORITY_DENIED", "Patient authority denied", 403).toResponse();
      }
      if (error.message === "Care intake packet not found") {
        return apiError("INTAKE_NOT_FOUND", "Care intake task not found", 404).toResponse();
      }
    }
    return apiError("INTERNAL_ERROR", "An unexpected error occurred", 500).toResponse();
  }
}
