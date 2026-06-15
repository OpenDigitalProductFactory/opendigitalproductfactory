import { describe, it, expect } from "vitest";
import { gridRegistry, type DataSourceAdapter } from "./adapter";
import {
  referenceKey,
  collectUniqueReferences,
  resolveReferenceLabels,
} from "./reference-resolver";

describe("referenceKey", () => {
  it("joins type and id", () => {
    expect(referenceKey("epic", "EP-1")).toBe("epic:EP-1");
  });
});

describe("collectUniqueReferences", () => {
  it("de-dupes by type:id and drops incomplete entries", () => {
    const unique = collectUniqueReferences([
      { referenceType: "epic", referenceId: "EP-1" },
      { referenceType: "epic", referenceId: "EP-1" },
      { referenceType: "epic", referenceId: "EP-2" },
      { referenceType: "epic", referenceId: "" },
      { referenceType: "", referenceId: "EP-3" },
    ]);
    expect([...unique.keys()]).toEqual(["epic:EP-1", "epic:EP-2"]);
  });
});

describe("resolveReferenceLabels", () => {
  // Minimal fake adapter so resolution runs against the registry without the
  // platform-tables dynamic import (which only fires for unregistered types).
  function registerFake(entityType: string, labels: Record<string, string>) {
    const adapter = {
      entityType,
      getColumns: async () => [],
      queryRows: async () => ({ data: [], nextCursor: null }),
      getRow: async () => null,
      getCapabilities: () => ({
        canAddRow: false,
        canAddColumn: false,
        canEditCell: false,
        canDeleteRow: false,
      }),
      resolveReference: async (_t: string, id: string) =>
        labels[id] ? { label: labels[id] } : null,
    } as unknown as DataSourceAdapter;
    gridRegistry.register(adapter);
  }

  it("resolves labels per unique reference and omits unresolvable ones", async () => {
    registerFake("fake_ref_a", { "A-1": "Alpha", "A-2": "Beta" });
    const labels = await resolveReferenceLabels([
      { referenceType: "fake_ref_a", referenceId: "A-1" },
      { referenceType: "fake_ref_a", referenceId: "A-1" },
      { referenceType: "fake_ref_a", referenceId: "A-2" },
      { referenceType: "fake_ref_a", referenceId: "A-missing" },
    ]);
    expect(labels.get("fake_ref_a:A-1")).toBe("Alpha");
    expect(labels.get("fake_ref_a:A-2")).toBe("Beta");
    expect(labels.has("fake_ref_a:A-missing")).toBe(false);
  });

  it("returns an empty map for no references", async () => {
    const labels = await resolveReferenceLabels([]);
    expect(labels.size).toBe(0);
  });
});
