import { describe, expect, it } from "vitest";
import {
  ADDITIVE_MARKER_LABELS,
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

  it("strips the Wiki namespace prefix", () => {
    expect(humanizeLabel("Wiki__Principle")).toBe("Principle");
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

  it("returns the curated descriptor for a knowledge page kind", () => {
    const descriptor = describeLabel("Wiki__Principle");
    expect(descriptor.label).toBe("Principle");
    expect(descriptor.domain).toBe("knowledge");
  });

  it("enumerates every additive marker so the census cannot double-count", () => {
    // The census sums per-label counts, so a node carrying an additive marker plus
    // the kind that owns it is counted twice and its tile overstates. Both known
    // markers must be declared; a new one added without landing here silently
    // inflates a domain (BI-0E019B95 generalised the hard-coded EaElement skip).
    expect(ADDITIVE_MARKER_LABELS.has("EaElement")).toBe(true);
    expect(ADDITIVE_MARKER_LABELS.has("DocImpactSource")).toBe(true);
    // A concrete kind must never be treated as a marker, or its nodes vanish
    // from the census entirely.
    expect(ADDITIVE_MARKER_LABELS.has("CodeFile")).toBe(false);
    expect(ADDITIVE_MARKER_LABELS.has("DocPage")).toBe(false);
  });

  it("groups repo documentation with the knowledge domain", () => {
    const descriptor = describeLabel("DocPage");
    expect(descriptor.label).toBe("Doc page");
    expect(descriptor.domain).toBe("knowledge");
  });

  it("describes a shared doc-impact node by the kind that owns it, not the marker", () => {
    // The doc-impact projection stamps DocImpactSource onto CodeFile nodes it shares
    // with the code graph. The node must still read as a source file (BI-0E019B95).
    const shared = describeNodeLabels(["DocImpactSource", "CodeFile"]);
    expect(shared.key).toBe("CodeFile");

    // A cited path the code graph does not index carries the marker alone, and must
    // still land in `code` rather than the architecture-flavoured unknown bucket.
    const leftover = describeNodeLabels(["DocImpactSource"]);
    expect(leftover.domain).toBe("code");
  });

  it("keeps an uncurated wiki page kind inside the knowledge domain", () => {
    // `WikiPage.pageKind` is a plain string, so a kind added later must not fall
    // through to the architecture-flavoured unknown bucket (BI-3045CC18).
    const descriptor = describeLabel("Wiki__FieldGuide");
    expect(descriptor.domain).toBe("knowledge");
    expect(descriptor.label).toBe("Field Guide");
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
