import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import { DecisionCanvas } from "@/components/decision-perspective/DecisionCanvas";
import { MaterialBacklinksPanel } from "@/components/decision-perspective/MaterialBacklinksPanel";
import { fromDecisionInteractionRow, projectDecisionCanvas, type DecisionCanvasSource } from "@/lib/decision-perspective/canvas";
import { getMaterialBacklinks, type MaterialBacklinksDbClient } from "@/lib/decision-perspective/material-backlinks";

type PageProps = {
  params: Promise<{ interactionId: string }>;
  searchParams?: Promise<{ materialId?: string }>;
};

function sourceRows(
  interactionId: string,
  sources: Array<{ materialId: string; sourceType: string; summary: string; effectiveWeight: number }>,
): DecisionCanvasSource[] {
  return sources.map((source) => ({
    id: source.materialId,
    label: source.summary || source.materialId,
    sourceType: source.sourceType,
    summary: source.summary || "Material used by the decision.",
    weight: source.effectiveWeight,
    href: `/platform/ai/decisions/${encodeURIComponent(interactionId)}?materialId=${encodeURIComponent(source.materialId)}`,
  }));
}

export default async function DecisionInteractionPage({ params, searchParams }: PageProps) {
  const [{ interactionId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({} as { materialId?: string }),
  ]);

  const row = await prisma.decisionInteraction.findUnique({
    where: { interactionId },
    include: {
      profile: {
        select: {
          profileId: true,
          name: true,
          kind: true,
        },
      },
    },
  });

  if (!row) notFound();

  const canvasInput = fromDecisionInteractionRow(row);
  const evaluation = canvasInput.evaluation;
  const materialId = resolvedSearchParams.materialId ?? evaluation.sources[0]?.materialId;
  const backlinks = await getMaterialBacklinks({
    db: prisma as unknown as MaterialBacklinksDbClient,
    target: materialId
      ? { materialId, profileId: row.profileId }
      : { profileId: row.profileId },
  });
  const viewModel = projectDecisionCanvas({
    ...canvasInput,
    sources: sourceRows(row.interactionId, evaluation.sources),
  });

  return (
    <main className="space-y-6">
      <DecisionCanvas viewModel={viewModel} />
      <MaterialBacklinksPanel result={backlinks} />
    </main>
  );
}
