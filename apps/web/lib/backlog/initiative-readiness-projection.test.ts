import { describe, expect, it } from "vitest";

import {
  projectInitiativeGateEvidence,
  selectLatestInitiativeGateRows,
  type InitiativeGateActivityRow,
} from "./initiative-readiness";

function row(overrides: Partial<InitiativeGateActivityRow> = {}): InitiativeGateActivityRow {
  return {
    id: "row-1",
    backlogItemId: "item-1",
    gateKey: "architecture-review",
    recordedAt: new Date("2026-08-08T20:00:00Z"),
    payload: {
      schemaVersion: 1,
      receiptId: overrides.id ?? "row-1",
      gate: overrides.gateKey ?? "architecture-review",
      decision: "pass",
      artifactDigest: "sha256:current",
      artifactAuthorRef: "principal:author|agent:author-agent",
      reviewerPrincipalId: "reviewer",
      reviewerAgentId: "reviewer-agent",
      authorityDecisionId: "decision-1",
      authoritySnapshot: { decision: "allow" },
      reason: "Independent review passed.",
      findingRefs: [],
      resolvedFindingRefs: [],
      artifactRef: { kind: "document-version", versionId: "secret-version" },
    },
    ...overrides,
  };
}

describe("initiative readiness projection", () => {
  it("bounds long histories to one newest row per item and gate with deterministic ties", () => {
    const rows = Array.from({ length: 500 }, (_, index) => row({
      id: `row-${String(index).padStart(4, "0")}`,
      recordedAt: new Date("2026-08-08T20:00:00Z"),
    }));
    rows.push(row({ id: "data-latest", gateKey: "data-review" }));
    const latest = selectLatestInitiativeGateRows(rows, ["item-1"]);
    expect(latest).toHaveLength(2);
    expect(latest.find((entry) => entry.gateKey === "architecture-review")?.id).toBe("row-0499");
  });

  it("keeps a malformed newest row authoritative instead of reviving an older pass", () => {
    const projected = projectInitiativeGateEvidence([
      row({ id: "older-pass", recordedAt: new Date("2026-08-08T19:00:00Z") }),
      row({ id: "new-malformed", payload: { decision: "pass" } }),
    ], { itemIds: ["item-1"], expectedArtifactDigest: "sha256:current" });
    expect(projected).toEqual([{ backlogItemId: "item-1", gate: "architecture-review", state: "malformed" }]);
  });

  it("returns sanitized state without exposing an immutable locator", () => {
    const projected = projectInitiativeGateEvidence([row()], {
      itemIds: ["item-1"],
      expectedArtifactDigest: "sha256:current",
    });
    expect(projected).toEqual([{ backlogItemId: "item-1", gate: "architecture-review", state: "pass" }]);
    expect(JSON.stringify(projected)).not.toContain("secret-version");
  });

  it("fails closed when row identity or authority binding is inconsistent", () => {
    const projected = projectInitiativeGateEvidence([
      row({ payload: {
        schemaVersion: 1,
        receiptId: "another-row",
        gate: "architecture-review",
        decision: "pass",
        artifactDigest: "sha256:current",
      } }),
    ], { itemIds: ["item-1"], expectedArtifactDigest: "sha256:current" });
    expect(projected[0]?.state).toBe("malformed");
  });
});
