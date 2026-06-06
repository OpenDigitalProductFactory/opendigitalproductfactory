"use server";

// Universal Grid & Workbooks — platform-data grid server actions (EP-GRID-WORKBOOKS, Phase 1b)
// Edits to platform records (e.g. backlog) made from a grid. Auth here; the
// underlying domain update action re-enforces its own capability + validation.

import { auth } from "@/lib/auth";
import { updatePlatformCells } from "@/lib/workbooks/platform-tables";
import { WorkbookError } from "@/lib/workbooks/workbook-service";
import type { CellValue } from "@/lib/workbooks/types";

export type PlatformGridResult =
  | { ok: true; data: { rowId: string } }
  | { ok: false; error: string };

export async function updatePlatformCellsAction(
  entityType: string,
  rowId: string,
  changes: Record<string, CellValue>,
): Promise<PlatformGridResult> {
  try {
    const session = await auth();
    const user = session?.user;
    if (!user?.id) throw new WorkbookError("Not authenticated", 401);
    const row = await updatePlatformCells(
      { id: user.id, platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      entityType,
      rowId,
      changes,
    );
    return { ok: true, data: { rowId: row.rowId } };
  } catch (e) {
    if (e instanceof WorkbookError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "Unexpected error" };
  }
}
