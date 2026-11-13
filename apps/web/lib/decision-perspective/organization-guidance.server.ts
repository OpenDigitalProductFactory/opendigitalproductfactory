// Server loader for organization guidance (BI-1B165D02). Reads whether this
// installation is a development companion, from the same stance every agent
// briefing states, and the guidance snapshot it holds from its authority.

import { prisma } from "@dpf/db";

import { loadInstanceStanceWithPairing, prismaInstanceStanceStore } from "@/lib/install/instance-stance";

import type { OrganizationGuidance } from "./organization-guidance";

export async function loadOrganizationGuidance(now: Date = new Date()): Promise<OrganizationGuidance> {
  const { stance, heldGuidanceSnapshot } = await loadInstanceStanceWithPairing(prismaInstanceStanceStore(prisma), { now });
  if (stance.relationship !== "companion") return { role: "local" };
  return { role: "companion", snapshot: heldGuidanceSnapshot, now };
}
