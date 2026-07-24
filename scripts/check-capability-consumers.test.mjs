import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseRegistry, evaluateCapabilityConsumers } from "./check-capability-consumers.mjs";

// A minimal registry fixture in the real source shape: two plain keys and one
// that declares a setupPrompt.
const REGISTRY_FIXTURE = `export const CAPABILITY_REGISTRY = {
  "member-equity": {
    label: "Member Equity",
    setupPrompt: {
      question: "Do members hold equity?",
    },
  },
  "partner-program": {
    label: "Partner Program",
    setupPrompt: {
      question: "Do you sell through partners?",
    },
  },
  "warehouse-operations": {
    label: "Warehouse Operations",
  },
} as const satisfies Record<string, CapabilityRegistryEntry>;
`;

describe("parseRegistry", () => {
  it("extracts every top-level capability key in source order", () => {
    const entries = parseRegistry(REGISTRY_FIXTURE);
    assert.deepEqual(
      entries.map((e) => e.key),
      ["member-equity", "partner-program", "warehouse-operations"],
    );
  });

  it("flags exactly the keys that declare a setupPrompt", () => {
    const entries = parseRegistry(REGISTRY_FIXTURE);
    const withPrompt = entries.filter((e) => e.hasSetupPrompt).map((e) => e.key);
    assert.deepEqual(withPrompt, ["member-equity", "partner-program"]);
  });

  it("does not treat a nested question: line as a top-level key", () => {
    const entries = parseRegistry(REGISTRY_FIXTURE);
    assert.equal(entries.length, 3);
  });
});

describe("evaluateCapabilityConsumers ratchet", () => {
  const base = (overrides = {}) => ({
    keys: ["member-equity", "partner-program", "warehouse-operations"],
    setupPromptKeys: new Set(["member-equity", "partner-program"]),
    consumed: new Set(["member-equity"]),
    baseline: ["partner-program", "warehouse-operations"],
    ...overrides,
  });

  it("passes when every inert key is baselined and no baseline entry is stale", () => {
    const r = evaluateCapabilityConsumers(base());
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.inert.sort(), ["partner-program", "warehouse-operations"]);
  });

  it("FAILS on a NEW inert capability that is not baselined", () => {
    const r = evaluateCapabilityConsumers(
      base({ keys: ["member-equity", "partner-program", "warehouse-operations", "new-cap"] }),
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('"new-cap"') && e.includes("no recognised consumer")));
  });

  it("names the setupPrompt honesty defect louder for an unbaselined prompt key", () => {
    const r = evaluateCapabilityConsumers(
      base({
        keys: ["member-equity", "partner-program", "warehouse-operations", "new-prompt-cap"],
        setupPromptKeys: new Set(["member-equity", "partner-program", "new-prompt-cap"]),
      }),
    );
    assert.equal(r.ok, false);
    const err = r.errors.find((e) => e.includes('"new-prompt-cap"'));
    assert.ok(err.includes("setup wizard asks a question that changes nothing"));
  });

  it("reports the unwired-setupPrompt debt among inert keys (partner-program)", () => {
    const r = evaluateCapabilityConsumers(base());
    assert.deepEqual(r.promptDebt, ["partner-program"]);
  });

  it("FAILS (stale baseline) when a baselined key now has a consumer — ratchet only tightens", () => {
    const r = evaluateCapabilityConsumers(
      base({ consumed: new Set(["member-equity", "warehouse-operations"]) }),
    );
    assert.equal(r.ok, false);
    assert.deepEqual(r.staleBaseline, ["warehouse-operations"]);
    assert.ok(r.errors.some((e) => e.includes("now HAS a consumer")));
  });

  it("FAILS when the baseline lists a key that is no longer in the registry", () => {
    const r = evaluateCapabilityConsumers(base({ baseline: ["partner-program", "warehouse-operations", "retired-key"] }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('"retired-key"') && e.includes("not a capability key")));
  });
});
