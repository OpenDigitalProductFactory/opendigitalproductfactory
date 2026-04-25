import { describe, expect, it } from "vitest";

import { TRIAGE_OUTCOMES } from "@/lib/discovery-triage";

describe("discovery triage web exports", () => {
  it("re-exports the canonical outcome enum from @dpf/db", () => {
    expect(TRIAGE_OUTCOMES).toContain("auto-attributed");
  });
});
