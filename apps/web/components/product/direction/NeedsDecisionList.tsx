import type { ProductDirectionSection } from "@/lib/product-management/product-direction-view";
import { DirectionEvidenceSection } from "./DirectionEvidenceSection";

export function NeedsDecisionList(props: {
  section: ProductDirectionSection;
  previewCount: number;
}) {
  return (
    <DirectionEvidenceSection
      {...props}
      emptyTitle="No demand decision is waiting"
      emptyDescription="New demand appears here when it needs shaping or a governed funding decision."
    />
  );
}
