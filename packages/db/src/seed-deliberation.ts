// packages/db/src/seed-deliberation.ts
// Reads deliberation/*.deliberation.md files, parses YAML frontmatter, and
// produces DeliberationPattern seed records.
//
// NOTE (Task 1 scope): the Prisma models DeliberationPattern and
// DeliberationRoleProfile do NOT exist yet — they arrive in Task 2 of the
// plan. This module is therefore authored as pure parse/discover logic with
// an injected `getExisting/create/update` surface so the behaviour
// (including the isOverridden skip mirrored from seed-prompt-templates.ts)
// is fully exercised by tests today. When Task 2 lands the Prisma bindings,
// the entry wrapper can be extended to pass real DB callbacks.
//
// Idempotency contract (mirrors seed-prompt-templates.ts):
//   - create a row when none exists for the slug
//   - update a row from the file when it exists and isOverridden=false
//   - skip the row when isOverridden=true (admin has customized at runtime)

import { readdirSync, readFileSync } from "fs";
import { join, basename } from "path";

const DELIBERATION_DIR = join(__dirname, "..", "..", "..", "deliberation");

/* -------------------------------------------------------------------------- */
/* Frontmatter types                                                          */
/* -------------------------------------------------------------------------- */

export type DeliberationRole = {
  roleId: string;
  count: number;
  required: boolean;
};

export type DeliberationFrontmatter = {
  slug: string;
  name: string;
  status: string;
  purpose: string;
  defaultRoles: DeliberationRole[];
  topologyTemplate: Record<string, unknown>;
  activationPolicyHints?: Record<string, unknown>;
  evidenceRequirements?: Record<string, unknown>;
  outputContract?: Record<string, unknown>;
  providerStrategyHints?: Record<string, unknown>;
};

export type DeliberationRecord = {
  slug: string;
  name: string;
  purpose: string;
  defaultRoles: DeliberationRole[];
  topologyTemplate: Record<string, unknown>;
  activationPolicyHints: Record<string, unknown>;
  evidenceRequirements: Record<string, unknown>;
  outputContract: Record<string, unknown>;
  providerStrategyHints: Record<string, unknown>;
  status: string;
  sourceFile: string;
};

/* -------------------------------------------------------------------------- */
/* Frontmatter parser                                                         */
/*                                                                            */
/* Handles the subset of YAML used by .deliberation.md files:                 */
/*   - scalar key: value (with type coercion)                                 */
/*   - inline arrays [a, b, c]                                                */
/*   - block arrays of scalars                                                */
/*   - block arrays of mappings (e.g. defaultRoles)                           */
/*   - nested mappings one level deep (e.g. topologyTemplate)                 */
/* -------------------------------------------------------------------------- */

function countIndent(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

function coerceScalar(raw: string): unknown {
  let value = raw.trim();
  // Inline array
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((s) => {
      const t = s.trim();
      return t.replace(/^["']|["']$/g, "");
    });
  }
  // Quoted string
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}

/**
 * Parse an indented YAML block (e.g. the body of a block-array item, or a
 * nested mapping). Starts at `startIdx` and consumes lines whose indentation
 * is >= `baseIndent`. Returns the parsed object and the index of the first
 * line that did NOT belong to this block.
 *
 * Supports:
 *   - nested `key: value` mappings at `baseIndent`
 *   - nested block arrays (`key:` followed by `  - ...`)
 *   - nested block-of-mappings (`key:` followed by `  - nestedKey: value`)
 */
function parseBlock(
  lines: string[],
  startIdx: number,
  baseIndent: number,
): { value: Record<string, unknown>; nextIdx: number } {
  const obj: Record<string, unknown> = {};
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = countIndent(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      // Unexpected deeper indent at this position — skip to avoid infinite loop.
      i++;
      continue;
    }

    // key: value at baseIndent
    const kvMatch = line.match(/^\s*(\w[\w.-]*)\s*:\s*(.*)$/);
    if (!kvMatch) {
      i++;
      continue;
    }
    const key = kvMatch[1];
    const rawValue = kvMatch[2];

    if (rawValue.trim() === "") {
      // Block value follows. Peek next non-blank line to decide shape.
      let peek = i + 1;
      while (
        peek < lines.length &&
        (lines[peek].trim() === "" || lines[peek].trim().startsWith("#"))
      ) {
        peek++;
      }
      if (peek >= lines.length) {
        obj[key] = "";
        i++;
        continue;
      }
      const peekLine = lines[peek];
      const peekIndent = countIndent(peekLine);
      const peekTrimmed = peekLine.trim();
      if (peekIndent <= baseIndent) {
        // No block follows — treat as empty scalar
        obj[key] = "";
        i++;
        continue;
      }
      if (peekTrimmed.startsWith("- ") || peekTrimmed === "-") {
        // Block array
        const { items, nextIdx } = parseBlockArray(lines, peek, peekIndent);
        obj[key] = items;
        i = nextIdx;
        continue;
      }
      // Nested mapping
      const { value: nested, nextIdx } = parseBlock(lines, peek, peekIndent);
      obj[key] = nested;
      i = nextIdx;
      continue;
    }

    obj[key] = coerceScalar(rawValue);
    i++;
  }
  return { value: obj, nextIdx: i };
}

/**
 * Parse a block array whose items each start with `- ` at `itemIndent`.
 * Items may be scalar (`- foo`) or mappings (`- key: value` with subsequent
 * continuation lines at a deeper indent).
 */
function parseBlockArray(
  lines: string[],
  startIdx: number,
  itemIndent: number,
): { items: unknown[]; nextIdx: number } {
  const items: unknown[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = countIndent(line);
    if (indent < itemIndent) break;
    if (indent > itemIndent) {
      // Unexpected deeper indent outside a mapping context — skip.
      i++;
      continue;
    }
    if (!trimmed.startsWith("-")) break;

    // Strip the leading "- " (or "-")
    const afterDash = trimmed.replace(/^-\s*/, "");

    if (afterDash === "") {
      // "- " with nothing — treat as empty mapping/scalar; advance.
      items.push(null);
      i++;
      continue;
    }

    // Check if this is a mapping item: "- key: value"
    const kvMatch = afterDash.match(/^(\w[\w.-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const obj: Record<string, unknown> = {};
      const firstKey = kvMatch[1];
      const firstRaw = kvMatch[2];
      if (firstRaw.trim() !== "") {
        obj[firstKey] = coerceScalar(firstRaw);
      } else {
        obj[firstKey] = "";
      }
      // Consume continuation lines at indent > itemIndent that belong to this item.
      // Continuation indent is itemIndent + 2 typically, but we accept any deeper indent.
      let j = i + 1;
      // Determine the mapping's continuation indent from the first continuation line.
      let contIndent: number | null = null;
      while (j < lines.length) {
        const nextLine = lines[j];
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed === "" || nextTrimmed.startsWith("#")) {
          j++;
          continue;
        }
        const nextIndent = countIndent(nextLine);
        if (nextIndent <= itemIndent) break;
        if (contIndent === null) contIndent = nextIndent;
        if (nextIndent < contIndent) break;
        if (nextIndent > contIndent) {
          // Should be consumed by a nested parseBlock call below, not here.
          j++;
          continue;
        }
        const kv2 = nextLine.match(/^\s*(\w[\w.-]*)\s*:\s*(.*)$/);
        if (!kv2) {
          j++;
          continue;
        }
        const k = kv2[1];
        const rawV = kv2[2];
        if (rawV.trim() === "") {
          // Nested block under this key — peek deeper.
          let peek = j + 1;
          while (
            peek < lines.length &&
            (lines[peek].trim() === "" || lines[peek].trim().startsWith("#"))
          ) {
            peek++;
          }
          if (peek < lines.length) {
            const peekIndent = countIndent(lines[peek]);
            const peekTrimmed = lines[peek].trim();
            if (peekIndent > contIndent) {
              if (peekTrimmed.startsWith("- ") || peekTrimmed === "-") {
                const { items: nestedItems, nextIdx } = parseBlockArray(
                  lines,
                  peek,
                  peekIndent,
                );
                obj[k] = nestedItems;
                j = nextIdx;
                continue;
              }
              const { value: nested, nextIdx } = parseBlock(
                lines,
                peek,
                peekIndent,
              );
              obj[k] = nested;
              j = nextIdx;
              continue;
            }
          }
          obj[k] = "";
          j++;
          continue;
        }
        obj[k] = coerceScalar(rawV);
        j++;
      }
      items.push(obj);
      i = j;
      continue;
    }

    // Scalar item
    items.push(coerceScalar(afterDash));
    i++;
  }
  return { items, nextIdx: i };
}

/**
 * Parse the YAML frontmatter of a .deliberation.md file.
 */
export function parseFrontmatter(raw: string): {
  frontmatter: DeliberationFrontmatter;
  body: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Missing YAML frontmatter delimiters (---)");
  }
  const yamlBlock = match[1];
  const body = match[2].trim();

  const lines = yamlBlock.split("\n");
  const { value } = parseBlock(lines, 0, 0);
  return {
    frontmatter: value as unknown as DeliberationFrontmatter,
    body,
  };
}

/* -------------------------------------------------------------------------- */
/* File discovery and record assembly                                         */
/* -------------------------------------------------------------------------- */

export function discoverDeliberationFiles(): Array<{
  slug: string;
  filePath: string;
}> {
  const results: Array<{ slug: string; filePath: string }> = [];
  let entries: string[];
  try {
    entries = readdirSync(DELIBERATION_DIR).filter((f) =>
      f.endsWith(".deliberation.md"),
    );
  } catch {
    console.warn(
      "[seed-deliberation] deliberation/ directory not found — skipping deliberation pattern seed",
    );
    return [];
  }
  for (const file of entries) {
    const slug = basename(file, ".deliberation.md");
    results.push({ slug, filePath: join(DELIBERATION_DIR, file) });
  }
  return results;
}

export function parseDeliberationFile(filePath: string): DeliberationRecord {
  const raw = readFileSync(filePath, "utf-8");
  const { frontmatter } = parseFrontmatter(raw);

  const defaultRoles = Array.isArray(frontmatter.defaultRoles)
    ? (frontmatter.defaultRoles as DeliberationRole[])
    : [];

  const asObject = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    slug: String(frontmatter.slug ?? basename(filePath, ".deliberation.md")),
    name: String(frontmatter.name ?? ""),
    purpose: String(frontmatter.purpose ?? ""),
    defaultRoles,
    topologyTemplate: asObject(frontmatter.topologyTemplate),
    activationPolicyHints: asObject(frontmatter.activationPolicyHints),
    evidenceRequirements: asObject(frontmatter.evidenceRequirements),
    outputContract: asObject(frontmatter.outputContract),
    providerStrategyHints: asObject(frontmatter.providerStrategyHints),
    status: String(frontmatter.status ?? "active"),
    sourceFile: `deliberation/${basename(filePath)}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Upsert behaviour — injected I/O so the logic is testable without Prisma    */
/* -------------------------------------------------------------------------- */

export type ExistingPattern = {
  slug: string;
  isOverridden: boolean;
};

export type ApplyDeliberationPatternsOptions = {
  records: DeliberationRecord[];
  getExisting: (slug: string) => Promise<ExistingPattern | null>;
  create: (record: DeliberationRecord) => Promise<void>;
  update: (record: DeliberationRecord) => Promise<void>;
  onSkip?: (slug: string) => void;
};

export type ApplyDeliberationPatternsResult = {
  created: number;
  updated: number;
  skipped: number;
};

/**
 * Idempotent upsert driver. Mirrors the isOverridden-skip behaviour used by
 * seed-prompt-templates.ts. Pure function apart from the injected callbacks,
 * so it can be unit-tested without touching Prisma.
 */
export async function applyDeliberationPatterns(
  opts: ApplyDeliberationPatternsOptions,
): Promise<ApplyDeliberationPatternsResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const record of opts.records) {
    const existing = await opts.getExisting(record.slug);
    if (existing === null) {
      await opts.create(record);
      created++;
      continue;
    }
    if (existing.isOverridden) {
      skipped++;
      opts.onSkip?.(record.slug);
      continue;
    }
    await opts.update(record);
    updated++;
  }

  return { created, updated, skipped };
}

/* -------------------------------------------------------------------------- */
/* Top-level entry                                                             */
/*                                                                            */
/* Task 1 scope: the DeliberationPattern Prisma model does not yet exist.    */
/* This function discovers and parses the files, logs a summary, and returns  */
/* the parsed records. Task 2 will add the Prisma model and extend this       */
/* wrapper to call applyDeliberationPatterns with real DB callbacks.          */
/* -------------------------------------------------------------------------- */

export async function seedDeliberationPatterns(
  _prisma?: unknown,
): Promise<DeliberationRecord[]> {
  const files = discoverDeliberationFiles();
  if (files.length === 0) return [];

  const records: DeliberationRecord[] = [];
  for (const { slug, filePath } of files) {
    try {
      records.push(parseDeliberationFile(filePath));
    } catch (err) {
      console.warn(
        `[seed-deliberation] Failed to parse ${slug}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  console.log(
    `Parsed deliberation patterns: ${records.length} (DB upsert deferred until Task 2 adds DeliberationPattern model)`,
  );
  return records;
}
