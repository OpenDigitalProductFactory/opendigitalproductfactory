import { describe, expect, it } from "vitest";

import { formatContributionPrTitle } from "./contribution-pipeline";

describe("formatContributionPrTitle", () => {
  const buildId = "FB-AD454C98";

  it("returns the full title unchanged when it fits well under the GitHub limit", () => {
    const title = "Wire conflict-cluster overflow scroll";
    const formatted = formatContributionPrTitle(title, buildId);
    expect(formatted).toBe(`feat: ${title} (Build ${buildId})`);
    expect(formatted.length).toBeLessThan(256);
  });

  it("truncates the body and appends an ellipsis when the rawTitle exceeds 220 chars", () => {
    const longTitle =
      "Extend the DPF Edge Node (TypeScript, services/edge-node/) with network telemetry: " +
      "(1) SNMP ifTable walk — poll ifHCInOctets/ifHCOutOctets (64-bit counters, OIDs 1.3.6.1.2.1.31.1.1.1.6/.10) " +
      "on a 10-second interval using the netsnmp shared library and persist into edge_iface_metric.";
    expect(longTitle.length).toBeGreaterThan(220);

    const formatted = formatContributionPrTitle(longTitle, buildId);
    expect(formatted.length).toBeLessThanOrEqual(256);
    expect(formatted.endsWith(`(Build ${buildId})`)).toBe(true);
    expect(formatted).toContain("…");
  });

  it("strips trailing whitespace before the ellipsis so the cut never reads as a dangling space", () => {
    // 218 chars of repeated word + lots of spaces in the middle
    const padded = "a".repeat(150) + " ".repeat(40) + "b".repeat(40);
    expect(padded.length).toBeGreaterThan(220);
    const formatted = formatContributionPrTitle(padded, buildId);
    const beforeEllipsis = formatted.slice(0, formatted.indexOf("…"));
    expect(beforeEllipsis.endsWith(" ")).toBe(false);
  });

  it("treats exactly-220-char rawTitle as fitting and does not truncate", () => {
    const title = "a".repeat(220);
    const formatted = formatContributionPrTitle(title, buildId);
    expect(formatted).toBe(`feat: ${title} (Build ${buildId})`);
    expect(formatted).not.toContain("…");
  });
});
