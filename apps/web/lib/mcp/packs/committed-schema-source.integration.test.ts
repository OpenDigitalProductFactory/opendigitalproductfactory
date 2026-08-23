// BI-F9CAF214 acceptance: the committed reader must resolve real models from
// the real split schema, with no build and no sandbox. No mocks — a unit test
// with a mocked filesystem cannot prove the schema path is correct, which is
// precisely how the dead schema.prisma path survived (BI-FA950F74).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";

import { loadCommittedSchema } from "./committed-schema-source";
import { describeModel } from "@/lib/build/schema-validator";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
let previous: string | undefined;

beforeAll(() => {
  previous = process.env.PROJECT_ROOT;
  process.env.PROJECT_ROOT = REPO_ROOT;
});
afterAll(() => {
  if (previous === undefined) delete process.env.PROJECT_ROOT;
  else process.env.PROJECT_ROOT = previous;
});

describe("committed schema — real filesystem", () => {
  it("reads the split schema and resolves models a build-gated tool could not", async () => {
    const source = await loadCommittedSchema({ readGit: async () => "main" });
    expect(source).not.toBeNull();
    expect(source!.provenance.schemaFileCount).toBeGreaterThan(20);

    // The two models a dead grep path once reported missing (BI-FA950F74),
    // plus the mileage substrate from PR #4481.
    for (const name of [
      "PayRun",
      "Payslip",
      "Vehicle",
      "Trip",
      "TripClassificationRule",
      "DriverLocationConsent",
      "MileageRate",
      "MileageRatePlan",
    ]) {
      const desc = describeModel(source!.schema, name);
      expect(desc, `${name} should resolve from the committed schema`).toBeTruthy();
    }
  });

  it("scores an off-default branch down instead of answering confidently", async () => {
    const source = await loadCommittedSchema({ readGit: async () => "my-changes" });
    const freshness = source!.trust.dimensions.find((d) => d.key === "freshness");
    expect(freshness!.score).toBeLessThanOrEqual(0.4);
    expect(freshness!.rationale).toContain("my-changes");
    expect(["low", "medium"]).toContain(source!.trust.tier);
  });
});
