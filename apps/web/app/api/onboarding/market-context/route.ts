import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import {
  captureMarketContext,
  type MarketContextAnswers,
} from "@/lib/onboarding/capture-market-context";
import { enrichOrgCorpus } from "@/lib/wiki/enrich-org-corpus";
import { createProductionInference } from "@/lib/wiki/inference-adapter";

export const runtime = "nodejs";

// Capture market/scope context (competitive landscape, market size, etc.) and
// index it into the org WWWD corpus as first-party narrative. Per BI-1378 it
// lands as a draft for review.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return NextResponse.json(
      { error: "Organization not found. Complete account setup first." },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    competitiveLandscape?: string;
    marketSize?: string;
    differentiators?: string;
    positioning?: string;
  };
  const answers: MarketContextAnswers = {
    competitiveLandscape: body.competitiveLandscape ?? null,
    marketSize: body.marketSize ?? null,
    differentiators: body.differentiators ?? null,
    positioning: body.positioning ?? null,
  };

  const result = await captureMarketContext(
    { organizationId: org.id, answers },
    {
      // Fire-and-forget + fail-open, mirroring the business-document route.
      // BI-741B6329 will move enrichment onto the durable queue.
      enrich: async ({ organizationId, text, title }) => {
        void enrichOrgCorpus({
          organizationId,
          text,
          title,
          provenance: { sourceType: "data-entry", sourceRef: { field: "market-context" } },
          trust: "first-party",
          infer: createProductionInference({ taskType: "wiki_proposal" }),
        }).catch((e) =>
          console.warn("[market-context] corpus enrichment failed (fail-open):", e),
        );
      },
    },
  );

  return NextResponse.json({ success: true, ...result });
}
