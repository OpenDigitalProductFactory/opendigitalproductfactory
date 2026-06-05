import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { captureBusinessDocument } from "@/lib/onboarding/capture-business-document";
import { enrichOrgCorpus } from "@/lib/wiki/enrich-org-corpus";
import { createProductionInference } from "@/lib/wiki/inference-adapter";

export const runtime = "nodejs";

// Capture a business plan / key document uploaded during onboarding into the
// Document DMS (org-scoped), then index its text into the org WWWD corpus via
// the enrichment pipeline (BI-7C9D6198). Per the founder's draft-by-default
// decision (BI-1378), document-derived material (`trust: "derived"`) lands as a
// draft for review — it never auto-promotes.
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

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const titleRaw = formData.get("title");
  const title = typeof titleRaw === "string" && titleRaw.trim().length > 0 ? titleRaw : null;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await captureBusinessDocument(
      {
        organizationId: org.id,
        fileName: file.name,
        mimeType: file.type,
        buffer,
        title,
      },
      {
        // Index the captured document into the org WWWD corpus. Fire-and-forget
        // so the upload response isn't blocked on multi-pass LLM extraction; the
        // portal is a long-lived process. BI-741B6329 will move this onto the
        // durable enrichment queue with retries. Fail-open: the document is
        // already safely stored in the DMS regardless of enrichment outcome.
        enrich: async ({ organizationId, documentId, title: docTitle, text }) => {
          void enrichOrgCorpus({
            organizationId,
            text,
            title: docTitle,
            provenance: { sourceType: "document", sourceRef: { documentId } },
            trust: "derived",
            infer: createProductionInference({ taskType: "wiki_proposal" }),
          }).catch((e) =>
            console.warn("[business-document] corpus enrichment failed (fail-open):", e),
          );
        },
      },
    );
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Capture failed" },
      { status: 400 },
    );
  }
}
