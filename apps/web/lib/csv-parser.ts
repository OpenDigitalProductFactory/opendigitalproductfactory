import Papa from "papaparse";

export type ParsedTransaction = {
  date: Date;
  description: string;
  amount: number; // positive = credit, negative = debit
  balance?: number;
  reference?: string;
};

export type ParseResult = {
  transactions: ParsedTransaction[];
  errors: Array<{ row: number; message: string }>;
  format: string;
  totalRows: number;
};

type FormatType = "generic" | "barclays" | "lloyds";

function detectFormat(headers: string[]): FormatType {
  const normalised = headers.map((h) => h.trim().toLowerCase());
  if (normalised.includes("money in") || normalised.includes("money out")) {
    return "barclays";
  }
  if (normalised.includes("debit amount") || normalised.includes("credit amount")) {
    return "lloyds";
  }
  return "generic";
}

/**
 * Attempt to parse a date string in multiple formats.
 * Returns a Date or null if parsing fails.
 *
 * Supported formats (in order of attempt):
 *   DD/MM/YYYY
 *   YYYY-MM-DD (ISO)
 *   MM/DD/YYYY
 */
function parseDate(raw: string): Date | null {
  const s = raw.trim();

  // DD/MM/YYYY
  const ukMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    const day = parseInt(ukMatch[1], 10);
    const month = parseInt(ukMatch[2], 10) - 1;
    const year = parseInt(ukMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // MM/DD/YYYY
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const month = parseInt(usMatch[1], 10) - 1;
    const day = parseInt(usMatch[2], 10);
    const year = parseInt(usMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function parseAmount(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  const cleaned = raw.trim().replace(/[£$€,]/g, "");
  const value = parseFloat(cleaned);
  return isNaN(value) ? null : value;
}

function getHeader(row: Record<string, string>, headers: string[], ...candidates: string[]): string | undefined {
  const lower = candidates.map((c) => c.toLowerCase());
  const match = headers.find((h) => lower.includes(h.trim().toLowerCase()));
  return match ? row[match] : undefined;
}

export function parseCSV(csvText: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    trimHeaders: true,
  });

  const headers: string[] = parsed.meta.fields ?? [];
  const format = detectFormat(headers);

  const transactions: ParsedTransaction[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  let totalRows = 0;

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    totalRows++;

    // Skip completely blank rows (all values empty)
    const values = Object.values(row);
    if (values.every((v) => v.trim() === "")) continue;

    const rawDate = getHeader(row, headers, "Date", "Transaction Date", "Value Date");
    const rawDescription = getHeader(row, headers, "Description", "Details", "Narrative", "Transaction Description");
    const rawReference = getHeader(row, headers, "Reference", "Ref");
    const rawBalance = getHeader(row, headers, "Balance", "Running Balance");

    // Parse date (row is reported 1-based relative to data rows)
    const rowNumber = i + 1;
    const date = rawDate ? parseDate(rawDate) : null;
    if (!date) {
      errors.push({ row: rowNumber, message: `Invalid or missing date: "${rawDate ?? ""}"` });
      continue;
    }

    const description = rawDescription?.trim() ?? "";

    // Parse amount based on format
    let amount: number | null = null;

    if (format === "barclays") {
      const moneyIn = getHeader(row, headers, "Money In");
      const moneyOut = getHeader(row, headers, "Money Out");
      const credit = parseAmount(moneyIn);
      const debit = parseAmount(moneyOut);
      if (credit !== null && credit !== 0) {
        amount = credit;
      } else if (debit !== null && debit !== 0) {
        amount = -debit;
      } else {
        amount = 0;
      }
    } else if (format === "lloyds") {
      const debitAmt = getHeader(row, headers, "Debit Amount");
      const creditAmt = getHeader(row, headers, "Credit Amount");
      const credit = parseAmount(creditAmt);
      const debit = parseAmount(debitAmt);
      if (credit !== null && credit !== 0) {
        amount = credit;
      } else if (debit !== null && debit !== 0) {
        amount = -debit;
      } else {
        amount = 0;
      }
    } else {
      // generic: signed Amount column
      const rawAmount = getHeader(row, headers, "Amount", "Transaction Amount");
      amount = parseAmount(rawAmount);
    }

    if (amount === null) {
      errors.push({ row: rowNumber, message: `Invalid or missing amount in row ${rowNumber}` });
      continue;
    }

    const balance = rawBalance ? parseAmount(rawBalance) ?? undefined : undefined;
    const reference = rawReference?.trim() || undefined;

    transactions.push({ date, description, amount, balance, reference });
  }

  return { transactions, errors, format, totalRows };
}
