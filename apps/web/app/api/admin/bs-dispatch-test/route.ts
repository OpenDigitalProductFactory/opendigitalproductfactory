// Temporary admin trigger for BS autonomous pipeline testing.
// Accepts DPF_MCP_BEARER_TOKEN as Authorization header (contributor-only dev surface).
import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { createHash } from "node:crypto";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const rawToken = authHeader.replace("Bearer ", "").trim();

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const tokenRow = await prisma.mcpApiToken.findFirst({ where: { tokenHash } });
  if (!tokenRow) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const buildId = body?.buildId;
  const resetPlan = body?.resetPlan === true;
  const dispatchPhase = body?.phase as "plan" | "build" | undefined;
  if (!buildId) return NextResponse.json({ error: "buildId required" }, { status: 400 });

  const userId = tokenRow.userId;

  if (resetPlan) {
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        buildPlan: null as unknown as import("@dpf/db").Prisma.InputJsonValue,
        planReview: null as unknown as import("@dpf/db").Prisma.InputJsonValue,
      },
    });
  }

  if (dispatchPhase === "build") {
    // BI-EB4BB4A0: the build is dispatched through its Workroom outbox, once, like every approved plan.
    const { requestBuildDispatch } = await import("@/lib/build/build-dispatch-effect.server");
    const result = await requestBuildDispatch({ buildId, userId });
    return NextResponse.json(result, { status: result.kind === "owed" ? 202 : 409 });
  }

  // Default: dispatch plan generation
  const { dispatchPlanForApprovedBuild } = await import("@/lib/build/plan-on-approval");
  const result = await dispatchPlanForApprovedBuild({ buildId, userId });
  return NextResponse.json(result);
}
