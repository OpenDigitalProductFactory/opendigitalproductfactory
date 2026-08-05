// Compliance-scope capture tool pack (BI-0B867B67 phase 3).
//
// Exposes record_compliance_scope so the compliance coworker can capture — mid
// conversation — what the business does with data and where it employs people.
// It writes the same BusinessContext columns the /storefront/settings/business
// form writes, so a signal captured conversationally moves matching regulations
// from "needs review" to "applies". The grant mirrors agent-grants.ts
// TOOL_TO_GRANTS (the gating source); the compliance-officer already holds
// data_governance_validate.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const definitions: ToolDefinition[] = [
  {
    name: "record_compliance_scope",
    description:
      "Capture what this business CONFIRMS it does with data and where it employs people, so the right " +
      "compliance obligations apply instead of showing as 'needs review'. Use after the operator confirms " +
      "a fact about their business — e.g. 'we process customer personal data', 'we send marketing email', " +
      "'we use AI to make decisions about people', 'we employ staff in the US'. Pass dataHandling " +
      "predicates and/or employsIn jurisdiction slugs. Values are merged with what is already declared " +
      "(never wiped). Capture ONLY confirmed statements about their own business, never speculation.",
    inputSchema: {
      type: "object",
      properties: {
        dataHandling: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "processes-personal-data",
              "serves-consumers",
              "handles-card-data",
              "deploys-automated-decisioning",
              "sends-marketing",
              "publicly-accessible-service",
              "handles-health-data",
              "handles-financial-data",
              "handles-education-data",
              "government-customers",
            ],
          },
          description: "Data-handling predicates the business confirmed it does.",
        },
        employsIn: {
          type: "array",
          items: { type: "string", enum: ["us", "eu", "uk", "global"] },
          description: "Jurisdiction blocs where the business employs staff (drives employment-law scope).",
        },
      },
    },
    requiredCapability: "view_compliance",
    executionMode: "immediate",
    sideEffect: true,
  },
];

async function recordComplianceScope(params: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { captureComplianceScope } = await import("@/lib/compliance/capture-compliance-scope");
    const result = await captureComplianceScope({
      dataHandling: Array.isArray(params["dataHandling"]) ? (params["dataHandling"] as unknown[]).map(String) : undefined,
      employsIn: Array.isArray(params["employsIn"]) ? (params["employsIn"] as unknown[]).map(String) : undefined,
    });
    if (!result.ok) {
      return { success: false, error: "capture_failed", message: result.message };
    }
    return {
      success: true,
      message: result.message,
      data: { dataHandling: result.dataHandling, employsIn: result.employsIn },
    };
  } catch (error) {
    return { success: false, error: "capture_error", message: getErrorMessage(error) };
  }
}

export const complianceScopePack: ToolPack = {
  packId: "compliance-scope",
  definitions,
  handlers: {
    record_compliance_scope: (params) => recordComplianceScope(params),
  },
  grants: {
    record_compliance_scope: ["data_governance_validate"],
  },
};
