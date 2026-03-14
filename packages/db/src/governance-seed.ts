import type { PrismaClient } from "../generated/client";

export function getDefaultCapabilityClasses() {
  return [
    {
      capabilityClassId: "cap-advisory",
      name: "Advisory",
      description: "Read-mostly guidance and recommendation agents with low-risk authority.",
      riskBand: "low",
      defaultActionScope: {
        actionFamilies: ["advisory.read", "advisory.suggest"],
        resourceTypes: ["workspace", "knowledge"],
        maxRiskBand: "low",
      },
    },
    {
      capabilityClassId: "cap-operator",
      name: "Operator",
      description: "Routine workflow operators with bounded execution authority.",
      riskBand: "medium",
      defaultActionScope: {
        actionFamilies: ["workflow.read", "workflow.update"],
        resourceTypes: ["user", "task", "ticket"],
        maxRiskBand: "medium",
        constraints: { teamScoped: true },
      },
    },
    {
      capabilityClassId: "cap-specialist",
      name: "Specialist",
      description: "Domain-specialist agents for higher-complexity workflow execution.",
      riskBand: "high",
      defaultActionScope: {
        actionFamilies: ["workflow.read", "workflow.update", "workflow.execute"],
        resourceTypes: ["user", "employee", "customer", "backlog_item"],
        maxRiskBand: "high",
        constraints: { teamScoped: true },
      },
    },
    {
      capabilityClassId: "cap-elevated",
      name: "Elevated",
      description: "High-authority agents that still require governed human oversight.",
      riskBand: "critical",
      defaultActionScope: {
        actionFamilies: ["workflow.execute", "governance.request_elevation"],
        resourceTypes: ["user", "employee", "customer", "platform"],
        maxRiskBand: "critical",
      },
    },
  ] as const;
}

export function getDefaultDirectivePolicyClasses() {
  return [
    {
      policyClassId: "dir-workflow-standard",
      name: "Workflow Standard",
      description: "Standard workflow directives with manager-approved operational scope.",
      configCategory: "workflow",
      approvalMode: "manager_approval",
      allowedRiskBand: "high",
    },
    {
      policyClassId: "dir-persona-standard",
      name: "Persona Standard",
      description: "Low-risk persona and tone directives.",
      configCategory: "persona",
      approvalMode: "self_service",
      allowedRiskBand: "low",
    },
    {
      policyClassId: "dir-tool-access-admin",
      name: "Tool Access Admin",
      description: "High-risk tool and integration directives requiring admin approval.",
      configCategory: "tool_access",
      approvalMode: "admin_approval",
      allowedRiskBand: "critical",
    },
  ] as const;
}

export async function seedGovernanceReferenceData(prisma: PrismaClient): Promise<void> {
  for (const capabilityClass of getDefaultCapabilityClasses()) {
    await prisma.agentCapabilityClass.upsert({
      where: { capabilityClassId: capabilityClass.capabilityClassId },
      update: {
        name: capabilityClass.name,
        description: capabilityClass.description,
        riskBand: capabilityClass.riskBand,
        defaultActionScope: capabilityClass.defaultActionScope,
      },
      create: capabilityClass,
    });
  }

  for (const policyClass of getDefaultDirectivePolicyClasses()) {
    await prisma.directivePolicyClass.upsert({
      where: { policyClassId: policyClass.policyClassId },
      update: {
        name: policyClass.name,
        description: policyClass.description,
        configCategory: policyClass.configCategory,
        approvalMode: policyClass.approvalMode,
        allowedRiskBand: policyClass.allowedRiskBand,
      },
      create: policyClass,
    });
  }
}
