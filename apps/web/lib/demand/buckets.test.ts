import { describe, expect, it } from "vitest";
import {
  bucketBalance,
  computeBucketMix,
  DEFAULT_BUCKET_TARGETS,
  deriveBucket,
  type BucketWeightedItem,
} from "./buckets";

describe("deriveBucket", () => {
  it("maps work-type to a default bucket", () => {
    expect(deriveBucket("bug")).toBe("run");
    expect(deriveBucket("chore")).toBe("run");
    expect(deriveBucket("refactor")).toBe("run");
    expect(deriveBucket("feature")).toBe("grow");
    expect(deriveBucket("doc")).toBeNull();
    expect(deriveBucket(null)).toBeNull();
  });
});

describe("computeBucketMix", () => {
  it("effort-weights the mix and computes shares", () => {
    const items: BucketWeightedItem[] = [
      { investmentBucket: "run", workType: null, weight: 70 },
      { investmentBucket: "grow", workType: null, weight: 20 },
      { investmentBucket: "transform", workType: null, weight: 10 },
    ];
    const mix = computeBucketMix(items);
    expect(mix.total).toBe(100);
    expect(mix.sharePct).toEqual({ run: 70, grow: 20, transform: 10 });
  });

  it("falls back to derived bucket and weight 1", () => {
    const mix = computeBucketMix([
      { investmentBucket: null, workType: "bug" }, // -> run, weight 1
      { investmentBucket: null, workType: "feature" }, // -> grow, weight 1
      { investmentBucket: null, workType: "doc" }, // unclassified
    ]);
    expect(mix.byBucket.run).toBe(1);
    expect(mix.byBucket.grow).toBe(1);
    expect(mix.unclassified).toBe(1);
    expect(mix.total).toBe(2);
    expect(mix.sharePct.run).toBe(50);
  });

  it("explicit bucket overrides the work-type derivation", () => {
    const mix = computeBucketMix([{ investmentBucket: "transform", workType: "bug", weight: 5 }]);
    expect(mix.byBucket.transform).toBe(5);
    expect(mix.byBucket.run).toBe(0);
  });
});

describe("bucketBalance", () => {
  it("flags a starved bucket against the default target", () => {
    // All effort in Run — Transform is 0% vs a 10% target => starved.
    const mix = computeBucketMix([{ investmentBucket: "run", workType: null, weight: 100 }]);
    const rows = bucketBalance(mix, null);
    const transform = rows.find((r) => r.bucket === "transform")!;
    expect(transform.targetPct).toBe(DEFAULT_BUCKET_TARGETS.transform);
    expect(transform.actualPct).toBe(0);
    expect(transform.deltaPct).toBe(-10);
    expect(transform.starved).toBe(true);
    const run = rows.find((r) => r.bucket === "run")!;
    expect(run.starved).toBe(false); // over-invested, not starved
  });

  it("honors an operator-set target and is not starved when balanced", () => {
    const mix = computeBucketMix([
      { investmentBucket: "run", workType: null, weight: 50 },
      { investmentBucket: "transform", workType: null, weight: 50 },
    ]);
    const rows = bucketBalance(mix, { run: 50, grow: 0, transform: 50 });
    expect(rows.every((r) => !r.starved)).toBe(true);
  });

  it("reports no starvation on an empty set", () => {
    const rows = bucketBalance(computeBucketMix([]), null);
    expect(rows.every((r) => !r.starved)).toBe(true);
  });
});
