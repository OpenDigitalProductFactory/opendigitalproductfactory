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
  "archimate:AggregationRelationship":    "aggregates",
  "archimate:RealizationRelationship":    "realizes",
  "archimate:ServingRelationship":        "serves",
  "archimate:AccessRelationship":         "accesses",
  "archimate:AssignmentRelationship":     "assigned_to",
  "archimate:InfluenceRelationship":      "influences",
  "archimate:TriggeringRelationship":     "triggers",
  "archimate:FlowRelationship":           "flows_to",
  "archimate:SpecializationRelationship": "specializes",
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

/** A relationship type the importer does not know; reported as a finding, never coerced (BI-E487F6D9). */
export type UnknownParsedRelationship = {
  archimateId: string;
  xmlType: string;
};

export type ParsedRelationship = {
  archimateId: string;
  fromArchimateId: string;
  toArchimateId: string;
  slug: string;
  /** For an association: the name that says what it means. */
  role?: string;
};

export type ParsedArchimateModel = {
  modelName: string;
  elements: ParsedElement[];
  relationships: ParsedRelationship[];
  unknownRelationships: UnknownParsedRelationship[];
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
  const unknownRelationships: UnknownParsedRelationship[] = [];

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
    // A DPF type exported as a named association round-trips through its dpf:relationshipType property.
    const dpfSlug = readDpfProperty(rel, "dpf:relationshipType");
    const slug = dpfSlug ?? ARCHIMATE_REL_TO_SLUG[xmlType];
    if (!slug) {
      unknownRelationships.push({ archimateId: String(rel["@_id"] ?? ""), xmlType });
      continue;
    }
    const name = typeof rel["@_name"] === "string" && rel["@_name"].trim() ? rel["@_name"].trim() : undefined;
    relationships.push({
      archimateId: String(rel["@_id"] ?? ""),
      fromArchimateId: String(rel["@_source"] ?? ""),
      toArchimateId: String(rel["@_target"] ?? ""),
      slug,
      // An association keeps its name as the role that says what it means; a DPF type exported
      // as a named association keeps its name unless the export only filled in the slug.
      ...(name && (slug === "associated_with" || (dpfSlug && name !== dpfSlug)) ? { role: name } : {}),
    });
  }

  return { modelName, elements, relationships, unknownRelationships };
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
    /** An association's role, exported as its name. */
    role?: string;
  }>;
};

const REL_SLUG_TO_ARCHIMATE: Record<string, string> = {
  associated_with: "archimate:AssociationRelationship",
  composed_of:     "archimate:CompositionRelationship",
  aggregates:      "archimate:AggregationRelationship",
  specializes:     "archimate:SpecializationRelationship",
  realizes:        "archimate:RealizationRelationship",
  serves:          "archimate:ServingRelationship",
  accesses:        "archimate:AccessRelationship",
  assigned_to:     "archimate:AssignmentRelationship",
  influences:      "archimate:InfluenceRelationship",
  triggers:        "archimate:TriggeringRelationship",
  flows_to:        "archimate:FlowRelationship",
};

/** ArchiMate has no relationship for this DPF slug: export a named association carrying the slug. */
function associationFallback(slug: string): boolean {
  return !REL_SLUG_TO_ARCHIMATE[slug];
}

function readDpfProperty(node: Record<string, unknown>, key: string): string | undefined {
  // The parser reads `properties` and `property` as arrays (see parseArchimateXml's isArray).
  const containers = Array.isArray(node.properties) ? node.properties : node.properties ? [node.properties] : [];
  for (const container of containers as Record<string, unknown>[]) {
    const list = Array.isArray(container.property) ? container.property : container.property ? [container.property] : [];
    for (const entry of list as Array<Record<string, unknown>>) {
      if (entry["@_key"] === key && typeof entry["@_value"] === "string") return entry["@_value"];
    }
  }
  return undefined;
}

/** Escape a value for a double-quoted XML attribute; names are free text from imports and users. */
function xmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function generateArchimateXml(input: GenerateInput): string {
  const { modelName, elements, relationships } = input;

  const xmlElements = elements.map(el => {
    const xmlType = el.isExtension && el.archimateExportSlug
      ? `archimate:${el.archimateExportSlug.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join("")}`
      : (SLUG_TO_ARCHIMATE_TYPE[el.slug] ?? "archimate:ApplicationComponent");
    const escapedName = xmlAttr(el.name);

    if (el.isExtension) {
      const ontologyProp = el.ontologyRole
        ? `\n      <property key="dpf:ontologyRole" value="${el.ontologyRole}"/>`
        : "";
      return `  <element xsi:type="${xmlType}" id="${el.archimateId}" name="${escapedName}">\n    <properties>\n      <property key="dpf:elementType" value="${el.slug}"/>${ontologyProp}\n    </properties>\n  </element>`;
    }
    return `  <element xsi:type="${xmlType}" id="${el.archimateId}" name="${escapedName}"/>`;
  }).join("\n");

  const xmlRels = relationships.map(rel => {
    if (associationFallback(rel.slug)) {
      // e.g. has_foreign_key_to, depends_on: a named association that re-imports as the same slug.
      const name = xmlAttr(rel.role ?? rel.slug);
      return `  <element xsi:type="archimate:AssociationRelationship" id="${rel.archimateId}" source="${rel.fromArchimateId}" target="${rel.toArchimateId}" name="${name}">\n    <properties>\n      <property key="dpf:relationshipType" value="${rel.slug}"/>\n    </properties>\n  </element>`;
    }
    const xmlType = REL_SLUG_TO_ARCHIMATE[rel.slug];
    const nameAttr = rel.slug === "associated_with" && rel.role ? ` name="${xmlAttr(rel.role)}"` : "";
    return `  <element xsi:type="${xmlType}" id="${rel.archimateId}" source="${rel.fromArchimateId}" target="${rel.toArchimateId}"${nameAttr}/>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:archimate="http://www.archimatetool.com/archimate"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 name="${xmlAttr(modelName)}">
  <folder name="Elements" type="other">
${xmlElements}
  </folder>
  <relationships>
${xmlRels}
  </relationships>
</archimate:model>`;
}
