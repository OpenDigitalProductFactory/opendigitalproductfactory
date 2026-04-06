// apps/web/lib/design-intelligence.ts
// TypeScript search engine for UI UX Pro Max design intelligence data.
// Reads CSV files from apps/web/data/design-intelligence/ and performs
// BM25-like keyword matching across multiple design domains.

import { readFileSync } from "fs";
import { join } from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DesignDomain =
  | "style"
  | "color"
  | "typography"
  | "ux"
  | "landing"
  | "chart"
  | "product"
  | "reasoning";

type CsvRow = Record<string, string>;

type SearchResult = {
  domain: DesignDomain;
  score: number;
  data: CsvRow;
};

export type DesignSystemResult = {
  productMatch: CsvRow | null;
  reasoningRule: CsvRow | null;
  recommendedStyle: CsvRow | null;
  colorPalette: CsvRow | null;
  typographyPairing: CsvRow | null;
  landingPattern: CsvRow | null;
  antiPatterns: string[];
};

// ─── CSV Parsing ────────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), "apps/web/data/design-intelligence");

/** Simple CSV parser that handles quoted fields with commas. */
function parseCsv(content: string): CsvRow[] {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]!);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]!);
    const row: CsvRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ─── Data Loading (lazy, cached) ────────────────────────────────────────────

const cache = new Map<string, CsvRow[]>();

function loadDomain(domain: DesignDomain): CsvRow[] {
  const fileMap: Record<DesignDomain, string> = {
    style: "styles.csv",
    color: "colors.csv",
    typography: "typography.csv",
    ux: "ux-guidelines.csv",
    landing: "landing.csv",
    chart: "charts.csv",
    product: "products.csv",
    reasoning: "ui-reasoning.csv",
  };

  const filename = fileMap[domain];
  if (cache.has(filename)) return cache.get(filename)!;

  try {
    const content = readFileSync(join(DATA_DIR, filename), "utf-8");
    const rows = parseCsv(content);
    cache.set(filename, rows);
    return rows;
  } catch {
    return [];
  }
}

// ─── Search Engine ──────────────────────────────────────────────────────────

/** Tokenize a string into lowercase keywords. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Score a row against query tokens using term frequency matching. */
function scoreRow(row: CsvRow, queryTokens: string[]): number {
  // Concatenate all field values into a searchable string
  const text = Object.values(row).join(" ").toLowerCase();
  let score = 0;

  for (const token of queryTokens) {
    // Count occurrences
    let idx = 0;
    let count = 0;
    while ((idx = text.indexOf(token, idx)) !== -1) {
      count++;
      idx += token.length;
    }
    if (count > 0) {
      // BM25-inspired: diminishing returns for repeated matches
      score += Math.log(1 + count);
    }
  }

  return score;
}

/** Search a specific design domain for matching rows. */
export function searchDesignDomain(
  query: string,
  domain: DesignDomain,
  maxResults = 5,
): SearchResult[] {
  const rows = loadDomain(domain);
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const scored = rows
    .map((row) => ({ domain, score: scoreRow(row, tokens), data: row }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return scored;
}

// ─── Design System Generator ────────────────────────────────────────────────

/** Format a single search result row for display. */
function formatRow(domain: DesignDomain, row: CsvRow): string {
  switch (domain) {
    case "style": {
      const lines = [
        `**Style:** ${row["Style Category"] ?? "Unknown"}`,
        `  Type: ${row["Type"] ?? ""}`,
        `  Keywords: ${row["Keywords"] ?? ""}`,
        `  Primary Colors: ${row["Primary Colors"] ?? ""}`,
        `  Effects: ${row["Effects & Animation"] ?? ""}`,
        `  Best For: ${row["Best For"] ?? ""}`,
        `  Performance: ${row["Performance"] ?? ""}  |  Accessibility: ${row["Accessibility"] ?? ""}`,
        `  Anti-patterns: ${row["Do Not Use For"] ?? ""}`,
      ];
      if (row["Implementation Checklist"]) {
        lines.push(`  Checklist: ${row["Implementation Checklist"]}`);
      }
      if (row["Design System Variables"]) {
        lines.push(`  Variables: ${row["Design System Variables"]}`);
      }
      return lines.join("\n");
    }
    case "color":
      return [
        `**Palette:** ${row["Product Type"] ?? "Unknown"}`,
        `  Primary: ${row["Primary (Hex)"] ?? ""}  |  Secondary: ${row["Secondary (Hex)"] ?? ""}`,
        `  CTA: ${row["CTA (Hex)"] ?? ""}  |  Background: ${row["Background (Hex)"] ?? ""}`,
        `  Text: ${row["Text (Hex)"] ?? ""}  |  Border: ${row["Border (Hex)"] ?? ""}`,
        `  Notes: ${row["Notes"] ?? ""}`,
      ].join("\n");
    case "typography":
      return [
        `**Font Pairing:** ${row["Font Pairing Name"] ?? "Unknown"}`,
        `  Heading: ${row["Heading Font"] ?? ""}  |  Body: ${row["Body Font"] ?? ""}`,
        `  Mood: ${row["Mood/Style Keywords"] ?? ""}`,
        `  Best For: ${row["Best For"] ?? ""}`,
        `  Google Fonts: ${row["Google Fonts URL"] ?? ""}`,
        `  CSS Import: ${row["CSS Import"] ?? ""}`,
      ].join("\n");
    case "ux":
      return [
        `**UX Rule:** ${row["Issue"] ?? row["Category"] ?? "Unknown"}`,
        `  Category: ${row["Category"] ?? ""}  |  Severity: ${row["Severity"] ?? ""}`,
        `  Do: ${row["Do"] ?? ""}`,
        `  Don't: ${row["Don't"] ?? ""}`,
        `  Good: ${row["Code Example Good"] ?? ""}`,
        `  Bad: ${row["Code Example Bad"] ?? ""}`,
      ].join("\n");
    case "landing":
      return [
        `**Pattern:** ${row["Pattern Name"] ?? "Unknown"}`,
        `  Sections: ${row["Section Order"] ?? ""}`,
        `  CTA Placement: ${row["Primary CTA Placement"] ?? ""}`,
        `  Color Strategy: ${row["Color Strategy"] ?? ""}`,
        `  Effects: ${row["Recommended Effects"] ?? ""}`,
        `  Conversion: ${row["Conversion Optimization"] ?? ""}`,
      ].join("\n");
    case "chart":
      return [
        `**Chart:** ${row["Best Chart Type"] ?? "Unknown"}`,
        `  Data Type: ${row["Data Type"] ?? ""}`,
        `  Alternatives: ${row["Secondary Options"] ?? ""}`,
        `  Colors: ${row["Color Guidance"] ?? ""}`,
        `  Library: ${row["Library Recommendation"] ?? ""}`,
        `  Accessibility: ${row["Accessibility Notes"] ?? ""}`,
      ].join("\n");
    case "product":
      return [
        `**Product:** ${row["Product Type"] ?? "Unknown"}`,
        `  Primary Style: ${row["Primary Style Recommendation"] ?? ""}`,
        `  Secondary Styles: ${row["Secondary Styles"] ?? ""}`,
        `  Landing Pattern: ${row["Landing Page Pattern"] ?? ""}`,
        `  Dashboard Style: ${row["Dashboard Style (if applicable)"] ?? ""}`,
        `  Color Focus: ${row["Color Palette Focus"] ?? ""}`,
        `  Key Considerations: ${row["Key Considerations"] ?? ""}`,
      ].join("\n");
    case "reasoning":
      return [
        `**Category:** ${row["UI_Category"] ?? "Unknown"}`,
        `  Pattern: ${row["Recommended_Pattern"] ?? ""}`,
        `  Style Priority: ${row["Style_Priority"] ?? ""}`,
        `  Color Mood: ${row["Color_Mood"] ?? ""}`,
        `  Typography Mood: ${row["Typography_Mood"] ?? ""}`,
        `  Key Effects: ${row["Key_Effects"] ?? ""}`,
        `  Anti-Patterns: ${row["Anti_Patterns"] ?? ""}`,
      ].join("\n");
    default:
      return Object.entries(row)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n");
  }
}

/** Format search results into a readable string. */
export function formatSearchResults(
  results: SearchResult[],
  query: string,
  domain: DesignDomain,
): string {
  if (results.length === 0) {
    return `No results found for "${query}" in domain "${domain}".`;
  }

  const header = `## Design Intelligence: ${domain}\n**Query:** ${query}\n**Results:** ${results.length}\n`;
  const body = results
    .map((r, i) => `### Result ${i + 1}\n${formatRow(r.domain, r.data)}`)
    .join("\n\n");

  return `${header}\n${body}`;
}

/**
 * Generate a complete design system recommendation by searching across
 * all domains and applying reasoning rules.
 */
export function generateDesignSystem(
  query: string,
  projectName?: string,
): string {
  // Search across all relevant domains
  const productResults = searchDesignDomain(query, "product", 1);
  const reasoningResults = searchDesignDomain(query, "reasoning", 1);
  const styleResults = searchDesignDomain(query, "style", 2);
  const colorResults = searchDesignDomain(query, "color", 1);
  const typographyResults = searchDesignDomain(query, "typography", 2);
  const landingResults = searchDesignDomain(query, "landing", 1);

  const product = productResults[0]?.data ?? null;
  const reasoning = reasoningResults[0]?.data ?? null;
  const style = styleResults[0]?.data ?? null;
  const color = colorResults[0]?.data ?? null;
  const typography = typographyResults[0]?.data ?? null;
  const landing = landingResults[0]?.data ?? null;

  // Build the design system output
  const parts: string[] = [];
  const title = projectName
    ? `# Design System: ${projectName}`
    : "# Design System Recommendation";
  parts.push(title);
  parts.push(`**Query:** ${query}\n`);

  // Product match
  if (product) {
    parts.push("## Product Type Match");
    parts.push(formatRow("product", product));
  }

  // Reasoning rule
  if (reasoning) {
    parts.push("\n## Design Reasoning");
    parts.push(formatRow("reasoning", reasoning));
  }

  // Landing page pattern
  if (landing) {
    parts.push("\n## Landing Page Pattern");
    parts.push(formatRow("landing", landing));
  }

  // Recommended style
  if (style) {
    parts.push("\n## Recommended Style");
    parts.push(formatRow("style", style));
    if (styleResults.length > 1) {
      parts.push("\n### Alternative Style");
      parts.push(formatRow("style", styleResults[1]!.data));
    }
  }

  // Color palette
  if (color) {
    parts.push("\n## Color Palette");
    parts.push(formatRow("color", color));
  }

  // Typography
  if (typography) {
    parts.push("\n## Typography");
    parts.push(formatRow("typography", typography));
    if (typographyResults.length > 1) {
      parts.push("\n### Alternative Typography");
      parts.push(formatRow("typography", typographyResults[1]!.data));
    }
  }

  // Anti-patterns (from reasoning + style)
  const antiPatterns: string[] = [];
  if (reasoning?.["Anti_Patterns"]) antiPatterns.push(reasoning["Anti_Patterns"]);
  if (style?.["Do Not Use For"]) antiPatterns.push(style["Do Not Use For"]);
  if (antiPatterns.length > 0) {
    parts.push("\n## Anti-Patterns (AVOID)");
    parts.push(antiPatterns.join("\n"));
  }

  // Pre-delivery checklist
  parts.push("\n## Pre-Delivery Checklist");
  parts.push(`- [ ] No emojis as icons (use SVG: Heroicons/Lucide)
- [ ] cursor-pointer on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] prefers-reduced-motion respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No horizontal scroll on mobile
- [ ] Form inputs have labels
- [ ] Color is not sole information carrier`);

  return parts.join("\n");
}
