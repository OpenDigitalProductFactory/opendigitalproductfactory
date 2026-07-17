import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { submitCareIntakePacket } from "@/lib/healthcare/care-intake-api-repository";

const SubmitBody = z.object({
  expectedVersion: z.number().int().positive(),
  sourceMode: z.enum([
    "patient-mobile", "patient-web", "proxy-mobile", "proxy-web",
    "kiosk", "staff-assisted", "paper-transcribed",
  ]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ packetId: string }> },
) {
  const token = request.headers.get("x-intake-resume-token")?.trim();
  if (!token) return apiError("INTAKE_TOKEN_REQUIRED", "Intake access token required", 401).toResponse();
  const parsed = SubmitBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_REQUEST", "Invalid intake submission", 400).toResponse();
  try {
    const { packetId } = await params;
    const result = await submitCareIntakePacket({ ...parsed.data, packetId, token });
    if (!result.ok) {
      return NextResponse.json(result, { status: 422 });
    }
    return apiSuccess(result);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "stale-intake-packet-version") {
        return apiError("STALE_INTAKE_VERSION", "The intake packet changed; refresh before submitting", 409).toResponse();
      }
      if (error.message.includes("access denied") || error.message.includes("resume token")) {
        return apiError("INTAKE_ACCESS_DENIED", "Intake access denied", 403).toResponse();
      }
    }
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "An unexpected error occurred" }, { status: 500 });
  }
}
