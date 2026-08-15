// apps/web/components/workbooks/PlatformGridSection.tsx
//
// The systematic surfacing block (EP-GRID-WORKBOOKS): one component that gives any
// domain list surface the List/Grid/Board switcher + the embedded platform grid.
// A page adds this once and wraps its existing list in `{!view && ...}` — turning
// "the grid engine exists" into "this list is also an editable/exportable grid",
// without re-implementing the switcher/grid wiring per page.
//
// Usage:
//   const view = parseSurfaceView(sp?.view);
//   <PlatformGridSection entityType="supplier" view={view} />
//   {!view && (<the existing list UI/>)}

import { SurfaceViewSwitcher } from "./SurfaceViewSwitcher";
import { SurfacePlatformGrid } from "./SurfacePlatformGrid";

import type { SurfaceDataScope } from "@/lib/workbooks/surface-view";

// Re-export pure helpers so a page can import the section + parsers together.
export {
  parseSurfaceDataScope,
  parseSurfaceView,
} from "@/lib/workbooks/surface-view";

export function PlatformGridSection({
  entityType,
  view,
  dataScope = "default",
}: {
  entityType: string;
  /** the parsed view (parseSurfaceView); null = show the page's own list */
  view: "grid" | "board" | null;
  /** registry default unless the URL explicitly selects all records */
  dataScope?: SurfaceDataScope;
}) {
  return (
    <>
      <SurfaceViewSwitcher
        entityType={entityType}
        current={view ?? "list"}
        dataScope={dataScope}
      />
      {view ? (
        <SurfacePlatformGrid
          entityType={entityType}
          view={view}
          dataScope={dataScope}
        />
      ) : null}
    </>
  );
}
