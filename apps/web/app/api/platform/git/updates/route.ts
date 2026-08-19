import { NextResponse } from "next/server";
import { handleGitHubWebhook } from "@/lib/build/git-promotion-intake";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const eventName = request.headers.get("x-github-event") ?? "unknown";
  const deliveryId = request.headers.get("x-github-delivery");
  const signature = request.headers.get("x-hub-signature-256");
  const secret = process.env.DPF_GIT_WEBHOOK_SECRET ?? process.env.GITHUB_WEBHOOK_SECRET ?? null;

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
    const status = message.includes("signature") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
