// apps/web/lib/a2a/agent-card.ts
//
// A2A Agent Card projection (BI-40648BBF, Slice 6). Projects DPF coworker Agent
// identity into the A2A v1.x Agent Card shape for optional external A2A peers
// (inventory design P3 — "profile, not rewrite bus"). READ-ONLY: this never
// accepts inbound task execution; it only publishes identity.
//
// Two guarantees:
//   1. Deny-by-default governance gate — an Agent is exported ONLY when it is
//      active, production-stage, non-archived, AND sensitivity === "public".
//      Every coworker defaults to "internal", so NOTHING is exported until an
//      operator explicitly opts a coworker in (Agent.sensitivity = "public").
//   2. Strict field allowlist — only name/description/skills cross the boundary.
//      Internal governance fields (humanSupervisorId, escalatesTo, delegatesTo,
//      hitlTierDefault, portfolioId, sensitivity, it4itSections, role, kind…)
//      are NEVER projected.
//
// NOTE (fast-follow): the card carries the instance's public identity
// (deviceId + signing public key) for verification, but a detached JWS
// `signatures` block is not yet emitted — that rides the federation
// instance-identity signer. Consumers verify provenance via the published
// public key until then.

import { prisma } from "@dpf/db";
import { resolveFederationIdentity } from "@/lib/federation/demand-identity";

export const A2A_PROTOCOL_VERSION = "0.3.0";

export type A2aSkill = { id: string; name: string; description: string; tags: string[] };

export type A2aProvenance = {
  instanceId: string;
  deviceId?: string;
  signingPublicKey?: string;
  signed: false;
  verification: string;
};

export type A2aAgentCard = {
  protocolVersion: string;
  name: string;
  description: string;
  version: string;
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2aSkill[];
  provenance: A2aProvenance;
};

type ExportableAgent = {
  agentId: string;
  displayName: string;
  description: string | null;
  skills: Array<{ label: string; description: string; capability: string | null }>;
};

// The Prisma filter that IS the governance gate. Deny-by-default via
// sensitivity:"public" — nothing exports until an operator opts a coworker in.
const EXPORT_GATE = {
  status: "active",
  archived: false,
  lifecycleStage: "production",
  sensitivity: "public",
} as const;

/** Project ONE exportable agent's own skills into A2A skills. Pure — allowlist only. */
export function projectAgentSkills(agent: ExportableAgent): A2aSkill[] {
  return agent.skills.map((s, i) => ({
    id: `${agent.agentId}:${s.label}`.slice(0, 128) || `${agent.agentId}:skill-${i}`,
    name: s.label,
    description: s.description,
    tags: s.capability ? [s.capability] : [],
  }));
}

/** Build the platform's primary A2A card: DPF as one agent whose skills are the
 *  exported coworkers' capabilities. Pure over its inputs. */
export function buildPlatformAgentCard(
  orgName: string,
  agents: ExportableAgent[],
  provenance: A2aProvenance,
): A2aAgentCard {
  const skills = agents.flatMap((a) =>
    projectAgentSkills(a).map((sk) => ({ ...sk, name: `${a.displayName}: ${sk.name}` })),
  );
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: orgName,
    description: `${orgName} — Digital Product Factory. AI coworkers available to external A2A peers.`,
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills,
    provenance,
  };
}

/** Build one coworker's own A2A card. Pure over its inputs. */
export function buildCoworkerAgentCard(
  agent: ExportableAgent,
  provenance: A2aProvenance,
): A2aAgentCard {
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: agent.displayName,
    description: agent.description ?? agent.displayName,
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: projectAgentSkills(agent),
    provenance,
  };
}

async function loadProvenance(orgId: string): Promise<A2aProvenance> {
  const base: A2aProvenance = {
    instanceId: orgId,
    signed: false,
    verification: "Verify via the published signingPublicKey; detached JWS signatures are a fast-follow.",
  };
  try {
    const identity = await resolveFederationIdentity(prisma as never);
    return { ...base, deviceId: identity.deviceId, signingPublicKey: identity.signingPublicKey };
  } catch {
    // Fail-open: a card without an identity stamp is still a valid read-only card.
    return base;
  }
}

async function loadExportableAgents(): Promise<ExportableAgent[]> {
  const rows = await prisma.agent.findMany({
    where: EXPORT_GATE,
    select: {
      agentId: true,
      displayName: true,
      description: true,
      skills: {
        select: { label: true, description: true, capability: true },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { displayName: "asc" },
  });
  return rows.map((r) => ({
    agentId: r.agentId,
    displayName: r.displayName,
    description: r.description,
    skills: r.skills,
  }));
}

/** The platform primary card served at /.well-known/agent-card.json. */
export async function getPlatformAgentCard(): Promise<A2aAgentCard | null> {
  const org = await prisma.organization.findFirst({ select: { orgId: true, name: true } });
  if (!org) return null;
  const [agents, provenance] = await Promise.all([loadExportableAgents(), loadProvenance(org.orgId)]);
  return buildPlatformAgentCard(org.name, agents, provenance);
}

/** One coworker's card, or null when it is not opted in for export. */
export async function getCoworkerAgentCard(agentId: string): Promise<A2aAgentCard | null> {
  const org = await prisma.organization.findFirst({ select: { orgId: true } });
  if (!org) return null;
  const row = await prisma.agent.findFirst({
    where: { agentId, ...EXPORT_GATE },
    select: {
      agentId: true,
      displayName: true,
      description: true,
      skills: {
        select: { label: true, description: true, capability: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!row) return null;
  const provenance = await loadProvenance(org.orgId);
  return buildCoworkerAgentCard(
    { agentId: row.agentId, displayName: row.displayName, description: row.description, skills: row.skills },
    provenance,
  );
}
