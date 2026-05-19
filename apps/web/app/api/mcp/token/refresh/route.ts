import { NextResponse } from "next/server";

import { acknowledgeMcpTokenRefresh } from "@/lib/auth/mcp-api-token";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const token =
    typeof body === "object" && body != null && "token" in body
      ? String((body as { token?: unknown }).token ?? "").trim()
      : "";
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "missing_token" },
      { status: 400 },
    );
  }

  const result = await acknowledgeMcpTokenRefresh(token);
  if (!result.ok) {
    return NextResponse.json(result, { status: 401 });
  }
  return NextResponse.json(result);
}

