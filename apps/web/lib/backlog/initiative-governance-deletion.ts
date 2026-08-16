import { prisma } from "@dpf/db";

export class InitiativeGovernanceRetentionError extends Error {
  readonly code = "INITIATIVE_GOVERNANCE_RETENTION";
}

const GOVERNANCE_KINDS = [
  "initiative_gate_receipt",
  "initiative_scope_baseline",
  "initiative_objective_mapping",
  "initiative_readiness_decision",
] as const;

function retained(subject: string): never {
  throw new InitiativeGovernanceRetentionError(`${subject} has permanent initiative-governance evidence and cannot be deleted; archive or defer it instead.`);
}

export async function assertBacklogItemGovernanceDeletable(id: string): Promise<void> {
  const count = await prisma.backlogItemActivity.count({
    where: { backlogItemId: id, kind: { in: [...GOVERNANCE_KINDS] } },
  });
  if (count > 0) retained("BacklogItem");
}

export async function assertEpicGovernanceDeletable(id: string): Promise<void> {
  const epic = await prisma.epic.findUnique({ where: { id }, select: { epicId: true } });
  if (!epic) return;
  const count = await prisma.backlogItemActivity.count({
    where: {
      kind: { in: [...GOVERNANCE_KINDS] },
      AND: [
        { payload: { path: ["subject", "kind"], equals: "epic" } },
        { payload: { path: ["subject", "id"], equals: epic.epicId } },
      ],
    },
  });
  if (count > 0) retained("Epic");
}

export async function assertFeatureBuildGovernanceDeletable(buildId: string): Promise<void> {
  const count = await prisma.initiativeArtifactRetentionPin.count({
    where: { buildArtifactRevision: { buildId } },
  });
  if (count > 0) retained("FeatureBuild");
}
