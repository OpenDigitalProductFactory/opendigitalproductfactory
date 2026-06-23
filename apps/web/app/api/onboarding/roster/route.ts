import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseDelimitedGrid, mapRosterToEmployees } from "@/lib/onboarding/roster-import";

export const runtime = "nodejs";

// Preview an uploaded employee-roster CSV (EP-ONBOARDING-INTAKE P4): parse the
// grid, detect columns, and return the proposed employees for the operator to
// confirm before any are created. CSV/TSV only in this slice — the universal
// roster export; a spreadsheet should be exported to CSV first.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const name = file.name.toLowerCase();
  const isCsv = file.type === "text/csv" || name.endsWith(".csv") || name.endsWith(".tsv");
  if (!isCsv) {
    return NextResponse.json(
      { error: "Please upload a CSV file — export your roster or spreadsheet as CSV first." },
      { status: 400 },
    );
  }

  const text = Buffer.from(await file.arrayBuffer()).toString("utf-8");
  const { columns, rows } = parseDelimitedGrid(text);
  if (columns.length === 0) {
    return NextResponse.json({ error: "That file looks empty." }, { status: 400 });
  }

  const MAX_ROWS = 2000;
  const result = mapRosterToEmployees(columns, rows.slice(0, MAX_ROWS));
  return NextResponse.json({ success: true, ...result, truncated: rows.length > MAX_ROWS });
}
