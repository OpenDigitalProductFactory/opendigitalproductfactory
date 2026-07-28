import { DirectionPhaseUnavailable } from "@/components/product/direction/DirectionPhaseUnavailable";

export default async function ProductIntelligencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <DirectionPhaseUnavailable
      title="Product intelligence is not active yet"
      description="Phase 7 will add reviewed, product-scoped research and scheduling. The Direction brief already shows any explicitly linked evidence available today."
      briefHref={`/portfolio/product/${id}/direction`}
    />
  );
}
