import { describe, expect, it } from "vitest";

import type { ToolDefinition } from "@/lib/mcp-tools";
import { narrowInitiativeReviewTools } from "./mcp-task-review-contract";

const binding = {
  writerToolName: "record_initiative_evidence",
  itemId: "BI-7D2C4F02",
  gate: "objective-mapping",
  expectedCurrentBaselineId: "baseline-08cecc05-02ef-4bf1-bfae-f250fc5e6da0",
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
        baselineId: evidenceWriterSchema.properties.baselineId,
        objectiveMappings: evidenceWriterSchema.properties.objectiveMappings,
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
});
