import { NextResponse, type NextRequest } from "next/server";

import { resolveFederationLinkAuth } from "@/lib/auth/federation-link-token";
import { persistHiveResult } from "@/lib/hive/result-store";

const ERROR_STATUS: Record<string, number> = {
  missing_authorization: 401,
  invalid_scheme: 401,
  invalid_token_format: 401,
  token_not_found: 401,
  link_not_trusted: 403,
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 48 * 1024) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }
  const authz = await resolveFederationLinkAuth(request.headers.get("authorization"));
  if (!authz.ok) {
    return NextResponse.json({ ok: false, error: authz.error }, { status: ERROR_STATUS[authz.error] ?? 401 });
  }
  if (authz.role !== "channel-upstream") {
    return NextResponse.json({ ok: false, error: "founder_channel_required" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const result = await persistHiveResult(body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "invalid_result_bundle", violations: result.violations }, { status: 422 });
  }
  return NextResponse.json(result, { status: result.action === "created" ? 202 : 200 });
}
