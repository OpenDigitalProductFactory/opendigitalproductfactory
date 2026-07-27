import { describe, expect, it } from "vitest";

import { WORK_ITEM_SOURCE_TYPES } from "@/lib/queue/queue-types";

import {
  WORK_CASE_ACCOUNT_RESOLVER_SOURCE_KEYS,
  WORK_CASE_SOURCE_REGISTRY,
  getWorkCaseSourceEntry,
} from "./source-registry";

describe("Work Case source registry", () => {
  it("covers every existing WorkItem source type", () => {
    for (const sourceType of WORK_ITEM_SOURCE_TYPES) {
      const entry = getWorkCaseSourceEntry(sourceType);
      expect(entry, `missing registry entry for ${sourceType}`).toBeTruthy();
      expect(entry?.sourceKey).toBe(sourceType);
    }
  });

  it("keeps the account-resolver source keys explicit and registry-derived", () => {
    expect([...WORK_CASE_ACCOUNT_RESOLVER_SOURCE_KEYS].sort()).toEqual(
      ["activity", "booking", "engagement", "opportunity", "storefront-booking"].sort(),
    );
  });

  it("documents routing, decision, transition, and receipt defaults for every source", () => {
    for (const entry of WORK_CASE_SOURCE_REGISTRY) {
      expect(entry.displayLabel.length).toBeGreaterThan(0);
      expect(entry.owningArea.length).toBeGreaterThan(0);
      expect(entry.domainCategory.length).toBeGreaterThan(0);
      expect(["wwmd", "wwwd", "wsid"]).toContain(entry.defaultDecisionScope);
      expect(entry.supportedTransitions.length).toBeGreaterThan(0);
      expect(entry.receiptPolicy.defaultReceiptKind.length).toBeGreaterThan(0);
      expect(entry.titleProjection.length).toBeGreaterThan(0);
      expect(entry.summaryProjection.length).toBeGreaterThan(0);
      expect(["finite", "standing"]).toContain(entry.roomProjection.mode);
      expect(Array.isArray(entry.roomProjection.outcomePacket.requiredCategories)).toBe(true);
    }
  });

  it("makes standing room mode an explicit source-registry decision", () => {
    expect(getWorkCaseSourceEntry("scheduled")?.roomProjection.mode).toBe("standing");
    expect(getWorkCaseSourceEntry("booking")?.roomProjection.mode).toBe("finite");
  });

  it("normalizes unknown, missing, and whitespace source keys safely", () => {
    expect(getWorkCaseSourceEntry(null)).toBeNull();
    expect(getWorkCaseSourceEntry(undefined)).toBeNull();
    expect(getWorkCaseSourceEntry("   ")).toBeNull();
    expect(getWorkCaseSourceEntry("unknown")).toBeNull();
    expect(getWorkCaseSourceEntry(" booking ")?.sourceKey).toBe("booking");
  });
});
