import type { AttentionSignal, HiveMindCandidate, PortalContextEnvelope } from "./types";
import type { AgentRegistryRow, PortalContextDb } from "./db-types";

type WorkProjection = PortalContextEnvelope["work"];

export async function resolveHiveMindCandidates(args: {
  routeDomain: string;
  work: WorkProjection;
  attention: AttentionSignal[];
  db: PortalContextDb;
}): Promise<HiveMindCandidate[]> {
  const agents = await safelyReadAgentRegistry(args.db);
  const candidates = agents
    .map((agent) => toHiveMindCandidate(agent, args))
    .filter((candidate): candidate is HiveMindCandidate & { score: number } => Boolean(candidate))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  return candidates.map(({ score: _score, ...candidate }) => candidate);
}

async function safelyReadAgentRegistry(db: PortalContextDb): Promise<AgentRegistryRow[]> {
  try {
    return await db.agent.findMany({
      where: {
        status: "active",
        archived: false,
      },
      orderBy: [
        { tier: "asc" },
        { name: "asc" },
      ],
      select: {
        agentId: true,
        name: true,
        description: true,
        valueStream: true,
        skills: {
          select: {
            label: true,
            description: true,
            capability: true,
            taskType: true,
          },
        },
        toolGrants: {
          select: {
            grantKey: true,
          },
        },
      },
    });
  } catch {
    return [];
  }
}

function toHiveMindCandidate(
  agent: AgentRegistryRow,
  args: {
    routeDomain: string;
    work: WorkProjection;
    attention: AttentionSignal[];
  },
): (HiveMindCandidate & { score: number }) | null {
  const text = searchableAgentText(agent);
  const routeDomain = args.routeDomain.toLowerCase();
  const attentionKinds = new Set(args.attention.map((signal) => signal.kind));
  let score = 0;

  if (args.work.featureBuild || args.routeDomain === "Build Studio") {
    if (text.includes("build") || text.includes("studio") || text.includes("integrate")) {
      score += args.work.featureBuild ? 40 : 25;
    }
  }

  if (routeDomain && text.includes(routeDomain)) {
    score += 20;
  }

  if (attentionKinds.has("missing_evidence") || attentionKinds.has("capsule_not_linked")) {
    if (text.includes("evidence") || text.includes("review") || text.includes("promotion")) {
      score += 60;
    }
  }

  if (attentionKinds.has("no_active_build")) {
    if (text.includes("context") || text.includes("anchor") || text.includes("capsule") || text.includes("backlog")) {
      score += 50;
    }
  }

  if (attentionKinds.has("build_stalled") || attentionKinds.has("lease_expired")) {
    if (text.includes("operate") || text.includes("workflow") || text.includes("handoff")) {
      score += 35;
    }
  }

  if (score <= 0) return null;

  const role = inferRole(text);
  return {
    agentId: agent.agentId,
    label: agent.name,
    role,
    reason: reasonForCandidate(role, args.attention),
    activation: activationForCandidate(role, args.work, args.attention),
    requiredGrantKeys: requiredGrantKeys(agent),
    taskType: taskTypeForAgent(agent, role),
    score,
  };
}

function searchableAgentText(agent: AgentRegistryRow): string {
  return [
    agent.name,
    agent.description,
    agent.valueStream,
    ...(agent.skills ?? []).flatMap((skill) => [skill.label, skill.description, skill.capability, skill.taskType]),
    ...(agent.toolGrants ?? []).map((grant) => grant.grantKey),
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
}

function inferRole(text: string): HiveMindCandidate["role"] {
  if (text.includes("architect") || text.includes("context")) return "architect";
  if (text.includes("review") || text.includes("evidence") || text.includes("promotion")) return "reviewer";
  if (text.includes("test") || text.includes("verify")) return "tester";
  if (text.includes("build") || text.includes("implement")) return "builder";
  if (text.includes("operate") || text.includes("studio")) return "operator";
  return "specialist";
}

function activationForCandidate(
  role: HiveMindCandidate["role"],
  work: WorkProjection,
  attention: AttentionSignal[],
): HiveMindCandidate["activation"] {
  if (role === "reviewer" && attention.some((signal) => signal.kind === "missing_evidence" || signal.kind === "capsule_not_linked")) {
    return "required-before-promotion";
  }
  if (work.featureBuild) return "ask-now";
  return "passive-suggestion";
}

function reasonForCandidate(role: HiveMindCandidate["role"], attention: AttentionSignal[]): string {
  if (attention.some((signal) => signal.kind === "no_active_build")) {
    return "Helps anchor portal work to an explicit build, capsule, or backlog item.";
  }
  if (attention.some((signal) => signal.kind === "missing_evidence" || signal.kind === "capsule_not_linked")) {
    return "Reviews missing evidence and handoff readiness before promotion.";
  }
  if (role === "operator") {
    return "Keeps the Build Studio work object, capsule, and evidence gates aligned.";
  }
  return "Matches the current route context and work anchors.";
}

function requiredGrantKeys(agent: AgentRegistryRow): string[] {
  return Array.from(new Set([
    ...(agent.toolGrants ?? []).map((grant) => grant.grantKey),
    ...(agent.skills ?? []).map((skill) => skill.capability).filter((capability): capability is string => Boolean(capability)),
  ]));
}

function taskTypeForAgent(agent: AgentRegistryRow, role: HiveMindCandidate["role"]): HiveMindCandidate["taskType"] {
  const taskType = (agent.skills ?? [])
    .map((skill) => skill.taskType)
    .find((value): value is HiveMindCandidate["taskType"] =>
      value === "conversation" || value === "analysis" || value === "code_generation" || value === "verification",
    );
  if (taskType) return taskType;
  if (role === "tester" || role === "reviewer") return "verification";
  if (role === "builder") return "code_generation";
  return "analysis";
}
