import { describe, it, expect } from "vitest";
import { parseArchimateXml, generateArchimateXml } from "./archimate-xml";

const MINIMAL_ARCHIMATE = `<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:archimate="http://www.archimatetool.com/archimate"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 name="Test Model" id="model-1">
  <folder name="Business" type="business">
    <element xsi:type="archimate:BusinessActor" id="actor-1" name="Customer"/>
    <element xsi:type="archimate:BusinessRole" id="role-1" name="Purchaser"/>
  </folder>
  <folder name="Application" type="application">
    <element xsi:type="archimate:ApplicationComponent" id="comp-1" name="Portal"/>
  </folder>
  <relationships>
    <element xsi:type="archimate:AssignmentRelationship" id="rel-1" source="actor-1" target="role-1"/>
    <element xsi:type="archimate:ServingRelationship" id="rel-2" source="comp-1" target="role-1"/>
  </relationships>
</archimate:model>`;

describe("parseArchimateXml", () => {
  it("extracts elements with correct slug mapping", () => {
    const result = parseArchimateXml(MINIMAL_ARCHIMATE);
    expect(result.elements).toHaveLength(3);
    expect(result.elements[0]).toMatchObject({ archimateId: "actor-1", name: "Customer", slug: "business_actor", folder: "Business" });
    expect(result.elements[2]).toMatchObject({ archimateId: "comp-1", name: "Portal", slug: "application_component" });
  });

  it("extracts relationships with correct slug mapping", () => {
    const result = parseArchimateXml(MINIMAL_ARCHIMATE);
    expect(result.relationships).toHaveLength(2);
    expect(result.relationships[0]).toMatchObject({ archimateId: "rel-1", fromArchimateId: "actor-1", toArchimateId: "role-1", slug: "assigned_to" });
    expect(result.relationships[1]).toMatchObject({ slug: "serves" });
  });

  it("returns model name", () => {
    const result = parseArchimateXml(MINIMAL_ARCHIMATE);
    expect(result.modelName).toBe("Test Model");
  });

  it("marks unknown element types and records original type", () => {
    const xml = MINIMAL_ARCHIMATE.replace('xsi:type="archimate:BusinessActor"', 'xsi:type="archimate:UnknownFuture"');
    const result = parseArchimateXml(xml);
    const unknown = result.elements.find(e => e.archimateId === "actor-1")!;
    expect(unknown.slug).toBe("object");
    expect(unknown.unknownArchimateType).toBe("archimate:UnknownFuture");
  });

  it("restores platform extension type from dpf:elementType property", () => {
    const xml = MINIMAL_ARCHIMATE.replace(
      '<element xsi:type="archimate:ApplicationComponent" id="comp-1" name="Portal"/>',
      `<element xsi:type="archimate:ApplicationComponent" id="comp-1" name="Portal">
        <properties><property key="dpf:elementType" value="digital_product"/></properties>
      </element>`
    );
    const result = parseArchimateXml(xml);
    const dp = result.elements.find(e => e.archimateId === "comp-1")!;
    expect(dp.slug).toBe("digital_product");
  });
});

describe("generateArchimateXml", () => {
  it("produces valid XML with correct xsi:type for standard elements", () => {
    const xml = generateArchimateXml({
      modelName: "Export",
      elements: [{ archimateId: "e-1", name: "Portal", slug: "application_component", archimateExportSlug: null, isExtension: false, ontologyRole: null }],
      relationships: [],
    });
    expect(xml).toContain('xsi:type="archimate:ApplicationComponent"');
    expect(xml).toContain('id="e-1"');
  });

  it("uses archimateExportSlug for extension types and adds dpf:elementType property", () => {
    const xml = generateArchimateXml({
      modelName: "Export",
      elements: [{ archimateId: "e-2", name: "Customer Portal", slug: "digital_product", archimateExportSlug: "application-component", isExtension: true, ontologyRole: "governed_thing" }],
      relationships: [],
    });
    expect(xml).toContain('xsi:type="archimate:ApplicationComponent"');
    expect(xml).toContain('key="dpf:elementType" value="digital_product"');
  });

  it("includes ontologyRole property when set on extension types", () => {
    const xml = generateArchimateXml({
      modelName: "Export",
      elements: [{ archimateId: "e-3", name: "AI Worker", slug: "ai_coworker", archimateExportSlug: "application-component", isExtension: true, ontologyRole: "actor" }],
      relationships: [],
    });
    expect(xml).toContain('key="dpf:ontologyRole" value="actor"');
  });

  it("emits relationships with correct ArchiMate type", () => {
    const xml = generateArchimateXml({
      modelName: "Export",
      elements: [],
      relationships: [{ archimateId: "r-1", fromArchimateId: "e-1", toArchimateId: "e-2", slug: "realizes" }],
    });
    expect(xml).toContain('xsi:type="archimate:RealizationRelationship"');
    expect(xml).toContain('source="e-1" target="e-2"');
  });

  it("round-trips: parse then generate preserves extension type slug", () => {
    const original = generateArchimateXml({
      modelName: "RT Test",
      elements: [{ archimateId: "dp-1", name: "Checkout", slug: "digital_product", archimateExportSlug: "application-component", isExtension: true, ontologyRole: null }],
      relationships: [],
    });
    const parsed = parseArchimateXml(original);
    expect(parsed.elements[0].slug).toBe("digital_product");
  });

  it("maps aggregation and specialization to their own slugs and keeps an association's name as its role (BI-E487F6D9)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:archimate="http://www.archimatetool.com/archimate" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="M">
  <folder name="Business"><element xsi:type="archimate:BusinessActor" id="a" name="A"/><element xsi:type="archimate:BusinessActor" id="b" name="B"/></folder>
  <relationships>
    <element xsi:type="archimate:AggregationRelationship" id="r1" source="a" target="b"/>
    <element xsi:type="archimate:SpecializationRelationship" id="r2" source="a" target="b"/>
    <element xsi:type="archimate:AssociationRelationship" id="r3" source="a" target="b" name="mentors"/>
    <element xsi:type="archimate:FutureRelationship" id="r4" source="a" target="b"/>
  </relationships>
</archimate:model>`;
    const parsed = parseArchimateXml(xml);
    expect(parsed.relationships.map((r) => r.slug)).toEqual(["aggregates", "specializes", "associated_with"]);
    expect(parsed.relationships[2].role).toBe("mentors");
    // An unknown type is reported, never coerced into a generic association.
    expect(parsed.unknownRelationships).toEqual([{ archimateId: "r4", xmlType: "archimate:FutureRelationship" }]);
  });

  it("round-trips a DPF type ArchiMate lacks as a named association carrying its slug", () => {
    const xml = generateArchimateXml({
      modelName: "RT",
      elements: [],
      relationships: [{ archimateId: "r1", fromArchimateId: "a", toArchimateId: "b", slug: "has_foreign_key_to", role: "author" }],
    });
    expect(xml).toContain('xsi:type="archimate:AssociationRelationship"');
    expect(xml).toContain('name="author"');
    const parsed = parseArchimateXml(xml);
    expect(parsed.relationships).toEqual([
      expect.objectContaining({ archimateId: "r1", slug: "has_foreign_key_to", role: "author" }),
    ]);
  });

  it("keeps the export well-formed and lossless when names carry XML special characters", () => {
    const xml = generateArchimateXml({
      modelName: `R&D <"core">`,
      elements: [{ archimateId: "a", name: `Sales & Marketing <EU> 'north'`, slug: "business_actor", archimateExportSlug: null, isExtension: false, ontologyRole: null }],
      relationships: [
        { archimateId: "r1", fromArchimateId: "a", toArchimateId: "a", slug: "associated_with", role: `owns & operates <"all">` },
        { archimateId: "r2", fromArchimateId: "a", toArchimateId: "a", slug: "has_foreign_key_to", role: "R&D" },
      ],
    });
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
    const parsed = parseArchimateXml(xml);
    expect(parsed.modelName).toBe(`R&D <"core">`);
    expect(parsed.elements[0].name).toBe(`Sales & Marketing <EU> 'north'`);
    expect(parsed.relationships.map(r => [r.slug, r.role])).toEqual([
      ["associated_with", `owns & operates <"all">`],
      ["has_foreign_key_to", "R&D"],
    ]);
  });

  it("does not invent a role for a DPF type exported without one", () => {
    const xml = generateArchimateXml({
      modelName: "RT", elements: [],
      relationships: [{ archimateId: "r1", fromArchimateId: "a", toArchimateId: "b", slug: "depends_on" }],
    });
    expect(parseArchimateXml(xml).relationships[0]).not.toHaveProperty("role");
  });
});
