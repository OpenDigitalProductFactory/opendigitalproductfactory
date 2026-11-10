// BI-28EFE18A — the install's own edge node is its host-upkeep agent.
//
// Host upkeep that must run outside the Docker VM (today: the operator-approved
// Docker VM restart) is carried by the native edge node, which every install
// now runs (WWMD DI-93310A596E88). For that to work, this installation's own
// node needs the action.execute capability enabled and the host-upkeep action
// types allowlisted. Nothing set either before: the capability arrives
// disabled on heartbeat, and no path wrote the allowlist.
//
// This converges them once per node and records that it did, in
// scopePolicy.hostUpkeep. It runs on a schedule, so existing installs pick it
// up after an upgrade, but it never re-enables what an operator later turned
// off. It adds only the host-upkeep types, keeps any types an operator already
// allowlisted, and touches only trusted, installer-managed, internal nodes
// (the same "installer-managed" basis as stale-supersession.ts).

import { DOCKER_VM_RESTART_ACTION_TYPE } from "@dpf/db/remote-action-dispatch";

import { isRecord } from "@/lib/shared/coerce";

export const HOST_UPKEEP_ACTION_TYPES = [DOCKER_VM_RESTART_ACTION_TYPE] as const;

export interface HostUpkeepConvergenceDb {
  edgeNode: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      trustState: string;
      scopePolicy: unknown;
      capabilityRows: Array<{ capability: string; mode: string }>;
    }>>;
    update(args: unknown): Promise<unknown>;
  };
  edgeNodeCapability: {
    upsert(args: unknown): Promise<unknown>;
  };
}

export async function convergeHostUpkeepOnInstallerNodes(
  db: HostUpkeepConvergenceDb,
  options: { now?: Date } = {},
): Promise<{ converged: string[] }> {
  const now = options.now ?? new Date();
  const nodes = await db.edgeNode.findMany({
    where: {
      trustState: { not: "revoked" },
      customerAccountId: null,
      customerSiteId: null,
      consumedTokens: { some: { autoApprove: true } },
    },
    select: {
      id: true,
      trustState: true,
      scopePolicy: true,
      capabilityRows: { where: { capability: "action.execute" }, select: { capability: true, mode: true } },
    },
  });
  const converged: string[] = [];
  for (const node of nodes) {
    if (node.trustState !== "trusted") continue;
    const policy = isRecord(node.scopePolicy) ? node.scopePolicy : {};
    if (isRecord(policy.hostUpkeep)) continue; // converged before; the operator owns it now
    const existing = Array.isArray(policy.actionTypes)
      ? policy.actionTypes.filter((item): item is string => typeof item === "string")
      : [];
    const actionTypes = [...existing, ...HOST_UPKEEP_ACTION_TYPES.filter((type) => !existing.includes(type))];
    await db.edgeNodeCapability.upsert({
      where: { edgeNodeId_capability: { edgeNodeId: node.id, capability: "action.execute" } },
      create: { edgeNodeId: node.id, capability: "action.execute", mode: "enabled", status: "unknown", reportedAt: now },
      update: { mode: "enabled" },
    });
    await db.edgeNode.update({
      where: { id: node.id },
      data: {
        scopePolicy: {
          ...policy,
          actionTypes,
          hostUpkeep: { convergedAt: now.toISOString(), actionTypes: [...HOST_UPKEEP_ACTION_TYPES] },
        },
      },
    });
    converged.push(node.id);
  }
  return { converged };
}
