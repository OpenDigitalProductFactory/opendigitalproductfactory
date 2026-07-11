// Licensing tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the licensing-readiness domain out of the mcp-tools.ts executeTool
// switch: persisting the organization's licensing investigation posture, and
// filing a factual licensing-readiness issue for a missing authority, unresolved
// legality question, missing credential, fee blocker, or display gap. Each
// handler lazy-imports the single backing compliance-actions service and
// reproduces the former switch case verbatim, so behaviour is identical when the
// tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "save_licensing_investigation",
    description: "Persist the current licensing investigation posture for the business without requiring every field to be re-entered. Use this to save whether the business is existing, new, or expanding, plus jurisdiction and research-confidence updates discovered during the coworker conversation.",
    inputSchema: {
      type: "object",
      properties: {
        setupStatus: { type: "string", enum: ["draft", "investigating", "ready", "blocked"] },
        investigationMode: { type: "string", enum: ["unknown", "existing", "new_business", "expanding"] },
        homeCountryCode: { type: "string", description: "Two-letter country code when known" },
        primaryRegionCode: { type: "string", description: "Primary state, province, or region code when known" },
        operatingFootprintSummary: { type: "string", description: "Short summary of where the business operates or delivers regulated work" },
        legalActivityConfidence: { type: "string", enum: ["low", "medium", "high"] },
        researchCoverageStatus: { type: "string", enum: ["draft", "partial", "covered", "stale"] },
        notes: { type: "string", description: "Investigation notes, official-source findings, or unresolved caveats" },
        appendNotes: { type: "boolean", description: "When true, append notes to the existing profile notes instead of replacing them" },
      },
      required: [],
    },
    requiredCapability: "manage_compliance",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "create_licensing_readiness_issue",
    description: "Create a factual licensing readiness issue for a missing authority, unresolved legality question, missing staff credential, fee blocker, or display/posting gap discovered during investigation.",
    inputSchema: {
      type: "object",
      properties: {
        issueType: { type: "string", description: "Short machine-readable issue type such as missing_jurisdiction_research or missing_person_credential" },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        title: { type: "string", description: "Human-readable issue title" },
        details: { type: "string", description: "Factual description of the gap, blocker, or unresolved question" },
        organizationLicenseRecordId: { type: "string", description: "Optional linked organization-held license record id" },
        personLicenseRecordId: { type: "string", description: "Optional linked person-held credential record id" },
      },
      required: ["issueType", "title"],
    },
    requiredCapability: "manage_compliance",
    executionMode: "immediate",
    sideEffect: true,
  },
];

async function saveLicensingInvestigationHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { saveLicensingInvestigationFinding } = await import("@/lib/actions/licensing-compliance");
  const result = await saveLicensingInvestigationFinding({
    setupStatus: typeof params["setupStatus"] === "string" ? params["setupStatus"] : undefined,
    investigationMode: typeof params["investigationMode"] === "string" ? params["investigationMode"] : undefined,
    homeCountryCode: typeof params["homeCountryCode"] === "string" ? params["homeCountryCode"] : undefined,
    primaryRegionCode: typeof params["primaryRegionCode"] === "string" ? params["primaryRegionCode"] : undefined,
    operatingFootprintSummary:
      typeof params["operatingFootprintSummary"] === "string"
        ? params["operatingFootprintSummary"]
        : undefined,
    legalActivityConfidence:
      typeof params["legalActivityConfidence"] === "string"
        ? params["legalActivityConfidence"]
        : undefined,
    researchCoverageStatus:
      typeof params["researchCoverageStatus"] === "string"
        ? params["researchCoverageStatus"]
        : undefined,
    notes: typeof params["notes"] === "string" ? params["notes"] : undefined,
    appendNotes: typeof params["appendNotes"] === "boolean" ? params["appendNotes"] : undefined,
  });

  return {
    success: result.ok,
    entityId: result.id,
    message: result.message,
    ...(result.ok ? {} : { error: result.message }),
  };
}

async function createLicensingReadinessIssueHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { createLicenseReadinessIssue } = await import("@/lib/actions/licensing-compliance");
  const result = await createLicenseReadinessIssue({
    issueType: String(params["issueType"] ?? ""),
    severity: typeof params["severity"] === "string" ? params["severity"] : undefined,
    title: String(params["title"] ?? ""),
    details: typeof params["details"] === "string" ? params["details"] : undefined,
    organizationLicenseRecordId:
      typeof params["organizationLicenseRecordId"] === "string"
        ? params["organizationLicenseRecordId"]
        : undefined,
    personLicenseRecordId:
      typeof params["personLicenseRecordId"] === "string"
        ? params["personLicenseRecordId"]
        : undefined,
  });

  return {
    success: result.ok,
    entityId: result.id,
    message: result.message,
    ...(result.ok ? {} : { error: result.message }),
  };
}

const handlers: Record<string, ToolPackHandler> = {
  save_licensing_investigation: (params) => saveLicensingInvestigationHandler(params),
  create_licensing_readiness_issue: (params) => createLicensingReadinessIssueHandler(params),
};

export const licensingPack: ToolPack = {
  packId: "licensing",
  definitions,
  handlers,
  grants: {
    save_licensing_investigation: ["policy_write"],
    create_licensing_readiness_issue: ["policy_write"],
  },
};
