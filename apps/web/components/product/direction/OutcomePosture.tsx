import type { ProductDirectionSection } from "@/lib/product-management/product-direction-view";
import { DirectionEvidenceSection } from "./DirectionEvidenceSection";

export function OutcomePosture(props: {
  section: ProductDirectionSection;
  previewCount: number;
}) {
  return (
    <DirectionEvidenceSection
      {...props}
      emptyTitle="No outcome evidence yet"
      emptyDescription="Outcome posture appears after a typed objective and observation have been recorded."
    />
  );
}
