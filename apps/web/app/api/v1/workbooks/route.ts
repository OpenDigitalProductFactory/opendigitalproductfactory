import { apiSuccess } from "@/lib/api/response";
import { authWorkbookUser, toApiError } from "@/lib/workbooks/api-helpers";
import { listWorkbooks, createWorkbook } from "@/lib/workbooks/workbook-service";

// GET /api/v1/workbooks — list workbooks the caller can access
export async function GET(request: Request) {
  try {
    const user = await authWorkbookUser(request, "view_workbooks");
    return apiSuccess({ data: await listWorkbooks(user) });
  } catch (e) {
    return toApiError(e).toResponse();
  }
}

// POST /api/v1/workbooks — create a workbook
export async function POST(request: Request) {
  try {
    const user = await authWorkbookUser(request, "manage_workbooks");
    const body = (await request.json()) as { name: string; description?: string; areaSlug?: string };
    const workbook = await createWorkbook(user, body);
    return apiSuccess({ data: workbook }, 201);
  } catch (e) {
    return toApiError(e).toResponse();
  }
}
