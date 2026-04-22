import { describe, expect, it } from "vitest";
import {
  BACKLOG_TRIAGE_OUTCOMES,
  BACKLOG_SOURCE_VALUES,
  BACKLOG_EFFORT_SIZES,
} from "@/lib/explore/backlog";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";

function toolInputEnum(toolName: string, field: string): readonly string[] {
  const tool = PLATFORM_TOOLS.find((t) => t.name === toolName);
  const properties = (tool?.inputSchema as { properties?: Record<string, { enum?: string[] }> } | undefined)
    ?.properties;
  return (properties?.[field]?.enum ?? []) as readonly string[];
}

describe("backlog enum parity between backlog.ts and mcp-tools.ts", () => {
  it("triageOutcome matches on triage_backlog_item.outcome", () => {
    expect(toolInputEnum("triage_backlog_item", "outcome")).toEqual([...BACKLOG_TRIAGE_OUTCOMES]);
  });

  it("source matches on create_backlog_item.source", () => {
    expect(toolInputEnum("create_backlog_item", "source")).toEqual([...BACKLOG_SOURCE_VALUES]);
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
});
