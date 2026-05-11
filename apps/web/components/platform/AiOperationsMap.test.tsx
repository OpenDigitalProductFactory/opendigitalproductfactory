import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AiOperationsMap", () => {
  it("renders source and severity controls for managing projected activity", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).toContain("View controls");
    expect(source).toContain("Showing {filteredProjections.length} of {projections.length} activities");
    expect(source).toContain("SOURCE_OPTIONS");
    expect(source).toContain("SEVERITY_OPTIONS");
    expect(source).toContain("toggleSourceFilter");
    expect(source).toContain("toggleSeverityFilter");
  });
});
