import { describe, expect, it } from "vitest";
import { parseQuiescenceControlRequest } from "./drain-control";

describe("parseQuiescenceControlRequest", () => {
  it("accepts the three operator choices for a quiescence run", () => {
    for (const action of ["keep-waiting", "force", "abort"]) {
      expect(parseQuiescenceControlRequest({ runId: "QR-2026-10-02-xlzfvsnl", action })).toEqual({
        ok: true, data: { runId: "QR-2026-10-02-xlzfvsnl", action },
      });
    }
  });
  it("refuses anything else", () => {
    expect(parseQuiescenceControlRequest(null).ok).toBe(false);
    expect(parseQuiescenceControlRequest({ runId: "QR-1", action: "swap" }).ok).toBe(false);
    expect(parseQuiescenceControlRequest({ runId: "../etc", action: "abort" }).ok).toBe(false);
    expect(parseQuiescenceControlRequest({ action: "abort" }).ok).toBe(false);
  });
});
