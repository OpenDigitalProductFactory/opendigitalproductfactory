// packages/db/src/seed-prompt-templates.ts
// Reads prompts/*.prompt.md files, parses YAML frontmatter, upserts into PromptTemplate table.
// Idempotent: skips rows where isOverridden=true (admin has customized).

import { readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import { Prisma } from "../generated/client/client";
import type { PrismaClient } from "../generated/client/client";

const PROMPTS_DIR = join(__dirname, "..", "..", "..", "prompts");

type PromptFrontmatter = {
  name: string;
  displayName: string;
  description?: string;
  category: string;
  version?: number;
  composesFrom?: string[];
  contentFormat?: string;
  variables?: Array<{ name: string; required?: boolean }>;
  valueStream?: string;
  stage?: string;
  sensitivity?: string;
  perspective?: string;
  heuristics?: string;
  interpretiveModel?: string;
};

/**
 * Simple YAML frontmatter parser — handles the subset used by .prompt.md files.
 * Does not handle nested objects or multi-line values (not needed here).
 */
function parseFrontmatter(raw: string): { frontmatter: PromptFrontmatter; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Missing YAML frontmatter delimiters (---)");
  }

  const yamlBlock = match[1];
  const content = match[2].trim();

  const fm: Record<string, unknown> = {};
  let currentKey = "";
  let inArray = false;
  let arrayItems: string[] = [];

  for (const line of yamlBlock.split("\n")) {
    // Skip comments and blank lines
    if (line.trim().startsWith("#") || line.trim() === "") continue;

    // Array item
    if (inArray && line.match(/^\s+-\s/)) {
      const val = line.replace(/^\s+-\s/, "").trim().replace(/^["']|["']$/g, "");
      arrayItems.push(val);
      continue;
    }

    // End of array — save it
    if (inArray) {
      fm[currentKey] = arrayItems;
      inArray = false;
      arrayItems = [];
    }

    // Key: value pair
    const kvMatch = line.match(/^(\w[\w.]*)\s*:\s*(.*)/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    let value = kvMatch[2].trim();

    // Inline array: [item1, item2]
    if (value.startsWith("[")) {
      const inner = value.replace(/^\[|\]$/g, "").trim();
      if (inner === "") {
        fm[key] = [];
      } else {
        fm[key] = inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      }
      continue;
    }

    // Start of block array (value is empty, items on next lines)
    if (value === "") {
      currentKey = key;
      inArray = true;
      arrayItems = [];
      continue;
    }

    // Strip quotes
    value = value.replace(/^["']|["']$/g, "");

    // Type coercion
    if (value === "true") fm[key] = true;
    else if (value === "false") fm[key] = false;
    else if (/^\d+$/.test(value)) fm[key] = parseInt(value, 10);
    else fm[key] = value;
  }

  // Flush trailing array
  if (inArray) {
    fm[currentKey] = arrayItems;
  }

  return { frontmatter: fm as unknown as PromptFrontmatter, content };
}

/**
 * Discover all .prompt.md files under the prompts/ directory tree.
 */
function discoverPromptFiles(): Array<{ category: string; slug: string; filePath: string }> {
  const results: Array<{ category: string; slug: string; filePath: string }> = [];

  let categories: string[];
  try {
    categories = readdirSync(PROMPTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    console.warn("[seed-prompts] prompts/ directory not found — skipping prompt template seed");
    return [];
  }

  for (const category of categories) {
    const categoryDir = join(PROMPTS_DIR, category);
    const files = readdirSync(categoryDir).filter((f) => f.endsWith(".prompt.md"));
    for (const file of files) {
      const slug = basename(file, ".prompt.md");
      results.push({ category, slug, filePath: join(categoryDir, file) });
    }
  }

  return results;
}

export async function seedPromptTemplates(prisma: PrismaClient): Promise<void> {
  const files = discoverPromptFiles();
  if (files.length === 0) return;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const { category, slug, filePath } of files) {
    const raw = readFileSync(filePath, "utf-8");
    const { frontmatter, content } = parseFrontmatter(raw);

    // Build metadata from extra frontmatter fields
    const metadata: Record<string, unknown> = {};
    if (frontmatter.valueStream) metadata.valueStream = frontmatter.valueStream;
    if (frontmatter.stage) metadata.stage = frontmatter.stage;
    if (frontmatter.sensitivity) metadata.sensitivity = frontmatter.sensitivity;
    if (frontmatter.perspective) metadata.perspective = frontmatter.perspective;
    if (frontmatter.heuristics) metadata.heuristics = frontmatter.heuristics;
    if (frontmatter.interpretiveModel) metadata.interpretiveModel = frontmatter.interpretiveModel;

    const existing = await prisma.promptTemplate.findUnique({
      where: { category_slug: { category, slug } },
    });

    if (existing) {
      if (existing.isOverridden) {
        // Admin has customized — don't overwrite
        skipped++;
        continue;
      }
      // Update from file (source of truth)
      await prisma.promptTemplate.update({
        where: { id: existing.id },
        data: {
          name: frontmatter.displayName,
          description: frontmatter.description ?? null,
          content,
          contentFormat: frontmatter.contentFormat ?? "markdown",
          composesFrom: frontmatter.composesFrom ?? [],
          variables: frontmatter.variables ?? Prisma.DbNull,
          metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      });
      updated++;
    } else {
      await prisma.promptTemplate.create({
        data: {
          category,
          slug,
          name: frontmatter.displayName,
          description: frontmatter.description ?? null,
          content,
          contentFormat: frontmatter.contentFormat ?? "markdown",
          composesFrom: frontmatter.composesFrom ?? [],
          variables: frontmatter.variables ?? Prisma.DbNull,
          metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonValue) : Prisma.DbNull,
          isOverridden: false,
          enabled: true,
          version: 1,
        },
      });
      created++;
    }
  }

  console.log(
    `Seeded prompt templates: ${created} created, ${updated} updated, ${skipped} skipped (overridden)`,
  );
}
