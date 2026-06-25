import { describe, it, expect } from "vitest";
import {
  normalizeIt4itEvidenceStream,
  evidenceStreamToCapabilityGroup,
  extractSectionToken,
  sectionCovers,
  IT4IT_V3_STREAMS,
  IT4IT_CAPABILITY_GROUPS,
} from "./it4it-crosswalk";

describe("normalizeIt4itEvidenceStream", () => {
  it("passes through canonical v3 streams", () => {
    for (const s of IT4IT_V3_STREAMS) {
      expect(normalizeIt4itEvidenceStream(s)).toBe(s);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeIt4itEvidenceStream("  Evaluate ")).toBe("evaluate");
  });

  it("normalizes legacy v2 labels to a v3 stream", () => {
    expect(normalizeIt4itEvidenceStream("Strategy to Portfolio")).toBe("evaluate");
    expect(normalizeIt4itEvidenceStream("Request to Deploy")).toBe("deploy");
    expect(normalizeIt4itEvidenceStream("Requirement to Deploy")).toBe("integrate");
  });

  it("keeps governance and cross-cutting distinct", () => {
    expect(normalizeIt4itEvidenceStream("governance")).toBe("governance");
    expect(normalizeIt4itEvidenceStream("cross-cutting")).toBe("cross-cutting");
    expect(normalizeIt4itEvidenceStream("cross cutting")).toBe("cross-cutting");
  });

  it("returns null for null, empty, and unknown labels", () => {
    expect(normalizeIt4itEvidenceStream(null)).toBeNull();
    expect(normalizeIt4itEvidenceStream("")).toBeNull();
    expect(normalizeIt4itEvidenceStream("   ")).toBeNull();
    expect(normalizeIt4itEvidenceStream("nonsense")).toBeNull();
  });
});

describe("evidenceStreamToCapabilityGroup", () => {
  it("maps the four delivery streams to their capability groups", () => {
    expect(evidenceStreamToCapabilityGroup("evaluate")).toBe("Strategy to Portfolio");
    expect(evidenceStreamToCapabilityGroup("explore")).toBe("Strategy to Portfolio");
    expect(evidenceStreamToCapabilityGroup("integrate")).toBe("Requirement to Deploy");
    expect(evidenceStreamToCapabilityGroup("deploy")).toBe("Requirement to Deploy");
    expect(evidenceStreamToCapabilityGroup("release")).toBe("Requirement to Deploy");
    expect(evidenceStreamToCapabilityGroup("consume")).toBe("Request to Fulfill");
    expect(evidenceStreamToCapabilityGroup("operate")).toBe("Detect to Correct");
  });

  it("maps governance to Supporting Functions and cross-cutting to null", () => {
    expect(evidenceStreamToCapabilityGroup("governance")).toBe("Supporting Functions");
    expect(evidenceStreamToCapabilityGroup("cross-cutting")).toBeNull();
  });

  it("maps legacy labels through to the right group", () => {
    expect(evidenceStreamToCapabilityGroup("Strategy to Portfolio")).toBe("Strategy to Portfolio");
    expect(evidenceStreamToCapabilityGroup("Request to Deploy")).toBe("Requirement to Deploy");
  });

  it("returns null for unknown labels", () => {
    expect(evidenceStreamToCapabilityGroup("nonsense")).toBeNull();
  });

  it("only ever returns a canonical capability group or null", () => {
    const allowed = new Set<string | null>([...IT4IT_CAPABILITY_GROUPS, null]);
    for (const s of [...IT4IT_V3_STREAMS, "governance", "cross-cutting", "bogus"]) {
      expect(allowed.has(evidenceStreamToCapabilityGroup(s))).toBe(true);
    }
  });
});

describe("section helpers", () => {
  it("extracts a dotted section token from messy references", () => {
    expect(extractSectionToken("6.1.1")).toBe("6.1.1");
    expect(extractSectionToken("section 6.1.1 Policy")).toBe("6.1.1");
    expect(extractSectionToken("5.1.1-5.1.6")).toBe("5.1.1");
    expect(extractSectionToken("Evaluate Value Stream")).toBeNull();
    expect(extractSectionToken(null)).toBeNull();
  });

  it("treats a dotted prefix as covering, at dot boundaries only", () => {
    expect(sectionCovers("6.1", "6.1.1")).toBe(true);
    expect(sectionCovers("6.1.1", "6.1.1")).toBe(true);
    expect(sectionCovers("6.1", "6.11")).toBe(false);
    expect(sectionCovers("6.1.1", "6.1")).toBe(false);
  });
});
