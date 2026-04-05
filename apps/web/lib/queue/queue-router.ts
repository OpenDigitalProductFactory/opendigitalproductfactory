import { Prisma, prisma } from "@dpf/db";
import type { WorkerConstraint, RoutingDecision, WorkerType } from "./queue-types";

interface RouteResult {
  assigned: boolean;
  workerId?: string;
  workerType?: WorkerType;
  decision: RoutingDecision;
}

function emptyDecision(reason: string): RoutingDecision {
  return {
    candidateCount: 0,
    selectedWorkerId: "",
    selectedWorkerType: "human",
    score: 0,
    reason,
    timestamp: new Date().toISOString(),
  };
}

export async function routeWorkItem(
  workItemId: string,
  workerConstraint: WorkerConstraint,
  teamId?: string,
): Promise<RouteResult> {
  // 1. Resolve team
  const team = teamId
    ? await prisma.valueStreamTeam.findUnique({
        where: { id: teamId },
        include: { roles: { include: { agent: true } } },
      })
    : null;

  if (!team) {
    return { assigned: false, decision: emptyDecision("no-team-found") };
  }

  // 2. Filter eligible workers by capability match
  const eligible = team.roles.filter((role) => {
    if (workerConstraint.workerType !== "either" && workerConstraint.workerType !== "team") {
      if (role.workerType !== workerConstraint.workerType && role.workerType !== "either") return false;
    }
    if (workerConstraint.requiredCapabilities?.length) {
      const hasAll = workerConstraint.requiredCapabilities.every((cap) => role.grantScope.includes(cap));
      if (!hasAll) return false;
    }
    if (workerConstraint.requiredRole && role.humanRoleId !== workerConstraint.requiredRole) return false;
    if (workerConstraint.requiredAgentId && role.agentId !== workerConstraint.requiredAgentId) return false;
    return true;
  });

  if (eligible.length === 0) {
    return { assigned: false, decision: emptyDecision("no-eligible-workers") };
  }

  // 3. Score candidates (capability-match mode)
  const scored = eligible.map((role) => {
    let score = 0;
    const capMatch = workerConstraint.requiredCapabilities?.filter((c) => role.grantScope.includes(c)).length ?? 0;
    score += capMatch * 3;
    if (workerConstraint.preferredWorkerIds?.includes(role.agentId ?? role.humanRoleId ?? "")) score += 10;
    score += (100 - role.priority);
    return { role, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  // 4. Assign
  const resolvedType: WorkerType = best.role.workerType === "either"
    ? (best.role.agentId ? "ai-agent" : "human")
    : best.role.workerType as WorkerType;

  const workerId = resolvedType === "ai-agent" ? best.role.agentId! : best.role.humanRoleId!;

  const decision: RoutingDecision = {
    teamId: team.id,
    candidateCount: eligible.length,
    selectedWorkerId: workerId,
    selectedWorkerType: resolvedType,
    score: best.score,
    reason: "capability-match",
    timestamp: new Date().toISOString(),
  };

  await prisma.workItem.update({
    where: { itemId: workItemId },
    data: {
      status: "assigned",
      assignedToType: resolvedType,
      assignedToAgentId: resolvedType === "ai-agent" ? best.role.agentId : null,
      claimedAt: new Date(),
      routingDecision: JSON.parse(JSON.stringify(decision)) as Prisma.InputJsonValue,
    },
  });

  return { assigned: true, workerId, workerType: resolvedType, decision };
}
