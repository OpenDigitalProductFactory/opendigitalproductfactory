import { describe, expect, it } from "vitest";
import type { BacklogItemInput } from "@/lib/backlog";
import { applyBacklogFormAssistUpdates } from "./backlog-form-assist";

describe("applyBacklogFormAssistUpdates", () => {
  it("applies supported scalar fields", () => {
    const next = applyBacklogFormAssistUpdates(
      { title: "", type: "portfolio", workType: "feature", status: "open", body: "" },
      {
        title: "Investigate provider filtering",
        priority: 2,
        body: "Use local providers for restricted routes.",
      },
    );

    expect(next).toEqual<BacklogItemInput>({
      title: "Investigate provider filtering",
      type: "portfolio",
      workType: "feature",
      status: "open",
      priority: 2,
      body: "Use local providers for restricted routes.",
    });
  });

  it("drops unsupported values and clears product selection when switching to portfolio", () => {
    const next = applyBacklogFormAssistUpdates(
      {
        title: "Existing",
        type: "product",
        workType: "feature",
        status: "open",
        digitalProductId: "prod-1",
      },
      {
        type: "portfolio",
        status: "invalid",
        priority: "abc",
      },
    );

    expect(next).toEqual<BacklogItemInput>({
      title: "Existing",
      type: "portfolio",
      workType: "feature",
      status: "open",
    });
  });
});
