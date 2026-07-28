import type { ProductDirectionSection } from "@/lib/product-management/product-direction-view";
import { DirectionEvidenceSection } from "./DirectionEvidenceSection";

export function CurrentBets(props: {
  section: ProductDirectionSection;
  previewCount: number;
}) {
  return (
    <DirectionEvidenceSection
      {...props}
      emptyTitle="No funded bets yet"
      emptyDescription="Demand appears here only after it crosses the governed funding boundary or enters delivery."
    />
  );
}
