import { prisma } from "@dpf/db";

import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute";

export type ArchitecturePrecondition = {
  key: string;
  business: { required: boolean; satisfied: boolean; evidenceRef: string };
  systems: { required: boolean; satisfied: boolean; evidenceRef: string };
};

export type PreconditionOrderingCheck = {
  key: string;
  coherent: boolean;
  satisfied: boolean;
  evidenceRefs: [string, string];
};

export type PreconditionOrderingDecision = {
  verdict: "approve" | "decline" | "escalate";
  rationale: string;
  checks: PreconditionOrderingCheck[];
};

export function evaluatePreconditionOrdering(input: {
  action: string;
  prerequisites: ArchitecturePrecondition[];
}): PreconditionOrderingDecision {
  const checks = input.prerequisites.map((prerequisite): PreconditionOrderingCheck => {
    const coherent = prerequisite.business.required === prerequisite.systems.required
      && Boolean(prerequisite.business.evidenceRef) && Boolean(prerequisite.systems.evidenceRef);
    return {
      key: prerequisite.key,
      coherent,
      satisfied: coherent && (!prerequisite.business.required
        || (prerequisite.business.satisfied && prerequisite.systems.satisfied)),
      evidenceRefs: [prerequisite.business.evidenceRef, prerequisite.systems.evidenceRef],
    };
  });
  if (checks.some((check) => !check.coherent)) {
    return {
      verdict: "escalate",
      rationale: `${input.action} has incoherent business and systems precondition evidence.`,
      checks,
    };
  }
  const unmet = checks.find((check) => !check.satisfied);
  if (unmet) {
    return {
      verdict: "decline",
      rationale: `${input.action} is blocked until prerequisite '${unmet.key}' is satisfied.`,
      checks,
    };
  }
  return { verdict: "approve", rationale: `${input.action} prerequisites are satisfied.`, checks };
}

export type PreconditionGate = (args: GovernedExecuteArgs) => Promise<PreconditionOrderingDecision>;
let overrideForTests: PreconditionGate | null = null;
export function setPreconditionGateOverrideForTests(override: PreconditionGate | null): void {
  overrideForTests = override;
}

export async function runTakPreconditionGate(args: GovernedExecuteArgs): Promise<PreconditionOrderingDecision> {
  if (overrideForTests) return overrideForTests(args);
  if (args.toolName !== "transition_employee_status") {
    return { verdict: "approve", rationale: "No executable preconditions are registered for this tool.", checks: [] };
  }
  const employeeRef = typeof args.rawParams.employeeId === "string" ? args.rawParams.employeeId.trim() : "";
  const employee = employeeRef
    ? await prisma.employeeProfile.findFirst({
        where: { OR: [{ id: employeeRef }, { employeeId: employeeRef }] },
        select: { id: true },
      })
    : null;
  return evaluatePreconditionOrdering({
    action: args.toolName,
    prerequisites: [{
      key: "employee-identity",
      business: {
        required: true,
        satisfied: Boolean(employee),
        evidenceRef: "workforce:employee-lifecycle:identity-before-transition",
      },
      systems: {
        required: true,
        satisfied: Boolean(employee),
        evidenceRef: "prisma:model:EmployeeProfile#employeeId",
      },
    }],
  });
}
