// apps/web/components/workbooks/SurfacePlatformGrid.tsx
// Renders a platform-data grid (the same records a form edits) embedded in its
// home domain surface (EP-GRID-WORKBOOKS per-surface integration). Reuses the
// existing getPlatformTableGridData + WorkbookGrid/KanbanBoard substrate — no new
// grid code. Capability is enforced by getPlatformTableGridData (domain view/manage).
import { auth } from "@/lib/auth";
import {
  getAllPlatformTableRows,
  getHomeSurfaceForEntity,
  type PlatformUser,
} from "@/lib/workbooks/platform-tables";
import {
  resolveSurfaceDataFilter,
  type SurfaceDataScope,
} from "@/lib/workbooks/surface-view";
import { WorkbookError } from "@/lib/workbooks/workbook-service";
import { defaultGroupByColumn } from "@/lib/workbooks/kanban-grouping";
import { WorkbookGrid } from "@/components/workbooks/Grid";
import { KanbanBoard } from "@/components/workbooks/KanbanBoard";

export async function SurfacePlatformGrid({
  entityType,
  view,
  dataScope = "default",
}: {
  entityType: string;
  view: "grid" | "board";
  dataScope?: SurfaceDataScope;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const user = session.user;
  const svcUser: PlatformUser = {
    id: user.id,
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  };

  let grid;
  try {
    const defaultFilter = getHomeSurfaceForEntity(entityType)?.defaultDataLens?.filter;
    grid = await getAllPlatformTableRows(svcUser, entityType, {
      filters: resolveSurfaceDataFilter(defaultFilter, dataScope),
    });
  } catch (e) {
    if (e instanceof WorkbookError) {
      return <p className="text-sm text-[var(--dpf-muted)]">{e.message}</p>;
    }
    throw e;
  }

  const groupBy = defaultGroupByColumn(grid.schema.columns);
  const boardView = view === "board" && groupBy !== null;

  return (
    <div className="min-h-0 flex-1">
      {boardView && groupBy !== null ? (
        <KanbanBoard
          source="platform"
          tableId={entityType}
          columns={grid.schema.columns}
          rows={grid.rows}
          capabilities={grid.schema.capabilities}
          groupByColumnId={groupBy}
        />
      ) : (
        <WorkbookGrid
          source="platform"
          tableId={entityType}
          columns={grid.schema.columns}
          rows={grid.rows}
          capabilities={grid.schema.capabilities}
        />
      )}
    </div>
  );
}
