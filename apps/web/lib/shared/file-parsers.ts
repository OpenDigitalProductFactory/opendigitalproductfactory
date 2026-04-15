export type ParsedFileContent = {
  type: "spreadsheet" | "document";
  summary: string;
  columns?: string[];
  sampleRows?: string[][];
  rowCount?: number;
  sections?: { heading: string; text: string }[];
  fullText?: string;
};

const MAX_COLUMNS = 200;
const MAX_COLUMN_LEN = 100;
const MAX_CELL_LEN = 200;
const MAX_SAMPLE_ROWS = 50;
const MAX_SECTIONS = 100;
const MAX_TEXT_LEN = 20_000;
const MAX_PARSED_JSON_SIZE = 100_000;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

export function parseCsv(buffer: Buffer): ParsedFileContent {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { type: "spreadsheet", summary: "Empty spreadsheet", columns: [], rowCount: 0 };

  const allColumns = lines[0]!.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const columns = allColumns.slice(0, MAX_COLUMNS).map((c) => truncate(c, MAX_COLUMN_LEN));
  const dataLines = lines.slice(1);
  const sampleRows = dataLines.slice(0, MAX_SAMPLE_ROWS).map((line) =>
    line.split(",").slice(0, MAX_COLUMNS).map((cell) => truncate(cell.trim().replace(/^"|"$/g, ""), MAX_CELL_LEN)),
  );

  return { type: "spreadsheet", summary: `${columns.length} columns, ${dataLines.length} rows`, columns, sampleRows, rowCount: dataLines.length };
}

export async function parseXlsx(buffer: Buffer): Promise<ParsedFileContent> {
  const XLSX = await import(/* turbopackIgnore: true */ "xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { type: "spreadsheet", summary: "Empty workbook", columns: [], rowCount: 0 };

  const sheet = workbook.Sheets[sheetName]!;
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as string[][];
  const headerRow = rows[0] ?? [];
  const columns = headerRow.slice(0, MAX_COLUMNS).map((c) => truncate(String(c), MAX_COLUMN_LEN));
  const dataRows = rows.slice(1);
  const sampleRows = dataRows.slice(0, MAX_SAMPLE_ROWS).map((row) =>
    row.slice(0, MAX_COLUMNS).map((cell) => truncate(String(cell), MAX_CELL_LEN)),
  );
  const extraSheets = workbook.SheetNames.length - 1;
  const sheetNote = extraSheets > 0 ? ` (${extraSheets} additional sheet${extraSheets !== 1 ? "s" : ""})` : "";

  return { type: "spreadsheet", summary: `${columns.length} columns, ${dataRows.length} rows${sheetNote}`, columns, sampleRows, rowCount: dataRows.length };
}

export async function parsePdf(buffer: Buffer): Promise<ParsedFileContent> {
  const { PDFParse } = await import(/* turbopackIgnore: true */ "pdf-parse");
  const pdf = new PDFParse({ data: new Uint8Array(buffer) });
  const textResult = await pdf.getText();
  const info = await pdf.getInfo();
  const numPages = info.pages?.length ?? textResult.pages?.length ?? 0;
  const fullText = textResult.text ?? "";
  await pdf.destroy();
  return { type: "document", summary: `${numPages} page${numPages !== 1 ? "s" : ""}, ${fullText.length} characters`, fullText: truncate(fullText, MAX_TEXT_LEN) };
}

export async function parseDocx(buffer: Buffer): Promise<ParsedFileContent> {
  const mammoth = await import(/* turbopackIgnore: true */ "mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const headingRe = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi;
  const sections: { heading: string; text: string }[] = [];
  let match;
  while ((match = headingRe.exec(htmlResult.value)) !== null && sections.length < MAX_SECTIONS) {
    sections.push({ heading: match[1]!.replace(/<[^>]*>/g, ""), text: "" });
  }
  const base: ParsedFileContent = { type: "document", summary: `${sections.length} section${sections.length !== 1 ? "s" : ""}, ${result.value.length} characters`, fullText: truncate(result.value, MAX_TEXT_LEN) };
  if (sections.length > 0) base.sections = sections;
  return base;
}

function parseTextFile(buffer: Buffer, fileName: string): ParsedFileContent {
  const text = buffer.toString("utf-8");
  return {
    type: "document",
    summary: `${text.length} characters`,
    fullText: truncate(text, MAX_TEXT_LEN),
  };
}

export async function parseFileContent(buffer: Buffer, mimeType: string, fileName: string): Promise<ParsedFileContent | null> {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (mimeType === "text/csv" || ext === "csv" || ext === "tsv") return parseCsv(buffer);
  if (ext === "xls" || ext === "xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || mimeType === "application/vnd.ms-excel") return parseXlsx(buffer);
  if (mimeType === "application/pdf" || ext === "pdf") return parsePdf(buffer);
  if (ext === "doc" || ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mimeType === "application/msword") return parseDocx(buffer);
  // Text-based formats
  if (ext && ["txt", "json", "md", "xml", "yaml", "yml", "log", "rtf"].includes(ext)) return parseTextFile(buffer, fileName);
  if (mimeType?.startsWith("text/")) return parseTextFile(buffer, fileName);
  return null;
}

export function capParsedContentSize(content: ParsedFileContent): ParsedFileContent {
  const json = JSON.stringify(content);
  if (json.length <= MAX_PARSED_JSON_SIZE) return content;
  if (content.fullText) {
    const excess = json.length - MAX_PARSED_JSON_SIZE;
    content.fullText = content.fullText.slice(0, Math.max(1000, content.fullText.length - excess));
  }
  return content;
}
