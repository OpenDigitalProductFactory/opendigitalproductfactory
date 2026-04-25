import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BindingFilters } from "./BindingFilters";

describe("BindingFilters", () => {
  it("renders query-backed filters and current result summary", () => {
    const html = renderToStaticMarkup(
      <BindingFilters
        actionHref="/platform/identity/authorization"
        currentFilters={{
          status: "active",
          resource: "/finance",
          coworker: "finance-controller",
          subject: "HR-200",
        }}
        options={{
          statuses: ["active", "draft"],
          resourceRefs: ["/finance", "/workspace"],
          appliedAgents: [{ agentId: "finance-controller", agentName: "Finance Controller" }],
          subjectRefs: ["HR-000", "HR-200"],
        }}
        resultCount={3}
      />,
    );

    expect(html).toContain("Filter bindings");
    expect(html).toContain("Finance Controller");
    expect(html).toContain("/finance");
    expect(html).toContain("3 binding row(s)");
    expect(html).toContain("Reset filters");
  });
});
