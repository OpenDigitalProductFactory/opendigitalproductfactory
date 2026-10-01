import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/error";
import { GitIntakeEmitError, handleGitHubWebhook } from "@/lib/build/git-promotion-intake";

/**
 * The signing secret, or null when none is configured.
 *
 * Compose passes `DPF_GIT_WEBHOOK_SECRET: ${DPF_GIT_WEBHOOK_SECRET:-}`, so an
 * install whose .env lacks the key sees an EMPTY string, not an unset
 * variable. Treat blank as absent so the legacy name still applies and the
 * production refusal below still fires.
 */
function configuredSecret(): string | null {
  const primary = process.env.DPF_GIT_WEBHOOK_SECRET?.trim();
  if (primary) return primary;
  const legacy = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  return legacy ? legacy : null;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const eventName = request.headers.get("x-github-event") ?? "unknown";
  const deliveryId = request.headers.get("x-github-delivery");
  const signature = request.headers.get("x-hub-signature-256");
  const secret = configuredSecret();

  if (!deliveryId) {
    return NextResponse.json({ error: "Missing x-github-delivery header" }, { status: 400 });
  }

  if (!secret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Git webhook secret is not configured" }, { status: 503 });
  }

  try {
    const candidate = await handleGitHubWebhook({
      rawBody,
      eventName,
      deliveryId,
      signature,
      secret,
    });
    return NextResponse.json(candidate, { status: candidate.duplicate ? 200 : 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook intake failed";
    // Recorded but not announced. A server-side failure, so GitHub marks the
    // delivery failed and a redelivery re-sends what was owed.
    if (err instanceof GitIntakeEmitError) {
      return apiErrorResponse("GIT_UPDATE_NOT_ANNOUNCED", message, 503);
    }
    const status = message.includes("signature") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
