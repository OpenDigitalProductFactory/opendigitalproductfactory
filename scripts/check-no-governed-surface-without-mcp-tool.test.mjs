import assert from "node:assert/strict";
import test from "node:test";

import { validateGovernedSurfaceContracts } from "./lib/governed-surface-tool-guard.mjs";

const base = {
  surfaceId: "test.surface",
  routes: ["/test"],
  readModel: "apps/web/lib/test/read-model.ts",
  requiredReadTools: ["read_test_surface"],
  requiredActTools: [],
};

test("missing required read or act tools fail with surface evidence", () => {
  const failures = validateGovernedSurfaceContracts([
    { ...base, requiredActTools: ["act_test_surface"] },
  ], new Set(["read_test_surface"]));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /test\.surface.*act_test_surface.*read-model/i);
});

test("present required tools pass", () => {
  assert.deepEqual(
    validateGovernedSurfaceContracts([base], new Set(["read_test_surface"])),
    [],
  );
});

test("exemption requires a rationale and owner", () => {
  const missing = validateGovernedSurfaceContracts([
    { ...base, requiredReadTools: [], exemption: { rationale: "", owner: "" } },
  ], new Set());
  assert.equal(missing.length, 1);
  const valid = validateGovernedSurfaceContracts([
    { ...base, requiredReadTools: [], exemption: { rationale: "Human-only safety boundary", owner: "Founder Review" } },
  ], new Set());
  assert.deepEqual(valid, []);
});

test("surface ids and routes are unique", () => {
  const failures = validateGovernedSurfaceContracts([
    base,
    { ...base, readModel: "other.ts" },
  ], new Set(["read_test_surface"]));
  assert.ok(failures.some((failure) => /duplicate surfaceId/i.test(failure)));
  assert.ok(failures.some((failure) => /duplicate route/i.test(failure)));
});

test("registered UI controls must carry semantic node markers", () => {
  const contract = {
    ...base,
    uiFiles: ["form.tsx"],
    requiredNodeIds: ["field.name", "form.save"],
  };
  const missing = validateGovernedSurfaceContracts(
    [contract],
    new Set(["read_test_surface"]),
    { sourceByPath: new Map([["form.tsx", '<input data-surface-node-id="field.name" /><button>Save</button>']]) },
  );
  assert.ok(missing.some((failure) => /form\.save/.test(failure)));
  assert.ok(missing.some((failure) => /unbound interactive control/i.test(failure)));

  const valid = validateGovernedSurfaceContracts(
    [contract],
    new Set(["read_test_surface"]),
    { sourceByPath: new Map([["form.tsx", '<input data-surface-node-id="field.name" /><button data-surface-node-id="form.save">Save</button>']]) },
  );
  assert.deepEqual(valid, []);
});
