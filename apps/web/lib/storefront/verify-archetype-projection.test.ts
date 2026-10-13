import { describe, expect, it } from "vitest";
import { observeWithRollback, requireVerificationEnvironment } from "./verify-archetype-projection-contract";

describe("bounded projection verification", () => {
  it("returns observations only after its own rollback signal", async () => {
    let rolledBack = false;
    const result = await observeWithRollback(async work => {
      try { return await work("transaction"); }
      catch (error) { rolledBack = true; throw error; }
    }, async tx => { expect(tx).toBe("transaction"); return { stages: 16 }; });
    expect(rolledBack).toBe(true);
    expect(result).toEqual({ stages: 16 });
  });
  it("does not turn an assertion or transport failure into success", async () => {
    await expect(observeWithRollback(async work => work(null), async () => {
      throw new Error("missing lifecycle history");
    })).rejects.toThrow("missing lifecycle history");
  });
  it("refuses a transaction adapter that commits or swallows rollback", async () => {
    await expect(observeWithRollback(async work => {
      try { return await work(null); } catch { return undefined as never; }
    }, async () => "observed")).rejects.toThrow("Rollback was not confirmed");
  });
  it.each(["production", "unknown", "", undefined])("rejects %s before fixture writes", value => {
    expect(() => requireVerificationEnvironment(value)).toThrow("development or test");
  });
  it.each(["development", "test"])("permits explicit %s", value => {
    expect(() => requireVerificationEnvironment(value)).not.toThrow();
  });
});
