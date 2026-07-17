import { z } from "zod";

import { apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { saveCareIntakePartialResponse } from "@/lib/healthcare/care-intake-api-repository";

const SaveBody = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/),
  expectedVersion: z.number().int().positive().nullable(),
  sourceMode: z.enum([
    "patient-mobile", "patient-web", "proxy-mobile", "proxy-web",
    "kiosk", "staff-assisted", "paper-transcribed",
  ]),
  answers: z.record(z.string(), z.unknown()),
  dataCategories: z.record(z.string(), z.string().min(1)),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ packetId: string; formId: string }> },
) {
  const token = request.headers.get("x-intake-resume-token")?.trim();
  if (!token) return apiError("INTAKE_TOKEN_REQUIRED", "Intake access token required", 401).toResponse();
  const parsed = SaveBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_REQUEST", "Invalid intake response", 400).toResponse();
  try {
    const { packetId, formId } = await params;
    return apiSuccess(await saveCareIntakePartialResponse({
      ...parsed.data,
      packetId,
      formId,
      token,
    }));
  } catch (error) {
    if (!(error instanceof Error)) {
      return apiError("INTERNAL_ERROR", "An unexpected error occurred", 500).toResponse();
    }
    if (error.message === "stale-intake-response-version" || error.message === "stale-intake-packet-version") {
      return apiError("STALE_INTAKE_VERSION", "The intake response changed; refresh before saving", 409).toResponse();
    }
    if (error.message.startsWith("data-category-not-authorized:")) {
      return apiError("MINIMUM_NECESSARY_VIOLATION", "The response contains data outside this intake assignment", 422).toResponse();
    }
    if (
      error.message.includes("access denied")
      || error.message.includes("resume token")
      || error.message.includes("not assigned")
    ) {
      return apiError("INTAKE_ACCESS_DENIED", "Intake access denied", 403).toResponse();
    }
    return apiError("INTERNAL_ERROR", "An unexpected error occurred", 500).toResponse();
  }
}
