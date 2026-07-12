import { describe, expect, it } from "vitest";
import { DEFAULT_DEMAND_FRAMEWORK, resolveDemandPolicy } from "./policy";
import { DEFAULT_BUCKET_TARGETS } from "./buckets";

describe("resolveDemandPolicy", () => {
  it("returns built-in defaults for null/empty config", () => {
    const p = resolveDemandPolicy(null);
    expect(p.framework).toBe(DEFAULT_DEMAND_FRAMEWORK);
    expect(p.bucketTargets).toEqual(DEFAULT_BUCKET_TARGETS);
  });

  it("honors a valid persisted framework", () => {
    expect(resolveDemandPolicy({ demandFramework: "wsjf" }).framework).toBe("wsjf");
  });

  it("falls back to the default framework on an invalid value", () => {
    expect(resolveDemandPolicy({ demandFramework: "bogus" }).framework).toBe(DEFAULT_DEMAND_FRAMEWORK);
  });

  it("merges partial/invalid targets over the default split", () => {
    const p = resolveDemandPolicy({ demandBucketTargets: { run: 50, grow: "x", transform: 50 } });
    expect(p.bucketTargets).toEqual({ run: 50, grow: DEFAULT_BUCKET_TARGETS.grow, transform: 50 });
  });

  it("ignores a non-object targets value", () => {
    expect(resolveDemandPolicy({ demandBucketTargets: "nope" }).bucketTargets).toEqual(DEFAULT_BUCKET_TARGETS);
  });
});
