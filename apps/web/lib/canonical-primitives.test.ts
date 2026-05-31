import { describe, expect, it } from "vitest";

import {
  CANONICAL_PRIMITIVES,
  matchCanonicalPrimitives,
} from "./canonical-primitives";

describe("canonical primitives registry", () => {
  it("registers report-kit with a principle + docs pointer", () => {
    const rk = CANONICAL_PRIMITIVES.find((p) => p.name === "report-kit");
    expect(rk).toBeDefined();
    expect(rk?.principleSlug).toBe("compose-report-kit-for-reporting-ux");
    expect(rk?.docs).toContain("report-kit/README.md");
    expect(rk?.exports).toContain("StatusBadge");
    expect(rk?.exports).toContain("DataTable");
  });
});

describe("matchCanonicalPrimitives", () => {
  it("matches a reporting feature description to report-kit", () => {
    const m = matchCanonicalPrimitives(
      "Build a compliance dashboard with a status badge and a sortable data table",
    );
    expect(m.map((p) => p.name)).toContain("report-kit");
  });

  it("matches on chart / KPI language", () => {
    expect(matchCanonicalPrimitives("show a revenue trend chart").length).toBeGreaterThan(0);
    expect(matchCanonicalPrimitives("a row of KPI cards").length).toBeGreaterThan(0);
  });

  it("does not match unrelated feature text", () => {
    expect(matchCanonicalPrimitives("add a webhook retry queue with backoff")).toHaveLength(0);
    expect(matchCanonicalPrimitives("")).toHaveLength(0);
  });
});
