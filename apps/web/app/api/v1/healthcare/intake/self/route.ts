import { apiError } from "@/lib/api/error";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { apiSuccess } from "@/lib/api/response";
import { resolveCarePortalIdentity } from "@/lib/healthcare/care-portal-session";
import { listPatientCareTasks } from "@/lib/healthcare/care-intake-portal-repository";

export async function GET(request: Request) {
  try {
    const { user } = await authenticateRequest(request);
    const identity = await resolveCarePortalIdentity(user);
    if (!identity) {
      return apiError("PATIENT_IDENTITY_REQUIRED", "A linked patient identity is required", 403).toResponse();
    }
    return apiSuccess(await listPatientCareTasks(identity));
  } catch (error) {
    if (error && typeof error === "object" && "toResponse" in error) {
      return (error as { toResponse(): Response }).toResponse();
    }
    return apiError("INTERNAL_ERROR", "An unexpected error occurred", 500).toResponse();
  }
}
