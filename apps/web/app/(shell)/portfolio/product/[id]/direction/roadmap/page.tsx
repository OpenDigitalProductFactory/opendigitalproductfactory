import { DirectionPhaseUnavailable } from "@/components/product/direction/DirectionPhaseUnavailable";

export default async function ProductRoadmapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <DirectionPhaseUnavailable
      title="The evidence-derived roadmap is not active yet"
      description="Phase 11 will derive this view from funded demand, objectives, delivery state, and dependencies without inventing dates."
      briefHref={`/portfolio/product/${id}/direction`}
    />
  );
}
