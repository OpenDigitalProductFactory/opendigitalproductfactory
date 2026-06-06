import { apiSuccess } from "@/lib/api/response";
import { authWorkbookUser, toApiError } from "@/lib/workbooks/api-helpers";
import { getTableSchema } from "@/lib/workbooks/workbook-service";

// GET /api/v1/grid/[tableId]/schema — column definitions + capabilities
export async function GET(request: Request, { params }: { params: Promise<{ tableId: string }> }) {
  try {
    const user = await authWorkbookUser(request, "view_workbooks");
    const { tableId } = await params;
    return apiSuccess({ data: await getTableSchema(user, tableId) });
  } catch (e) {
    return toApiError(e).toResponse();
  }
}
