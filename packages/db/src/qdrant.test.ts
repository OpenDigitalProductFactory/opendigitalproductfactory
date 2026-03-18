import { describe, expect, it } from "vitest";

describe("qdrant exports", () => {
  it("exports ensurePayloadIndexes", async () => {
    const mod = await import("./qdrant");
    expect(typeof mod.ensurePayloadIndexes).toBe("function");
  });

  it("exports scrollPoints for filter-only queries", async () => {
    const mod = await import("./qdrant");
    expect(typeof mod.scrollPoints).toBe("function");
  });

  it("exports hashToNumber for point ID generation", async () => {
    const mod = await import("./qdrant");
    expect(typeof mod.hashToNumber).toBe("function");
  });
});
