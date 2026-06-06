import { apiSuccess } from "@/lib/api/response";
import { parsePagination } from "@/lib/api/pagination";
import { authWorkbookUser, toApiError } from "@/lib/workbooks/api-helpers";
import { queryRows, createRow } from "@/lib/workbooks/workbook-service";
import type { CellValue, SortSpec, DataSourceFilter } from "@/lib/workbooks/types";

// GET /api/v1/grid/[tableId]/rows — query rows (cursor pagination)
export async function GET(request: Request, { params }: { params: Promise<{ tableId: string }> }) {
  try {
    const user = await authWorkbookUser(request, "view_workbooks");
    const { tableId } = await params;
    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const sortRaw = url.searchParams.get("sort");
    const sort = sortRaw ? (JSON.parse(sortRaw) as SortSpec[]) : undefined;
    const filterRaw = url.searchParams.get("filters");
    const filters = filterRaw ? (JSON.parse(filterRaw) as DataSourceFilter) : undefined;
    const result = await queryRows(user, tableId, { cursor, limit, sort, filters });
    return apiSuccess(result);
  } catch (e) {
    return toApiError(e).toResponse();
  }
}

// POST /api/v1/grid/[tableId]/rows — create a row
export async function POST(request: Request, { params }: { params: Promise<{ tableId: string }> }) {
  try {
    const user = await authWorkbookUser(request, "manage_workbooks");
    const { tableId } = await params;
    const body = (await request.json()) as { cells?: Record<string, CellValue> };
    const row = await createRow(user, tableId, body.cells ?? {});
    return apiSuccess({ data: row }, 201);
  } catch (e) {
    return toApiError(e).toResponse();
  }
}
