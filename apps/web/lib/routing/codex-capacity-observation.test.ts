import { describe, expect, it } from "vitest";
import { codexCapacityAvailable } from "./codex-capacity-observation";
const available = { primary: { usedPercent: 0 }, secondary: { usedPercent: 75 } };
describe("early-reset current Codex usage", () => {
  it("recognizes current capacity after an early reset", () => {
    expect(codexCapacityAvailable({ accountId: "selected", rateLimits: available }, "selected")).toBe(true);
  });
  it("preserves a hold when any current window remains exhausted", () => {
    expect(codexCapacityAvailable({ accountId: "selected", rateLimits: { ...available, primary: { usedPercent: 100 } } }, "selected")).toBe(false);
    expect(codexCapacityAvailable({ accountId: "selected", rateLimits: available,
      rateLimitsByLimitId: { another: { ...available, secondary: { usedPercent: 100 } } } }, "selected")).toBe(false);
  });
  it.each([undefined, {}, { accountId: "other", rateLimits: available },
    { accountId: "selected", rateLimits: { primary: { usedPercent: 0 } } },
    { accountId: "selected", rateLimits: { ...available, primary: { usedPercent: -1 } } },
    { accountId: "selected", rateLimits: { ...available, primary: { usedPercent: NaN } } },
  ])("does not infer capacity from incomplete or different-account evidence", value => {
    expect(codexCapacityAvailable(value, "selected")).toBe(false);
  });
});
