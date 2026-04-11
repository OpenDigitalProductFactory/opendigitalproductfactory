"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** YAML frontmatter fields from the Agent Skills standard (SKILL.md). */
export interface SkillMdFrontmatter {
  name: string;
  description: string;
  "disable-model-invocation"?: boolean;
  "user-invocable"?: boolean;
  "allowed-tools"?: string;
  context?: string;
  agent?: string;
  model?: string;
  effort?: string;
  // Extended fields (Phase 2 enrichment)
  triggerPattern?: string;
  userInvocable?: boolean;
  agentInvocable?: boolean;
  allowedTools?: string[];
  composesFrom?: string[];
  contextRequirements?: string[];
  capability?: string | null;
  taskType?: string;
  category?: string;
  assignTo?: string[];
  riskBand?: string;
}

export interface SkillIngestionInput {
  /** Raw SKILL.md content (YAML frontmatter + markdown body). */
  skillMdContent: string;
  sourceType: "marketplace" | "github" | "internal" | "community";
  sourceUrl?: string;
  sourceRegistry?: string;
  category?: string;
  tags?: string[];
  author?: string;
  license?: string;
}

export interface SkillIngestionResult {
  skillId: string;
  name: string;
  created: boolean; // true = new, false = updated
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser (lightweight — no heavy deps)
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a SKILL.md string.
 * Expects `---` delimiters. Returns parsed key-value pairs and the body.
 */
function parseSkillMd(raw: string): {
  frontmatter: SkillMdFrontmatter;
  body: string;
} {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("---")) {
    throw new Error("SKILL.md must start with YAML frontmatter (---)");
  }

  const endIdx = trimmed.indexOf("---", 3);
  if (endIdx === -1) {
    throw new Error("SKILL.md frontmatter is missing closing ---");
  }

  const yamlBlock = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trim();

  const frontmatter: Record<string, string | boolean | string[] | null> = {};
  for (const line of yamlBlock.split("\n")) {
    if (line.trim().startsWith("#") || line.trim() === "") continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: string | boolean | string[] | null = line.slice(colonIdx + 1).trim();
    // Inline array: ["item1", "item2"] or [item1, item2]
    if (typeof value === "string" && value.startsWith("[")) {
      const inner = value.replace(/^\[|\]$/g, "").trim();
      if (inner === "") {
        frontmatter[key] = [];
      } else {
        frontmatter[key] = inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      }
      continue;
    }
    // Strip surrounding quotes
    if (
      typeof value === "string" &&
      ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    // Boolean / null coercion
    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (value === "null") value = null;
    frontmatter[key] = value;
  }

  if (!frontmatter.name || typeof frontmatter.name !== "string") {
    throw new Error("SKILL.md frontmatter must include a 'name' field");
  }
  if (!frontmatter.description || typeof frontmatter.description !== "string") {
    throw new Error("SKILL.md frontmatter must include a 'description' field");
  }

  return {
    frontmatter: frontmatter as unknown as SkillMdFrontmatter,
    body,
  };
}

// ---------------------------------------------------------------------------
// Single skill ingestion
// ---------------------------------------------------------------------------

/** Ingest a single SKILL.md — creates or updates the SkillDefinition. */
export async function ingestSkill(
  input: SkillIngestionInput
): Promise<SkillIngestionResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const { frontmatter } = parseSkillMd(input.skillMdContent);
  const skillId = frontmatter.name; // Agent Skills standard: name is the unique ID

  const existing = await prisma.skillDefinition.findUnique({
    where: { skillId },
  });

  // Extract enriched fields from frontmatter
  const enrichedFields = {
    triggerPattern: frontmatter.triggerPattern ?? null,
    userInvocable: frontmatter.userInvocable ?? (frontmatter["user-invocable"] !== false),
    agentInvocable: frontmatter.agentInvocable ?? true,
    allowedTools: frontmatter.allowedTools ?? [],
    composesFrom: frontmatter.composesFrom ?? [],
    contextRequirements: frontmatter.contextRequirements ?? [],
    capability: typeof frontmatter.capability === "string" ? frontmatter.capability : null,
    taskType: frontmatter.taskType ?? "conversation",
  };

  if (existing) {
    await prisma.skillDefinition.update({
      where: { skillId },
      data: {
        name: frontmatter.name,
        description: frontmatter.description,
        skillMdContent: input.skillMdContent,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl ?? existing.sourceUrl,
        sourceRegistry: input.sourceRegistry ?? existing.sourceRegistry,
        category: input.category ?? frontmatter.category ?? existing.category,
        tags: input.tags ?? existing.tags,
        author: input.author ?? existing.author,
        license: input.license ?? existing.license,
        ...enrichedFields,
      },
    });
    return { skillId, name: frontmatter.name, created: false };
  }

  await prisma.skillDefinition.create({
    data: {
      skillId,
      name: frontmatter.name,
      description: frontmatter.description,
      skillMdContent: input.skillMdContent,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl ?? null,
      sourceRegistry: input.sourceRegistry ?? null,
      category: input.category ?? frontmatter.category ?? "ai-agents",
      tags: input.tags ?? [],
      author: input.author ?? null,
      license: input.license ?? null,
      ...enrichedFields,
    },
  });
  return { skillId, name: frontmatter.name, created: true };
}

// ---------------------------------------------------------------------------
// Bulk ingestion
// ---------------------------------------------------------------------------

export interface BulkIngestionResult {
  total: number;
  created: number;
  updated: number;
  errors: Array<{ index: number; error: string }>;
}

/** Ingest multiple SKILL.md files in a single call. */
export async function ingestSkillsBulk(
  inputs: SkillIngestionInput[]
): Promise<BulkIngestionResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const result: BulkIngestionResult = {
    total: inputs.length,
    created: 0,
    updated: 0,
    errors: [],
  };

  for (let i = 0; i < inputs.length; i++) {
    try {
      const r = await ingestSkill(inputs[i]);
      if (r.created) result.created++;
      else result.updated++;
    } catch (err) {
      result.errors.push({
        index: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Catalog queries (used by the admin skills page)
// ---------------------------------------------------------------------------

export interface SkillCatalogFilters {
  search?: string;
  status?: string;
  sourceType?: string;
  category?: string;
}

export async function getSkillCatalog(filters?: SkillCatalogFilters) {
  const where: Record<string, unknown> = {};

  if (filters?.status) {
    where.status = filters.status;
  }
  if (filters?.sourceType) {
    where.sourceType = filters.sourceType;
  }
  if (filters?.category) {
    where.category = filters.category;
  }
  if (filters?.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
      { tags: { has: filters.search.toLowerCase() } },
    ];
  }

  return prisma.skillDefinition.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { assignments: true } },
    },
  });
}

export async function getSkillCatalogStats() {
  const [total, byStatus, bySource] = await Promise.all([
    prisma.skillDefinition.count(),
    prisma.skillDefinition.groupBy({ by: ["status"], _count: true }),
    prisma.skillDefinition.groupBy({ by: ["sourceType"], _count: true }),
  ]);
  return { total, byStatus, bySource };
}
