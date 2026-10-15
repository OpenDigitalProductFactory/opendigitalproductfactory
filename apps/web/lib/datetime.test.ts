import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatInstant,
  formatTimestamp,
} from "./datetime";

// The copies these helpers replaced, verbatim, so the migration is pinned to
// "identical output for every input" rather than to one runtime's rendering.
function copiedFormatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function copiedAdpFormatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function copiedMileageFormatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function copiedBackupsFormatTimestamp(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

function copiedMcpFormatDate(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString();
}

const INSTANTS = [
  "2026-09-26T15:04:05.000Z",
  "2026-01-01T00:00:00Z",
  "2025-12-31T23:59:59.999Z",
  "2026-03-08T02:30:00-05:00",
  "2026-09-26",
  "1970-01-01T00:00:00.000Z",
];

describe("datetime shared display helpers", () => {
  it("formatDateTime matches the integration-panel copy, including invalid input", () => {
    for (const iso of [...INSTANTS, "not a date", ""]) {
      expect(formatDateTime(iso)).toBe(copiedFormatDateTime(iso));
    }
    expect(formatDateTime("not a date")).toBe("Invalid Date");
  });

  it("formatDate matches the ADP panel and mileage copies, including invalid input", () => {
    for (const iso of [...INSTANTS, "not a date", ""]) {
      expect(formatDate(iso)).toBe(copiedAdpFormatDate(iso));
      expect(formatDate(iso)).toBe(copiedMileageFormatDate(iso));
    }
  });

  it("formatTimestamp matches the backups copy and, with 'never', the MCP copy", () => {
    for (const s of [...INSTANTS, "not a date", "", null]) {
      expect(formatTimestamp(s)).toBe(copiedBackupsFormatTimestamp(s));
      expect(formatTimestamp(s, "never")).toBe(copiedMcpFormatDate(s));
    }
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp(undefined)).toBe("—");
  });

  it("formatInstant keeps its own contract (empty string for invalid input)", () => {
    expect(formatInstant("not a date")).toBe("");
    expect(formatInstant("2026-09-26T15:04:05Z", { mode: "date", timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date("2026-09-26T15:04:05Z")),
    );
  });
});
