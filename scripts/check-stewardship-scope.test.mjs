import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateStewardshipScope,
  modelsBelowStewardshipFloor,
  delegateFor,
  EXEMPTION_REASONS,
} from "./lib/stewardship-scope.mjs";

// Fixture: Country is fully stewarded via an exemption, Invoice via a retained
// dataset, ToolExecution via a purge policy. LegacyThing is grandfathered debt.
function baseInput(overrides = {}) {
  return {
    models: ["Country", "Invoice", "ToolExecution", "LegacyThing"],
    classified: new Set(["Country", "Invoice", "ToolExecution"]),
    purgeModels: new Set(["toolExecution"]),
    retainedModels: new Set(["invoice"]),
    exemptions: new Map([["Country", "reference-data"]]),
    baseline: new Set(["LegacyThing"]),
    ...overrides,
  };
}

describe("delegateFor", () => {
  it("lower-cases only the first character, matching the Prisma delegate", () => {
    assert.equal(delegateFor("AgentThread"), "agentThread");
    assert.equal(delegateFor("TokenUsage"), "tokenUsage");
    assert.equal(delegateFor("EaDqRule"), "eaDqRule");
  });
});

describe("stewardship-scope gate", () => {
  it("passes when every non-grandfathered model declares classification + a disposition", () => {
    const r = evaluateStewardshipScope(baseInput());
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
    assert.equal(r.completeCount, 3);
  });

  it("counts all three disposition kinds as satisfying the retention axis", () => {
    const r = evaluateStewardshipScope(baseInput());
    for (const m of ["Country", "Invoice", "ToolExecution"]) {
      assert.equal(r.coverage[m].hasDisposition, true, `${m} should hold a disposition`);
    }
  });

  // THE CORE REGRESSION: this is the defect BI-C34E09B0 reports.
  it("BLOCKS a NEW model that declares neither axis", () => {
    const r = evaluateStewardshipScope(
      baseInput({ models: ["Country", "Invoice", "ToolExecution", "LegacyThing", "BrandNewModel"] }),
    );
    assert.equal(r.ok, false);
    const e = r.errors.find((x) => x.model === "BrandNewModel");
    assert.ok(e, "a brand-new unstewarded model must fail");
    assert.equal(e.kind, "unstewarded-model");
    assert.equal(e.missing.length, 2);
    assert.ok(e.missing.some((m) => m.includes("TABLE_CLASSIFICATION")));
    assert.ok(e.missing.some((m) => m.includes("retention disposition")));
  });

  it("BLOCKS a new model that is classified but declares no retention disposition", () => {
    const r = evaluateStewardshipScope(
      baseInput({
        models: [...baseInput().models, "ClassifiedOnly"],
        classified: new Set([...baseInput().classified, "ClassifiedOnly"]),
      }),
    );
    assert.equal(r.ok, false);
    const e = r.errors.find((x) => x.model === "ClassifiedOnly");
    assert.deepEqual(e.missing.length, 1);
    assert.ok(e.missing[0].includes("retention disposition"));
  });

  it("BLOCKS a new model that has a disposition but no classification", () => {
    const r = evaluateStewardshipScope(
      baseInput({
        models: [...baseInput().models, "PurgedButUnclassified"],
        purgeModels: new Set(["toolExecution", "purgedButUnclassified"]),
      }),
    );
    assert.equal(r.ok, false);
    const e = r.errors.find((x) => x.model === "PurgedButUnclassified");
    assert.equal(e.missing.length, 1);
    assert.ok(e.missing[0].includes("TABLE_CLASSIFICATION"));
  });

  it("allows a grandfathered gap and reports it as ratcheting down, not an error", () => {
    const r = evaluateStewardshipScope(baseInput());
    assert.equal(r.ok, true);
    assert.equal(r.coverage.LegacyThing.passes, false);
    assert.equal(r.errors.length, 0);
  });

  it("surfaces a baselined model that now passes so the ratchet can tighten", () => {
    const r = evaluateStewardshipScope(
      baseInput({
        classified: new Set([...baseInput().classified, "LegacyThing"]),
        exemptions: new Map([
          ["Country", "reference-data"],
          ["LegacyThing", "config-singleton"],
        ]),
      }),
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.staleBaseline, ["LegacyThing"]);
  });

  it("surfaces a baseline entry whose model no longer exists", () => {
    const r = evaluateStewardshipScope(
      baseInput({ baseline: new Set(["LegacyThing", "DeletedModel"]) }),
    );
    assert.deepEqual(r.orphanBaseline, ["DeletedModel"]);
  });
});

describe("integrity checks — never grandfathered", () => {
  it("BLOCKS an exemption naming a model that does not exist, even if baselined", () => {
    const r = evaluateStewardshipScope(
      baseInput({
        exemptions: new Map([
          ["Country", "reference-data"],
          ["GhostModel", "reference-data"],
        ]),
        baseline: new Set(["LegacyThing", "GhostModel"]),
      }),
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.kind === "dangling-exemption" && e.model === "GhostModel"));
  });

  it("BLOCKS an exemption carrying a reason outside the closed set", () => {
    const r = evaluateStewardshipScope(
      baseInput({ exemptions: new Map([["Country", "because-i-said-so"]]) }),
    );
    assert.equal(r.ok, false);
    const e = r.errors.find((x) => x.kind === "invalid-exemption-reason");
    assert.ok(e);
    assert.ok(e.detail.includes("reference-data"));
  });

  it("accepts every reason in the closed set", () => {
    for (const reason of EXEMPTION_REASONS) {
      const r = evaluateStewardshipScope(
        baseInput({ exemptions: new Map([["Country", reason]]) }),
      );
      assert.equal(r.ok, true, `reason ${reason} should be accepted`);
    }
  });

  it("BLOCKS a purge policy naming a delegate with no backing model", () => {
    const r = evaluateStewardshipScope(
      baseInput({ purgeModels: new Set(["toolExecution", "vanishedTable"]) }),
    );
    assert.equal(r.ok, false);
    const e = r.errors.find((x) => x.kind === "dangling-registry-entry");
    assert.ok(e);
    assert.ok(e.detail.includes("PURGE_POLICIES"));
  });

  it("BLOCKS a retained dataset naming a delegate with no backing model", () => {
    const r = evaluateStewardshipScope(
      baseInput({ retainedModels: new Set(["invoice", "vanishedTable"]) }),
    );
    assert.equal(r.ok, false);
    assert.ok(
      r.errors.some(
        (e) => e.kind === "dangling-registry-entry" && e.detail.includes("RETAINED_DATASETS"),
      ),
    );
  });

  // A model that is both purged and retained is contradictory; a model that is
  // both exempt and purged is equally ambiguous about what the engine should do.
  it("BLOCKS a model holding two dispositions", () => {
    const r = evaluateStewardshipScope(
      baseInput({ exemptions: new Map([["Country", "reference-data"], ["Invoice", "reference-data"]]) }),
    );
    assert.equal(r.ok, false);
    const e = r.errors.find((x) => x.kind === "conflicting-disposition");
    assert.ok(e);
    assert.equal(e.model, "Invoice");
  });

  it("BLOCKS a purge/retained overlap (mirrors the retention.test.ts invariant)", () => {
    const r = evaluateStewardshipScope(
      baseInput({ purgeModels: new Set(["toolExecution", "invoice"]) }),
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.kind === "conflicting-disposition" && e.model === "Invoice"));
  });
});

describe("modelsBelowStewardshipFloor (--update)", () => {
  it("returns exactly the models missing either axis", () => {
    assert.deepEqual(modelsBelowStewardshipFloor(baseInput()), ["LegacyThing"]);
  });

  it("does not re-add a model that has since been fully stewarded", () => {
    const below = modelsBelowStewardshipFloor(
      baseInput({
        classified: new Set([...baseInput().classified, "LegacyThing"]),
        exemptions: new Map([
          ["Country", "reference-data"],
          ["LegacyThing", "derived-projection"],
        ]),
      }),
    );
    assert.deepEqual(below, []);
  });
});
