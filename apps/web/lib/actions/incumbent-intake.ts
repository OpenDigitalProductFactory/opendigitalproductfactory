"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/actions/shared/guards";
import { parseDelimitedGrid } from "@/lib/onboarding/roster-import";
import { inferTableFromSheet, type SheetCell } from "@/lib/workbooks/sheet-import";
import {
  createIncumbentApplication,
  type IncumbentIntakeInput,
  type IncumbentIntakeResult,
} from "@/lib/incumbent/intake";
import {
  importIncumbentRows,
  type IncumbentImportResult,
} from "@/lib/incumbent/spreadsheet";

// Server-action wrapper for incumbent intake (D2 P1, BI-BF12C25C). The write core
// lives in lib/incumbent/intake.ts (pure + unit-tested); this adds the auth guard
// and cache revalidation, matching the createDigitalProduct pattern in products.ts.

export async function intakeIncumbentApplication(
  input: IncumbentIntakeInput,
): Promise<IncumbentIntakeResult> {
  await requireCapability("view_portfolio");
  const result = await createIncumbentApplication(prisma, input);
  revalidatePath("/portfolio");
  revalidatePath("/workforce");
  return result;
}

// D2 P2: spreadsheet import. Parses an uploaded CSV/TSV/XLSX into a row matrix
// (the same path workbooks.ts uses), then intakes every row through the P1 core.
// The file→matrix→rows parsing is the only I/O here; the mapping + orchestration
// live in the unit-tested lib/incumbent/spreadsheet.ts core.
export async function importIncumbentSpreadsheet(
  formData: FormData,
): Promise<IncumbentImportResult> {
  await requireCapability("view_portfolio");

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No spreadsheet file uploaded");

  const lower = file.name.toLowerCase();
  let matrix: SheetCell[][];
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || file.type === "text/csv") {
    const text = Buffer.from(await file.arrayBuffer()).toString("utf-8");
    const { columns, rows } = parseDelimitedGrid(text);
    matrix = [columns, ...rows];
  } else {
    const buffer = await file.arrayBuffer();
    const { readSheet } = await import(/* turbopackIgnore: true */ "read-excel-file/browser");
    matrix = (await readSheet(buffer)) as SheetCell[][];
  }

  const { rows } = inferTableFromSheet(matrix);
  const result = await importIncumbentRows(prisma, rows);
  revalidatePath("/portfolio");
  revalidatePath("/workforce");
  return result;
}
