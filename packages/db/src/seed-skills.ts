// packages/db/src/seed-skills.ts
// Reads skills/**/*.skill.md files, parses YAML frontmatter, upserts into
// SkillDefinition + SkillAssignment tables.
// Idempotent: existing SkillDefinitions are updated unless admin has overridden.

import { readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import type { PrismaClient } from "../generated/client/client";
import { COWORKER_AGENT_SEEDS, ONBOARDING_AGENT_GRANTS } from "./workforce-seed.js";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SKILLS_DIR = join(REPO_ROOT, "skills");
const DPF_PLATFORM_SKILLS_DIR = join(REPO_ROOT, "packages", "dpf-skill-pack", "skills");

export const LEGACY_SKILL_SOURCE_TYPE = "repo-skills-directory";
export const DPF_PLATFORM_SKILL_SOURCE_TYPE = "dpf-platform-plugin";

export type SkillFrontmatter = {
  name?: string;
  description?: string;
  category?: string;
  assignTo?: string[];       // ["agent-id"] or ["*"] for all agents
  capability?: string | null;
  taskType?: string;
  /** Cron expression (UTC). Meaningful only with taskType: "recurring". */
  cadence?: string | null;
  triggerPattern?: string | null;
  userInvocable?: boolean;
  agentInvocable?: boolean;
  allowedTools?: string[] | string;
  composesFrom?: string[];
  contextRequirements?: string[];
  riskBand?: string;
  "disable-model-invocation"?: boolean;
  "user-invocable"?: boolean;
  "allowed-tools"?: string | string[];
  enforces?: string[];
  [key: string]: unknown;
};

export type SkillSeedSourceType =
  | typeof LEGACY_SKILL_SOURCE_TYPE
  | typeof DPF_PLATFORM_SKILL_SOURCE_TYPE;

export type SkillSeedSource = {
  category: string;
  filePath: string;
  sourceType: SkillSeedSourceType;
};

export type LoadedSkillSeedEntry = SkillSeedSource & {
  skillId: string;
  raw: string;
  frontmatter: SkillFrontmatter;
};

export type SkillSeedConflict = {
  skillId: string;
  legacyPath: string;
  pluginPath: string;
};

export type NormalizedSkillSeed = {
  skillId: string;
  skillDefinition: {
    name: string;
    description: string;
    skillMdContent: string;
    sourceType: SkillSeedSourceType;
    category: string;
    tags: string[];
    riskBand: string;
    status: string;
    triggerPattern: string | null;
    userInvocable: boolean;
    agentInvocable: boolean;
    allowedTools: string[];
    composesFrom: string[];
    contextRequirements: string[];
    capability: string | null;
    taskType: string;
    cadence: string | null;
  };
  assignTo: string[];
};

// All known agent IDs — used when assignTo includes "*". Derived from the
// canonical coworker roster (plus the bootstrap-created onboarding agent)
// instead of a hand-copied list: the previous literal list had drifted to a
// nonexistent "docs-specialist" (roster id is "doc-specialist") and silently
// omitted five roster coworkers (data-steward, doc-specialist,
// legal-operations-counsel, finance-controller, dispatcher), so wildcard
// skills never reached them (EP-COWORKER-LIFECYCLE Phase 1, BI-53ABC4A4).
export const SKILL_WILDCARD_AGENT_IDS: readonly string[] = [
  ...COWORKER_AGENT_SEEDS.map((seed) => seed.agentId),
  ...Object.keys(ONBOARDING_AGENT_GRANTS),
];
const ALL_AGENT_IDS = SKILL_WILDCARD_AGENT_IDS;

/**
 * Simple YAML frontmatter parser for .skill.md files.
 * Handles the subset of YAML used: scalars, inline arrays, block-style lists,
 * booleans, null.
 */
export function parseFrontmatter(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Missing YAML frontmatter delimiters (---)");
  }

  const yamlBlock = match[1];
  const body = match[2].trim();

  const fm: Record<string, unknown> = {};
  const lines = yamlBlock.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("#") || line.trim() === "") {
      i++;
      continue;
    }

    const kvMatch = line.match(/^(\w[\w.-]*)\s*:\s*(.*)/);
    if (!kvMatch) {
      i++;
      continue;
    }

    const key = kvMatch[1];
    let value: string = kvMatch[2].trim();

    // Block-style list:
    //   key:
    //     - item1
    //     - item2
    if (value === "") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        const itemMatch = next.match(/^\s+-\s+(.*)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1].trim().replace(/^["']|["']$/g, ""));
        j++;
      }
      if (items.length > 0) {
        fm[key] = items;
        i = j;
        continue;
      }
      // Empty value with no block list — fall through to scalar handling below.
    }

    // Inline array: ["item1", "item2"] or [item1, item2]
    if (value.startsWith("[")) {
      const inner = value.replace(/^\[|\]$/g, "").trim();
      if (inner === "") {
        fm[key] = [];
      } else {
        fm[key] = inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      }
      i++;
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

    i++;
  }

  return {
    frontmatter: fm as unknown as SkillFrontmatter,
    body,
  };
}

/**
 * Discover all .skill.md files under the skills/ directory tree.
 */
export function discoverLegacySkillFiles(skillsDir = SKILLS_DIR): SkillSeedSource[] {
  const results: SkillSeedSource[] = [];

  let categories: string[];
  try {
    categories = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    console.warn("[seed-skills] skills/ directory not found — skipping skill seed");
    return [];
  }

  for (const category of categories) {
    const categoryDir = join(skillsDir, category);
    const files = readdirSync(categoryDir).filter((f) => f.endsWith(".skill.md"));
    for (const file of files) {
      results.push({
        category,
        filePath: join(categoryDir, file),
        sourceType: LEGACY_SKILL_SOURCE_TYPE,
      });
    }
  }

  return results;
}

/**
 * Discover dpf-platform plugin skills. Each skill lives under
 * packages/dpf-skill-pack/skills/<slug>/SKILL.md so the same files can be
 * loaded by Claude/Codex plugins and seeded into coworkers.
 */
export function discoverDpfPlatformSkillFiles(
  pluginSkillsDir = DPF_PLATFORM_SKILLS_DIR,
): SkillSeedSource[] {
  let slugs: string[];
  try {
    slugs = readdirSync(pluginSkillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    console.warn("[seed-skills] packages/dpf-skill-pack/skills directory not found — skipping dpf-platform skills");
    return [];
  }

  return slugs.map((slug) => ({
    category: "dpf-platform",
    filePath: join(pluginSkillsDir, slug, "SKILL.md"),
    sourceType: DPF_PLATFORM_SKILL_SOURCE_TYPE,
  }));
}

function discoverSkillFiles(): SkillSeedSource[] {
  return [
    ...discoverLegacySkillFiles(),
    ...discoverDpfPlatformSkillFiles(),
  ];
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))];
}

export function parseAllowedTools(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.filter((item): item is string => typeof item === "string"));
  }
  if (typeof value !== "string" || value.trim() === "") return [];

  const tokens: string[] = [];
  let current = "";
  let parenDepth = 0;

  for (const char of value.trim()) {
    if (/\s/.test(char) && parenDepth === 0) {
      if (current.trim() !== "") tokens.push(current.trim());
      current = "";
      continue;
    }

    if (char === "(") parenDepth += 1;
    else if (char === ")" && parenDepth > 0) parenDepth -= 1;
    current += char;
  }

  if (current.trim() !== "") tokens.push(current.trim());
  return uniqueStrings(tokens);
}

function allowedToolBase(tool: string): string {
  const scopeStart = tool.indexOf("(");
  return scopeStart === -1 ? tool : tool.slice(0, scopeStart);
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * The taskType that makes a skill schedulable (TAK §8.11 — recurring work must
 * be declarable). Before this, 0 of 68 skills could say "runs weekly": the
 * cadence lived only in a hand-written self-task registry, so a skill's own
 * definition could not express the one thing an operator most wants to read
 * off it.
 */
export const RECURRING_SKILL_TASK_TYPE = "recurring";

export const SKILL_TASK_TYPES = [
  "conversation",
  "code_generation",
  "analysis",
  RECURRING_SKILL_TASK_TYPE,
] as const;

/** Five space-separated cron fields. Deliberately shape-only — the scheduler owns semantics. */
export function isCronExpression(value: unknown): value is string {
  return typeof value === "string" && /^\S+(\s+\S+){4}$/.test(value.trim());
}

export function normalizeSkillFrontmatterForSeed(input: {
  frontmatter: SkillFrontmatter;
  raw: string;
  category: string;
  sourceType: SkillSeedSourceType;
}): NormalizedSkillSeed {
  const { frontmatter, raw, category, sourceType } = input;
  const skillId = typeof frontmatter.name === "string" ? frontmatter.name : "";
  const standardAllowedTools = parseAllowedTools(frontmatter["allowed-tools"]).map(allowedToolBase);
  const coworkerAllowedTools = asStringArray(frontmatter.allowedTools);
  const disableModelInvocation = booleanOrUndefined(frontmatter["disable-model-invocation"]);
  const agentInvocable =
    booleanOrUndefined(frontmatter.agentInvocable) ?? (disableModelInvocation !== true);
  const userInvocable =
    booleanOrUndefined(frontmatter.userInvocable) ??
    (booleanOrUndefined(frontmatter["user-invocable"]) !== false);
  const taskType = typeof frontmatter.taskType === "string" ? frontmatter.taskType : "conversation";

  return {
    skillId,
    skillDefinition: {
      name: skillId,
      description: typeof frontmatter.description === "string" ? frontmatter.description : "",
      skillMdContent: raw,
      sourceType,
      category: typeof frontmatter.category === "string" ? frontmatter.category : category,
      tags: [],
      riskBand: typeof frontmatter.riskBand === "string" ? frontmatter.riskBand : "low",
      status: "active",
      triggerPattern: typeof frontmatter.triggerPattern === "string" ? frontmatter.triggerPattern : null,
      userInvocable,
      agentInvocable,
      allowedTools: coworkerAllowedTools.length > 0 ? coworkerAllowedTools : uniqueStrings(standardAllowedTools),
      composesFrom: asStringArray(frontmatter.composesFrom),
      contextRequirements: asStringArray(frontmatter.contextRequirements),
      capability: typeof frontmatter.capability === "string" ? frontmatter.capability : null,
      taskType,
      // A cadence is only meaningful on a recurring skill. Declared on any
      // other taskType it is dropped rather than stored, so the column never
      // holds a schedule that nothing will ever read (TAK §8.11.1).
      cadence: taskType === RECURRING_SKILL_TASK_TYPE && isCronExpression(frontmatter.cadence)
        ? frontmatter.cadence.trim()
        : null,
    },
    assignTo: asStringArray(frontmatter.assignTo),
  };
}

export function validateDpfPlatformSkillFrontmatter(
  frontmatter: SkillFrontmatter,
  sourceLabel: string,
): string[] {
  const issues: string[] = [];
  const standardAllowedTools = parseAllowedTools(frontmatter["allowed-tools"]);
  const coworkerAllowedTools = asStringArray(frontmatter.allowedTools);

  for (const key of ["name", "description", "category", "taskType", "riskBand"]) {
    if (typeof frontmatter[key] !== "string" || frontmatter[key] === "") {
      issues.push(`${sourceLabel}: missing string frontmatter '${key}'`);
    }
  }

  for (const key of ["assignTo", "composesFrom", "contextRequirements", "enforces"]) {
    if (!Array.isArray(frontmatter[key])) {
      issues.push(`${sourceLabel}: missing array frontmatter '${key}'`);
    }
  }

  for (const key of ["disable-model-invocation", "user-invocable", "userInvocable", "agentInvocable"]) {
    if (typeof frontmatter[key] !== "boolean") {
      issues.push(`${sourceLabel}: missing boolean frontmatter '${key}'`);
    }
  }

  if (standardAllowedTools.length === 0) {
    issues.push(`${sourceLabel}: missing Agent Skills 'allowed-tools' entries`);
  }
  if (coworkerAllowedTools.length === 0) {
    issues.push(`${sourceLabel}: missing DPF coworker 'allowedTools' entries`);
  }

  if (
    typeof frontmatter["user-invocable"] === "boolean" &&
    typeof frontmatter.userInvocable === "boolean" &&
    frontmatter["user-invocable"] !== frontmatter.userInvocable
  ) {
    issues.push(`${sourceLabel}: user-invocable contradicts userInvocable`);
  }

  if (
    typeof frontmatter["disable-model-invocation"] === "boolean" &&
    typeof frontmatter.agentInvocable === "boolean" &&
    frontmatter.agentInvocable !== !frontmatter["disable-model-invocation"]
  ) {
    issues.push(`${sourceLabel}: disable-model-invocation contradicts agentInvocable`);
  }

  const missingCoworkerTools = uniqueStrings(standardAllowedTools.map(allowedToolBase))
    .filter((tool) => !coworkerAllowedTools.includes(tool));
  if (missingCoworkerTools.length > 0) {
    issues.push(
      `${sourceLabel}: allowedTools missing Agent Skills base tool(s): ${missingCoworkerTools.join(", ")}`,
    );
  }

  return issues;
}

function loadSkillSeedEntry(source: SkillSeedSource): LoadedSkillSeedEntry | null {
  const raw = readFileSync(source.filePath, "utf-8");
  const { frontmatter } = parseFrontmatter(raw);
  const skillId = frontmatter.name;
  if (!skillId) {
    console.warn(`[seed-skills] Skipping ${basename(source.filePath)} — no 'name' in frontmatter`);
    return null;
  }
  return { ...source, raw, frontmatter, skillId };
}

export function selectSkillSeedEntries(entries: LoadedSkillSeedEntry[]): {
  selected: LoadedSkillSeedEntry[];
  conflicts: SkillSeedConflict[];
} {
  const selectedBySkillId = new Map<string, LoadedSkillSeedEntry>();
  const conflicts: SkillSeedConflict[] = [];

  for (const entry of entries) {
    const existing = selectedBySkillId.get(entry.skillId);
    if (!existing) {
      selectedBySkillId.set(entry.skillId, entry);
      continue;
    }

    if (
      existing.sourceType === LEGACY_SKILL_SOURCE_TYPE &&
      entry.sourceType === DPF_PLATFORM_SKILL_SOURCE_TYPE
    ) {
      conflicts.push({
        skillId: entry.skillId,
        legacyPath: existing.filePath,
        pluginPath: entry.filePath,
      });
      selectedBySkillId.set(entry.skillId, entry);
      continue;
    }

    if (
      existing.sourceType === DPF_PLATFORM_SKILL_SOURCE_TYPE &&
      entry.sourceType === LEGACY_SKILL_SOURCE_TYPE
    ) {
      conflicts.push({
        skillId: entry.skillId,
        legacyPath: entry.filePath,
        pluginPath: existing.filePath,
      });
      continue;
    }

    selectedBySkillId.set(entry.skillId, entry);
  }

  return {
    selected: [...selectedBySkillId.values()],
    conflicts,
  };
}

type SkillSeedWarningSeedClient = Pick<PrismaClient, "skillSeedWarning">;

export async function writeSkillSeedConflictWarnings(
  prisma: SkillSeedWarningSeedClient,
  conflicts: SkillSeedConflict[],
): Promise<void> {
  for (const conflict of conflicts) {
    const warningId = `plugin-overrides-legacy:${conflict.skillId}`;
    const message =
      `dpf-platform plugin skill '${conflict.skillId}' overrides legacy coworker skill at seed time; migrate or retire the legacy file under EP-SKILL-001.`;

    await prisma.skillSeedWarning.upsert({
      where: { warningId },
      update: {
        skillId: conflict.skillId,
        warningType: "plugin-overrides-legacy",
        message,
        legacyPath: conflict.legacyPath,
        pluginPath: conflict.pluginPath,
        sourceType: DPF_PLATFORM_SKILL_SOURCE_TYPE,
        metadata: {},
        resolvedAt: null,
      },
      create: {
        warningId,
        skillId: conflict.skillId,
        warningType: "plugin-overrides-legacy",
        message,
        legacyPath: conflict.legacyPath,
        pluginPath: conflict.pluginPath,
        sourceType: DPF_PLATFORM_SKILL_SOURCE_TYPE,
        metadata: {},
      },
    });
  }
}

type SkillAssignmentSeedClient = Pick<PrismaClient, "skillAssignment">;

export async function reconcileSkillAssignments(
  prisma: SkillAssignmentSeedClient,
  skillId: string,
  targetAgents: readonly string[],
  priority = 10,
): Promise<{ created: number; removed: number }> {
  const existingAssignments = await prisma.skillAssignment.findMany({
    where: { skillId },
    select: { agentId: true, assignedBy: true },
  });

  const desiredAgents = new Set(targetAgents);
  const existingAgentIds = new Set(existingAssignments.map((assignment) => assignment.agentId));
  let created = 0;
  let removed = 0;

  for (const agentId of targetAgents) {
    if (existingAgentIds.has(agentId)) continue;
    await prisma.skillAssignment.create({
      data: {
        skillId,
        agentId,
        priority,
        enabled: true,
        assignedBy: "system-seed",
      },
    });
    created += 1;
  }

  for (const assignment of existingAssignments) {
    if (assignment.assignedBy !== "system-seed") continue;
    if (desiredAgents.has(assignment.agentId)) continue;
    await prisma.skillAssignment.delete({
      where: {
        skillId_agentId: {
          skillId,
          agentId: assignment.agentId,
        },
      },
    });
    removed += 1;
  }

  return { created, removed };
}

export async function seedSkills(prisma: PrismaClient): Promise<void> {
  const loadedFiles = discoverSkillFiles()
    .map((file) => loadSkillSeedEntry(file))
    .filter((entry): entry is LoadedSkillSeedEntry => entry !== null);
  if (loadedFiles.length === 0) return;

  const { selected: files, conflicts } = selectSkillSeedEntries(loadedFiles);
  for (const conflict of conflicts) {
    console.warn(
      `[seed-skills] dpf-platform plugin skill '${conflict.skillId}' overrides legacy skill '${conflict.legacyPath}'`,
    );
  }
  await writeSkillSeedConflictWarnings(prisma, conflicts);

  let created = 0;
  let updated = 0;
  let assignmentsCreated = 0;
  let assignmentsRemoved = 0;

  for (const file of files) {
    const { skillId, skillDefinition: data, assignTo } = normalizeSkillFrontmatterForSeed({
      frontmatter: file.frontmatter,
      raw: file.raw,
      category: file.category,
      sourceType: file.sourceType,
    });

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
    const targetAgents = assignTo.includes("*") ? ALL_AGENT_IDS : assignTo;

    const reconcileResult = await reconcileSkillAssignments(
      prisma,
      skillId,
      targetAgents,
      assignTo.includes("*") ? 0 : 10,
    );
    assignmentsCreated += reconcileResult.created;
    assignmentsRemoved += reconcileResult.removed;
  }

  console.log(
    `Seeded skills: ${created} created, ${updated} updated, ${assignmentsCreated} assignments created, ${assignmentsRemoved} assignments removed`,
  );
}
