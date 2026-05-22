import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { getLatestCycloneDxForProduct } from "@/lib/assurance/bom-export";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: Context) {
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
