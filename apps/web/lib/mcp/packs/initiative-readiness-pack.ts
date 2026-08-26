import type { InitiativeArtifactRef, InitiativeGateKey } from "@/lib/backlog/initiative-readiness";
import { prisma } from "@dpf/db";
import {
  recordInitiativeGateReceipt,
  recordInitiativeObjectiveMappingProposal,
  recordInitiativeSpecApproval,
} from "@/lib/backlog/initiative-readiness";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import {
  INITIATIVE_READINESS_LANES as LANES,
  type InitiativeReadinessLane as Lane,
} from "@/lib/tak/initiative-readiness-tool-grants";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

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

function inputSchemaFor(name: string, lane: Lane): ToolDefinition["inputSchema"] {
  return {
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
      supersessionDispositions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            statementId: { type: "string" },
            reason: { type: "string" },
          },
          required: ["statementId", "reason"],
        },
      },
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
  };
}

function definitionBase(lane: Lane): Omit<ToolDefinition, "name" | "inputSchema"> {
  return {
    description: `Record authenticated initiative evidence for only these gate lanes: ${lane.gates.join(", ")}. Artifact identity, digest, subject, author, reviewer, and authority are server resolved.`,
    requiredCapability: lane.capability,
    executionMode: "immediate",
    sideEffect: true,
  };
}

const definitions: ToolDefinition[] = [
  {
    name: "record_initiative_evidence",
    inputSchema: inputSchemaFor("record_initiative_evidence", LANES.record_initiative_evidence),
    ...definitionBase(LANES.record_initiative_evidence),
  },
  {
    name: "record_initiative_design_review",
    inputSchema: inputSchemaFor("record_initiative_design_review", LANES.record_initiative_design_review),
    ...definitionBase(LANES.record_initiative_design_review),
  },
  {
    name: "record_initiative_architecture_review",
    inputSchema: inputSchemaFor("record_initiative_architecture_review", LANES.record_initiative_architecture_review),
    ...definitionBase(LANES.record_initiative_architecture_review),
  },
  {
    name: "record_initiative_data_review",
    inputSchema: inputSchemaFor("record_initiative_data_review", LANES.record_initiative_data_review),
    ...definitionBase(LANES.record_initiative_data_review),
  },
  {
    name: "record_initiative_ux_review",
    inputSchema: inputSchemaFor("record_initiative_ux_review", LANES.record_initiative_ux_review),
    ...definitionBase(LANES.record_initiative_ux_review),
  },
  {
    name: "record_initiative_security_review",
    inputSchema: inputSchemaFor("record_initiative_security_review", LANES.record_initiative_security_review),
    ...definitionBase(LANES.record_initiative_security_review),
  },
  {
    name: "record_initiative_compliance_review",
    inputSchema: inputSchemaFor("record_initiative_compliance_review", LANES.record_initiative_compliance_review),
    ...definitionBase(LANES.record_initiative_compliance_review),
  },
  {
    name: "record_initiative_domain_review",
    inputSchema: inputSchemaFor("record_initiative_domain_review", LANES.record_initiative_domain_review),
    ...definitionBase(LANES.record_initiative_domain_review),
  },
  {
    name: "record_initiative_archetype_review",
    inputSchema: inputSchemaFor("record_initiative_archetype_review", LANES.record_initiative_archetype_review),
    ...definitionBase(LANES.record_initiative_archetype_review),
  },
];

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

async function resolveExternalInitiativeReviewBinding(
  actionKey: string,
  taskRunId: string | undefined,
): Promise<{
  itemId: string;
  gate: string;
  expectedCurrentBaselineId?: string | null;
  artifactRef: InitiativeArtifactRef;
} | null> {
  if (!taskRunId) return null;
  const run = await prisma.taskRun.findUnique({
    where: { taskRunId },
    select: { a2aMetadata: true },
  });
  const metadata = run?.a2aMetadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  if (record["trigger"] !== "external-mcp") return null;
  const rawBinding = record["initiativeReviewBinding"];
  if (!rawBinding || typeof rawBinding !== "object" || Array.isArray(rawBinding)) return null;
  const binding = rawBinding as Record<string, unknown>;
  if (binding["writerToolName"] !== actionKey) return null;
  const itemId = typeof binding["itemId"] === "string" ? binding["itemId"].trim() : "";
  const gate = typeof binding["gate"] === "string" ? binding["gate"].trim() : "";
  const rawArtifact = binding["artifactRef"];
  const expectedCurrentBaselineId = binding["expectedCurrentBaselineId"];
  if (!itemId.startsWith("BI-") || !gate || !rawArtifact || typeof rawArtifact !== "object" || Array.isArray(rawArtifact)) {
    return null;
  }
  const artifact = rawArtifact as Record<string, unknown>;
  if (
    artifact["kind"] !== "repo-blob-at-commit"
    || typeof artifact["repositoryFullName"] !== "string"
    || typeof artifact["commitSha"] !== "string"
    || typeof artifact["path"] !== "string"
    || typeof artifact["providerBlobId"] !== "string"
    || (expectedCurrentBaselineId !== undefined
      && expectedCurrentBaselineId !== null
      && typeof expectedCurrentBaselineId !== "string")
  ) return null;
  return {
    itemId,
    gate,
    ...(expectedCurrentBaselineId !== undefined
      ? { expectedCurrentBaselineId: expectedCurrentBaselineId as string | null }
      : {}),
    artifactRef: {
      kind: "repo-blob-at-commit",
      repositoryFullName: artifact["repositoryFullName"],
      commitSha: artifact["commitSha"],
      path: artifact["path"],
      providerBlobId: artifact["providerBlobId"],
    },
  };
}

function handlerFor(actionKey: string, lane: Lane): ToolPackHandler {
  return async (params, userId, context): Promise<ToolResult> => {
    const binding = await resolveExternalInitiativeReviewBinding(actionKey, context?.taskRunId);
    if (binding) {
      params = {
        ...params,
        itemId: binding.itemId,
        gate: binding.gate,
        artifactRef: binding.artifactRef,
        ...(Object.prototype.hasOwnProperty.call(binding, "expectedCurrentBaselineId")
          ? { expectedCurrentBaselineId: binding.expectedCurrentBaselineId }
          : {}),
        ...(actionKey === "record_initiative_evidence" && binding.gate === "research"
          ? {
              findings: [],
              resolvedFindingRefs: [],
              reason: `Independent reviewer ${context?.agentId ?? "unknown"} recorded ${String(params.decision ?? "unknown")} for the immutable research artifact bound to TaskRun ${context?.taskRunId ?? "unknown"}.`,
            }
          : {}),
      };
    }
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
    const selectedProfile = params.profile;
    if (gate === "classification" && decision === "pass"
      && !(selectedProfile === "doc-only" || selectedProfile === "fix" || selectedProfile === "feature" || selectedProfile === "cross-domain" || selectedProfile === "archetype")) {
      return { success: false, error: "malformed-receipt", message: "Passing classification requires a governed profile." };
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
        supersessionDispositions: Array.isArray(params.supersessionDispositions)
          ? params.supersessionDispositions.flatMap((value) => value && typeof value === "object" && !Array.isArray(value)
            && typeof (value as Record<string, unknown>).statementId === "string"
            && typeof (value as Record<string, unknown>).reason === "string"
            ? [{
              statementId: (value as Record<string, string>).statementId,
              reason: (value as Record<string, string>).reason,
            }]
            : [])
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
      selectedProfile: gate === "classification" && decision === "pass" ? selectedProfile as never : undefined,
    });
    return result.ok
      ? { success: true, entityId: result.receiptId, message: `${gate} receipt recorded for ${String(params.itemId)}.`, data: { receiptId: result.receiptId } }
      : { success: false, error: result.code, message: result.error };
  };
}

// `LANES` is the single registry for disclosure, receipt validation AND recovery
// routing, so it deliberately carries lanes this pack does not own as tools —
// `record_plan_backlog_coverage` is routed here for the implementation-planner
// role but is IMPLEMENTED by decomposition-pack with a different schema
// (`decision: decomposed|atomic` + `deliverables`, not `gate` + `decision: pass`).
// Deriving handlers from every lane registered a second handler under that name
// and shadowed the real one, so the documented schema was rejected with
// `gate-not-authorized` and no plan coverage could be recorded (BI-17CBD21F).
// Bind handlers to the names this pack actually defines; the lane stays in
// `LANES` so `readinessLaneForRole` still resolves its recovery route.
const OWNED_TOOL_NAMES = definitions.map((definition) => definition.name);
const ownedLanes = Object.entries(LANES).filter(([name]) => OWNED_TOOL_NAMES.includes(name));

export const initiativeReadinessPack: ToolPack = {
  packId: "initiative-readiness",
  definitions,
  handlers: Object.fromEntries(ownedLanes.map(([name, lane]) => [name, handlerFor(name, lane)])),
  grants: Object.fromEntries(ownedLanes.map(([name, lane]) => [name, [lane.grant]])),
};
