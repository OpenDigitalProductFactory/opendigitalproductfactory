// lib/finance/withholding-table-text.ts — read a withholding table pasted as
// the IRS prints it: one row per line, the wage the row starts at, then its
// rate (BI-099EAE30). "7,500  10%", "$19,900 12", "0 0%" all read the same.
//
// Rates are typed as printed (10 for 10%) and returned as fractions (0.1), so
// nobody has to remember the storage convention and get it wrong by 100x.

export type ParsedTable = { readable: true; rows: Array<{ over: number; rate: number }> } | { readable: false; line: number };

export function parseWithholdingTableText(text: string): ParsedTable {
  const rows: Array<{ over: number; rate: number }> = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const numbers = line.replace(/[$,]/g, "").match(/\d+(?:\.\d+)?/g);
    if (!numbers || numbers.length !== 2) return { readable: false, line: i + 1 };
    rows.push({ over: Number(numbers[0]), rate: Number(numbers[1]) / 100 });
  }
  return { readable: true, rows };
}
