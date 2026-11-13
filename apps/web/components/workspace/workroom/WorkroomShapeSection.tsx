"use client";

import { useMemo } from "react";
import type { ShapeGraph } from "@/lib/work-management/shape-projection";
import type { WorkroomView } from "@/lib/work-management/room-types";
import type { WorkroomFlowMapModel } from "@/lib/work-management/workroom-flow-map";
import { createWorkroomProcessSnapshot, type WorkroomProcessSnapshot, type WorkroomRefreshTarget } from "@/lib/work-management/workroom-process-snapshot";
import { ButtonLink } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/use-t";
import { ShapeViewToggle, type WorkroomViewMode } from "./ShapeViewToggle";
import { WorkroomFlowMap } from "./WorkroomFlowMap";
import { WorkroomShape } from "./WorkroomShape";
import { useWorkroomProcessRefresh } from "./useWorkroomProcessRefresh";

/** A manual refresh replaces definition, process and companion map together. */
export function WorkroomShapeSection({ graph, room, flowMap = null, mode, onModeChange, refreshTarget, processSnapshot }: {
  graph: ShapeGraph; room: WorkroomView; flowMap?: WorkroomFlowMapModel | null;
  mode: WorkroomViewMode; onModeChange: (next: WorkroomViewMode) => void;
  refreshTarget?: WorkroomRefreshTarget; processSnapshot?: WorkroomProcessSnapshot;
}) {
  const t = useT("workrooms");
  const initial = useMemo(() => processSnapshot ?? createWorkroomProcessSnapshot(refreshTarget ?? { caseKey: "", workroomRowId: "" }, graph,
    { definition: room.identity.definition, mode: room.mode, activeCycle: Boolean(room.currentCycle) }, flowMap), [processSnapshot, refreshTarget, graph, room.identity.definition, room.mode, room.currentCycle, flowMap]);
  const read = useWorkroomProcessRefresh(initial, refreshTarget);
  const { snapshot } = read;
  const definition = snapshot.context.definition;
  const occurrenceLabel = snapshot.context.mode === "standing" ? snapshot.context.activeCycle ? "This room · Active cycle" : "This room · Standing stream" : "This room · Single occurrence";
  if (read.protectedContentHidden) return <section className="mt-4 space-y-3" aria-live="polite">
    <p>{t(`refresh.${read.issue!}`)}</p>
    <ButtonLink variant="secondary" href={read.issue === "sessionRequired" ? "/login" : "/workspace/my-queue"}>
      {t(read.issue === "sessionRequired" ? "refresh.signIn" : "refresh.openQueue")}
    </ButtonLink>
  </section>;
  return <div className="mt-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">{"Room definition"}</p>
        <p className="mt-1 text-sm font-medium text-[var(--dpf-text)]">{definition ? `${definition.label} · Definition v${definition.version}` : "Definition not resolved"}</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">{occurrenceLabel}</p>
      </div>
      <ShapeViewToggle mode={mode} onChange={onModeChange} />
    </div>
    {mode === "shape" && snapshot.flowMap ? <div className="mt-4"><WorkroomFlowMap model={snapshot.flowMap} /></div> : null}
    {mode === "shape" ? <WorkroomShape graph={snapshot.graph} refresh={refreshTarget ? { onRefresh: read.refresh, pending: read.pending, notice: read.issue ? t(`refresh.${read.issue}`) : null } : undefined} /> : null}
  </div>;
}
