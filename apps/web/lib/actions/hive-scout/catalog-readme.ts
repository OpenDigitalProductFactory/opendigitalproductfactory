// apps/web/lib/actions/hive-scout/catalog-readme.ts
//
// Hive Scout — parsing of the MIT-licensed 500-AI-Agents-Projects upstream
// README into structured catalog entries. Pure functions, no I/O.

// ─── Constants ──────────────────────────────────────────────────────────────

export const CATALOG_NAME = "500-AI-Agents-Projects";
export const CATALOG_LICENSE = "MIT";
export const CATALOG_README_URL =
  "https://raw.githubusercontent.com/ashishpatel26/500-AI-Agents-Projects/main/README.md";

// ─── Types ──────────────────────────────────────────────────────────────────

export type Framework = "crewai" | "autogen" | "agno" | "langgraph";

export interface CatalogEntry {
  name: string;
  industry: string;
  description: string;
  sourceUrl: string;
  framework?: Framework;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Strip leading emoji / punctuation / markdown-bold wrappers from a table cell.
 * The upstream README prefixes many cells with emoji (e.g. "🗣️ Communication").
 */
function cleanCell(raw: string): string {
  return raw
    .trim()
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/^\*|\*$/g, "")
    .replace(/^[^\w(]+/, "") // drop leading emoji / symbol runs
    .trim();
}

/**
 * Extract the first http(s) URL from a cell (cells contain badge images
 * followed by the real link in markdown: [![badge](img)](URL)).
 */
function firstUrl(cell: string): string | null {
  // Look for the closing paren of the outer link: `](URL)` at end of cell
  const matches = cell.match(/\(https?:\/\/[^\s)]+\)/g);
  if (!matches || matches.length === 0) return null;
  // The last match is the outer link's target (innermost is the badge image)
  const last = matches[matches.length - 1];
  return last.slice(1, -1);
}

/**
 * Parse a single markdown table into rows of 4 string cells.
 * Returns rows in the order they appear; skips header and separator.
 */
function parseMarkdownTable(block: string): string[][] {
  const lines = block.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 3) return []; // need header + separator + at least one row

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    // Separator rows look like "| --- | --- | ... |" — skip just in case they
    // appear mid-table (rare but possible)
    if (/^\|\s*-+\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length >= 4) rows.push(cells);
  }
  return rows;
}

/**
 * Extract a contiguous block of markdown-table lines starting at `startIdx`.
 * Returns the block as a single string and the index after the block ends.
 */
function extractTable(lines: string[], startIdx: number): { block: string; next: number } {
  let i = startIdx;
  const blockLines: string[] = [];
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    blockLines.push(lines[i]);
    i++;
  }
  return { block: blockLines.join("\n"), next: i };
}

/**
 * Parse the upstream README markdown into catalog entries.
 * Recognises the main "Use Case Table" and each framework sub-table.
 *
 * Throws if no entries are found — upstream format drift should fail loud
 * rather than silently return empty results.
 */
export function parseReadme(markdown: string): CatalogEntry[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const entries: CatalogEntry[] = [];
  let currentFramework: Framework | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track framework section headings like:
    //   ### **Framework Name**: **CrewAI**
    const fwMatch = line.match(/Framework Name[^*]*\*\*:\s*\*\*([A-Za-z]+)/);
    if (fwMatch) {
      const raw = fwMatch[1].toLowerCase();
      if (raw === "crewai") currentFramework = "crewai";
      else if (raw === "autogen") currentFramework = "autogen";
      else if (raw === "agno") currentFramework = "agno";
      else if (raw === "langgraph") currentFramework = "langgraph";
      else currentFramework = undefined;
      continue;
    }

    // When we hit a table row, slurp the whole contiguous block
    if (line.trim().startsWith("|") && lines[i + 1]?.trim().startsWith("|")) {
      const { block, next } = extractTable(lines, i);
      for (const row of parseMarkdownTable(block)) {
        const [nameCell, industryCell, descCell, linkCell] = row;
        const url = firstUrl(linkCell);
        if (!url) continue;
        const name = cleanCell(nameCell);
        const industry = cleanCell(industryCell);
        const description = cleanCell(descCell);
        if (!name || !industry || !description) continue;

        entries.push({
          name,
          industry,
          description,
          sourceUrl: url,
          ...(currentFramework ? { framework: currentFramework } : {}),
        });
      }
      i = next - 1;
    }
  }

  if (entries.length === 0) {
    throw new Error(
      "Hive Scout parser produced zero catalog entries — upstream README format may have changed. " +
        "Refusing to write partial results.",
    );
  }

  return entries;
}
