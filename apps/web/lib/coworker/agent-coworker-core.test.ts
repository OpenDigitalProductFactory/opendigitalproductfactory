// apps/web/lib/coworker/agent-coworker-core.test.ts
//
// Unit tests for the pure agent-coworker domain helpers extracted from
// lib/actions/agent-coworker.ts (BI-OPT-FAT-ACTIONS, agent-coworker slice).
// These functions are side-effect-free (no prisma / auth / Next.js), so they
// are exercised directly here.
import { describe, it, expect } from "vitest";
import type { PortalObjectAnchor } from "@/lib/portal-context";
import {
  formatPortalContextPromptSection,
  isSubstantiveCoworkerOutput,
  normalizePortalContextPathname,
  normalizePortalContextRoute,
  isPortalContextSupportedPath,
  resolveBuildIdFromRouteContext,
  resolveCapsuleIdFromPathname,
} from "./agent-coworker-core";

function anchor(kind: string, id: string): PortalObjectAnchor {
  return { kind, id } as PortalObjectAnchor;
}

describe("formatPortalContextPromptSection", () => {
  it("emits a header + digest and an anchor line when anchors are present", () => {
    const section = formatPortalContextPromptSection("A digest.", [
      anchor("build", "FB-1"),
      anchor("capsule", "WC-2"),
    ]);
    expect(section).toBe(
      "--- PORTAL CONTEXT ---\nA digest.\nAnchors: build:FB-1, capsule:WC-2",
    );
  });

  it("omits the anchor line when there are no anchors but still renders the digest", () => {
    const section = formatPortalContextPromptSection("  Only a digest  ", []);
    expect(section).toBe("--- PORTAL CONTEXT ---\nOnly a digest");
  });

  it("returns null when the digest is empty and there are no anchors (only the header survives)", () => {
    expect(formatPortalContextPromptSection("   ", [])).toBeNull();
  });
});

describe("isSubstantiveCoworkerOutput", () => {
  it("rejects content shorter than 40 chars", () => {
    expect(isSubstantiveCoworkerOutput("too short")).toBe(false);
  });

  it("rejects trivial social acknowledgements", () => {
    expect(isSubstantiveCoworkerOutput("Thanks")).toBe(false);
    expect(isSubstantiveCoworkerOutput("GOT IT")).toBe(false);
  });

  it("accepts a substantive, sufficiently long response", () => {
    expect(
      isSubstantiveCoworkerOutput(
        "Here is a real answer that is well beyond the length floor and carries content.",
      ),
    ).toBe(true);
  });
});

describe("normalizePortalContextPathname", () => {
  it("strips hash and query fragments", () => {
    expect(normalizePortalContextPathname("/build#FB-1?x=1")).toBe("/build");
    expect(normalizePortalContextPathname("/platform/ai?tab=providers")).toBe("/platform/ai");
  });

  it("returns the route unchanged when there is no fragment", () => {
    expect(normalizePortalContextPathname("/build/work/WC-1")).toBe("/build/work/WC-1");
  });
});

describe("normalizePortalContextRoute", () => {
  it("collapses build-work paths to /build/work", () => {
    expect(normalizePortalContextRoute("/build/work/WC-1")).toBe("/build/work");
  });

  it("collapses other build paths to /build", () => {
    expect(normalizePortalContextRoute("/build")).toBe("/build");
    expect(normalizePortalContextRoute("/build/anything")).toBe("/build");
  });

  it("passes non-build paths through unchanged", () => {
    expect(normalizePortalContextRoute("/platform/ai")).toBe("/platform/ai");
  });
});

describe("isPortalContextSupportedPath", () => {
  it("accepts build and build-work surfaces", () => {
    expect(isPortalContextSupportedPath("/build")).toBe(true);
    expect(isPortalContextSupportedPath("/build/work/WC-1")).toBe(true);
  });

  it("accepts the /platform/ai family (D29)", () => {
    expect(isPortalContextSupportedPath("/platform/ai")).toBe(true);
    expect(isPortalContextSupportedPath("/platform/ai/providers")).toBe(true);
  });

  it("rejects unrelated surfaces", () => {
    expect(isPortalContextSupportedPath("/workspace")).toBe(false);
    expect(isPortalContextSupportedPath("/crm")).toBe(false);
  });
});

describe("resolveBuildIdFromRouteContext", () => {
  it("extracts and decodes a build id from a /build#<id> hash route", () => {
    expect(resolveBuildIdFromRouteContext("/build#FB-1")).toBe("FB-1");
    expect(resolveBuildIdFromRouteContext("/build#FB%2D2")).toBe("FB-2");
  });

  it("returns null when the shape does not match", () => {
    expect(resolveBuildIdFromRouteContext("/build")).toBeNull();
    expect(resolveBuildIdFromRouteContext("/build/work/WC-1")).toBeNull();
    expect(resolveBuildIdFromRouteContext("/build#a/b")).toBeNull();
  });
});

describe("resolveCapsuleIdFromPathname", () => {
  it("extracts and decodes a capsule id from a /build/work/<id> path", () => {
    expect(resolveCapsuleIdFromPathname("/build/work/WC-1")).toBe("WC-1");
    expect(resolveCapsuleIdFromPathname("/build/work/WC%2D2")).toBe("WC-2");
  });

  it("returns null when the shape does not match", () => {
    expect(resolveCapsuleIdFromPathname("/build/work")).toBeNull();
    expect(resolveCapsuleIdFromPathname("/build/work/WC-1/extra")).toBeNull();
    expect(resolveCapsuleIdFromPathname("/build")).toBeNull();
  });
});
