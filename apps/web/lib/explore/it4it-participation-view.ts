// apps/web/lib/explore/it4it-participation-view.ts
//
// Pure view-shaping for the IT4IT participation grid (EP-IT4IT-CONFORMANCE, BI-D51A5A4A).
// The IT4IT FC Participation Matrix (seeded as participationByColumn on each value-stream
// stage) says which functional components participate in which value stream. This collapses
// the 28 stages up to the 7 value streams and cross-tabs them against the 35 functional
// components, tinted by each component's coverage status. No IO — the cached query in
// ea-data.ts feeds it; the math is unit-tested here.

import type { CoverageStatus, It4itComponentCoverage } from "./reference-model-types";

export interface It4itStageParticipationRow {
  /** Value-stream name the stage belongs to. */
  stream: string;
  /** participationByColumn: component name -> "●" (participates) or null. */
  participation: Record<string, string | null>;
}

export interface It4itParticipationCell {
  componentId: string;
  componentName: string;
  status: CoverageStatus;
  score: number;
  /** stream name -> participates. */
  participatesIn: Record<string, boolean>;
  /** count of streams this component participates in. */
  streamCount: number;
}

export interface It4itParticipationGroup {
  group: string;
  rows: It4itParticipationCell[];
}

export interface It4itParticipationGrid {
  hasData: boolean;
  streams: string[];
  groups: It4itParticipationGroup[];
}

const GROUP_ORDER = [
  "Strategy to Portfolio",
  "Requirement to Deploy",
  "Request to Fulfill",
  "Detect to Correct",
  "Supporting Functions",
];

export function shapeIt4itParticipationGrid(params: {
  components: It4itComponentCoverage[];
  valueStreams: string[];
  stageParticipation: It4itStageParticipationRow[];
}): It4itParticipationGrid {
  const { components, valueStreams, stageParticipation } = params;

  // Order streams by the seeded order (stable), de-duplicated.
  const streams = Array.from(new Set(valueStreams));

  // component name -> set of streams it participates in (union across that stream's stages).
  const participationByComponent = new Map<string, Set<string>>();
  for (const stage of stageParticipation) {
    for (const [componentName, mark] of Object.entries(stage.participation)) {
      if (mark == null || String(mark).trim() === "") continue;
      const set = participationByComponent.get(componentName) ?? new Set<string>();
      set.add(stage.stream);
      participationByComponent.set(componentName, set);
    }
  }

  const groupsMap = new Map<string, It4itParticipationCell[]>();
  for (const c of components) {
    const streamsForComp = participationByComponent.get(c.name) ?? new Set<string>();
    const participatesIn: Record<string, boolean> = {};
    for (const s of streams) participatesIn[s] = streamsForComp.has(s);
    const cell: It4itParticipationCell = {
      componentId: c.id,
      componentName: c.name,
      status: c.status,
      score: c.score,
      participatesIn,
      streamCount: streams.filter((s) => participatesIn[s]).length,
    };
    const arr = groupsMap.get(c.capabilityGroup ?? "Supporting Functions") ?? [];
    arr.push(cell);
    groupsMap.set(c.capabilityGroup ?? "Supporting Functions", arr);
  }

  const groups: It4itParticipationGroup[] = [];
  for (const [group, rows] of groupsMap) {
    rows.sort((a, b) => b.streamCount - a.streamCount || a.componentName.localeCompare(b.componentName));
    groups.push({ group, rows });
  }
  groups.sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a.group);
    const ib = GROUP_ORDER.indexOf(b.group);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.group.localeCompare(b.group);
  });

  return {
    hasData: components.length > 0 && streams.length > 0,
    streams,
    groups,
  };
}
