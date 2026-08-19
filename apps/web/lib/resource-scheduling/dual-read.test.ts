import { describe, expect, it } from "vitest";
import { mergeDualRead } from "./dual-read";

interface UnifiedRow {
  id: string;
  sourceRef: string | null;
  label: string;
}

interface LegacyRow {
  id: string;
  label: string;
}

const adapt = (row: LegacyRow): UnifiedRow => ({
  id: `adapted:${row.id}`,
  sourceRef: `Legacy:${row.id}`,
  label: row.label,
});

describe("mergeDualRead", () => {
  it("degenerates to the legacy read while unified tables are empty (expand phase)", () => {
    const merged = mergeDualRead<UnifiedRow, LegacyRow>({
      unified: [],
      legacy: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      legacySourceRef: (row) => `Legacy:${row.id}`,
      adapt,
    });
    expect(merged.rows.map((r) => r.label)).toEqual(["A", "B"]);
    expect(merged.unifiedCount).toBe(0);
    expect(merged.adaptedCount).toBe(2);
    expect(merged.mirroredCount).toBe(0);
  });

  it("prefers a unified row over the clone row it mirrors", () => {
    const merged = mergeDualRead<UnifiedRow, LegacyRow>({
      unified: [{ id: "u1", sourceRef: "Legacy:a", label: "A-unified" }],
      legacy: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      legacySourceRef: (row) => `Legacy:${row.id}`,
      adapt,
    });
    expect(merged.rows.map((r) => r.label)).toEqual(["A-unified", "B"]);
    expect(merged.unifiedCount).toBe(1);
    expect(merged.adaptedCount).toBe(1);
    expect(merged.mirroredCount).toBe(1);
  });

  it("keeps born-unified rows (null sourceRef) without suppressing any legacy row", () => {
    const merged = mergeDualRead<UnifiedRow, LegacyRow>({
      unified: [{ id: "u2", sourceRef: null, label: "Born unified" }],
      legacy: [{ id: "a", label: "A" }],
      legacySourceRef: (row) => `Legacy:${row.id}`,
      adapt,
    });
    expect(merged.rows.map((r) => r.label)).toEqual(["Born unified", "A"]);
    expect(merged.mirroredCount).toBe(0);
  });
});
