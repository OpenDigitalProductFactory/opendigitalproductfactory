import { describe, expect, it } from "vitest";
import {
  GRAPH_DOMAINS,
  describeLabel,
  describeNodeLabels,
  describeRelType,
  humanizeLabel,
} from "../explorer-vocabulary";

describe("humanizeLabel", () => {
  it("splits PascalCase storage labels into words", () => {
    expect(humanizeLabel("CodeSymbol")).toBe("Code Symbol");
    expect(humanizeLabel("PrismaModel")).toBe("Prisma Model");
  });

  it("strips the ArchiMate namespace prefix", () => {
    expect(humanizeLabel("ArchiMate__DataObject")).toBe("Data Object");
  });
});

describe("describeLabel", () => {
  it("returns the curated descriptor for a known label", () => {
    const descriptor = describeLabel("CodeRoute");
    expect(descriptor.label).toBe("Route");
    expect(descriptor.domain).toBe("code");
  });

  it("derives a descriptor for any ArchiMate type without a curated entry", () => {
    const descriptor = describeLabel("ArchiMate__ApplicationService");
    expect(descriptor.label).toBe("Application Service");
    expect(descriptor.domain).toBe("architecture");
  });

  it("degrades rather than throwing on an unknown label", () => {
    const descriptor = describeLabel("SomethingNew");
    expect(descriptor.label).toBe("Something New");
    expect(descriptor.color).toBeTruthy();
  });

  it("assigns every curated label to a declared domain", () => {
    const domainKeys = new Set(GRAPH_DOMAINS.map((d) => d.key));
    for (const raw of ["CodeFile", "PrismaField", "EaElement", "InfraCI", "Portfolio"]) {
      expect(domainKeys.has(describeLabel(raw).domain)).toBe(true);
    }
  });
});

describe("describeNodeLabels", () => {
  it("prefers the concrete ArchiMate type over the generic EaElement marker", () => {
    // Live rows carry both: 532 nodes are labelled EaElement AND ArchiMate__DataObject.
    expect(describeNodeLabels(["EaElement", "ArchiMate__DataObject"]).label).toBe("Data Object");
  });

  it("prefers the more specific of two code labels", () => {
    expect(describeNodeLabels(["CodeFile", "TestFile"]).label).toBe("Test file");
  });

  it("falls back to a neutral descriptor for a node with no labels", () => {
    expect(describeNodeLabels([]).label).toBe("Node");
  });
});

describe("describeRelType", () => {
  it("uses the curated label and colour when the type is known", () => {
    const descriptor = describeRelType("IMPLEMENTS_ROUTE");
    expect(descriptor.label).toBe("Implements route");
    expect(descriptor.color).not.toBe("#8888a0");
  });

  it("humanizes an unknown relationship type instead of showing the raw enum", () => {
    expect(describeRelType("SOME_NEW_EDGE").label).toBe("some new edge");
  });
});
