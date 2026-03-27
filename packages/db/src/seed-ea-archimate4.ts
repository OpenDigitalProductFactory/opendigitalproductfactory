// packages/db/src/seed-ea-archimate4.ts
// ArchiMate 4 notation seed data.
// Adds one EaNotation, element types, relationship types, relationship rules, DQ stage-gate rules,
// framework mappings, and bounded traversal patterns.
// Safe to re-run (upsert pattern throughout).

import { prisma } from "./client.js";
import type { Prisma } from "../generated/client/client";

// ─── Lifecycle constraint sets ────────────────────────────────────────────────

// Logical entities: cannot be decommissioned; "inactive" and "retirement" don't apply
const LOGICAL_STAGES   = ["plan", "design", "production"];
const LOGICAL_STATUSES = ["draft", "active"];

// Full lifecycle for operational / manifested elements
const FULL_STAGES   = ["plan", "design", "build", "production", "retirement"];
const FULL_STATUSES = ["draft", "active", "inactive"];

// ─── Element type definitions ──────────────────────────────────────────────────

type ElementTypeDef = {
  slug: string;
  name: string;
  neoLabel: string;
  domain: string;
  description?: string;
  stages: string[];
  statuses: string[];
  isExtension?: boolean;        // true only for DPF-extension types beyond ArchiMate 4 standard
  archimateExportSlug?: string; // ArchiMate 4 element name used in Archi .archimate XML export
  ontologyCategory?: string;    // structure | behavior | motivation | information | governance
};

const ELEMENT_TYPES: ElementTypeDef[] = [
  // ── Strategy ──────────────────────────────────────────────────────────────
  { slug: "value_stream",       name: "Value Stream",       neoLabel: "ArchiMate__ValueStream",      domain: "strategy",       description: "A sequence of activities creating overall value for a customer or stakeholder",        stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  { slug: "value_stream_stage", name: "Value Stream Stage", neoLabel: "ArchiMate__ValueStreamStage", domain: "strategy",       description: "An ordered stage within a value stream",                                              stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  { slug: "capability",         name: "Capability",         neoLabel: "ArchiMate__Capability",       domain: "strategy",       description: "An ability of an active structure element",                                          stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  { slug: "course_of_action",   name: "Course of Action",   neoLabel: "ArchiMate__CourseOfAction",   domain: "strategy",       description: "An approach or plan for configuring capabilities",                                   stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  // ── Business ──────────────────────────────────────────────────────────────
  { slug: "business_capability",name: "Business Capability",neoLabel: "ArchiMate__BusinessCapability",domain: "business",     description: "A particular ability that a business possesses",                                     stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  { slug: "business_actor",     name: "Business Actor",     neoLabel: "ArchiMate__BusinessActor",    domain: "business",       description: "An organizational entity capable of performing behaviour",                           stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },
  { slug: "business_role",      name: "Business Role",      neoLabel: "ArchiMate__BusinessRole",     domain: "business",       description: "The responsibility of performing a business behaviour",                              stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  { slug: "business_object",    name: "Business Object",    neoLabel: "ArchiMate__BusinessObject",   domain: "business",       description: "A concept used within a business domain",                                           stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  { slug: "contract",           name: "Contract",           neoLabel: "ArchiMate__Contract",         domain: "business",       description: "A formal or informal agreement between parties",                                    stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },
  // ── Application ───────────────────────────────────────────────────────────
  { slug: "application_component",  name: "Application Component",  neoLabel: "ArchiMate__ApplicationComponent",  domain: "application", description: "An encapsulation of application functionality aligned to implementation structure", stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },
  { slug: "application_service",    name: "Application Service",    neoLabel: "ArchiMate__ApplicationService",    domain: "application", description: "An explicitly defined exposed application behaviour",                            stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "data_object",            name: "Data Object",            neoLabel: "ArchiMate__DataObject",            domain: "application", description: "Data structured for automated processing",                                       stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  // ── Technology ────────────────────────────────────────────────────────────
  { slug: "technology_node",       name: "Technology Node",       neoLabel: "ArchiMate__TechnologyNode",       domain: "technology",  description: "A computational or physical resource hosting artefacts",                         stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },
  { slug: "technology_service",    name: "Technology Service",    neoLabel: "ArchiMate__TechnologyService",    domain: "technology",  description: "An explicitly defined exposed technology behaviour",                             stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "artifact",              name: "Artifact",              neoLabel: "ArchiMate__Artifact",             domain: "technology",  description: "A piece of data used or produced by a technology node",                          stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },
  { slug: "device",               name: "Device",               neoLabel: "ArchiMate__Device",               domain: "technology",  description: "A physical IT resource",                                                         stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },
  { slug: "system_software",      name: "System Software",      neoLabel: "ArchiMate__SystemSoftware",       domain: "technology",  description: "Software that provides a platform on which applications run",                    stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },
  { slug: "communication_network",name: "Communication Network",neoLabel: "ArchiMate__CommunicationNetwork", domain: "technology",  description: "A set of structures that connects technology nodes",                            stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },
  // ── Motivation ────────────────────────────────────────────────────────────
  { slug: "stakeholder", name: "Stakeholder", neoLabel: "ArchiMate__Stakeholder", domain: "motivation", description: "A role of an individual, team, or organisation that has interests in the architecture", stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "motivation" },
  { slug: "driver",      name: "Driver",      neoLabel: "ArchiMate__Driver",      domain: "motivation", description: "An external or internal condition motivating change",                                    stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "motivation" },
  { slug: "goal",        name: "Goal",        neoLabel: "ArchiMate__Goal",        domain: "motivation", description: "A high-level statement of intent, direction, or desired end state",                     stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "motivation" },
  { slug: "outcome",     name: "Outcome",     neoLabel: "ArchiMate__Outcome",     domain: "motivation", description: "An end result that has been achieved",                                                  stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "motivation" },
  { slug: "principle",   name: "Principle",   neoLabel: "ArchiMate__Principle",   domain: "motivation", description: "A qualitative statement of intent guiding design",                                      stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "motivation" },
  { slug: "requirement", name: "Requirement", neoLabel: "ArchiMate__Requirement", domain: "motivation", description: "A statement of need that must be realised by an architecture",                          stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "motivation" },
  { slug: "constraint",  name: "Constraint",  neoLabel: "ArchiMate__Constraint",  domain: "motivation", description: "A restriction on the way in which a system is realised",                                stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "motivation" },
  // ── Common ────────────────────────────────────────────────────────────────
  { slug: "resource", name: "Resource", neoLabel: "ArchiMate__Resource", domain: "common", description: "An asset owned by an actor",                                                            stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },
  { slug: "object",   name: "Object",   neoLabel: "ArchiMate__Object",   domain: "common", description: "A passive element on which behaviour can be performed",                                  stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  // ── Implementation & Migration ────────────────────────────────────────────
  { slug: "work_package", name: "Work Package", neoLabel: "ArchiMate__WorkPackage", domain: "impl_migration", description: "A series of actions to achieve a goal or produce deliverables",   stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "deliverable",  name: "Deliverable",  neoLabel: "ArchiMate__Deliverable", domain: "impl_migration", description: "A precisely defined result of work",                                stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "plateau",      name: "Plateau",      neoLabel: "ArchiMate__Plateau",     domain: "impl_migration", description: "A relatively stable state of the architecture",                    stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
  { slug: "gap",          name: "Gap",          neoLabel: "ArchiMate__Gap",         domain: "impl_migration", description: "A difference between two states of the architecture",               stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },

  // ── Phase EA-2: Business layer behaviour elements ─────────────────────────
  { slug: "business_process",       name: "Business Process",       neoLabel: "ArchiMate__BusinessProcess",       domain: "business",     description: "A sequence of behaviours in service of a goal",                                   stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "business_function",      name: "Business Function",      neoLabel: "ArchiMate__BusinessFunction",      domain: "business",     description: "A collection of business behaviour based on a chosen set of criteria",             stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
  { slug: "business_interaction",   name: "Business Interaction",   neoLabel: "ArchiMate__BusinessInteraction",   domain: "business",     description: "A unit of collective business behaviour performed by two or more roles",           stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
  { slug: "business_event",         name: "Business Event",         neoLabel: "ArchiMate__BusinessEvent",         domain: "business",     description: "A business behaviour element denoting an organisational state change",            stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "business_service",       name: "Business Service",       neoLabel: "ArchiMate__BusinessService",       domain: "business",     description: "An explicitly defined exposed business behaviour",                                stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "business_collaboration", name: "Business Collaboration", neoLabel: "ArchiMate__BusinessCollaboration", domain: "business",     description: "An aggregate of two or more business roles that work together",                  stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  { slug: "product",                name: "Product",                neoLabel: "ArchiMate__Product",               domain: "business",     description: "A coherent collection of services and/or passive structure elements",            stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },

  // ── Phase EA-2: Application layer behaviour elements ──────────────────────
  { slug: "application_function",    name: "Application Function",    neoLabel: "ArchiMate__ApplicationFunction",    domain: "application", description: "Automated behaviour of an application component",                                      stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
  { slug: "application_interaction", name: "Application Interaction", neoLabel: "ArchiMate__ApplicationInteraction", domain: "application", description: "A unit of collective application behaviour performed by two or more components",       stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
  { slug: "application_event",       name: "Application Event",       neoLabel: "ArchiMate__ApplicationEvent",       domain: "application", description: "An application behaviour element denoting a state change",                           stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "application_interface",   name: "Application Interface",   neoLabel: "ArchiMate__ApplicationInterface",   domain: "application", description: "A point of access where application services are made available",                    stages: FULL_STAGES,    statuses: FULL_STATUSES,   ontologyCategory: "structure" },

  // ── Phase EA-2: Technology layer ──────────────────────────────────────────
  { slug: "technology_function",    name: "Technology Function",    neoLabel: "ArchiMate__TechnologyFunction",    domain: "technology",  description: "A collection of technology behaviour",                                              stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },

  // ── Ontology-extension types (isExtension=true) ───────────────────────────
  // NOTE: "control" slug is distinct from the compliance Control Prisma model — EA-layer concept only.
  { slug: "digital_product",   name: "Digital Product",   neoLabel: "ArchiMate__DigitalProduct",   domain: "product",     description: "Cross-layer anchor entity spanning business intent through operational delivery. Bridges to DigitalProduct record.",   stages: FULL_STAGES,    statuses: FULL_STATUSES,   isExtension: true, archimateExportSlug: "application-component", ontologyCategory: "structure" },
  { slug: "service_offering",  name: "Service Offering",  neoLabel: "ArchiMate__ServiceOffering",  domain: "product",     description: "Customer-facing offer realized by a digital product. Distinct from the product itself.",                             stages: FULL_STAGES,    statuses: FULL_STATUSES,   isExtension: true, archimateExportSlug: "product",               ontologyCategory: "structure" },
  { slug: "information_object",name: "Information Object",neoLabel: "ArchiMate__InformationObject",domain: "information", description: "Governed data class with obligation semantics. Carries control requirements and evidence obligations.",               stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, isExtension: true, archimateExportSlug: "business-object",       ontologyCategory: "information" },
  { slug: "ea_control",        name: "Control",           neoLabel: "ArchiMate__Control",          domain: "governance",  description: "Policy, control objective, or implemented workflow gate. NOTE: distinct from the compliance Control Prisma model.", stages: FULL_STAGES,    statuses: FULL_STATUSES,   isExtension: true, archimateExportSlug: "constraint",            ontologyCategory: "governance" },
  { slug: "event_evidence",    name: "Event / Evidence",  neoLabel: "ArchiMate__EventEvidence",    domain: "governance",  description: "Audit record, evidence artifact, or operational event. Actual-layer complement to Control.",                         stages: FULL_STAGES,    statuses: FULL_STATUSES,   isExtension: true, archimateExportSlug: "business-event",        ontologyCategory: "governance" },
  { slug: "ai_coworker",       name: "AI Coworker",       neoLabel: "ArchiMate__AiCoworker",       domain: "product",     description: "AI agent identity — simultaneously a product, a component within a product, and an actor with governed authority.",  stages: FULL_STAGES,    statuses: FULL_STATUSES,   isExtension: true, archimateExportSlug: "application-component", ontologyCategory: "structure" },
];

// ─── Relationship type definitions ────────────────────────────────────────────

type RelTypeDef = {
  slug: string;
  name: string;
  neoType: string;
  description?: string;
};

const REL_TYPES: RelTypeDef[] = [
  { slug: "realizes",         name: "Realizes",         neoType: "REALIZES",        description: "Lower-layer element realises a higher-layer concept" },
  { slug: "depends_on",       name: "Depends On",       neoType: "DEPENDS_ON",      description: "Runtime or structural dependency" },
  { slug: "assigned_to",      name: "Assigned To",      neoType: "ASSIGNED_TO",     description: "Active structure element assigned to a behaviour or resource" },
  { slug: "composed_of",      name: "Composed Of",      neoType: "COMPOSED_OF",     description: "Whole-part structural composition" },
  { slug: "associated_with",  name: "Associated With",  neoType: "ASSOCIATED_WITH", description: "Generic unspecified relationship" },
  { slug: "influences",       name: "Influences",       neoType: "INFLUENCES",      description: "Motivation element influences another element" },
  { slug: "triggers",         name: "Triggers",         neoType: "TRIGGERS",        description: "Temporal or causal trigger between behaviours" },
  { slug: "flows_to",         name: "Flows To",         neoType: "FLOWS_TO",        description: "Information or material flow" },
  { slug: "serves",           name: "Serves",           neoType: "SERVES",          description: "An element provides services to another element" },
  { slug: "accesses",         name: "Accesses",         neoType: "ACCESSES",        description: "An active element accesses a passive element" },
];

// ─── Relationship rules ───────────────────────────────────────────────────────
// Each entry: [fromSlug, toSlug, relSlug]

type RuleDef = [string, string, string];

const RULES: RuleDef[] = [
  // Application → Business
  ["application_component", "business_capability",   "realizes"],
  ["application_service",   "business_capability",   "realizes"],
  ["application_component", "business_capability",   "associated_with"],
  // Application → Technology
  ["application_component", "technology_node",       "depends_on"],
  ["application_component", "technology_service",    "depends_on"],
  // Technology internal
  ["technology_node",       "technology_node",       "depends_on"],
  ["technology_node",       "technology_node",       "composed_of"],
  ["device",                "system_software",       "composed_of"],
  ["device",                "communication_network", "depends_on"],
  // Application internal
  ["application_component", "application_component", "composed_of"],
  ["application_component", "application_service",   "serves"],
  ["application_component", "data_object",           "accesses"],
  // Business internal
  ["business_actor",        "business_role",         "assigned_to"],
  ["business_capability",   "business_capability",   "associated_with"],
  ["business_capability",   "business_capability",   "composed_of"],
  ["value_stream",          "value_stream_stage",    "composed_of"],
  ["value_stream",          "business_capability",   "associated_with"],
  // Motivation → Strategy / Business
  ["goal",                  "business_capability",   "influences"],
  ["goal",                  "capability",            "influences"],
  ["requirement",           "application_component", "influences"],
  ["requirement",           "business_capability",   "influences"],
  ["constraint",            "application_component", "influences"],
  ["driver",                "goal",                  "influences"],
  ["stakeholder",           "driver",                "associated_with"],
  ["principle",             "goal",                  "influences"],
  // Implementation & Migration
  ["work_package",          "goal",                  "associated_with"],
  ["work_package",          "deliverable",           "associated_with"],
  ["plateau",               "business_capability",   "associated_with"],
  ["gap",                   "plateau",               "associated_with"],
  // Phase EA-2: Application behaviour rules
  ["application_function",    "application_component", "composed_of"],
  ["application_interaction", "application_component", "composed_of"],
  ["application_function",    "application_service",   "serves"],
  ["business_process",        "business_capability",   "realizes"],
  ["business_service",        "business_capability",   "realizes"],
  // Digital Product (EA-DP spec)
  ["digital_product", "business_actor",        "serves"],
  ["digital_product", "business_role",         "serves"],
  ["digital_product", "application_component", "composed_of"],
  ["digital_product", "technology_node",       "composed_of"],
  ["digital_product", "digital_product",       "composed_of"],
  ["digital_product", "digital_product",       "depends_on"],
  ["digital_product", "technology_node",       "depends_on"],
  ["digital_product", "business_actor",        "assigned_to"],
  ["digital_product", "business_role",         "assigned_to"],
  ["digital_product", "value_stream",          "associated_with"],
  ["digital_product", "capability",            "associated_with"],
  ["technology_service", "digital_product",    "serves"],
  // Phase EA-2 bridges to Digital Product
  ["digital_product", "business_service",      "realizes"],
  ["digital_product", "application_service",   "realizes"],
  ["digital_product", "application_function",  "composed_of"],
  ["digital_product", "information_object",    "accesses"],
  ["digital_product", "ea_control",            "associated_with"],
  // Service Offering
  ["digital_product",  "service_offering",   "realizes"],
  ["service_offering", "business_actor",     "serves"],
  ["service_offering", "contract",           "associated_with"],
  // Information Object / Governance
  ["information_object", "ea_control",         "associated_with"],
  ["information_object", "event_evidence",     "realizes"],
  ["ea_control",         "event_evidence",     "associated_with"],
  ["ea_control",         "digital_product",    "influences"],
  ["ea_control",         "information_object", "influences"],
  // Event/Evidence terminals (required for governance_audit traversal pattern)
  ["event_evidence", "business_actor",  "associated_with"],
  ["event_evidence", "ai_coworker",     "associated_with"],
  // AI Coworker
  ["ai_coworker", "digital_product",       "associated_with"],
  ["ai_coworker", "application_component", "realizes"],
  ["ai_coworker", "business_role",         "assigned_to"],
  ["ai_coworker", "ea_control",            "associated_with"],
  ["ai_coworker", "event_evidence",        "associated_with"],
  ["business_actor", "ai_coworker",        "associated_with"],
];

// ─── DQ stage-gate rules ──────────────────────────────────────────────────────

type DqRuleDef = {
  elementTypeSlug: string;
  name: string;
  description: string;
  lifecycleStage: string;
  severity: "error" | "warn";
  rule: Prisma.InputJsonValue;
};

const DQ_RULES: DqRuleDef[] = [
  {
    elementTypeSlug: "application_component",
    name: "ApplicationComponent must realize a BusinessCapability before design",
    description: "An Application Component must be linked to a Business Capability via Realizes before entering the design stage",
    lifecycleStage: "design",
    severity: "error",
    rule: { requires: { relationshipType: "realizes", toElementType: "business_capability", minCount: 1 } },
  },
  {
    elementTypeSlug: "application_component",
    name: "ApplicationComponent must bridge to a DigitalProduct before build",
    description: "An Application Component must be linked to a DigitalProduct (the operational manifestation) before entering build",
    lifecycleStage: "build",
    severity: "error",
    rule: { requires: { bridge: "digitalProductId" } },
  },
  {
    elementTypeSlug: "application_component",
    name: "Collision: multiple design-stage elements bridging same DigitalProduct",
    description: "Two or more ApplicationComponents in design stage reference the same DigitalProduct — possible change programme collision",
    lifecycleStage: "build",
    severity: "warn",
    rule: { warns: { duplicateBridge: { lifecycleStage: "design", maxCount: 1 } } },
  },
  {
    elementTypeSlug: "application_component",
    name: "ApplicationComponent must depend on a TechnologyNode before production",
    description: "An Application Component must have at least one TechnologyNode dependency before entering production",
    lifecycleStage: "production",
    severity: "error",
    rule: { requires: { relationshipType: "depends_on", toElementType: "technology_node", minCount: 1 } },
  },
  // Ontology-extension DQ rules
  {
    elementTypeSlug: "digital_product",
    name: "DigitalProduct must realize a ServiceOffering or BusinessService before production",
    description: "A Digital Product must be linked to a ServiceOffering or BusinessService via Realizes before entering production",
    lifecycleStage: "production",
    severity: "error",
    rule: { requires: { relationshipType: "realizes", toElementTypeOneOf: ["service_offering", "business_service"], minCount: 1 } },
  },
  {
    elementTypeSlug: "service_offering",
    name: "ServiceOffering must be realized by a DigitalProduct before production",
    description: "A Service Offering must be realized by at least one Digital Product before entering production",
    lifecycleStage: "production",
    severity: "error",
    rule: { requires: { relationshipType: "realizes", fromElementType: "digital_product", minCount: 1, direction: "inbound" } },
  },
  {
    elementTypeSlug: "information_object",
    name: "InformationObject should have a governing Control before production",
    description: "An Information Object should be linked to a Control via associated_with before entering production",
    lifecycleStage: "production",
    severity: "warn",
    rule: { requires: { relationshipType: "associated_with", toElementType: "ea_control", minCount: 1 } },
  },
  {
    elementTypeSlug: "ai_coworker",
    name: "AiCoworker must have a BusinessRole and Control before production",
    description: "An AI Coworker must be assigned_to a BusinessRole and associated_with at least one Control before entering production",
    lifecycleStage: "production",
    severity: "error",
    rule: { requires: [
      { relationshipType: "assigned_to", toElementType: "business_role", minCount: 1 },
      { relationshipType: "associated_with", toElementType: "ea_control", minCount: 1 },
    ]},
  },
  {
    elementTypeSlug: "ea_control",
    name: "Control should have at least one EventEvidence before production",
    description: "A Control should be associated with at least one Event/Evidence record before entering production",
    lifecycleStage: "production",
    severity: "warn",
    rule: { requires: { relationshipType: "associated_with", toElementType: "event_evidence", minCount: 1 } },
  },
];

// ─── Framework mapping seed ───────────────────────────────────────────────────

type MappingDef = {
  elementTypeSlug: string;
  frameworkSlug: string;
  nativeConceptName: string;
  mappingType: string;
  semanticDisparity?: string;
  influenceOpportunity?: string;
  exchangeOpportunity?: boolean;
};

const FRAMEWORK_MAPPINGS: MappingDef[] = [
  // ── digital_product ──────────────────────────────────────────────────────
  { elementTypeSlug: "digital_product", frameworkSlug: "archimate4",  nativeConceptName: "Application Component",     mappingType: "approximate", semanticDisparity: "Loses business context, value proposition, portfolio position",              influenceOpportunity: "Add Product specialisation spanning business + application layers",          exchangeOpportunity: true },
  { elementTypeSlug: "digital_product", frameworkSlug: "csdm5",       nativeConceptName: "Business Application",      mappingType: "partial",     semanticDisparity: "Loses lifecycle richness, portfolio partitioning, offer semantics",           influenceOpportunity: "CSDM 6: elevate to first-class entity",                                     exchangeOpportunity: false },
  { elementTypeSlug: "digital_product", frameworkSlug: "csdm6",       nativeConceptName: "Digital Product",           mappingType: "exact",       semanticDisparity: undefined,                                                                   influenceOpportunity: "This platform is the reference implementation",                             exchangeOpportunity: true },
  { elementTypeSlug: "digital_product", frameworkSlug: "it4it_v3",    nativeConceptName: "Digital Product (backbone)", mappingType: "partial",     semanticDisparity: "Treated as attribute of value streams, not a persistent governed entity",     influenceOpportunity: "Use as stable cross-stream anchor with full identity",                       exchangeOpportunity: true },
  { elementTypeSlug: "digital_product", frameworkSlug: "itil5",       nativeConceptName: "Digital Product",           mappingType: "partial",     semanticDisparity: "Conceptual only — no data model defined",                                   influenceOpportunity: "Push persistent entity with lifecycle and governed data",                    exchangeOpportunity: false },
  { elementTypeSlug: "digital_product", frameworkSlug: "togaf",       nativeConceptName: "Application Building Block", mappingType: "approximate", semanticDisparity: "ADM outputs not product-anchored by default",                               influenceOpportunity: "Reinterpret ADM phases through Digital Product traceability",                exchangeOpportunity: false },
  { elementTypeSlug: "digital_product", frameworkSlug: "cobit",       nativeConceptName: "IT-related Asset",          mappingType: "approximate", semanticDisparity: "Governance focus; no product realization path",                              influenceOpportunity: "Map control objectives to product evidence paths",                           exchangeOpportunity: false },
  { elementTypeSlug: "digital_product", frameworkSlug: "dora",        nativeConceptName: "ICT Service",               mappingType: "approximate", semanticDisparity: "Regulatory obligations explicit; product identity indirect",                  influenceOpportunity: "Tie resilience evidence to Digital Product as the unit",                    exchangeOpportunity: false },
  { elementTypeSlug: "digital_product", frameworkSlug: "apqc",        nativeConceptName: "Product / Service",         mappingType: "approximate", semanticDisparity: "Process taxonomy can overtake product identity",                             influenceOpportunity: "Use as scaffolding beneath product semantics",                              exchangeOpportunity: false },
  { elementTypeSlug: "digital_product", frameworkSlug: "tbm",         nativeConceptName: "Service",                   mappingType: "approximate", semanticDisparity: "Cost paths strong; lifecycle and identity secondary",                         influenceOpportunity: "Connect cost allocation to product realization directly",                    exchangeOpportunity: false },
  { elementTypeSlug: "digital_product", frameworkSlug: "tm_forum",    nativeConceptName: "Product",                   mappingType: "partial",     semanticDisparity: "Sector-shaped labels; versioned catalog semantics",                          influenceOpportunity: "Adopt Digital Product as cross-domain anchor",                              exchangeOpportunity: true },
  { elementTypeSlug: "digital_product", frameworkSlug: "bian",        nativeConceptName: "Business Capability area",  mappingType: "approximate", semanticDisparity: "Domain taxonomy does not convey lifecycle semantics",                         influenceOpportunity: "Import sector taxonomy; retain ontology refinement rules",                   exchangeOpportunity: false },
  // ── service_offering ─────────────────────────────────────────────────────
  { elementTypeSlug: "service_offering", frameworkSlug: "archimate4",  nativeConceptName: "Product (business layer)",      mappingType: "partial",     semanticDisparity: "Business-layer only; no realization path to Digital Product",              influenceOpportunity: "Strengthen Product → Application realization semantics",                    exchangeOpportunity: true },
  { elementTypeSlug: "service_offering", frameworkSlug: "csdm5",       nativeConceptName: "Service Offering / Business Service", mappingType: "partial", semanticDisparity: "Offer and product conflated; no formal realization link",              influenceOpportunity: "Separate offer from product; add realization FK",                           exchangeOpportunity: false },
  { elementTypeSlug: "service_offering", frameworkSlug: "it4it_v3",    nativeConceptName: "Service Model / Offer",         mappingType: "partial",     semanticDisparity: "Offer semantics exist in Release stream; not anchored to product identity", influenceOpportunity: "Tie offer lifecycle to Digital Product Backbone",                           exchangeOpportunity: true },
  { elementTypeSlug: "service_offering", frameworkSlug: "itil5",       nativeConceptName: "Service Offering",              mappingType: "exact",       semanticDisparity: "Well-defined; lacks realization link to Digital Product",                 influenceOpportunity: "Add formal product → offer realization in v5 data model",                   exchangeOpportunity: false },
  { elementTypeSlug: "service_offering", frameworkSlug: "togaf",       nativeConceptName: "Service",                      mappingType: "approximate", semanticDisparity: "Architectural abstractions, not managed offerings",                       influenceOpportunity: "Frame service design output as an offer realized by a product",             exchangeOpportunity: false },
  { elementTypeSlug: "service_offering", frameworkSlug: "tm_forum",    nativeConceptName: "Product Offering",             mappingType: "partial",     semanticDisparity: "Industry-specific layering valuable; catalog versioning differs",          influenceOpportunity: "Preserve TM Forum layering as an overlay on platform offers",               exchangeOpportunity: true },
  { elementTypeSlug: "service_offering", frameworkSlug: "bian",        nativeConceptName: "Service Domain",               mappingType: "approximate", semanticDisparity: "Domain-level granularity; no offer lifecycle",                            influenceOpportunity: "Import domain taxonomy as offer classification",                            exchangeOpportunity: false },
  // ── information_object ───────────────────────────────────────────────────
  { elementTypeSlug: "information_object", frameworkSlug: "archimate4",  nativeConceptName: "Business Object",        mappingType: "partial",     semanticDisparity: "No governance obligations or evidence requirements",                      influenceOpportunity: "Add obligation-bearing semantics to Business Object",                       exchangeOpportunity: true },
  { elementTypeSlug: "information_object", frameworkSlug: "csdm5",       nativeConceptName: "Data Classification",    mappingType: "partial",     semanticDisparity: "Classification exists; governed obligation path weak",                     influenceOpportunity: "Add evidence and control linkage to data classes",                          exchangeOpportunity: false },
  { elementTypeSlug: "information_object", frameworkSlug: "it4it_v3",    nativeConceptName: "Information Object",     mappingType: "partial",     semanticDisparity: "Present in value streams; no persistent governed-data semantics",           influenceOpportunity: "Make information objects obligation-bearing across streams",                exchangeOpportunity: true },
  { elementTypeSlug: "information_object", frameworkSlug: "itil5",       nativeConceptName: "Information",            mappingType: "approximate", semanticDisparity: "Referenced in practices; no formal governed-data model",                   influenceOpportunity: "Push governed data class with control and evidence links",                  exchangeOpportunity: false },
  { elementTypeSlug: "information_object", frameworkSlug: "cobit",       nativeConceptName: "Information",            mappingType: "partial",     semanticDisparity: "Governance-rich; product realization path missing",                        influenceOpportunity: "Map information governance to product-centric evidence paths",               exchangeOpportunity: true },
  { elementTypeSlug: "information_object", frameworkSlug: "dora",        nativeConceptName: "Data",                   mappingType: "partial",     semanticDisparity: "Regulatory obligations explicit; product anchor indirect",                  influenceOpportunity: "Use information object as unit tying data to product resilience",           exchangeOpportunity: false },
  { elementTypeSlug: "information_object", frameworkSlug: "togaf",       nativeConceptName: "Data Entity",            mappingType: "partial",     semanticDisparity: "Data modeling present; obligation and evidence semantics absent",          influenceOpportunity: "Extend data entities with governance obligation layer",                      exchangeOpportunity: false },
  // ── ea_control ───────────────────────────────────────────────────────────
  { elementTypeSlug: "ea_control", frameworkSlug: "archimate4",  nativeConceptName: "Constraint",          mappingType: "approximate", semanticDisparity: "Constraint is a restriction, not a control with evidence requirements",    influenceOpportunity: "Add Control as a distinct motivation-layer concept",                        exchangeOpportunity: true },
  { elementTypeSlug: "ea_control", frameworkSlug: "csdm5",       nativeConceptName: "(not modeled)",       mappingType: "no_equivalent", semanticDisparity: "Completely absent — controls implicit in workflows",                    influenceOpportunity: "Introduce Control as a CSDM 6 first-class entity",                         exchangeOpportunity: false },
  { elementTypeSlug: "ea_control", frameworkSlug: "it4it_v3",    nativeConceptName: "Control",             mappingType: "partial",     semanticDisparity: "Present but not linked to product-centric evidence paths",               influenceOpportunity: "Anchor controls to Digital Product lifecycle gates",                        exchangeOpportunity: true },
  { elementTypeSlug: "ea_control", frameworkSlug: "itil5",       nativeConceptName: "Control",             mappingType: "partial",     semanticDisparity: "Referenced in governance practices; no formal data model",               influenceOpportunity: "Push control entity with evidence obligation semantics",                    exchangeOpportunity: false },
  { elementTypeSlug: "ea_control", frameworkSlug: "cobit",       nativeConceptName: "Control Objective",   mappingType: "partial",     semanticDisparity: "Intent is exact; operational evidence path underspecified",               influenceOpportunity: "Map control objectives to product evidence and audit paths",                exchangeOpportunity: true },
  { elementTypeSlug: "ea_control", frameworkSlug: "dora",        nativeConceptName: "Control Measure",     mappingType: "partial",     semanticDisparity: "Regulatory control explicit; product identity link indirect",            influenceOpportunity: "Use Digital Product as the unit control measures apply to",                 exchangeOpportunity: false },
  { elementTypeSlug: "ea_control", frameworkSlug: "togaf",       nativeConceptName: "Constraint / Principle", mappingType: "approximate", semanticDisparity: "No evidence requirement semantics",                                 influenceOpportunity: "Connect architecture principles to implemented controls with evidence",      exchangeOpportunity: false },
  // ── event_evidence ───────────────────────────────────────────────────────
  { elementTypeSlug: "event_evidence", frameworkSlug: "archimate4",  nativeConceptName: "Business Event",       mappingType: "approximate", semanticDisparity: "Events are triggers, not evidence artifacts",                          influenceOpportunity: "Add Evidence as a distinct implementation-layer concept",                   exchangeOpportunity: true },
  { elementTypeSlug: "event_evidence", frameworkSlug: "csdm5",       nativeConceptName: "Audit Record",          mappingType: "approximate", semanticDisparity: "Audit records exist; not linked to product identity or controls",       influenceOpportunity: "Connect audit records to Digital Product and Control",                      exchangeOpportunity: false },
  { elementTypeSlug: "event_evidence", frameworkSlug: "it4it_v3",    nativeConceptName: "Event",                 mappingType: "partial",     semanticDisparity: "Events in Operate stream; no formal evidence semantics",               influenceOpportunity: "Promote event to evidence artifact with control linkage",                   exchangeOpportunity: true },
  { elementTypeSlug: "event_evidence", frameworkSlug: "itil5",       nativeConceptName: "Event / Record",        mappingType: "partial",     semanticDisparity: "Well-understood operationally; no governed evidence data model",        influenceOpportunity: "Push evidence model with timeliness and completeness obligations",           exchangeOpportunity: false },
  { elementTypeSlug: "event_evidence", frameworkSlug: "cobit",       nativeConceptName: "Evidence",              mappingType: "partial",     semanticDisparity: "Evidence concept exists for audit; product path weak",                 influenceOpportunity: "Connect evidence to Digital Product realization and control",                exchangeOpportunity: true },
  { elementTypeSlug: "event_evidence", frameworkSlug: "dora",        nativeConceptName: "Evidence Obligation",   mappingType: "partial",     semanticDisparity: "Explicit timeliness requirements; product unit indirect",             influenceOpportunity: "Use Digital Product as evidence-bearing unit for DORA reporting",            exchangeOpportunity: false },
  { elementTypeSlug: "event_evidence", frameworkSlug: "togaf",       nativeConceptName: "(not modeled)",         mappingType: "no_equivalent", semanticDisparity: "No evidence or audit concept in architecture artifacts",            influenceOpportunity: "Introduce evidence as output of ADM phases",                               exchangeOpportunity: false },
  // ── ai_coworker ──────────────────────────────────────────────────────────
  { elementTypeSlug: "ai_coworker", frameworkSlug: "archimate4",  nativeConceptName: "Application Component",  mappingType: "approximate",   semanticDisparity: "Loses actor identity, oversight model, RBAC constraints, product/actor duality",  influenceOpportunity: "Define AI Agent specialisation spanning application + motivation layers",   exchangeOpportunity: true },
  { elementTypeSlug: "ai_coworker", frameworkSlug: "csdm5",       nativeConceptName: "(not modeled)",          mappingType: "no_equivalent", semanticDisparity: "Completely absent",                                                                influenceOpportunity: "Introduce AI Coworker as a CSDM 6 first-class entity",                     exchangeOpportunity: false },
  { elementTypeSlug: "ai_coworker", frameworkSlug: "it4it_v3",    nativeConceptName: "(not modeled)",          mappingType: "no_equivalent", semanticDisparity: "AI agents not addressed in value stream model",                                    influenceOpportunity: "Add AI Coworker as a value-stream participant with governed identity",      exchangeOpportunity: false },
  { elementTypeSlug: "ai_coworker", frameworkSlug: "itil5",       nativeConceptName: "(not modeled)",          mappingType: "no_equivalent", semanticDisparity: "Service account / automation only",                                               influenceOpportunity: "Push AI agent identity into ITIL v5 practice areas",                       exchangeOpportunity: false },
  { elementTypeSlug: "ai_coworker", frameworkSlug: "cobit",       nativeConceptName: "(not modeled)",          mappingType: "no_equivalent", semanticDisparity: "No AI actor model",                                                                influenceOpportunity: "Extend control objectives to cover AI coworker authorization",              exchangeOpportunity: false },
  { elementTypeSlug: "ai_coworker", frameworkSlug: "dora",        nativeConceptName: "(not modeled)",          mappingType: "no_equivalent", semanticDisparity: "Resilience framework does not address autonomous AI agents",                       influenceOpportunity: "Include AI coworker scope in resilience evidence obligations",              exchangeOpportunity: false },
  { elementTypeSlug: "ai_coworker", frameworkSlug: "togaf",       nativeConceptName: "(not modeled)",          mappingType: "no_equivalent", semanticDisparity: "No AI agent concept in architecture artifacts",                                    influenceOpportunity: "Platform is the reference implementation for all frameworks",               exchangeOpportunity: false },
  { elementTypeSlug: "ai_coworker", frameworkSlug: "tm_forum",    nativeConceptName: "(not modeled)",          mappingType: "no_equivalent", semanticDisparity: "Universal gap across all surveyed frameworks",                                     influenceOpportunity: "Platform is the reference implementation for all frameworks",               exchangeOpportunity: false },
  { elementTypeSlug: "ai_coworker", frameworkSlug: "bian",        nativeConceptName: "(not modeled)",          mappingType: "no_equivalent", semanticDisparity: "Universal gap across all surveyed frameworks",                                     influenceOpportunity: "Platform is the reference implementation for all frameworks",               exchangeOpportunity: false },
];

// ─── Traversal patterns ───────────────────────────────────────────────────────

type PatternDef = {
  slug: string;
  name: string;
  description: string;
  patternType: string;
  steps: object[];
  forbiddenShortcuts: string[];
};

const TRAVERSAL_PATTERNS: PatternDef[] = [
  {
    slug: "blast_radius",
    name: "Software Supply-Chain Blast Radius",
    description: "Trace a vulnerable package or component through actual dependencies to Digital Products, offers, and consumers.",
    patternType: "blast_radius",
    steps: [
      { elementTypeSlugs: ["artifact", "technology_node"], refinementLevel: "actual", relationshipTypeSlugs: ["depends_on", "composed_of"], direction: "outbound" },
      { elementTypeSlugs: ["application_component"],       refinementLevel: null,     relationshipTypeSlugs: ["realizes"],                  direction: "inbound" },
      { elementTypeSlugs: ["digital_product"],             refinementLevel: null,     relationshipTypeSlugs: ["realizes"],                  direction: "outbound" },
      { elementTypeSlugs: ["service_offering"],            refinementLevel: null,     relationshipTypeSlugs: ["serves"],                    direction: "outbound" },
      { elementTypeSlugs: ["business_actor"],              refinementLevel: null,     relationshipTypeSlugs: [],                            direction: "terminal" },
    ],
    forbiddenShortcuts: [
      "Do not traverse conceptual elements as actual deployed dependencies",
      "Do not assume all paths through a shared platform component imply equal customer impact",
      "Do not conflate composed_of (structural) with depends_on (runtime) when estimating blast radius",
    ],
  },
  {
    slug: "governance_audit",
    name: "Information Governance and Audit Evidence",
    description: "Trace an information object through its governing controls to evidence and responsible actors.",
    patternType: "governance_audit",
    steps: [
      { elementTypeSlugs: ["information_object"],                refinementLevel: null,     relationshipTypeSlugs: ["associated_with"], direction: "outbound" },
      { elementTypeSlugs: ["ea_control"],                         refinementLevel: null,     relationshipTypeSlugs: ["associated_with"], direction: "outbound" },
      { elementTypeSlugs: ["event_evidence"],                     refinementLevel: "actual", relationshipTypeSlugs: ["associated_with"], direction: "outbound" },
      { elementTypeSlugs: ["business_actor", "ai_coworker"],      refinementLevel: null,     relationshipTypeSlugs: [],                 direction: "terminal" },
    ],
    forbiddenShortcuts: [
      "Any path from control to a record is not audit proof unless it passes through event_evidence with actual refinement level",
      "Do not traverse associated_with generically — must follow the full control → event_evidence chain",
    ],
  },
  {
    slug: "architecture_traceability",
    name: "Architecture to Operations Traceability",
    description: "Trace from a requirement or architecture concern through logical design to actual product realization and evidence.",
    patternType: "architecture_traceability",
    steps: [
      { elementTypeSlugs: ["requirement", "constraint", "principle"], refinementLevel: "conceptual", relationshipTypeSlugs: ["influences"],      direction: "outbound" },
      { elementTypeSlugs: ["application_component", "application_function"], refinementLevel: "logical", relationshipTypeSlugs: ["realizes"],  direction: "outbound" },
      { elementTypeSlugs: ["digital_product"],                       refinementLevel: null,           relationshipTypeSlugs: ["associated_with"], direction: "outbound" },
      { elementTypeSlugs: ["event_evidence"],                        refinementLevel: "actual",       relationshipTypeSlugs: [],                 direction: "terminal" },
    ],
    forbiddenShortcuts: [
      "Do not jump from a conceptual requirement directly to actual evidence without a logical design element",
      "realizes is not proof of deployment — logical realization is not the same as actual production",
    ],
  },
  {
    slug: "ai_oversight",
    name: "AI Coworker Authority and Oversight",
    description: "Trace AI coworker identity through authorization controls to permitted action scope and supervising humans.",
    patternType: "ai_oversight",
    steps: [
      { elementTypeSlugs: ["ai_coworker"],                   refinementLevel: null, relationshipTypeSlugs: ["associated_with"], direction: "outbound" },
      { elementTypeSlugs: ["ea_control"],                     refinementLevel: null, relationshipTypeSlugs: ["influences"],      direction: "outbound" },
      { elementTypeSlugs: ["digital_product", "resource"],   refinementLevel: null, relationshipTypeSlugs: ["associated_with"], direction: "inbound" },
      { elementTypeSlugs: ["business_actor"],                 refinementLevel: null, relationshipTypeSlugs: [],                 direction: "terminal" },
    ],
    forbiddenShortcuts: [
      "Do not use broad actor adjacency to infer oversight — supervision requires an explicit business_actor → ai_coworker edge",
      "Do not assume every ai_coworker → digital_product association implies authority to modify the product",
    ],
  },
  {
    slug: "cost_rollup",
    name: "Cost and Investment Allocation",
    description: "Trace cost sources through capabilities and shared services to Digital Products and portfolios.",
    patternType: "cost_rollup",
    steps: [
      { elementTypeSlugs: ["resource"],                              refinementLevel: "actual", relationshipTypeSlugs: ["assigned_to", "composed_of"],  direction: "outbound" },
      { elementTypeSlugs: ["capability", "business_service"],        refinementLevel: null,     relationshipTypeSlugs: ["realizes", "associated_with"],  direction: "outbound" },
      { elementTypeSlugs: ["digital_product"],                       refinementLevel: null,     relationshipTypeSlugs: [],                               direction: "terminal" },
    ],
    forbiddenShortcuts: [
      "Do not assume shared platform cost equals Digital Product cost without an explicit allocation basis",
      "Do not roll up costs through composed_of across portfolio boundaries without allocation rules",
    ],
  },
  {
    slug: "ma_separation",
    name: "M&A and Divestiture Separability",
    description: "Determine what moves together versus what can be separated — products, dependencies, information obligations, and customer commitments.",
    patternType: "ma_separation",
    steps: [
      { elementTypeSlugs: ["digital_product"],                                              refinementLevel: null, relationshipTypeSlugs: ["composed_of", "depends_on"], direction: "either" },
      { elementTypeSlugs: ["digital_product", "application_component", "technology_node"], refinementLevel: null, relationshipTypeSlugs: ["accesses"],                  direction: "outbound" },
      { elementTypeSlugs: ["information_object"],                                           refinementLevel: null, relationshipTypeSlugs: ["associated_with"],            direction: "outbound" },
      { elementTypeSlugs: ["contract"],                                                     refinementLevel: null, relationshipTypeSlugs: ["serves"],                    direction: "inbound" },
      { elementTypeSlugs: ["business_actor"],                                               refinementLevel: null, relationshipTypeSlugs: [],                            direction: "terminal" },
    ],
    forbiddenShortcuts: [
      "Do not assume shared technology_node dependencies can be cleanly separated without operational evidence",
      "Do not conflate customer-facing service_offering with enabling business_service — both must be traced separately",
      "Shared information_object obligations travel with the product unless a control explicitly releases them",
    ],
  },
  {
    slug: "service_customer_impact",
    name: "Service and Customer Impact",
    description: "Trace product degradation through offers and SLAs to customer impact, including downstream consuming products.",
    patternType: "service_customer_impact",
    steps: [
      { elementTypeSlugs: ["digital_product"],  refinementLevel: null, relationshipTypeSlugs: ["realizes"], direction: "outbound" },
      { elementTypeSlugs: ["service_offering"], refinementLevel: null, relationshipTypeSlugs: ["serves"],   direction: "outbound" },
      { elementTypeSlugs: ["business_actor"],   refinementLevel: null, relationshipTypeSlugs: [],           direction: "terminal" },
    ],
    forbiddenShortcuts: [
      "Do not assume all business_actor nodes linked to a product are impacted customers — distinguish consumers from managers",
      "Do not traverse associated_with into motivation layer elements when calculating consumer impact",
    ],
  },
];

// ─── Seed function ────────────────────────────────────────────────────────────

export async function seedEaArchimate4(): Promise<void> {
  // 1. Upsert notation
  const notation = await prisma.eaNotation.upsert({
    where:  { slug: "archimate4" },
    update: { name: "ArchiMate 4", version: "4.0" },
    create: { slug: "archimate4", name: "ArchiMate 4", version: "4.0" },
  });
  console.log(`Seeded EaNotation: ${notation.slug}`);

  // 2. Upsert element types
  const etMap = new Map<string, string>(); // slug → id
  for (const et of ELEMENT_TYPES) {
    const record = await prisma.eaElementType.upsert({
      where:  { notationId_slug: { notationId: notation.id, slug: et.slug } },
      update: {
        name: et.name, neoLabel: et.neoLabel, domain: et.domain,
        description: et.description ?? null,
        validLifecycleStages: et.stages, validLifecycleStatuses: et.statuses,
        isExtension: et.isExtension ?? false,
        archimateExportSlug: et.archimateExportSlug ?? null,
        ontologyCategory: et.ontologyCategory ?? null,
      },
      create: {
        notationId: notation.id, slug: et.slug, name: et.name,
        neoLabel: et.neoLabel, domain: et.domain,
        description: et.description ?? null,
        validLifecycleStages: et.stages, validLifecycleStatuses: et.statuses,
        isExtension: et.isExtension ?? false,
        archimateExportSlug: et.archimateExportSlug ?? null,
        ontologyCategory: et.ontologyCategory ?? null,
      },
    });
    etMap.set(et.slug, record.id);
  }
  console.log(`Seeded ${ELEMENT_TYPES.length} EaElementTypes`);

  // 3. Upsert relationship types
  const rtMap = new Map<string, string>(); // slug → id
  for (const rt of REL_TYPES) {
    const record = await prisma.eaRelationshipType.upsert({
      where:  { notationId_slug: { notationId: notation.id, slug: rt.slug } },
      update: { name: rt.name, neoType: rt.neoType, description: rt.description ?? null },
      create: { notationId: notation.id, slug: rt.slug, name: rt.name, neoType: rt.neoType, description: rt.description ?? null },
    });
    rtMap.set(rt.slug, record.id);
  }
  console.log(`Seeded ${REL_TYPES.length} EaRelationshipTypes`);

  // 4. Upsert relationship rules
  for (const [fromSlug, toSlug, relSlug] of RULES) {
    const fromId = etMap.get(fromSlug);
    const toId   = etMap.get(toSlug);
    const relId  = rtMap.get(relSlug);
    if (!fromId || !toId || !relId) {
      console.warn(`Skipping rule ${fromSlug} -[${relSlug}]-> ${toSlug}: slug not found`);
      continue;
    }
    await prisma.eaRelationshipRule.upsert({
      where: { fromElementTypeId_toElementTypeId_relationshipTypeId: { fromElementTypeId: fromId, toElementTypeId: toId, relationshipTypeId: relId } },
      update: {},
      create: { fromElementTypeId: fromId, toElementTypeId: toId, relationshipTypeId: relId },
    });
  }
  console.log(`Seeded ${RULES.length} EaRelationshipRules`);

  // 5. Upsert DQ rules
  for (const dq of DQ_RULES) {
    const etId = etMap.get(dq.elementTypeSlug);
    if (!etId) {
      console.warn(`Skipping DQ rule "${dq.name}": element type "${dq.elementTypeSlug}" not found`);
      continue;
    }
    const existing = await prisma.eaDqRule.findFirst({
      where: { notationId: notation.id, elementTypeId: etId, name: dq.name },
    });
    if (existing) {
      await prisma.eaDqRule.update({
        where: { id: existing.id },
        data: { description: dq.description, lifecycleStage: dq.lifecycleStage, severity: dq.severity, rule: dq.rule },
      });
    } else {
      await prisma.eaDqRule.create({
        data: {
          notationId: notation.id, elementTypeId: etId, name: dq.name,
          description: dq.description, lifecycleStage: dq.lifecycleStage,
          severity: dq.severity, rule: dq.rule,
        },
      });
    }
  }
  console.log(`Seeded ${DQ_RULES.length} EaDqRules`);

  // 6. Framework mappings
  await seedEaFrameworkMappings(etMap);

  // 7. Traversal patterns
  await seedEaTraversalPatterns(notation.id);
}

async function seedEaFrameworkMappings(etMap: Map<string, string>): Promise<void> {
  for (const m of FRAMEWORK_MAPPINGS) {
    const etId = etMap.get(m.elementTypeSlug);
    if (!etId) {
      console.warn(`Skipping mapping ${m.elementTypeSlug}/${m.frameworkSlug}: type not found`);
      continue;
    }
    await prisma.eaFrameworkMapping.upsert({
      where:  { elementTypeId_frameworkSlug: { elementTypeId: etId, frameworkSlug: m.frameworkSlug } },
      update: {
        nativeConceptName: m.nativeConceptName, mappingType: m.mappingType,
        semanticDisparity: m.semanticDisparity ?? null,
        influenceOpportunity: m.influenceOpportunity ?? null,
        exchangeOpportunity: m.exchangeOpportunity ?? false,
      },
      create: {
        elementTypeId: etId, frameworkSlug: m.frameworkSlug,
        nativeConceptName: m.nativeConceptName, mappingType: m.mappingType,
        semanticDisparity: m.semanticDisparity ?? null,
        influenceOpportunity: m.influenceOpportunity ?? null,
        exchangeOpportunity: m.exchangeOpportunity ?? false,
      },
    });
  }
  console.log(`Seeded ${FRAMEWORK_MAPPINGS.length} EaFrameworkMappings`);
}

async function seedEaTraversalPatterns(notationId: string): Promise<void> {
  for (const p of TRAVERSAL_PATTERNS) {
    await prisma.eaTraversalPattern.upsert({
      where:  { notationId_slug: { notationId, slug: p.slug } },
      update: {
        name: p.name, description: p.description, patternType: p.patternType,
        steps: p.steps, forbiddenShortcuts: p.forbiddenShortcuts,
      },
      create: {
        notationId, slug: p.slug, name: p.name, description: p.description,
        patternType: p.patternType, steps: p.steps, forbiddenShortcuts: p.forbiddenShortcuts,
      },
    });
  }
  console.log(`Seeded ${TRAVERSAL_PATTERNS.length} EaTraversalPatterns`);
}
