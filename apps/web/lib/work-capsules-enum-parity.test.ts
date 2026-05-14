import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "./mcp-tools";
import {
  WORK_CAPSULE_EVIDENCE_KINDS,
  WORK_CAPSULE_EXECUTOR_KINDS,
  WORK_CAPSULE_SOURCES,
  WORK_CAPSULE_STATUSES,
} from "./work-capsules";

function enumOf(toolName: string, paramName: string): readonly string[] {
  const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`Tool ${toolName} is not registered`);
  const schema = tool.inputSchema as { properties?: Record<string, { enum?: string[] }> };
  return schema.properties?.[paramName]?.enum ?? [];
}

describe("work capsule MCP enum parity", () => {
  it("list_work_capsules.status mirrors WORK_CAPSULE_STATUSES", () => {
    expect(enumOf("list_work_capsules", "status")).toEqual([...WORK_CAPSULE_STATUSES]);
  });

  it("create_work_capsule.source mirrors WORK_CAPSULE_SOURCES", () => {
    expect(enumOf("create_work_capsule", "source")).toEqual([...WORK_CAPSULE_SOURCES]);
  });

  it("create_work_capsule.executorKind mirrors WORK_CAPSULE_EXECUTOR_KINDS", () => {
    expect(enumOf("create_work_capsule", "executorKind")).toEqual([...WORK_CAPSULE_EXECUTOR_KINDS]);
  });

  it("record_capsule_evidence.kind mirrors WORK_CAPSULE_EVIDENCE_KINDS", () => {
    expect(enumOf("record_capsule_evidence", "kind")).toEqual([...WORK_CAPSULE_EVIDENCE_KINDS]);
  });
});
