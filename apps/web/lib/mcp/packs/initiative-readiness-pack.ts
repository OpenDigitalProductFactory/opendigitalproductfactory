import type { InitiativeArtifactRef, InitiativeGateKey } from "@/lib/backlog/initiative-readiness";
import {
  recordInitiativeGateReceipt,
  recordInitiativeObjectiveMappingProposal,
  recordInitiativeSpecApproval,
} from "@/lib/backlog/initiative-readiness";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

type Lane = {
  capability: NonNullable<ToolDefinition["requiredCapability"]>;
  grant: string;
  gates: readonly InitiativeGateKey[];
  independent: boolean;
};

const LANES: Record<string, Lane> = {
  record_initiative_evidence: { capability: "manage_backlog", grant: "initiative_evidence_write", gates: ["classification", "research", "dependency-disposition"], independent: false },
  record_initiative_design_review: { capability: "manage_backlog", grant: "initiative_design_review", gates: ["design-spec", "spec-approval", "plan-review"], independent: true },
  record_initiative_architecture_review: { capability: "manage_ea_model", grant: "initiative_architecture_review", gates: ["architecture-review"], independent: true },
  record_initiative_data_review: { capability: "manage_ea_model", grant: "initiative_data_review", gates: ["data-review"], independent: true },
  record_initiative_ux_review: { capability: "manage_backlog", grant: "initiative_ux_review", gates: ["ux-fit-review"], independent: true },
  record_initiative_security_review: { capability: "manage_compliance", grant: "initiative_security_review", gates: ["security-review"], independent: true },
  record_initiative_compliance_review: { capability: "manage_compliance", grant: "initiative_compliance_review", gates: ["compliance-review"], independent: true },
  record_initiative_domain_review: { capability: "manage_backlog", grant: "initiative_domain_review", gates: ["domain-review"], independent: true },
  record_initiative_archetype_review: { capability: "manage_taxonomy", grant: "initiative_archetype_review", gates: ["archetype-provisioning", "archetype-completeness"], independent: true },
};

const artifactRefSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["feature-build-revision", "document-version", "repo-blob-at-commit"] },
    revisionId: { type: "string" },
    versionId: { type: "string" },
    repositoryFullName: { type: "string" },
    commitSha: { type: "string" },
    path: { type: "string" },
    providerBlobId: { type: "string" },
  },
  required: ["kind"],
};

const definitions: ToolDefinition[] = Object.entries(LANES).map(([name, lane]) => ({
  name,
  description: `Record authenticated initiative evidence for only these gate lanes: ${lane.gates.join(", ")}. Artifact identity, digest, subject, author, reviewer, and authority are server resolved.`,
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "string", description: "Governed BacklogItem ID (BI-*)." },
      gate: { type: "string", enum: [...lane.gates] },
      decision: { type: "string", enum: ["pass", "fail", "not-applicable"] },
      artifactRef: artifactRefSchema,
      reason: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            issue: { type: "string" },
            severity: { type: "string", enum: ["critical", "important"] },
          },
          required: ["issue", "severity"],
        },
      },
      resolvedFindingRefs: { type: "array", items: { type: "string" } },
      profile: { type: "string", enum: ["doc-only", "fix", "feature", "cross-domain", "archetype"] },
      artifactRole: { type: "string", enum: ["design-spec", "problem-statement", "documentation-scope"] },
      expectedCurrentBaselineId: { type: ["string", "null"] },
      supersessionDispositionIds: { type: "array", items: { type: "string" } },
      ...(name === "record_initiative_evidence" ? {
        operation: { type: "string", enum: ["gate-receipt", "objective-mapping"] },
        baselineId: { type: "string" },
        objectiveMappings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              objectiveId: { type: "string" },
              evidenceRefs: { type: "array", items: { type: "string" } },
            },
            required: ["objectiveId", "evidenceRefs"],
          },
        },
      } : {}),
    },
    required: name === "record_initiative_evidence"
      ? ["itemId", "reason"]
      : ["itemId", "gate", "decision", "artifactRef", "reason", "findings", "resolvedFindingRefs"],
  },
  requiredCapability: lane.capability,
  executionMode: "immediate",
  sideEffect: true,
}));

function parseFindings(value: unknown): Array<{ issue: string; severity: "critical" | "important" }> | null {
  if (!Array.isArray(value)) return null;
  const findings: Array<{ issue: string; severity: "critical" | "important" }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const finding = entry as Record<string, unknown>;
    if (typeof finding.issue !== "string" || !finding.issue.trim()
      || (finding.severity !== "critical" && finding.severity !== "important")) return null;
    findings.push({ issue: finding.issue, severity: finding.severity });
  }
  return findings;
}

function parseStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim())
    ? value as string[]
    : null;
}

function parseObjectiveMappings(value: unknown): Array<{ objectiveId: string; evidenceRefs: string[] }> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const mappings: Array<{ objectiveId: string; evidenceRefs: string[] }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const mapping = entry as Record<string, unknown>;
    const evidenceRefs = parseStringArray(mapping.evidenceRefs);
    if (typeof mapping.objectiveId !== "string" || !mapping.objectiveId.trim() || !evidenceRefs || evidenceRefs.length === 0) return null;
    mappings.push({ objectiveId: mapping.objectiveId, evidenceRefs });
  }
  return mappings;
}

function handlerFor(actionKey: string, lane: Lane): ToolPackHandler {
  return async (params, userId, context): Promise<ToolResult> => {
    const operation = params.operation ?? "gate-receipt";
    if (actionKey === "record_initiative_evidence" && operation === "objective-mapping") {
      const mappings = parseObjectiveMappings(params.objectiveMappings);
      if (typeof params.baselineId !== "string" || !params.baselineId.trim() || !mappings) {
        return { success: false, error: "malformed-receipt", message: "Objective mapping requires a current baselineId and non-empty objective/evidence mappings." };
      }
      const result = await recordInitiativeObjectiveMappingProposal({
        itemId: String(params.itemId ?? ""),
        baselineId: params.baselineId,
        mappings,
        reason: String(params.reason ?? ""),
        proposerUserId: userId,
        proposerAgentId: context?.agentId ?? null,
        authorityDecisionId: context?.authorityDecisionId ?? null,
        tokenScope: context?.tokenScope ?? null,
      });
      return result.ok
        ? { success: true, entityId: result.proposalId, message: `Objective evidence proposal recorded for ${String(params.itemId)}.`, data: { proposalId: result.proposalId } }
        : { success: false, error: result.code, message: result.error };
    }
    if (operation !== "gate-receipt") {
      return { success: false, error: "malformed-receipt", message: `${actionKey} does not support that operation.` };
    }
    const gate = params.gate;
    const decision = params.decision;
    if (typeof gate !== "string" || !lane.gates.includes(gate as InitiativeGateKey)) {
      return { success: false, error: "gate-not-authorized", message: `${actionKey} cannot record that gate.` };
    }
    if (decision !== "pass" && decision !== "fail" && decision !== "not-applicable") {
      return { success: false, error: "malformed-receipt", message: "decision must be pass, fail, or not-applicable." };
    }
    if (!params.artifactRef || typeof params.artifactRef !== "object") {
      return { success: false, error: "malformed-receipt", message: "artifactRef is required." };
    }
    const findings = parseFindings(params.findings);
    const resolvedFindingRefs = parseStringArray(params.resolvedFindingRefs);
    if (!findings || !resolvedFindingRefs) {
      return { success: false, error: "malformed-receipt", message: "findings and resolvedFindingRefs must match the governed receipt schema." };
    }
    if (gate === "spec-approval" && decision === "pass") {
      const profile = params.profile;
      const artifactRole = params.artifactRole;
      if (!(profile === "doc-only" || profile === "fix" || profile === "feature" || profile === "cross-domain" || profile === "archetype")
        || !(artifactRole === "design-spec" || artifactRole === "problem-statement" || artifactRole === "documentation-scope")) {
        return { success: false, error: "malformed-receipt", message: "Passing spec approval requires profile and artifactRole." };
      }
      if (findings.length > 0) {
        return { success: false, error: "malformed-receipt", message: "A passing spec approval cannot introduce findings." };
      }
      const approval = await recordInitiativeSpecApproval({
        itemId: String(params.itemId ?? ""),
        profile,
        artifactRole,
        artifactRef: params.artifactRef as InitiativeArtifactRef,
        expectedCurrentBaselineId: typeof params.expectedCurrentBaselineId === "string" ? params.expectedCurrentBaselineId : null,
        supersessionDispositionIds: Array.isArray(params.supersessionDispositionIds)
          ? params.supersessionDispositionIds.filter((value): value is string => typeof value === "string")
          : [],
        resolvedFindingRefs,
        reason: String(params.reason ?? ""),
        reviewerUserId: userId,
        reviewerAgentId: context?.agentId ?? null,
        authorityDecisionId: context?.authorityDecisionId ?? null,
        tokenScope: context?.tokenScope ?? null,
      });
      return approval.ok
        ? { success: true, entityId: approval.baselineId, message: `spec-approval receipt and canonical baseline recorded for ${String(params.itemId)}.`, data: approval }
        : { success: false, error: approval.code, message: approval.error };
    }
    const result = await recordInitiativeGateReceipt({
      itemId: String(params.itemId ?? ""),
      allowedGates: lane.gates,
      requiredCapability: lane.capability,
      requiredGrant: lane.grant,
      actionKey,
      gate: gate as InitiativeGateKey,
      decision,
      artifactRef: params.artifactRef as InitiativeArtifactRef,
      reason: String(params.reason ?? ""),
      findings,
      resolvedFindingRefs,
      reviewerUserId: userId,
      reviewerAgentId: context?.agentId ?? null,
      authorityDecisionId: context?.authorityDecisionId ?? null,
      tokenScope: context?.tokenScope ?? null,
      requiresIndependentReviewer: lane.independent,
    });
    return result.ok
      ? { success: true, entityId: result.receiptId, message: `${gate} receipt recorded for ${String(params.itemId)}.`, data: { receiptId: result.receiptId } }
      : { success: false, error: result.code, message: result.error };
  };
}

export const initiativeReadinessPack: ToolPack = {
  packId: "initiative-readiness",
  definitions,
  handlers: Object.fromEntries(Object.entries(LANES).map(([name, lane]) => [name, handlerFor(name, lane)])),
  grants: Object.fromEntries(Object.entries(LANES).map(([name, lane]) => [name, [lane.grant]])),
};
