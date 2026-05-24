import { describe, it, expect } from "vitest";
import { allFunctions } from "@/lib/queue/functions";

describe("self-upgrade substrate audit (Phase 0 baseline)", () => {
  it("registers only the ops/self-upgrade family (legacy removed)", () => {
    const ids = allFunctions.map((fn) => (fn as { id: () => string }).id());
    expect(ids).toContain("ops/self-upgrade-scheduled");
    expect(ids).toContain("ops/self-upgrade-manual");
    expect(ids).not.toContain("portal/self-upgrade-scheduled");
    expect(ids).not.toContain("portal/self-upgrade-requested");
    expect(ids).not.toContain("portal/self-upgrade-completion-sweep");
  });
});
