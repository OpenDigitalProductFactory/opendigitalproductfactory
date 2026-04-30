import { describe, expect, it } from "vitest";

import {
  GAID_AUTHORIZATION_CLASS_ORDER,
  mapLocalPolicyToPortableClasses,
} from "./authorization-classes";

describe("mapLocalPolicyToPortableClasses", () => {
  it("maps DPF grant keys into the canonical GAID authorization vocabulary", () => {
    expect(
      mapLocalPolicyToPortableClasses([
        "registry_read",
        "deliberation_create",
        "backlog_write",
        "sandbox_execute",
        "admin_write",
        "external_registry_search",
      ]),
    ).toEqual([
      "observe",
      "analyze",
      "create",
      "update",
      "execute",
      "administer",
      "cross-boundary",
    ]);
  });

  it("deduplicates classes and preserves canonical order", () => {
    expect(
      mapLocalPolicyToPortableClasses([
        "sandbox_execute",
        "registry_read",
        "backlog_read",
        "sandbox_execute",
        "admin_write",
      ]),
    ).toEqual(["observe", "execute", "administer"]);
    expect(GAID_AUTHORIZATION_CLASS_ORDER).toEqual([
      "observe",
      "analyze",
      "create",
      "update",
      "approve",
      "execute",
      "delegate",
      "administer",
      "cross-boundary",
    ]);
  });
});
