import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "./mcp-tools";
import {
  WORK_CAPSULE_BRANCH_TAXONOMIES,
  WORK_CAPSULE_DECISION_SCOPES,
  WORK_CAPSULE_EVIDENCE_KINDS,
  WORK_CAPSULE_EXECUTOR_KINDS,
  WORK_CAPSULE_OUTCOME_ANCHOR_KINDS,
  WORK_CAPSULE_PORTFOLIO_ROLES,
  WORK_CAPSULE_SCOPE_ACTIVITY_KINDS,
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
  it("list_workrooms.status mirrors WORK_CAPSULE_STATUSES", () => {
    expect(enumOf("list_workrooms", "status")).toEqual([...WORK_CAPSULE_STATUSES]);
  });

  it("create_workroom.source mirrors WORK_CAPSULE_SOURCES", () => {
    expect(enumOf("create_workroom", "source")).toEqual([...WORK_CAPSULE_SOURCES]);
  });

  it("create_workroom.executorKind mirrors WORK_CAPSULE_EXECUTOR_KINDS", () => {
    expect(enumOf("create_workroom", "executorKind")).toEqual([...WORK_CAPSULE_EXECUTOR_KINDS]);
  });

  it("create_workroom scope enums mirror source constants", () => {
    expect(enumOf("create_workroom", "decisionScope")).toEqual([...WORK_CAPSULE_DECISION_SCOPES]);
    expect(enumOf("create_workroom", "portfolioRole")).toEqual([...WORK_CAPSULE_PORTFOLIO_ROLES]);
    expect(enumOf("create_workroom", "activityKind")).toEqual([...WORK_CAPSULE_SCOPE_ACTIVITY_KINDS]);

    const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === "create_workroom");
    const schema = tool?.inputSchema as {
      properties?: Record<string, { properties?: Record<string, { enum?: string[] }> }>;
    };
    expect(schema.properties?.outcomeAnchor?.properties?.kind?.enum).toEqual([
      ...WORK_CAPSULE_OUTCOME_ANCHOR_KINDS,
    ]);
  });

  it("adopt_worktree scope enums mirror source constants", () => {
    expect(enumOf("adopt_worktree", "decisionScope")).toEqual([...WORK_CAPSULE_DECISION_SCOPES]);
    expect(enumOf("adopt_worktree", "portfolioRole")).toEqual([...WORK_CAPSULE_PORTFOLIO_ROLES]);
    expect(enumOf("adopt_worktree", "activityKind")).toEqual([...WORK_CAPSULE_SCOPE_ACTIVITY_KINDS]);
  });

  it("list_workrooms scope filters mirror source constants", () => {
    expect(enumOf("list_workrooms", "decisionScope")).toEqual([...WORK_CAPSULE_DECISION_SCOPES]);
    expect(enumOf("list_workrooms", "portfolioRole")).toEqual([...WORK_CAPSULE_PORTFOLIO_ROLES]);
  });

  it("record_workroom_evidence.kind mirrors WORK_CAPSULE_EVIDENCE_KINDS", () => {
    expect(enumOf("record_workroom_evidence", "kind")).toEqual([...WORK_CAPSULE_EVIDENCE_KINDS]);
  });

  it("update_workroom_status.status mirrors WORK_CAPSULE_STATUSES", () => {
    expect(enumOf("update_workroom_status", "status")).toEqual([...WORK_CAPSULE_STATUSES]);
  });

  it("plan_workroom_worktree.taxonomy mirrors WORK_CAPSULE_BRANCH_TAXONOMIES", () => {
    expect(enumOf("plan_workroom_worktree", "taxonomy")).toEqual([...WORK_CAPSULE_BRANCH_TAXONOMIES]);
  });
});
