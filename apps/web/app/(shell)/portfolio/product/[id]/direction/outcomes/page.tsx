import { DirectionPhaseUnavailable } from "@/components/product/direction/DirectionPhaseUnavailable";

export default async function ProductOutcomesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <DirectionPhaseUnavailable
      title="Product outcomes are not active yet"
      description="Phase 9 will introduce typed objectives and observations. Until then, the brief reports outcome evidence as unavailable rather than showing invented zeroes."
      briefHref={`/portfolio/product/${id}/direction`}
    />
  );
}
