import { NextResponse } from "next/server";

import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { getCareIntakePacketProjection } from "@/lib/healthcare/care-intake-api-repository";

function resumeToken(request: Request): string {
  const token = request.headers.get("x-intake-resume-token")?.trim();
  if (!token) throw apiError("INTAKE_TOKEN_REQUIRED", "Intake access token required", 401);
  return token;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ packetId: string }> },
) {
  try {
    const { packetId } = await params;
    const projection = await getCareIntakePacketProjection({
      packetId,
      token: resumeToken(request),
    });
    return apiSuccess(projection);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (
      error instanceof Error
      && [
        "Invalid care intake resume token",
        "Care intake access denied",
      ].includes(error.message)
    ) {
      return apiError("INTAKE_ACCESS_DENIED", "Intake access denied", 403).toResponse();
    }
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
