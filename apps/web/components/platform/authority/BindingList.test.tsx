import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BindingList } from "./BindingList";
import type { AuthorityBindingRow } from "@/lib/authority/bindings";

const SUBJECT_ROW: AuthorityBindingRow = {
  bindingId: "AB-000001",
  name: "Finance workspace controller",
  pivotKind: "subject",
  pivotLabel: "HR-400",
  status: "active",
  scopeType: "route",
  resourceType: "route",
  resourceRef: "/finance",
  approvalMode: "proposal-required",
  sensitivityCeiling: "confidential",
  appliedAgentId: "finance-controller",
  appliedAgentName: "Finance Controller",
  subjectLabels: ["HR-400", "finance"],
  subjectCount: 2,
  grantModes: ["ledger_write:require-approval"],
};

const COWORKER_ROW: AuthorityBindingRow = {
  ...SUBJECT_ROW,
  pivotKind: "coworker",
  pivotLabel: "Finance Controller",
};

describe("BindingList", () => {
  it("renders subject-first rows for the identity entry point", () => {
    const html = renderToStaticMarkup(
      <BindingList pivot="subject" rows={[SUBJECT_ROW]} emptyMessage="No bindings" />,
    );

    expect(html).toContain("HR-400");
    expect(html).toContain("/finance");
    expect(html).toContain("Finance Controller");
  });

  it("renders coworker-first rows for the AI entry point", () => {
    const html = renderToStaticMarkup(
      <BindingList pivot="coworker" rows={[COWORKER_ROW]} emptyMessage="No bindings" />,
    );

    expect(html).toContain("Finance Controller");
    expect(html).toContain("HR-400");
    expect(html).toContain("proposal-required");
  });
});
