// apps/web/lib/ea/reconcile-skill-toolchain.ts
//
// Reconcile the agent skill toolchain into a live SysML projection (Parity Engine,
// living-graph Phase A). Thin IO shell: read the seeded skill catalogue
// (SkillDefinition + enabled SkillAssignment counts) from the DB, build the desired
// model (pure extractor), and apply it via the shared idempotent seeder. Re-derives
// from the catalogue every run, so it cannot drift. db is injectable for tests.
//
// Not run at install; intended for the scheduled/on-demand reconcile path like the
// coworker-authority and MCP-authority reconciles. Skips cleanly on an install with no
// seeded skills (mirrors value-streams skipping when the IT4IT reference model is absent).

import { prisma } from "@dpf/db";
import { buildSkillToolchainModel, type SkillFact } from "./skill-toolchain-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

type SkillRow = {
  skillId: string;
  name: string;
  description: string;
  category: string;
  status: string;
  riskBand: string;
  taskType: string;
  capability: string | null;
  userInvocable: boolean;
  agentInvocable: boolean;
  allowedTools: string[];
  composesFrom: string[];
};

export interface SkillToolchainReconcileOpts {
  db?: typeof prisma;
}

export async function reconcileSkillToolchain(opts: SkillToolchainReconcileOpts = {}): Promise<SysmlSeedResult> {
  const db = opts.db ?? prisma;

  const skills = (await db.skillDefinition.findMany({
    select: {
      skillId: true,
      name: true,
      description: true,
      category: true,
      status: true,
      riskBand: true,
      taskType: true,
      capability: true,
      userInvocable: true,
      agentInvocable: true,
      allowedTools: true,
      composesFrom: true,
    },
  })) as SkillRow[];

  if (skills.length === 0) {
    console.warn("[skill-toolchain] no SkillDefinition rows — skipping");
    return { status: "skipped", created: 0, updated: 0, removed: 0 };
  }

  const assignments = await db.skillAssignment.findMany({ where: { enabled: true }, select: { skillId: true } });
  const counts = new Map<string, number>();
  for (const a of assignments) counts.set(a.skillId, (counts.get(a.skillId) ?? 0) + 1);

  const facts: SkillFact[] = skills.map((s) => ({
    skillId: s.skillId,
    name: s.name,
    description: s.description,
    category: s.category,
    status: s.status,
    riskBand: s.riskBand,
    taskType: s.taskType,
    capability: s.capability ?? null,
    userInvocable: s.userInvocable,
    agentInvocable: s.agentInvocable,
    allowedTools: s.allowedTools ?? [],
    composesFrom: s.composesFrom ?? [],
    assignmentCount: counts.get(s.skillId) ?? 0,
  }));

  const result = await applySysmlModel(buildSkillToolchainModel(facts), { db: opts.db });
  console.info(
    `[skill-toolchain] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed} (skills=${facts.length})`,
  );
  return result;
}
