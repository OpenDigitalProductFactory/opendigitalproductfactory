import type { ProductDirectionSection } from "@/lib/product-management/product-direction-view";
import { DirectionEvidenceSection } from "./DirectionEvidenceSection";

export function EvidenceDeltaList(props: {
  section: ProductDirectionSection;
  previewCount: number;
}) {
  return (
    <DirectionEvidenceSection
      {...props}
      emptyTitle="No changed evidence yet"
      emptyDescription="Reviewed research and delivery changes appear here when they are explicitly linked to this scope."
    />
  );
}
