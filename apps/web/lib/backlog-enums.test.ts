import { describe, expect, it } from "vitest";
import {
  BACKLOG_TRIAGE_OUTCOMES,
  BACKLOG_SOURCE_VALUES,
  BACKLOG_WORK_TYPE_VALUES,
  BACKLOG_EFFORT_SIZES,
  BACKLOG_STATUS_VALUES,
  BACKLOG_SCOPE_KIND_VALUES,
  EPIC_STATUSES,
} from "@/lib/explore/backlog";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";

function toolInputEnum(toolName: string, field: string): readonly string[] {
  const tool = PLATFORM_TOOLS.find((t) => t.name === toolName);
  const properties = (tool?.inputSchema as { properties?: Record<string, { enum?: string[] }> } | undefined)
    ?.properties;
  return (properties?.[field]?.enum ?? []) as readonly string[];
}

function toolInputFields(toolName: string): string[] {
  const tool = PLATFORM_TOOLS.find((t) => t.name === toolName);
  const properties = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  return Object.keys(properties ?? {}).sort();
}

describe("backlog enum parity between backlog.ts and mcp-tools.ts", () => {
  it("triageOutcome matches on triage_backlog_item.outcome", () => {
    expect(toolInputEnum("triage_backlog_item", "outcome")).toEqual([...BACKLOG_TRIAGE_OUTCOMES]);
  });

  it("source matches on create_backlog_item.source", () => {
    expect(toolInputEnum("create_backlog_item", "source")).toEqual([...BACKLOG_SOURCE_VALUES]);
  });

  it("scopeKind matches on create_backlog_item.scopeKind", () => {
    expect(toolInputEnum("create_backlog_item", "scopeKind")).toEqual([...BACKLOG_SCOPE_KIND_VALUES]);
  });

  it("scopeKind matches on update_backlog_item.scopeKind", () => {
    expect(toolInputEnum("update_backlog_item", "scopeKind")).toEqual([...BACKLOG_SCOPE_KIND_VALUES]);
  });

  it("scopeKind matches on list_backlog_items.scopeKind filter", () => {
    expect(toolInputEnum("list_backlog_items", "scopeKind")).toEqual([...BACKLOG_SCOPE_KIND_VALUES]);
  });

  it("scopeKind matches on query_backlog.scopeKind filter", () => {
    expect(toolInputEnum("query_backlog", "scopeKind")).toEqual([...BACKLOG_SCOPE_KIND_VALUES]);
  });

  it("scopeKind matches on list_epics.scopeKind filter", () => {
    expect(toolInputEnum("list_epics", "scopeKind")).toEqual([...BACKLOG_SCOPE_KIND_VALUES]);
  });

  it("scopeKind matches on create_epic.scopeKind", () => {
    expect(toolInputEnum("create_epic", "scopeKind")).toEqual([...BACKLOG_SCOPE_KIND_VALUES]);
  });

  it("scopeKind matches on update_epic.scopeKind", () => {
    expect(toolInputEnum("update_epic", "scopeKind")).toEqual([...BACKLOG_SCOPE_KIND_VALUES]);
  });

  it("workType matches on create_backlog_item.workType", () => {
    expect(toolInputEnum("create_backlog_item", "workType")).toEqual([...BACKLOG_WORK_TYPE_VALUES]);
  });

  it("workType matches on update_backlog_item.workType", () => {
    expect(toolInputEnum("update_backlog_item", "workType")).toEqual([...BACKLOG_WORK_TYPE_VALUES]);
  });

  it("source matches on update_backlog_item.source", () => {
    expect(toolInputEnum("update_backlog_item", "source")).toEqual([...BACKLOG_SOURCE_VALUES]);
  });

  it("workType matches on list_backlog_items.workType filter", () => {
    expect(toolInputEnum("list_backlog_items", "workType")).toEqual([...BACKLOG_WORK_TYPE_VALUES]);
  });

  it("source matches on list_backlog_items.source filter", () => {
    expect(toolInputEnum("list_backlog_items", "source")).toEqual([...BACKLOG_SOURCE_VALUES]);
  });

  it("create_backlog_item declares workType as required", () => {
    const tool = PLATFORM_TOOLS.find((t) => t.name === "create_backlog_item");
    const required = (tool?.inputSchema as { required?: string[] } | undefined)?.required ?? [];
    expect(required).toContain("workType");
  });

  it("effortSize matches on size_backlog_item.size", () => {
    expect(toolInputEnum("size_backlog_item", "size")).toEqual([...BACKLOG_EFFORT_SIZES]);
  });

  it("effortSize matches on triage_backlog_item.effortSize", () => {
    expect(toolInputEnum("triage_backlog_item", "effortSize")).toEqual([...BACKLOG_EFFORT_SIZES]);
  });

  it("proposedOutcome on create_backlog_item uses the triage outcome enum", () => {
    expect(toolInputEnum("create_backlog_item", "proposedOutcome")).toEqual([...BACKLOG_TRIAGE_OUTCOMES]);
  });

  it("update_backlog_item.status matches shared backlog statuses", () => {
    expect(toolInputEnum("update_backlog_item", "status")).toEqual([...BACKLOG_STATUS_VALUES]);
  });

  it("query_backlog.status matches shared backlog statuses", () => {
    expect(toolInputEnum("query_backlog", "status")).toEqual([...BACKLOG_STATUS_VALUES]);
  });

  it("create_epic.status matches shared epic statuses", () => {
    expect(toolInputEnum("create_epic", "status")).toEqual([...EPIC_STATUSES]);
  });

  it("update_epic.status matches shared epic statuses", () => {
    expect(toolInputEnum("update_epic", "status")).toEqual([...EPIC_STATUSES]);
  });

  it("create_epic exposes the generic epic management fields", () => {
    expect(toolInputFields("create_epic")).toEqual(
      expect.arrayContaining([
        "description",
        "epicId",
        "owner",
        "planPath",
        "priority",
        "rationale",
        "source",
        "specPath",
        "status",
        "scopeKind",
        "archetypeCategories",
        "archetypeIds",
        "scopeRationale",
        "lifecycleTags",
        "title",
      ]),
    );
  });

  it("update_epic exposes priority and spec/plan audit context", () => {
    expect(toolInputFields("update_epic")).toEqual(
      expect.arrayContaining([
        "description",
        "epicId",
        "planPath",
        "priority",
        "rationale",
        "scopeKind",
        "archetypeCategories",
        "archetypeIds",
        "scopeRationale",
        "lifecycleTags",
        "specPath",
        "status",
        "title",
      ]),
    );
  });
});
