import { NextResponse, type NextRequest } from "next/server";
import { completeLinkedInOAuth } from "@/lib/marketing/channels/linkedin-personal-social/oauth";

export const dynamic = "force-dynamic";

const RESULT_PATH = "/platform/tools/integrations/linkedin-personal-social";

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`${RESULT_PATH}?oauth=error&reason=${encodeURIComponent(errorParam)}`, url.origin),
    );
  }

  if (!state || !code) {
    return NextResponse.redirect(
      new URL(`${RESULT_PATH}?oauth=error&reason=missing_state_or_code`, url.origin),
    );
  }

  const result = await completeLinkedInOAuth({ state, code });
  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`${RESULT_PATH}?oauth=error&reason=${encodeURIComponent(result.error)}`, url.origin),
    );
  }

  return NextResponse.redirect(
    new URL(`${RESULT_PATH}?oauth=success`, url.origin),
  );
}
