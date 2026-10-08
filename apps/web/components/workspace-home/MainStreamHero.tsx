import Link from "next/link";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

import { Surface } from "@/components/ui/Surface";
import { WorkroomFlowMap } from "@/components/workspace/workroom/WorkroomFlowMap";
import { AREA_SECTIONS } from "@/lib/navigation/portal-shell-sections";
import { loadPortfolioFlowView, loadShapeFlowView } from "@/lib/work-management/area-flow.server";
import { bottleneckSentence, heroShape, resolveHeroPortfolio, type PortfolioDecompositionLike } from "@/lib/work-management/main-stream-hero";
import { getWorkShape } from "@/lib/work-management/work-shapes";
import { formatDuration } from "@/lib/work-management/workroom-flow-map";

/**
 * L0 of the workroom flow view (EP-B70E718D F7): the archetype's main
 * value-delivery area, drawn live, with the one place work is waiting.
 * Renders nothing when the flow read fails; the rest of the home is unaffected.
 */
export async function MainStreamHero({ archetypeId }: { archetypeId: string | null }) {
  const flows = await loadPortfolioFlowView().catch(() => null);
  if (!flows) return null;
  const archetype = archetypeId ? ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId) : null;
  const decomposition = (archetype?.activationProfile as { portfolios?: PortfolioDecompositionLike } | undefined)?.portfolios;
  const role = resolveHeroPortfolio(decomposition, flows);
  const flow = flows.find((candidate) => candidate.key === role);
  const section = AREA_SECTIONS.find((candidate) => candidate.portfolioRole === role);
  if (!flow || !section) return null;
  const workHref = `/area/${section.key}?view=work`;
  const shape = heroShape(flow);
  const view = shape ? await loadShapeFlowView({ shapeKey: shape.shapeKey, portfolioRole: role }).catch(() => null) : null;
  const sentence = bottleneckSentence(flow, (key) => getWorkShape(key)?.title ?? key);

  return (
    <Surface as="section" aria-labelledby="main-stream-heading" className="my-6 space-y-3" rounded="xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="main-stream-heading" className="text-base font-semibold text-[var(--dpf-text)]">
          Main value stream · {section.label}
        </h2>
        <Link href={workHref} className="text-xs font-medium text-[var(--dpf-accent)] hover:underline">Open {section.label}</Link>
      </div>
      <p className={`text-sm ${sentence ? "font-medium text-[var(--dpf-warning)]" : "text-[var(--dpf-muted)]"}`}>
        {sentence ?? (flow.flowLoad > 0 ? "Nothing is waiting right now." : "No work is in flow here right now.")}
      </p>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div><dt className="text-xs text-[var(--dpf-muted)]">In flow now</dt><dd className="font-semibold tabular-nums text-[var(--dpf-text)]">{flow.flowLoad}</dd></div>
        <div><dt className="text-xs text-[var(--dpf-muted)]">Flow time (median)</dt><dd className="font-semibold tabular-nums text-[var(--dpf-text)]">{flow.flowTime.p50Ms == null ? "—" : formatDuration(flow.flowTime.p50Ms)}</dd></div>
        <div><dt className="text-xs text-[var(--dpf-muted)]">Flow efficiency</dt><dd className="font-semibold tabular-nums text-[var(--dpf-text)]">{flow.flowEfficiency.value == null ? "—" : `${Math.round(flow.flowEfficiency.value * 100)}%`}</dd></div>
        <div><dt className="text-xs text-[var(--dpf-muted)]">Finished per week</dt><dd className="font-semibold tabular-nums text-[var(--dpf-text)]">{flow.throughput.perWeek.toFixed(1)}</dd></div>
      </dl>
      {view ? (
        <WorkroomFlowMap model={view.model} stageHrefBase={`${workHref}&shape=${encodeURIComponent(view.model.shapeRef.split("@")[0]!)}`} />
      ) : null}
    </Surface>
  );
}
