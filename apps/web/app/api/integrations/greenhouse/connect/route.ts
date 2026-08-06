import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { apiErrorResponse } from "@/lib/api/error";
import { connectGreenhouse } from "@/lib/integrate/greenhouse/connect-action";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }
  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    return apiErrorResponse("FORBIDDEN", "Forbidden", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse("INVALID_BODY", "invalid JSON body", 400);
  }

  const result = await connectGreenhouse(body);

  if (result.ok) {
    return NextResponse.json({ status: result.status }, { status: 200 });
  }

  return apiErrorResponse("CONNECT_FAILED", result.error, result.statusCode);
}
