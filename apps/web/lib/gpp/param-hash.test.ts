// GPP Phase 2, PR-D — the exact-call parameter hash a permit binds.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-D).
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { computeParamHash } from "./param-hash";

describe("computeParamHash", () => {
  it("is independent of argument key order, at every depth", () => {
    const a = computeParamHash("create_portal_pr", { title: "t", body: { z: 1, a: [1, 2] } });
    const b = computeParamHash("create_portal_pr", { body: { a: [1, 2], z: 1 }, title: "t" });
    expect(a).toBe(b);
  });

  it("differs when an argument, the array order, or the tool differs", () => {
    const base = computeParamHash("create_portal_pr", { title: "t", labels: ["a", "b"] });
    expect(computeParamHash("create_portal_pr", { title: "u", labels: ["a", "b"] })).not.toBe(base);
    expect(computeParamHash("create_portal_pr", { title: "t", labels: ["b", "a"] })).not.toBe(base);
    expect(computeParamHash("contribute_to_hive", { title: "t", labels: ["a", "b"] })).not.toBe(base);
  });

  it("treats an absent key and an undefined key the same, as canonicalJson does", () => {
    expect(computeParamHash("t", { a: 1, b: undefined })).toBe(computeParamHash("t", { a: 1 }));
  });

  it("is locale independent: keys order by code unit, pinned to a fixed vector", () => {
    // A localeCompare sort would put "a" before "B" and "ä" next to "a" on most
    // hosts; code-unit order is B < Z < a < ä on every host. The hash is pinned
    // to that byte string, so a host whose locale reorders keys fails here.
    const params = { "ä": 4, a: 3, Z: 2, B: 1 };
    const expected = createHash("sha256")
      .update('{"params":{"B":1,"Z":2,"a":3,"ä":4},"tool":"t"}')
      .digest("hex");
    expect(computeParamHash("t", params)).toBe(expected);
  });

  it("is a lowercase hex SHA-256", () => {
    expect(computeParamHash("t", {})).toMatch(/^[0-9a-f]{64}$/);
  });
});
