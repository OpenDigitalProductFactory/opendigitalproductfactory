import { describe, expect, it } from "vitest";

describe("operate barrel export", () => {
  it("exports process observer", async () => {
    const mod = await import("./process-observer");
    expect(mod).toHaveProperty("analyzeConversation");
  });

  it("exports metrics", async () => {
    const mod = await import("./metrics");
    expect(mod).toHaveProperty("metricsRegistry");
  });

  it("exports quality queue", async () => {
    const mod = await import("./quality-queue");
    expect(mod).toHaveProperty("submitReport");
  });
});
