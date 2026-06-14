import { describe, expect, it } from "vitest";

import {
  FIELD_DISPATCH_JOB_STATUSES,
  FIELD_DISPATCH_JOB_STATUS_LABEL,
  FIELD_DISPATCH_SOURCE_TYPE,
  FIELD_DISPATCH_STATUS_DOMAIN,
  collectPartsUsed,
  fieldDispatchStatusOrder,
  isFieldDispatchJobStatus,
  isTerminalStatus,
  isWorkComplete,
  needsDispatcherAttention,
  parseFieldDispatchEvidence,
  parseFieldDispatchStatus,
} from "./field-dispatch";

describe("field-dispatch job status vocabulary", () => {
  it("exposes the canonical source type and domain key", () => {
    expect(FIELD_DISPATCH_SOURCE_TYPE).toBe("field-service-job");
    expect(FIELD_DISPATCH_STATUS_DOMAIN).toBe("fieldDispatchJob");
  });

  it("has a label for every status", () => {
    for (const status of FIELD_DISPATCH_JOB_STATUSES) {
      expect(FIELD_DISPATCH_JOB_STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it("recognizes known statuses and rejects everything else", () => {
    expect(isFieldDispatchJobStatus("en-route")).toBe(true);
    expect(isFieldDispatchJobStatus("queued")).toBe(false);
    expect(isFieldDispatchJobStatus("")).toBe(false);
    expect(isFieldDispatchJobStatus(null)).toBe(false);
    expect(isFieldDispatchJobStatus(42)).toBe(false);
  });
});

describe("parseFieldDispatchStatus", () => {
  it("passes known lifecycle values through", () => {
    expect(parseFieldDispatchStatus("scheduled")).toBe("scheduled");
    expect(parseFieldDispatchStatus("paid")).toBe("paid");
  });

  it("maps the WorkItem default, legacy, and junk values to needs-review (ADR-7)", () => {
    expect(parseFieldDispatchStatus("queued")).toBe("needs-review"); // WorkItem DB default
    expect(parseFieldDispatchStatus("in_progress")).toBe("needs-review"); // legacy
    expect(parseFieldDispatchStatus(undefined)).toBe("needs-review");
    expect(parseFieldDispatchStatus(null)).toBe("needs-review");
    expect(parseFieldDispatchStatus({})).toBe("needs-review");
  });
});

describe("lifecycle classification", () => {
  it("orders by lifecycle with needs-review first", () => {
    expect(fieldDispatchStatusOrder("needs-review")).toBe(-1);
    expect(fieldDispatchStatusOrder("quoted")).toBeLessThan(fieldDispatchStatusOrder("scheduled"));
    expect(fieldDispatchStatusOrder("on-site")).toBeLessThan(fieldDispatchStatusOrder("complete"));
  });

  it("identifies terminal statuses", () => {
    expect(isTerminalStatus("paid")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("on-site")).toBe(false);
  });

  it("identifies the work-complete band (drives completedAt)", () => {
    expect(isWorkComplete("complete")).toBe(true);
    expect(isWorkComplete("invoiced")).toBe(true);
    expect(isWorkComplete("paid")).toBe(true);
    expect(isWorkComplete("on-site")).toBe(false);
    expect(isWorkComplete("cancelled")).toBe(false);
  });

  it("flags jobs needing dispatcher attention", () => {
    expect(needsDispatcherAttention("needs-review")).toBe(true);
    expect(needsDispatcherAttention("quoted")).toBe(true);
    expect(needsDispatcherAttention("scheduled")).toBe(true);
    expect(needsDispatcherAttention("confirmed")).toBe(false);
    expect(needsDispatcherAttention("en-route")).toBe(false);
  });
});

describe("parseFieldDispatchEvidence", () => {
  it("returns empty for absent or malformed top-level input", () => {
    expect(parseFieldDispatchEvidence(undefined)).toEqual({ entries: [] });
    expect(parseFieldDispatchEvidence(null)).toEqual({ entries: [] });
    expect(parseFieldDispatchEvidence("nope")).toEqual({ entries: [] });
    expect(parseFieldDispatchEvidence({})).toEqual({ entries: [] });
    expect(parseFieldDispatchEvidence({ entries: "x" })).toEqual({ entries: [] });
  });

  it("keeps well-formed entries and drops malformed ones (never throws)", () => {
    const result = parseFieldDispatchEvidence({
      // a foreign top-level key written by another domain is ignored
      somethingElse: 123,
      entries: [
        { kind: "note", at: "2026-06-13T10:00:00Z", note: "Replaced capacitor" },
        { kind: "status-change", at: "2026-06-13T10:05:00Z", fromStatus: "on-site", toStatus: "complete" },
        { kind: "not-a-kind", at: "2026-06-13T10:06:00Z" }, // invalid kind -> dropped
        { kind: "note" }, // missing `at` -> dropped
        "garbage", // non-object -> dropped
      ],
    });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ kind: "note", note: "Replaced capacitor" });
    expect(result.entries[1]).toMatchObject({ fromStatus: "on-site", toStatus: "complete" });
  });

  it("parses parts-used entries and flattens parts across the job", () => {
    const evidence = parseFieldDispatchEvidence({
      entries: [
        {
          kind: "parts-used",
          at: "2026-06-13T11:00:00Z",
          partsUsed: [
            { sku: "CAP-370-50", label: "370V 50uF capacitor", quantity: 1 },
            { sku: "FILT-16x25", quantity: 2 },
          ],
        },
        { kind: "parts-used", at: "2026-06-13T11:30:00Z", partsUsed: [{ sku: "CONTACTOR-2P", quantity: 1 }] },
      ],
    });
    const parts = collectPartsUsed(evidence);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.sku)).toEqual(["CAP-370-50", "FILT-16x25", "CONTACTOR-2P"]);
  });
});
