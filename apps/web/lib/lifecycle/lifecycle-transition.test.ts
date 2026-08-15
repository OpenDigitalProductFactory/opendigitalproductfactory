import { describe, expect, it } from "vitest";
import { isRecordableKind, recordLifecycleTransition } from "./lifecycle-transition";

// These exercise the pure guard paths of the writer — both return before any prisma query, so
// no test DB is needed. The DB round-trip is covered by the integration suite / live verification.

describe("isRecordableKind — widened write-path vocabulary (F1)", () => {
  it("accepts EA governed things", () => {
    expect(isRecordableKind("EaElement")).toBe(true);
    expect(isRecordableKind("DigitalProduct")).toBe(true);
  });
  it("accepts grammar entity kinds not in the EA allowlist", () => {
    expect(isRecordableKind("CustomerAccount")).toBe(true);
    expect(isRecordableKind("Opportunity")).toBe(true);
  });
  it("rejects an unknown kind", () => {
    expect(isRecordableKind("Banana")).toBe(false);
  });
});

describe("recordLifecycleTransition guard paths (no DB hit)", () => {
  it("refuses an unrecordable kind", async () => {
    const result = await recordLifecycleTransition({
      governedThingKind: "Banana",
      governedThingId: "x",
    });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("not a recordable lifecycle kind") });
  });

  it("refuses an illegal grammar advancement before writing", async () => {
    const result = await recordLifecycleTransition({
      governedThingKind: "CustomerAccount",
      governedThingId: "acct-1",
      // prospect → active is illegal (prospect only advances to qualified/closed).
      from: { stage: "prospect", state: "prospect" },
      to: { stage: "active", state: "active" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not advance to/);
  });

  it("refuses a point whose state does not exist in the grammar (no unresolved rows written)", async () => {
    const result = await recordLifecycleTransition({
      governedThingKind: "CustomerAccount",
      governedThingId: "acct-1",
      from: { stage: "prospect", state: "prospect" },
      to: { stage: "qualified", state: "garbage" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a valid state in grammar/);
  });
});
