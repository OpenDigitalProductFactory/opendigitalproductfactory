import { requireCapability, requireEmployeeAuth } from "@/lib/api/auth-middleware";
import { apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { EvidenceDecisionBody, careIntakeEvidenceError } from "@/lib/healthcare/care-intake-evidence-api";
import { decideCareConsentAttestation } from "@/lib/healthcare/care-intake-evidence-repository";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ packetId: string; attestationId: string }> },
) {
  try {
    const { capabilities, authContext } = await requireEmployeeAuth(request);
    requireCapability(capabilities, "operate_customer");
    if (!authContext.principalId) return apiError("PRINCIPAL_REQUIRED", "Relational principal required", 403).toResponse();
    const parsed = EvidenceDecisionBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("INVALID_REQUEST", "Invalid consent attestation decision", 400).toResponse();
    const { packetId, attestationId } = await params;
    return apiSuccess(await decideCareConsentAttestation({
      ...parsed.data, packetId, attestationId, actorPrincipalId: authContext.principalId,
    }));
  } catch (error) {
    return careIntakeEvidenceError(error);
  }
}
