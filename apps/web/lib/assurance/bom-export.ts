import type { CycloneDxDocument } from "./bom-types";
import { createShareableCycloneDxBom } from "./bom-redaction";

export async function getLatestCycloneDxForProduct(
  db: {
    bomDocument: {
      findFirst(args: unknown): Promise<null | { raw: unknown; documentId: string }>;
    };
  },
  digitalProductId: string,
): Promise<null | { documentId: string; raw: CycloneDxDocument }> {
  const document = await db.bomDocument.findFirst({
    where: { digitalProductId },
    orderBy: { generatedAt: "desc" },
    select: { documentId: true, raw: true },
  });

  if (!document) return null;

  return {
    documentId: document.documentId,
    raw: createShareableCycloneDxBom(document.raw as CycloneDxDocument),
  };
}
