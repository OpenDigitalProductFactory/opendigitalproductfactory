import { useEffect, useState } from "react";
import { computeOrgChartLayout, type OrgPosition } from "./layout-org-chart";
import type { OrgEdge } from "@/lib/workforce/org-chart-model";

/**
 * Org chart positions from the async ELK layout.
 *
 * `null` until the first layout lands, so the canvas stays empty rather than stacking every
 * card at the origin. A re-layout (after a reassignment) keeps the previous positions on
 * screen until the new ones arrive; a superseded layout is dropped.
 */
export function useOrgChartLayout(
  employees: ReadonlyArray<{ id: string }>,
  edges: OrgEdge[],
): Record<string, OrgPosition> | null {
  const [positions, setPositions] = useState<Record<string, OrgPosition> | null>(null);

  useEffect(() => {
    let cancelled = false;
    computeOrgChartLayout(
      employees.map((e) => e.id),
      edges,
    ).then(
      (next) => {
        if (!cancelled) setPositions(next);
      },
      (error: unknown) => {
        console.error("[org-chart] layout failed", error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [employees, edges]);

  return positions;
}
