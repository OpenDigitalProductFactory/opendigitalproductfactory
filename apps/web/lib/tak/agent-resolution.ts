/**
 * EP-AI-WORKFORCE-001: Agent Resolution Utility
 *
 * Resolves agents by either canonical AGT-xxx ID or slug alias.
 * Single entry point for looking up agent profiles with all
 * unified lifecycle data.
 */
import { prisma } from "@dpf/db";

/**
 * Resolve an agent by its canonical agentId (e.g. "AGT-ORCH-000")
 * or its slug alias (e.g. "coo", "build-specialist").
 */
export async function resolveAgent(idOrSlug: string) {
  return prisma.agent.findFirst({
    where: {
      OR: [{ agentId: idOrSlug }, { slugId: idOrSlug }],
    },
  });
}

/**
 * Resolve an agent with all unified lifecycle data included.
 */
export async function resolveAgentFull(idOrSlug: string) {
  return prisma.agent.findFirst({
    where: {
      OR: [{ agentId: idOrSlug }, { slugId: idOrSlug }],
    },
    include: {
      executionConfig: true,
      skills: { orderBy: { sortOrder: "asc" } },
      toolGrants: true,
      performanceProfiles: true,
      degradationMappings: true,
      promptContext: true,
      governanceProfile: {
        include: {
          capabilityClass: true,
          directivePolicyClass: true,
        },
      },
    },
  });
}

/**
 * Get all agents with their unified profiles, suitable for
 * the AI Workforce management page.
 */
export async function listAgentsWithProfiles() {
  return prisma.agent.findMany({
    where: { archived: false },
    orderBy: [{ tier: "asc" }, { name: "asc" }],
    include: {
      executionConfig: true,
      skills: { orderBy: { sortOrder: "asc" } },
      toolGrants: true,
      performanceProfiles: true,
      degradationMappings: true,
      promptContext: true,
      governanceProfile: true,
    },
  });
}
