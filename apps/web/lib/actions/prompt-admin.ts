"use server";
// Server actions for Admin > Prompts page.
// CRUD on PromptTemplate + PromptRevision with cache invalidation.

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { invalidatePromptCache } from "@/lib/tak/prompt-loader";
import { lazyFs, lazyPath } from "@/lib/shared/lazy-node";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PromptCatalogEntry = {
  id: string;
  category: string;
  slug: string;
  name: string;
  description: string | null;
  isOverridden: boolean;
  enabled: boolean;
  version: number;
  updatedAt: Date;
};

export type PromptCatalogGroup = {
  category: string;
  label: string;
  prompts: PromptCatalogEntry[];
};

export type PromptTemplateDetail = {
  id: string;
  category: string;
  slug: string;
  name: string;
  description: string | null;
  content: string;
  contentFormat: string;
  composesFrom: string[];
  variables: unknown;
  metadata: unknown;
  isOverridden: boolean;
  enabled: boolean;
  version: number;
  updatedAt: Date;
  updatedBy: string | null;
  revisions: Array<{
    id: string;
    version: number;
    changeReason: string | null;
    changedBy: string | null;
    createdAt: Date;
  }>;
};

// ─── Category Labels ────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  "platform-identity": "Platform Identity",
  "platform-preamble": "Platform Preamble",
  "route-persona": "Route Personas",
  "build-phase": "Build Phases",
  specialist: "Specialists",
  reviewer: "Reviewers",
  context: "Context",
};

const CATEGORY_ORDER = [
  "platform-identity",
  "platform-preamble",
  "route-persona",
  "build-phase",
  "specialist",
  "reviewer",
  "context",
];

// ─── Actions ────────────────────────────────────────────────────────────────

export async function getPromptCatalog(): Promise<PromptCatalogGroup[]> {
  const rows = await prisma.promptTemplate.findMany({
    select: {
      id: true,
      category: true,
      slug: true,
      name: true,
      description: true,
      isOverridden: true,
      enabled: true,
      version: true,
      updatedAt: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const grouped = new Map<string, PromptCatalogEntry[]>();
  for (const row of rows) {
    const list = grouped.get(row.category) ?? [];
    list.push(row);
    grouped.set(row.category, list);
  }

  // Sort by canonical order, then alphabetically for unknown categories
  const result: PromptCatalogGroup[] = [];
  for (const cat of CATEGORY_ORDER) {
    const prompts = grouped.get(cat);
    if (prompts) {
      result.push({
        category: cat,
        label: CATEGORY_LABELS[cat] ?? cat,
        prompts,
      });
      grouped.delete(cat);
    }
  }
  // Any remaining categories
  for (const [cat, prompts] of grouped) {
    result.push({ category: cat, label: CATEGORY_LABELS[cat] ?? cat, prompts });
  }

  return result;
}

export async function getPromptTemplate(
  category: string,
  slug: string,
): Promise<PromptTemplateDetail | null> {
  const row = await prisma.promptTemplate.findUnique({
    where: { category_slug: { category, slug } },
    include: {
      revisions: {
        orderBy: { version: "desc" },
        take: 20,
        select: {
          id: true,
          version: true,
          changeReason: true,
          changedBy: true,
          createdAt: true,
        },
      },
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    category: row.category,
    slug: row.slug,
    name: row.name,
    description: row.description,
    content: row.content,
    contentFormat: row.contentFormat,
    composesFrom: row.composesFrom,
    variables: row.variables,
    metadata: row.metadata,
    isOverridden: row.isOverridden,
    enabled: row.enabled,
    version: row.version,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    revisions: row.revisions,
  };
}

export async function updatePromptContent(
  category: string,
  slug: string,
  content: string,
  changeReason?: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Not authenticated" };

  const existing = await prisma.promptTemplate.findUnique({
    where: { category_slug: { category, slug } },
  });
  if (!existing) return { success: false, error: "Prompt template not found" };

  const newVersion = existing.version + 1;

  await prisma.$transaction([
    // Create revision snapshot
    prisma.promptRevision.create({
      data: {
        templateId: existing.id,
        version: newVersion,
        content,
        metadata: existing.metadata ?? undefined,
        changeReason: changeReason ?? null,
        changedBy: session.user.id,
      },
    }),
    // Update template
    prisma.promptTemplate.update({
      where: { id: existing.id },
      data: {
        content,
        isOverridden: true,
        version: newVersion,
        updatedBy: session.user.id,
      },
    }),
  ]);

  invalidatePromptCache(category, slug);
  return { success: true };
}

export async function resetPromptToDefault(
  category: string,
  slug: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Not authenticated" };

  // Read the original .prompt.md file
  const filePath = lazyPath().join(
    process.cwd(),
    "..",
    "..",
    "prompts",
    category,
    `${slug}.prompt.md`,
  );

  let fileContent: string;
  try {
    const raw = lazyFs().readFileSync(filePath, "utf-8");
    // Extract content below frontmatter
    const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    fileContent = match ? match[1].trim() : raw;
  } catch {
    return { success: false, error: "Default prompt file not found" };
  }

  const existing = await prisma.promptTemplate.findUnique({
    where: { category_slug: { category, slug } },
  });
  if (!existing) return { success: false, error: "Prompt template not found" };

  const newVersion = existing.version + 1;

  await prisma.$transaction([
    prisma.promptRevision.create({
      data: {
        templateId: existing.id,
        version: newVersion,
        content: fileContent,
        changeReason: "Reset to default",
        changedBy: session.user.id,
      },
    }),
    prisma.promptTemplate.update({
      where: { id: existing.id },
      data: {
        content: fileContent,
        isOverridden: false,
        version: newVersion,
        updatedBy: session.user.id,
      },
    }),
  ]);

  invalidatePromptCache(category, slug);
  return { success: true };
}

export async function getPromptRevisionContent(
  revisionId: string,
): Promise<string | null> {
  const rev = await prisma.promptRevision.findUnique({
    where: { id: revisionId },
    select: { content: true },
  });
  return rev?.content ?? null;
}
