import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AiOperationsMap", () => {
  it("renders source and severity controls for managing projected activity", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).toContain("View controls");
    expect(source).toContain("Showing {filteredProjections.length} of {projections.length} activities");
    expect(source).toContain("SOURCE_OPTIONS");
    expect(source).toContain("SEVERITY_OPTIONS");
    expect(source).toContain("Quick views");
    expect(source).toContain("OPERATIONS_MAP_QUICK_VIEWS");
    expect(source).toContain("applyQuickView");
    expect(source).toContain("loadOperationsMapViewPreference");
    expect(source).toContain("saveOperationsMapViewPreference");
    expect(source).toContain("toggleSourceFilter");
    expect(source).toContain("toggleSeverityFilter");
  });
});
