// Build-review tool pack — Simplify & Strengthen W9 (BI-0E7B0953).
//
// Drains the LAST three inline cases out of the mcp-tools.ts executeTool
// switch: saveBuildEvidence (evidence writes with per-field validation) and
// the reviewDesignDoc / reviewBuildPlan review gates. With this pack the
// legacy monolith stops registering any tool of its own — PLATFORM_TOOLS is
// purely the pack-registry composition and the switch is guard-frozen at zero
// inline cases (scripts/check-mcp-tool-pack.mjs).
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array — the
// tool-NAME contract is frozen: no renames, no schema changes. Grants mirror
// agent-grants.ts TOOL_TO_GRANTS, which stays the gating source. Handler
// implementations live in sibling modules (build-review-handlers.ts and
// build-design-review-handler.ts) so no file exceeds the module-size ceiling.

import type { ToolDefinition } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
import { saveBuildEvidence, reviewBuildPlan } from "@/lib/mcp/build-review-handlers";
import { reviewDesignDoc } from "@/lib/mcp/build-design-review-handler";

const definitions: ToolDefinition[] = [
  {
    name: "saveBuildEvidence",
    description: "Save evidence to a FeatureBuild record. ALWAYS pass both `field` and `value` — calls with empty `{}` are rejected. Example: `{field: \"designDoc\", value: {problemStatement: \"...\", existingFunctionalityAudit: \"...\", reusePlan: \"...\", proposedApproach: \"...\", acceptanceCriteria: [\"...\"]}}`. Valid fields: designDoc, designReview, buildPlan, planReview, taskResults, verificationOut, acceptanceMet.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
        field: { type: "string", enum: ["designDoc", "designReview", "buildPlan", "planReview", "taskResults", "verificationOut", "acceptanceMet"], description: "Evidence field to update — required" },
        value: { type: "object", description: "JSON value to store — required, do not omit. Shape varies by field; for designDoc use {problemStatement, existingFunctionalityAudit, reusePlan, proposedApproach, acceptanceCriteria[]}, for buildPlan use {fileStructure[], tasks[]} arrays." },
      },
      required: ["field", "value"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Internal build workflow — available in advise mode
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "reviewDesignDoc",
    description: "Submit the design document for AI review. Returns pass/fail with issues.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Internal build workflow — available in advise mode
    buildPhases: ["ideate"],
  },
  {
    name: "reviewBuildPlan",
    description: "Submit the implementation plan for AI review. Returns pass/fail with issues.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Internal build workflow — available in advise mode
    buildPhases: ["plan"],
  },
];

export const buildReviewPack: ToolPack = {
  packId: "build-review",
  definitions,
  handlers: {
    saveBuildEvidence: (params, userId, context) => saveBuildEvidence(params, userId, context),
    reviewDesignDoc: (params, userId, context) => reviewDesignDoc(params, userId, context),
    reviewBuildPlan: (params, userId, context) => reviewBuildPlan(params, userId, context),
  },
  grants: {
    saveBuildEvidence: ["build_evidence"],
    reviewDesignDoc: ["architecture_read"],
    reviewBuildPlan: ["build_plan_write"],
  },
};
