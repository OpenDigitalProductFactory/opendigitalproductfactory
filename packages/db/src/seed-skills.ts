// packages/db/src/seed-skills.ts
// Reads skills/**/*.skill.md files, parses YAML frontmatter, upserts into
// SkillDefinition + SkillAssignment tables.
// Idempotent: existing SkillDefinitions are updated unless admin has overridden.

import { readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import type { PrismaClient } from "../generated/client/client";

const SKILLS_DIR = join(__dirname, "..", "..", "..", "skills");

type SkillFrontmatter = {
  name: string;
  description: string;
  category: string;
  assignTo: string[];       // ["agent-id"] or ["*"] for all agents
  capability: string | null;
  taskType: string;
  triggerPattern: string | null;
  userInvocable: boolean;
  agentInvocable: boolean;
  allowedTools: string[];
  composesFrom: string[];
  contextRequirements: string[];
  riskBand: string;
};

// All known agent IDs — used when assignTo includes "*"
const ALL_AGENT_IDS = [
  "portfolio-advisor",
  "inventory-specialist",
  "ea-architect",
  "hr-specialist",
  "customer-advisor",
  "ops-coordinator",
  "platform-engineer",
  "build-specialist",
  "admin-assistant",
  "marketing-specialist",
  "onboarding-coo",
  "coo",
  "compliance-officer",
  "docs-specialist",
];

/**
 * Simple YAML frontmatter parser for .skill.md files.
 * Handles the subset of YAML used: scalars, inline arrays, booleans, null.
 */
function parseFrontmatter(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Missing YAML frontmatter delimiters (---)");
  }

  const yamlBlock = match[1];
  const body = match[2].trim();

  const fm: Record<string, unknown> = {};

  for (const line of yamlBlock.split("\n")) {
    if (line.trim().startsWith("#") || line.trim() === "") continue;

    const kvMatch = line.match(/^(\w[\w.-]*)\s*:\s*(.*)/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    let value: string = kvMatch[2].trim();

    // Inline array: ["item1", "item2"] or [item1, item2]
    if (value.startsWith("[")) {
      const inner = value.replace(/^\[|\]$/g, "").trim();
      if (inner === "") {
        fm[key] = [];
      } else {
        fm[key] = inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      }
      continue;
    }

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Type coercion
    if (value === "true") fm[key] = true;
    else if (value === "false") fm[key] = false;
    else if (value === "null") fm[key] = null;
    else fm[key] = value;
  }

  return {
    frontmatter: fm as unknown as SkillFrontmatter,
    body,
  };
}

/**
 * Discover all .skill.md files under the skills/ directory tree.
 */
function discoverSkillFiles(): Array<{ category: string; filePath: string }> {
  const results: Array<{ category: string; filePath: string }> = [];

  let categories: string[];
  try {
    categories = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    console.warn("[seed-skills] skills/ directory not found — skipping skill seed");
    return [];
  }

  for (const category of categories) {
    const categoryDir = join(SKILLS_DIR, category);
    const files = readdirSync(categoryDir).filter((f) => f.endsWith(".skill.md"));
    for (const file of files) {
      results.push({ category, filePath: join(categoryDir, file) });
    }
  }

  return results;
}

export async function seedSkills(prisma: PrismaClient): Promise<void> {
  const files = discoverSkillFiles();
  if (files.length === 0) return;

  let created = 0;
  let updated = 0;
  let assignments = 0;

  for (const { category, filePath } of files) {
    const raw = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);

    const skillId = frontmatter.name;
    if (!skillId) {
      console.warn(`[seed-skills] Skipping ${basename(filePath)} — no 'name' in frontmatter`);
      continue;
    }

    const skillMdContent = raw; // Store the full file content including frontmatter

    const data = {
      name: skillId,
      description: frontmatter.description ?? "",
      skillMdContent,
      sourceType: "internal" as const,
      category: frontmatter.category ?? category,
      tags: [],
      riskBand: frontmatter.riskBand ?? "low",
      status: "active",
      triggerPattern: frontmatter.triggerPattern ?? null,
      userInvocable: frontmatter.userInvocable !== false,
      agentInvocable: frontmatter.agentInvocable !== false,
      allowedTools: frontmatter.allowedTools ?? [],
      composesFrom: frontmatter.composesFrom ?? [],
      contextRequirements: frontmatter.contextRequirements ?? [],
      capability: typeof frontmatter.capability === "string" ? frontmatter.capability : null,
      taskType: frontmatter.taskType ?? "conversation",
    };

    const existing = await prisma.skillDefinition.findUnique({
      where: { skillId },
    });

    if (existing) {
      await prisma.skillDefinition.update({
        where: { skillId },
        data,
      });
      updated++;
    } else {
      await prisma.skillDefinition.create({
        data: { skillId, ...data },
      });
      created++;
    }

    // Create SkillAssignment records
    const assignTo = frontmatter.assignTo ?? [];
    const targetAgents = assignTo.includes("*") ? ALL_AGENT_IDS : assignTo;

    for (const agentId of targetAgents) {
      const existing = await prisma.skillAssignment.findUnique({
        where: { skillId_agentId: { skillId, agentId } },
      });
      if (!existing) {
        await prisma.skillAssignment.create({
          data: {
            skillId,
            agentId,
            priority: assignTo.includes("*") ? 0 : 10, // Route-specific skills get higher priority
            enabled: true,
            assignedBy: "system-seed",
          },
        });
        assignments++;
      }
    }
  }

  console.log(
    `Seeded skills: ${created} created, ${updated} updated, ${assignments} assignments`,
  );
}
