import type { ProductDirectionSection } from "@/lib/product-management/product-direction-view";
import { DirectionEvidenceSection } from "./DirectionEvidenceSection";

export function NextCoworkerRuns(props: {
  section: ProductDirectionSection;
  previewCount: number;
}) {
  return (
    <DirectionEvidenceSection
      {...props}
      emptyTitle="No product-scoped runs scheduled"
      emptyDescription="Only schedules with a typed product association appear in this workspace."
    />
  );
}
