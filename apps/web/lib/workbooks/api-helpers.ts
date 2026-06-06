// Universal Grid & Workbooks — REST API helpers (EP-GRID-WORKBOOKS)

import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { WorkbookError, type ServiceUser } from "./workbook-service";

export async function authWorkbookUser(
  request: Request,
  capability: "view_workbooks" | "manage_workbooks",
): Promise<ServiceUser> {
  const { user, capabilities } = await authenticateRequest(request);
  if (!user?.id) throw new ApiError("unauthorized", "Not authenticated", 401);
  if (!user.isSuperuser && !capabilities.includes(capability)) {
    throw new ApiError("forbidden", `Missing capability: ${capability}`, 403);
  }
  return { id: user.id, isSuperuser: user.isSuperuser };
}

/** Convert a thrown error into an ApiError for uniform route handling. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof WorkbookError) return new ApiError("workbook_error", e.message, e.status);
  return new ApiError("internal_error", "An unexpected error occurred", 500);
}
