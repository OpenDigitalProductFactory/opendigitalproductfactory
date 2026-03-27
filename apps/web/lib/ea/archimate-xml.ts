import { XMLParser } from "fast-xml-parser";

// ─── ArchiMate XML type → platform slug ──────────────────────────────────────

const ARCHIMATE_TYPE_TO_SLUG: Record<string, string> = {
  "archimate:BusinessActor":          "business_actor",
  "archimate:BusinessRole":           "business_role",
  "archimate:BusinessCollaboration":  "business_collaboration",
  "archimate:BusinessProcess":        "business_process",
  "archimate:BusinessFunction":       "business_function",
  "archimate:BusinessInteraction":    "business_interaction",
  "archimate:BusinessEvent":          "business_event",
  "archimate:BusinessService":        "business_service",
  "archimate:BusinessObject":         "business_object",
  "archimate:Contract":               "contract",
  "archimate:Product":                "product",
  "archimate:ApplicationComponent":   "application_component",
  "archimate:ApplicationFunction":    "application_function",
  "archimate:ApplicationInteraction": "application_interaction",
  "archimate:ApplicationEvent":       "application_event",
  "archimate:ApplicationService":     "application_service",
  "archimate:ApplicationInterface":   "application_interface",
  "archimate:DataObject":             "data_object",
  "archimate:Node":                   "technology_node",
  "archimate:Device":                 "device",
  "archimate:SystemSoftware":         "system_software",
  "archimate:TechnologyFunction":     "technology_function",
  "archimate:TechnologyService":      "technology_service",
  "archimate:Artifact":               "artifact",
  "archimate:CommunicationNetwork":   "communication_network",
  "archimate:Stakeholder":            "stakeholder",
  "archimate:Driver":                 "driver",
  "archimate:Goal":                   "goal",
  "archimate:Outcome":                "outcome",
  "archimate:Principle":              "principle",
  "archimate:Requirement":            "requirement",
  "archimate:Constraint":             "constraint",
  "archimate:Capability":             "capability",
  "archimate:ValueStream":            "value_stream",
  "archimate:CourseOfAction":         "course_of_action",
  "archimate:Resource":               "resource",
  "archimate:WorkPackage":            "work_package",
  "archimate:Deliverable":            "deliverable",
  "archimate:Plateau":                "plateau",
  "archimate:Gap":                    "gap",
};

const ARCHIMATE_REL_TO_SLUG: Record<string, string> = {
  "archimate:AssociationRelationship":    "associated_with",
  "archimate:CompositionRelationship":    "composed_of",
  "archimate:AggregationRelationship":    "composed_of",
  "archimate:RealizationRelationship":    "realizes",
  "archimate:ServingRelationship":        "serves",
  "archimate:AccessRelationship":         "accesses",
  "archimate:AssignmentRelationship":     "assigned_to",
  "archimate:InfluenceRelationship":      "influences",
  "archimate:TriggeringRelationship":     "triggers",
  "archimate:FlowRelationship":           "flows_to",
  "archimate:SpecializationRelationship": "associated_with",
};

// Reverse map: slug → ArchiMate XML type (standard types only)
export const SLUG_TO_ARCHIMATE_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(ARCHIMATE_TYPE_TO_SLUG)
    .filter(([, slug]) => slug !== "object")
    .map(([xmlType, slug]) => [slug, xmlType])
);

export type ParsedElement = {
  archimateId: string;
  name: string;
  slug: string;
  folder?: string;
  unknownArchimateType?: string;
  archimateRelType?: string;
};

export type ParsedRelationship = {
  archimateId: string;
  fromArchimateId: string;
  toArchimateId: string;
  slug: string;
  archimateRelType?: string;
};

export type ParsedArchimateModel = {
  modelName: string;
  elements: ParsedElement[];
  relationships: ParsedRelationship[];
};

export function parseArchimateXml(xml: string): ParsedArchimateModel {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => ["folder", "element", "properties", "property"].includes(name),
  });
  const doc = parser.parse(xml);
  const model = doc["archimate:model"] ?? doc;
  const modelName: string = model["@_name"] ?? "Imported Model";

  const elements: ParsedElement[] = [];
  const relationships: ParsedRelationship[] = [];

  // Process folders (elements)
  const folders: unknown[] = Array.isArray(model.folder) ? model.folder : model.folder ? [model.folder] : [];
  for (const folder of folders as Record<string, unknown>[]) {
    const folderName = String(folder["@_name"] ?? "");
    const rawElements: unknown[] = Array.isArray(folder.element) ? folder.element : folder.element ? [folder.element] : [];
    for (const el of rawElements as Record<string, unknown>[]) {
      const xmlType = String(el["@_xsi:type"] ?? "");
      const archimateId = String(el["@_id"] ?? "");
      const name = String(el["@_name"] ?? "");

      // Check for dpf:elementType property (round-trip restoration of extension types)
      let slug = ARCHIMATE_TYPE_TO_SLUG[xmlType];
      let unknownArchimateType: string | undefined;
      const propsContainers = Array.isArray(el.properties) ? el.properties : el.properties ? [el.properties] : [];
      for (const propsContainer of propsContainers as Record<string, unknown>[]) {
        const propList = Array.isArray(propsContainer.property) ? propsContainer.property : propsContainer.property ? [propsContainer.property] : [];
        for (const prop of propList as Record<string, unknown>[]) {
          if (prop["@_key"] === "dpf:elementType") {
            slug = String(prop["@_value"]);
          }
        }
      }
      if (!slug) {
        slug = "object"; // deterministic fallback for unknown types
        unknownArchimateType = xmlType;
      }
      elements.push({
        archimateId,
        name,
        slug,
        folder: folderName,
        ...(unknownArchimateType ? { unknownArchimateType } : {}),
      });
    }
  }

  // Process relationships
  const relsContainer = (model.relationships ?? {}) as Record<string, unknown>;
  const rawRels: unknown[] = Array.isArray(relsContainer.element) ? relsContainer.element : relsContainer.element ? [relsContainer.element] : [];
  for (const rel of rawRels as Record<string, unknown>[]) {
    const xmlType = String(rel["@_xsi:type"] ?? "");
    const slug = ARCHIMATE_REL_TO_SLUG[xmlType] ?? "associated_with";
    relationships.push({
      archimateId: String(rel["@_id"] ?? ""),
      fromArchimateId: String(rel["@_source"] ?? ""),
      toArchimateId: String(rel["@_target"] ?? ""),
      slug,
      ...( ["archimate:AggregationRelationship", "archimate:SpecializationRelationship"].includes(xmlType) ? { archimateRelType: xmlType } : {}),
    });
  }

  return { modelName, elements, relationships };
}

export type GenerateInput = {
  modelName: string;
  elements: Array<{
    archimateId: string;
    name: string;
    slug: string;
    archimateExportSlug: string | null;
    isExtension: boolean;
    ontologyRole: string | null;
  }>;
  relationships: Array<{
    archimateId: string;
    fromArchimateId: string;
    toArchimateId: string;
    slug: string;
  }>;
};

const REL_SLUG_TO_ARCHIMATE: Record<string, string> = {
  associated_with: "archimate:AssociationRelationship",
  composed_of:     "archimate:CompositionRelationship",
  realizes:        "archimate:RealizationRelationship",
  serves:          "archimate:ServingRelationship",
  accesses:        "archimate:AccessRelationship",
  assigned_to:     "archimate:AssignmentRelationship",
  influences:      "archimate:InfluenceRelationship",
  triggers:        "archimate:TriggeringRelationship",
  flows_to:        "archimate:FlowRelationship",
  depends_on:      "archimate:AssociationRelationship", // no direct equivalent; use association
};

export function generateArchimateXml(input: GenerateInput): string {
  const { modelName, elements, relationships } = input;

  const xmlElements = elements.map(el => {
    const xmlType = el.isExtension && el.archimateExportSlug
      ? `archimate:${el.archimateExportSlug.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join("")}`
      : (SLUG_TO_ARCHIMATE_TYPE[el.slug] ?? "archimate:ApplicationComponent");
    const escapedName = el.name.replace(/"/g, "&quot;");

    if (el.isExtension) {
      const ontologyProp = el.ontologyRole
        ? `\n      <property key="dpf:ontologyRole" value="${el.ontologyRole}"/>`
        : "";
      return `  <element xsi:type="${xmlType}" id="${el.archimateId}" name="${escapedName}">\n    <properties>\n      <property key="dpf:elementType" value="${el.slug}"/>${ontologyProp}\n    </properties>\n  </element>`;
    }
    return `  <element xsi:type="${xmlType}" id="${el.archimateId}" name="${escapedName}"/>`;
  }).join("\n");

  const xmlRels = relationships.map(rel => {
    const xmlType = REL_SLUG_TO_ARCHIMATE[rel.slug] ?? "archimate:AssociationRelationship";
    return `  <element xsi:type="${xmlType}" id="${rel.archimateId}" source="${rel.fromArchimateId}" target="${rel.toArchimateId}"/>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:archimate="http://www.archimatetool.com/archimate"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 name="${modelName.replace(/"/g, "&quot;")}">
  <folder name="Elements" type="other">
${xmlElements}
  </folder>
  <relationships>
${xmlRels}
  </relationships>
</archimate:model>`;
}
