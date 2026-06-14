import { describe, expect, it } from "vitest";
import {
  parseToolToGrants,
  buildMcpAuthorityModel,
  MCP_AUTH_PACKAGE_KEY,
  MCP_AUTH_DEFAULT_DENY_KEY,
} from "./mcp-authority-extract";

const FIXTURE = `
const TOOL_TO_GRANTS: Record<string, string[]> = {
  // a namespaced tool with a quoted key
  "mcp-x__act": ["browser_drive"],
  create_backlog_item: ["backlog_write"],
  query_backlog: ["backlog_read"],
  multi_tool: ["backlog_write", "build_evidence"],
};
`;

describe("parseToolToGrants", () => {
  it("parses quoted and bare tool keys with single and multi grant arrays", () => {
    const map = parseToolToGrants(FIXTURE);
    expect(map).toEqual({
      "mcp-x__act": ["browser_drive"],
      create_backlog_item: ["backlog_write"],
      query_backlog: ["backlog_read"],
      multi_tool: ["backlog_write", "build_evidence"],
    });
  });

  it("returns empty when the map is absent", () => {
    expect(parseToolToGrants("export const nope = 1;")).toEqual({});
  });
});

describe("buildMcpAuthorityModel", () => {
  const model = buildMcpAuthorityModel(parseToolToGrants(FIXTURE));
  const byKey = new Map(model.elements.map((e) => [e.sysmlKey, e]));

  it("counts tools and dedupes grants", () => {
    expect(model.toolCount).toBe(4);
    expect(model.grantCount).toBe(4); // backlog_read, backlog_write, browser_drive, build_evidence
  });

  it("emits a package, a default-deny constraint, grant requirements, and tool actions", () => {
    expect(byKey.get(MCP_AUTH_PACKAGE_KEY)?.typeSlug).toBe("package");
    expect(byKey.get(MCP_AUTH_DEFAULT_DENY_KEY)?.typeSlug).toBe("constraint");
    expect(byKey.get("mcp:grant:backlog_write")?.typeSlug).toBe("requirement");
    expect(byKey.get("mcp:tool:query_backlog")?.typeSlug).toBe("action");
    // 1 pkg + 1 constraint + 4 grants + 4 tools
    expect(model.elements).toHaveLength(10);
  });

  it("dedupes a grant shared by two tools into one requirement", () => {
    const writeReqs = model.elements.filter((e) => e.sysmlKey === "mcp:grant:backlog_write");
    expect(writeReqs).toHaveLength(1);
  });

  it("traces each tool to every grant that gates it", () => {
    const traces = model.relationships.filter((r) => r.relSlug === "traces");
    expect(traces).toContainEqual({ fromKey: "mcp:tool:multi_tool", toKey: "mcp:grant:backlog_write", relSlug: "traces" });
    expect(traces).toContainEqual({ fromKey: "mcp:tool:multi_tool", toKey: "mcp:grant:build_evidence", relSlug: "traces" });
    expect(traces).toContainEqual({ fromKey: "mcp:tool:mcp-x__act", toKey: "mcp:grant:browser_drive", relSlug: "traces" });
    expect(traces).toHaveLength(5);
  });

  it("contains every element under the package", () => {
    const contains = model.relationships.filter((r) => r.relSlug === "contains" && r.fromKey === MCP_AUTH_PACKAGE_KEY);
    // 4 grants + 4 tools + 1 constraint
    expect(contains).toHaveLength(9);
  });

  it("produces stable descriptors that change with the grant set", () => {
    expect(byKey.get("mcp:tool:multi_tool")?.descriptor).toBe("tool:multi_tool|grants:backlog_write,build_evidence");
  });
});
