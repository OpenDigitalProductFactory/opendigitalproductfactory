import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { getLatestCycloneDxForProduct } from "@/lib/assurance/bom-export";

type Context = {
  params: Promise<{ id: string }>;
};

// "Shareable" here is the redaction *profile* (createShareableCycloneDxBom strips
// internal paths, user ids, secrets, and route context) so the downloaded artifact
// is safe for an authenticated operator to forward to customers/auditors. It is NOT
// an anonymous public share link: the only UI that links here lives under the
// (shell) layout, which already requires an authenticated, non-customer session.
// API route handlers do not inherit that layout's auth, so the guard is enforced
// explicitly below. If a genuinely public/customer-facing SBOM share is ever wanted,
// it should be a separate route keyed by an unguessable share token, not the
// guessable product id.
export async function GET(_request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const bom = await getLatestCycloneDxForProduct(prisma, id);

  if (!bom) {
    return NextResponse.json({ error: "No BOM found" }, { status: 404 });
  }

  return new NextResponse(JSON.stringify(bom.raw, null, 2), {
    headers: {
      "content-type": "application/vnd.cyclonedx+json; charset=utf-8",
      "content-disposition": `attachment; filename="${bom.documentId}.shareable.cdx.json"`,
    },
  });
}
