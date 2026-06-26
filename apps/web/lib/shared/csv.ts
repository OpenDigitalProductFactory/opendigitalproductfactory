// apps/web/lib/shared/csv.ts
//
// Server-safe RFC-4180 CSV serialization — the single source of truth for the
// hand-rolled field-escaping + row-joining that was duplicated, with diverging
// rules, across the server-side CSV exporters outside report-kit:
//   * components/workbooks/grid-csv.ts  (quoted [",\r\n], joined with \r\n)
//   * lib/actions/reports.ts            (quoted only [",], joined with \n — a bug:
//                                         a value containing a newline was NOT quoted)
//   * app/api/v1/finance/reports/[report]/route.ts (reuses reports.ts)
// A CSV bug fixed in one silently persisted in the others; this converges them
// onto one correct serializer.
//
// Pure function, no DOM / Prisma / React imports — safe in server actions, API
// routes, and the workbook grid alike. RFC-4180:
//   * a field is quoted iff it contains `"`, `,`, CR, or LF
//   * an interior `"` is escaped by doubling it (`"` -> `""`)
//   * records are joined with CRLF (`\r\n`)
//
// This is the *server* serializer (string-matrix in, CSV string out). The
// client report-kit `toCsv` in components/ui/report-kit/ExportButton.tsx is a
// separate, papaparse-backed serializer over *object* rows ({key, header}
// columns); it already emits CRLF and is intentionally left as the client
// affordance. The two do not share a module or a barrel, so the duplicate
// export name does not collide.

/** Quote a field per RFC-4180 iff it contains `"`, `,`, CR or LF; double interior quotes. */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serialize a matrix of already-stringified cells to an RFC-4180 CSV document.
 *
 * @param rows    Body rows; each is an array of cell strings.
 * @param columns Optional header row, emitted first.
 * @returns CSV text with fields escaped per RFC-4180 and records joined by CRLF.
 *
 * @example toCsv([["a", "b"], ["c,d", 'e"f']], ["x", "y"])
 *   // 'x,y\r\na,b\r\n"c,d","e""f"'
 */
export function toCsv(
  rows: readonly (readonly string[])[],
  columns?: readonly string[],
): string {
  const records = columns ? [columns, ...rows] : rows;
  return records
    .map((record) => record.map(escapeCsvField).join(","))
    .join("\r\n");
}
