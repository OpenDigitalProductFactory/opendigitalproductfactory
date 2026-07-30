import {
  expandGrants,
  isToolAllowedByGrants,
} from "@/lib/tak/agent-grants";
import type { CoworkerAvailabilityReadiness } from "./availability-projection";

export type CoworkerServiceBacking = {
  serviceId: string;
  name: string;
  backingSkillIds: unknown;
  backingToolNames: unknown;
  backingGrantKeys: unknown;
};

export type CoworkerServiceReadinessEvidence = {
  assignedSkillIds: readonly string[];
  registeredToolNames: readonly string[];
  heldGrantKeys: readonly string[];
  routeReady: boolean;
  routeBlockerReason?: string;
  blockingCapabilityNeedCount: number;
};

export function evaluateCoworkerServiceReadiness(
  service: CoworkerServiceBacking,
  evidence: CoworkerServiceReadinessEvidence,
): CoworkerAvailabilityReadiness {
  const backingSkills = parseStringArray(service.backingSkillIds);
  const backingTools = parseStringArray(service.backingToolNames);
  const backingGrants = parseStringArray(service.backingGrantKeys);
  const assignedSkills = new Set(evidence.assignedSkillIds);
  const registeredTools = new Set(evidence.registeredToolNames);
  const effectiveGrants = new Set(expandGrants(evidence.heldGrantKeys));
  const missingKinds = new Set<string>();
  const details: string[] = [];

  if (!backingSkills.valid || !backingTools.valid || !backingGrants.valid) {
    missingKinds.add(`Repair the advertised backing for ${service.name}`);
    details.push("One or more backing declarations are not valid string arrays.");
  }
  if (
    backingSkills.values.length === 0 &&
    backingTools.values.length === 0 &&
    backingGrants.values.length === 0
  ) {
    missingKinds.add(`Define executable backing for ${service.name}`);
    details.push("No backing skill, tool, or permission is declared.");
  }

  for (const skillId of backingSkills.values) {
    if (!assignedSkills.has(skillId)) {
      missingKinds.add(`Assign the advertised skills for ${service.name}`);
      details.push(`Missing skill: ${skillId}`);
    }
  }

  for (const toolName of backingTools.values) {
    if (!registeredTools.has(toolName)) {
      missingKinds.add(`Register the advertised tools for ${service.name}`);
      details.push(`Unregistered tool: ${toolName}`);
      continue;
    }
    if (!isToolAllowedByGrants(toolName, [...evidence.heldGrantKeys])) {
      missingKinds.add(`Grant the advertised permissions for ${service.name}`);
      details.push(`Tool permission denied: ${toolName}`);
    }
  }

  for (const grantKey of backingGrants.values) {
    if (!effectiveGrants.has(grantKey)) {
      missingKinds.add(`Grant the advertised permissions for ${service.name}`);
      details.push(`Missing permission: ${grantKey}`);
    }
  }

  const blockers: string[] = [];
  if (!evidence.routeReady) {
    blockers.push(
      evidence.routeBlockerReason ??
        "No configured model satisfies this coworker's routing requirements.",
    );
  }
  if (evidence.blockingCapabilityNeedCount > 0) {
    const count = evidence.blockingCapabilityNeedCount;
    blockers.push(
      `${count} blocking capability ${count === 1 ? "need requires" : "needs require"} review.`,
    );
  }

  return {
    status: "evaluated",
    blockers,
    missingPrerequisites: [...missingKinds],
    ...(details.length > 0 ? { details: [...new Set(details)] } : {}),
  };
}

export function evaluateCoworkerServicesReadiness(
  services: readonly CoworkerServiceBacking[],
  evidence: CoworkerServiceReadinessEvidence,
): Map<string, CoworkerAvailabilityReadiness> {
  return new Map(
    services.map((service) => [
      service.serviceId,
      evaluateCoworkerServiceReadiness(service, evidence),
    ]),
  );
}

function parseStringArray(value: unknown): {
  valid: boolean;
  values: string[];
} {
  if (!Array.isArray(value)) return { valid: false, values: [] };
  const values = value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
  return {
    valid: values.length === value.length,
    values,
  };
}
