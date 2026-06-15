import { apiSuccess } from "@/lib/api/response";
import { authWorkbookUser, toApiError } from "@/lib/workbooks/api-helpers";
import { updateCells, deleteRow } from "@/lib/workbooks/workbook-service";
import type { CellValue } from "@/lib/workbooks/types";

// PATCH /api/v1/grid/[tableId]/rows/[rowId] — update cells in a row
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tableId: string; rowId: string }> },
) {
  try {
    const user = await authWorkbookUser(request, "manage_workbooks");
    const { tableId, rowId } = await params;
    const body = (await request.json()) as { cells?: Record<string, CellValue> };
    const row = await updateCells(user, tableId, rowId, body.cells ?? {});
    return apiSuccess({ data: row });
  } catch (e) {
    return toApiError(e).toResponse();
  }
}

// DELETE /api/v1/grid/[tableId]/rows/[rowId] — delete a row
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tableId: string; rowId: string }> },
) {
  try {
    const user = await authWorkbookUser(request, "manage_workbooks");
    const { tableId, rowId } = await params;
    await deleteRow(user, tableId, rowId);
    return apiSuccess({ ok: true });
  } catch (e) {
    return toApiError(e).toResponse();
  }
}
