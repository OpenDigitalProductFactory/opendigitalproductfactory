import { describe, expect, it } from "vitest";

import type { ToolDefinition } from "@/lib/mcp-tools";
import { narrowInitiativeReviewTools, parseInitiativeReviewBinding } from "./mcp-task-review-contract";

const binding = {
  writerToolName: "record_initiative_evidence",
  itemId: "BI-7D2C4F02",
  gate: "objective-mapping",
  expectedCurrentBaselineId: "baseline-08cecc05-02ef-4bf1-bfae-f250fc5e6da0",
  eligibleEvidenceActivityIds: ["EVIDENCE-1", "EVIDENCE-2"],
  workroomRef: {
    kind: "workroom-head" as const,
    workroomId: "WC-7D2C4F02",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    branchName: "fix/objective-mapping",
    headSha: "25934fda4591e2047bd66ac799a1e024353f03cd",
  },
  artifactRef: {
    kind: "repo-blob-at-commit" as const,
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    commitSha: "25934fda4591e2047bd66ac799a1e024353f03cd",
    path: "docs/superpowers/specs/2026-08-24-platform-sbom-currency-consolidation-design.md",
    providerBlobId: "3652f3d223fa8eb9a2a4873de7d65a8222f114c6",
  },
};

const evidenceWriterSchema = {
  type: "object",
  properties: {
    itemId: { type: "string" },
    gate: { type: "string" },
    decision: { type: "string", enum: ["pass", "fail", "not-applicable"] },
    artifactRef: { type: "object" },
    reason: { type: "string" },
    findings: { type: "array" },
    resolvedFindingRefs: { type: "array" },
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
  },
  required: ["itemId", "reason"],
};

describe("narrowInitiativeReviewTools", () => {
  it("exposes only the complete objective-mapping proposal on the bound evidence writer", () => {
    const reader: ToolDefinition = {
      name: "read_source_at_version",
      description: "Read immutable source.",
      requiredCapability: "manage_backlog",
      inputSchema: { type: "object", properties: {} },
    };
    const writer: ToolDefinition = {
      name: binding.writerToolName,
      description: "Record initiative evidence.",
      requiredCapability: "manage_backlog",
      inputSchema: evidenceWriterSchema,
    };
    const narrowed = narrowInitiativeReviewTools({
      tools: [reader, writer],
      toolsForProvider: [
        { type: "function", function: { name: reader.name, parameters: reader.inputSchema } },
        { type: "function", function: { name: writer.name, parameters: writer.inputSchema } },
      ],
      deferredTools: [],
    }, [reader.name, writer.name], binding);

    const expectedWriterSchema = {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["objective-mapping"] },
        baselineId: {
          type: "string",
          enum: [binding.expectedCurrentBaselineId],
        },
        objectiveMappings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              objectiveId: { type: "string" },
              evidenceRefs: {
                type: "array",
                items: { type: "string", enum: binding.eligibleEvidenceActivityIds },
                minItems: 1,
                uniqueItems: true,
              },
            },
            required: ["objectiveId", "evidenceRefs"],
          },
        },
        reason: evidenceWriterSchema.properties.reason,
      },
      required: ["operation", "baselineId", "objectiveMappings", "reason"],
      additionalProperties: false,
    };
    const narrowedWriter = narrowed.tools.find((tool) => tool.name === writer.name);
    const providerWriter = narrowed.toolsForProvider.find((tool) => {
      const fn = tool["function"] as Record<string, unknown> | undefined;
      return fn?.["name"] === writer.name;
    });

    expect(narrowedWriter?.inputSchema).toEqual(expectedWriterSchema);
    expect((providerWriter?.["function"] as Record<string, unknown>)?.["parameters"])
      .toEqual(expectedWriterSchema);
  });

  it("preserves the explicit objective-mapping operation on a legacy dependency-disposition binding", () => {
    const reader: ToolDefinition = {
      name: "read_source_at_version",
      description: "Read immutable source.",
      requiredCapability: "manage_backlog",
      inputSchema: { type: "object", properties: {} },
    };
    const writer: ToolDefinition = {
      name: binding.writerToolName,
      description: "Record initiative evidence.",
      requiredCapability: "manage_backlog",
      inputSchema: evidenceWriterSchema,
    };
    const legacyBinding = { ...binding, gate: "dependency-disposition" };
    const narrowed = narrowInitiativeReviewTools({
      tools: [reader, writer],
      toolsForProvider: [
        { type: "function", function: { name: reader.name, parameters: reader.inputSchema } },
        { type: "function", function: { name: writer.name, parameters: writer.inputSchema } },
      ],
      deferredTools: [],
    }, [reader.name, writer.name], legacyBinding,
    "Only if grounded, call record_initiative_evidence with operation='objective-mapping'.");

    expect(narrowed.tools.find((tool) => tool.name === writer.name)?.inputSchema).toEqual({
      type: "object",
      properties: {
        operation: { type: "string", enum: ["objective-mapping"] },
        baselineId: {
          type: "string",
          enum: [binding.expectedCurrentBaselineId],
        },
        objectiveMappings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              objectiveId: { type: "string" },
              evidenceRefs: {
                type: "array",
                items: { type: "string", enum: binding.eligibleEvidenceActivityIds },
                minItems: 1,
                uniqueItems: true,
              },
            },
            required: ["objectiveId", "evidenceRefs"],
          },
        },
        reason: evidenceWriterSchema.properties.reason,
      },
      required: ["operation", "baselineId", "objectiveMappings", "reason"],
      additionalProperties: false,
    });
  });

  it("rejects a newly issued objective-mapping binding without finite eligible evidence", () => {
    const withoutEvidence = { ...binding, eligibleEvidenceActivityIds: undefined };
    expect(parseInitiativeReviewBinding(withoutEvidence)).toBeNull();
    const withoutWorkroom = { ...binding, workroomRef: undefined };
    expect(parseInitiativeReviewBinding(withoutWorkroom)).toMatchObject({
      gate: "objective-mapping",
      eligibleEvidenceActivityIds: binding.eligibleEvidenceActivityIds,
    });
  });

  it("normalizes evidence order and rejects an incomplete Workroom identity", () => {
    expect(parseInitiativeReviewBinding({
      ...binding,
      eligibleEvidenceActivityIds: ["EVIDENCE-2", "EVIDENCE-1"],
    })?.eligibleEvidenceActivityIds).toEqual(["EVIDENCE-1", "EVIDENCE-2"]);
    expect(parseInitiativeReviewBinding({
      ...binding,
      workroomRef: { ...binding.workroomRef, headSha: "" },
    })).toBeNull();
    expect(parseInitiativeReviewBinding({
      ...binding,
      workroomRef: { ...binding.workroomRef, repositoryFullName: "Other/repository" },
    })).toBeNull();
  });

  it("does not grant objective-mapping authority to an ordinary dependency disposition", () => {
    const writer: ToolDefinition = {
      name: binding.writerToolName,
      description: "Record initiative evidence.",
      requiredCapability: "manage_backlog",
      inputSchema: evidenceWriterSchema,
    };
    const narrowed = narrowInitiativeReviewTools({
      tools: [writer],
      toolsForProvider: [
        { type: "function", function: { name: writer.name, parameters: writer.inputSchema } },
      ],
      deferredTools: [],
    }, [writer.name], { ...binding, gate: "dependency-disposition" },
    "Review the dependency disposition and record a governed pass or fail.");

    expect(narrowed.tools[0]?.inputSchema).toEqual({
      type: "object",
      properties: {
        decision: evidenceWriterSchema.properties.decision,
        reason: evidenceWriterSchema.properties.reason,
        findings: evidenceWriterSchema.properties.findings,
        resolvedFindingRefs: evidenceWriterSchema.properties.resolvedFindingRefs,
      },
      required: ["decision", "reason", "findings", "resolvedFindingRefs"],
      additionalProperties: false,
    });
  });
});
