import { describe, expect, it } from "vitest";
import { buildDigestBody, isReferenceDocProposal } from "./canonical-improvement-digest";

describe("canonical-improvement-digest", () => {
  it("detects reference-doc process proposals", () => {
    expect(
      isReferenceDocProposal({
        category: "process",
        description: "[reference-doc] AGENTS.md — add note",
      }),
    ).toBe(true);
    expect(
      isReferenceDocProposal({
        category: "ux_friction",
        description: "[reference-doc] ignored",
      }),
    ).toBe(false);
  });

  it("builds a digest body listing proposals", () => {
    const body = buildDigestBody([
      {
        proposalId: "IP-ABC12",
        title: "[reference-doc] Foo",
        description: "[reference-doc] docs/x.md — gap",
        createdAt: new Date("2026-07-09"),
      },
    ]);
    expect(body).toContain("IP-ABC12");
    expect(body).toContain("Canonical improvement digest");
  });
});