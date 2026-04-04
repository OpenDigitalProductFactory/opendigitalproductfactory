// packages/db/src/seed-ea-bpmn20.ts
// BPMN 2.0 notation seed data.
// Adds one EaNotation, element types, relationship types, relationship rules,
// DQ stage-gate rules, and a bounded traversal pattern.
// Safe to re-run (upsert pattern throughout).
// Spec: docs/superpowers/specs/2026-04-03-value-stream-team-architecture-design.md

import { prisma } from "./client.js";
import type { Prisma } from "../generated/client/client";

// ─── Lifecycle constraint sets ────────────────────────────────────────────────

// Design-time only elements (gateways, events — behavioural abstractions)
const DESIGN_STAGES   = ["plan", "design", "production"];
const DESIGN_STATUSES = ["draft", "active"];

// Full lifecycle for executable / instance-bearing elements
const FULL_STAGES   = ["plan", "design", "build", "production", "retirement"];
const FULL_STATUSES = ["draft", "active", "inactive"];

// ─── Element type definitions ─────────────────────────────────────────────────

type ElementTypeDef = {
  slug: string;
  name: string;
  neoLabel: string;
  domain: string;
  description?: string;
  stages: string[];
  statuses: string[];
  isExtension?: boolean;
  archimateExportSlug?: string;
  ontologyCategory?: string;
};

const ELEMENT_TYPES: ElementTypeDef[] = [
  // ── Flow Objects (Activities) ─────────────────────────────────────────────
  { slug: "bpmn_process",            name: "Process",              neoLabel: "BPMN__Process",           domain: "process",     description: "Top-level process container — maps to ValueStreamTeam configuration",                  stages: FULL_STAGES,   statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "bpmn_sub_process",        name: "Sub-Process",          neoLabel: "BPMN__SubProcess",        domain: "process",     description: "Collapsible sub-process — maps to nested orchestrator scope",                          stages: FULL_STAGES,   statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "bpmn_task",               name: "Task",                 neoLabel: "BPMN__Task",              domain: "process",     description: "Generic atomic task (abstract base type)",                                             stages: FULL_STAGES,   statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "bpmn_user_task",          name: "User Task",            neoLabel: "BPMN__UserTask",          domain: "process",     description: "Human-performed task — maps to TaskNode with status awaiting_human",                   stages: FULL_STAGES,   statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "bpmn_service_task",       name: "Service Task",         neoLabel: "BPMN__ServiceTask",       domain: "process",     description: "Automated system task — maps to specialist agent dispatch",                            stages: FULL_STAGES,   statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "bpmn_send_task",          name: "Send Task",            neoLabel: "BPMN__SendTask",          domain: "process",     description: "Send message — maps to agent event bus emission",                                      stages: FULL_STAGES,   statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "bpmn_receive_task",       name: "Receive Task",         neoLabel: "BPMN__ReceiveTask",       domain: "process",     description: "Wait for message — maps to event bus subscription",                                    stages: FULL_STAGES,   statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "bpmn_script_task",        name: "Script Task",          neoLabel: "BPMN__ScriptTask",        domain: "process",     description: "Inline script execution — maps to run_sandbox_command",                                stages: FULL_STAGES,   statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "bpmn_business_rule_task", name: "Business Rule Task",   neoLabel: "BPMN__BusinessRuleTask",  domain: "process",     description: "Decision table evaluation — maps to gate check or DQ rule evaluation",                stages: FULL_STAGES,   statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "bpmn_manual_task",        name: "Manual Task",          neoLabel: "BPMN__ManualTask",        domain: "process",     description: "Off-platform human action — maps to approval request with notification",               stages: FULL_STAGES,   statuses: FULL_STATUSES,   ontologyCategory: "behavior" },
  { slug: "bpmn_call_activity",      name: "Call Activity",        neoLabel: "BPMN__CallActivity",      domain: "process",     description: "Invokes another process — maps to cross-value-stream delegation",                      stages: FULL_STAGES,   statuses: FULL_STATUSES,   ontologyCategory: "behavior" },

  // ── Events ────────────────────────────────────────────────────────────────
  { slug: "bpmn_start_event",              name: "Start Event",              neoLabel: "BPMN__StartEvent",              domain: "event", description: "Process initiation — maps to TaskRun creation",                              stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_end_event",                name: "End Event",                neoLabel: "BPMN__EndEvent",                domain: "event", description: "Process completion — maps to TaskRun completion",                             stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_intermediate_throw_event", name: "Intermediate Throw Event", neoLabel: "BPMN__IntermediateThrowEvent",  domain: "event", description: "Emit signal mid-process — maps to agent event bus emit",                     stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_intermediate_catch_event", name: "Intermediate Catch Event", neoLabel: "BPMN__IntermediateCatchEvent",  domain: "event", description: "Wait for signal mid-process — maps to event bus subscription with timeout",  stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_boundary_event",           name: "Boundary Event",           neoLabel: "BPMN__BoundaryEvent",           domain: "event", description: "Attached to task — error/timer/signal handling",                             stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_timer_event",              name: "Timer Event",              neoLabel: "BPMN__TimerEvent",              domain: "event", description: "Time-based trigger — maps to deployment window or calendar check",           stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_error_event",              name: "Error Event",              neoLabel: "BPMN__ErrorEvent",              domain: "event", description: "Error handling — maps to escalation path activation",                        stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_signal_event",             name: "Signal Event",             neoLabel: "BPMN__SignalEvent",             domain: "event", description: "Broadcast signal — maps to cross-build events",                              stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_message_event",            name: "Message Event",            neoLabel: "BPMN__MessageEvent",            domain: "event", description: "Point-to-point message — maps to PhaseHandoff document delivery",            stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },

  // ── Gateways ──────────────────────────────────────────────────────────────
  { slug: "bpmn_exclusive_gateway",   name: "Exclusive Gateway",   neoLabel: "BPMN__ExclusiveGateway",   domain: "gateway", description: "XOR — exactly one outgoing path chosen based on condition",                 stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_parallel_gateway",    name: "Parallel Gateway",    neoLabel: "BPMN__ParallelGateway",    domain: "gateway", description: "AND — all outgoing paths execute concurrently (fork/join)",                 stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_inclusive_gateway",   name: "Inclusive Gateway",   neoLabel: "BPMN__InclusiveGateway",   domain: "gateway", description: "OR — one or more outgoing paths may be taken based on conditions",          stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_event_based_gateway", name: "Event-Based Gateway", neoLabel: "BPMN__EventBasedGateway",  domain: "gateway", description: "Wait for first event among alternatives — race condition pattern",          stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },
  { slug: "bpmn_complex_gateway",     name: "Complex Gateway",     neoLabel: "BPMN__ComplexGateway",     domain: "gateway", description: "Custom merge condition — maps to review board consensus or custom logic",    stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "behavior" },

  // ── Participants & Swimlanes ──────────────────────────────────────────────
  { slug: "bpmn_pool", name: "Pool", neoLabel: "BPMN__Pool", domain: "participant", description: "Participant boundary (organisation or system) — maps to value stream boundary", stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "structure" },
  { slug: "bpmn_lane", name: "Lane", neoLabel: "BPMN__Lane", domain: "participant", description: "Role partition within a pool — maps to agent role or human role",                  stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "structure" },

  // ── Data Objects ──────────────────────────────────────────────────────────
  { slug: "bpmn_data_object", name: "Data Object", neoLabel: "BPMN__DataObject", domain: "data", description: "Data input/output — maps to PhaseHandoff or evidence artifact",       stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "information" },
  { slug: "bpmn_data_store",  name: "Data Store",  neoLabel: "BPMN__DataStore",  domain: "data", description: "Persistent data reference — maps to Prisma model or Qdrant collection", stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "information" },
  { slug: "bpmn_data_input",  name: "Data Input",  neoLabel: "BPMN__DataInput",  domain: "data", description: "Process input parameter — maps to build brief or user request",        stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "information" },
  { slug: "bpmn_data_output", name: "Data Output", neoLabel: "BPMN__DataOutput", domain: "data", description: "Process output artifact — maps to build artifact or release bundle",    stages: DESIGN_STAGES, statuses: DESIGN_STATUSES, ontologyCategory: "information" },
];

// ─── Relationship type definitions ────────────────────────────────────────────

type RelTypeDef = {
  slug: string;
  name: string;
  neoType: string;
  description?: string;
};

const REL_TYPES: RelTypeDef[] = [
  { slug: "sequence_flow",    name: "Sequence Flow",    neoType: "SEQUENCE_FLOW",    description: "Ordered execution flow between flow objects within a process" },
  { slug: "message_flow",     name: "Message Flow",     neoType: "MESSAGE_FLOW",     description: "Communication between participants (across pools)" },
  { slug: "association",      name: "Association",       neoType: "ASSOCIATED_WITH",  description: "Link between an artifact and a flow object" },
  { slug: "data_association", name: "Data Association",  neoType: "DATA_ASSOCIATION", description: "Data flow to or from an activity" },
  { slug: "default_flow",    name: "Default Flow",      neoType: "DEFAULT_FLOW",     description: "Default path from a gateway when no conditions match" },
  { slug: "conditional_flow", name: "Conditional Flow", neoType: "CONDITIONAL_FLOW", description: "Condition-guarded path from a gateway" },
];

// ─── Relationship rules ───────────────────────────────────────────────────────
// Each entry: [fromSlug, toSlug, relSlug]

type RuleDef = [string, string, string];

const RULES: RuleDef[] = [
  // ── Sequence flows (within process) ─────────────────────────────────────
  // Start events → activities/gateways
  ["bpmn_start_event",              "bpmn_task",               "sequence_flow"],
  ["bpmn_start_event",              "bpmn_user_task",          "sequence_flow"],
  ["bpmn_start_event",              "bpmn_service_task",       "sequence_flow"],
  ["bpmn_start_event",              "bpmn_script_task",        "sequence_flow"],
  ["bpmn_start_event",              "bpmn_business_rule_task", "sequence_flow"],
  ["bpmn_start_event",              "bpmn_manual_task",        "sequence_flow"],
  ["bpmn_start_event",              "bpmn_send_task",          "sequence_flow"],
  ["bpmn_start_event",              "bpmn_receive_task",       "sequence_flow"],
  ["bpmn_start_event",              "bpmn_sub_process",        "sequence_flow"],
  ["bpmn_start_event",              "bpmn_call_activity",      "sequence_flow"],
  ["bpmn_start_event",              "bpmn_exclusive_gateway",  "sequence_flow"],
  ["bpmn_start_event",              "bpmn_parallel_gateway",   "sequence_flow"],

  // Activities → activities/gateways/end events
  ["bpmn_task",                     "bpmn_task",               "sequence_flow"],
  ["bpmn_task",                     "bpmn_end_event",          "sequence_flow"],
  ["bpmn_task",                     "bpmn_exclusive_gateway",  "sequence_flow"],
  ["bpmn_task",                     "bpmn_parallel_gateway",   "sequence_flow"],
  ["bpmn_user_task",                "bpmn_user_task",          "sequence_flow"],
  ["bpmn_user_task",                "bpmn_service_task",       "sequence_flow"],
  ["bpmn_user_task",                "bpmn_end_event",          "sequence_flow"],
  ["bpmn_user_task",                "bpmn_exclusive_gateway",  "sequence_flow"],
  ["bpmn_user_task",                "bpmn_parallel_gateway",   "sequence_flow"],
  ["bpmn_service_task",             "bpmn_service_task",       "sequence_flow"],
  ["bpmn_service_task",             "bpmn_user_task",          "sequence_flow"],
  ["bpmn_service_task",             "bpmn_end_event",          "sequence_flow"],
  ["bpmn_service_task",             "bpmn_exclusive_gateway",  "sequence_flow"],
  ["bpmn_service_task",             "bpmn_parallel_gateway",   "sequence_flow"],
  ["bpmn_script_task",              "bpmn_end_event",          "sequence_flow"],
  ["bpmn_script_task",              "bpmn_service_task",       "sequence_flow"],
  ["bpmn_script_task",              "bpmn_exclusive_gateway",  "sequence_flow"],
  ["bpmn_business_rule_task",       "bpmn_exclusive_gateway",  "sequence_flow"],
  ["bpmn_business_rule_task",       "bpmn_end_event",          "sequence_flow"],
  ["bpmn_manual_task",              "bpmn_end_event",          "sequence_flow"],
  ["bpmn_manual_task",              "bpmn_service_task",       "sequence_flow"],
  ["bpmn_manual_task",              "bpmn_exclusive_gateway",  "sequence_flow"],
  ["bpmn_send_task",                "bpmn_end_event",          "sequence_flow"],
  ["bpmn_send_task",                "bpmn_receive_task",       "sequence_flow"],
  ["bpmn_receive_task",             "bpmn_service_task",       "sequence_flow"],
  ["bpmn_receive_task",             "bpmn_end_event",          "sequence_flow"],
  ["bpmn_sub_process",              "bpmn_end_event",          "sequence_flow"],
  ["bpmn_sub_process",              "bpmn_service_task",       "sequence_flow"],
  ["bpmn_sub_process",              "bpmn_exclusive_gateway",  "sequence_flow"],
  ["bpmn_call_activity",            "bpmn_end_event",          "sequence_flow"],
  ["bpmn_call_activity",            "bpmn_service_task",       "sequence_flow"],

  // Gateways → activities/events/gateways
  ["bpmn_exclusive_gateway",        "bpmn_task",               "sequence_flow"],
  ["bpmn_exclusive_gateway",        "bpmn_user_task",          "sequence_flow"],
  ["bpmn_exclusive_gateway",        "bpmn_service_task",       "sequence_flow"],
  ["bpmn_exclusive_gateway",        "bpmn_sub_process",        "sequence_flow"],
  ["bpmn_exclusive_gateway",        "bpmn_end_event",          "sequence_flow"],
  ["bpmn_exclusive_gateway",        "bpmn_exclusive_gateway",  "sequence_flow"],
  ["bpmn_parallel_gateway",         "bpmn_service_task",       "sequence_flow"],
  ["bpmn_parallel_gateway",         "bpmn_user_task",          "sequence_flow"],
  ["bpmn_parallel_gateway",         "bpmn_sub_process",        "sequence_flow"],
  ["bpmn_parallel_gateway",         "bpmn_parallel_gateway",   "sequence_flow"],
  ["bpmn_inclusive_gateway",        "bpmn_service_task",       "sequence_flow"],
  ["bpmn_inclusive_gateway",        "bpmn_user_task",          "sequence_flow"],
  ["bpmn_inclusive_gateway",        "bpmn_end_event",          "sequence_flow"],
  ["bpmn_event_based_gateway",      "bpmn_receive_task",       "sequence_flow"],
  ["bpmn_event_based_gateway",      "bpmn_intermediate_catch_event", "sequence_flow"],
  ["bpmn_complex_gateway",          "bpmn_service_task",       "sequence_flow"],
  ["bpmn_complex_gateway",          "bpmn_user_task",          "sequence_flow"],
  ["bpmn_complex_gateway",          "bpmn_end_event",          "sequence_flow"],

  // Intermediate events → activities
  ["bpmn_intermediate_throw_event", "bpmn_service_task",       "sequence_flow"],
  ["bpmn_intermediate_throw_event", "bpmn_end_event",          "sequence_flow"],
  ["bpmn_intermediate_catch_event", "bpmn_service_task",       "sequence_flow"],
  ["bpmn_intermediate_catch_event", "bpmn_user_task",          "sequence_flow"],

  // ── Conditional and default flows from gateways ─────────────────────────
  ["bpmn_exclusive_gateway",        "bpmn_service_task",       "conditional_flow"],
  ["bpmn_exclusive_gateway",        "bpmn_user_task",          "conditional_flow"],
  ["bpmn_exclusive_gateway",        "bpmn_sub_process",        "conditional_flow"],
  ["bpmn_exclusive_gateway",        "bpmn_end_event",          "conditional_flow"],
  ["bpmn_exclusive_gateway",        "bpmn_service_task",       "default_flow"],
  ["bpmn_inclusive_gateway",        "bpmn_service_task",       "conditional_flow"],
  ["bpmn_inclusive_gateway",        "bpmn_user_task",          "conditional_flow"],

  // ── Message flows (cross-pool) ──────────────────────────────────────────
  ["bpmn_send_task",                "bpmn_receive_task",       "message_flow"],
  ["bpmn_intermediate_throw_event", "bpmn_intermediate_catch_event", "message_flow"],
  ["bpmn_pool",                     "bpmn_pool",               "message_flow"],

  // ── Data associations ───────────────────────────────────────────────────
  ["bpmn_data_object",   "bpmn_task",          "data_association"],
  ["bpmn_data_object",   "bpmn_user_task",     "data_association"],
  ["bpmn_data_object",   "bpmn_service_task",  "data_association"],
  ["bpmn_task",          "bpmn_data_object",   "data_association"],
  ["bpmn_user_task",     "bpmn_data_object",   "data_association"],
  ["bpmn_service_task",  "bpmn_data_object",   "data_association"],
  ["bpmn_data_input",    "bpmn_process",       "data_association"],
  ["bpmn_process",       "bpmn_data_output",   "data_association"],
  ["bpmn_data_store",    "bpmn_service_task",  "data_association"],
  ["bpmn_service_task",  "bpmn_data_store",    "data_association"],

  // ── Associations (artifact links) ───────────────────────────────────────
  ["bpmn_data_object",   "bpmn_task",          "association"],
  ["bpmn_data_object",   "bpmn_service_task",  "association"],
  ["bpmn_boundary_event","bpmn_task",          "association"],
  ["bpmn_boundary_event","bpmn_service_task",  "association"],
  ["bpmn_boundary_event","bpmn_sub_process",   "association"],
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
    elementTypeSlug: "bpmn_process",
    name: "Process must have a StartEvent before design",
    description: "A BPMN Process must contain at least one Start Event before entering design stage",
    lifecycleStage: "design",
    severity: "error",
    rule: { requires: { containedElementType: "bpmn_start_event", minCount: 1 } },
  },
  {
    elementTypeSlug: "bpmn_process",
    name: "Process must have an EndEvent before design",
    description: "A BPMN Process must contain at least one End Event before entering design stage",
    lifecycleStage: "design",
    severity: "error",
    rule: { requires: { containedElementType: "bpmn_end_event", minCount: 1 } },
  },
  {
    elementTypeSlug: "bpmn_process",
    name: "Process should have at least one Lane before production",
    description: "A production-ready process should have participant lanes defining who performs each task",
    lifecycleStage: "production",
    severity: "warn",
    rule: { requires: { containedElementType: "bpmn_lane", minCount: 1 } },
  },
  {
    elementTypeSlug: "bpmn_service_task",
    name: "ServiceTask should have incoming and outgoing sequence flows before design",
    description: "A Service Task should be connected in the process flow (not orphaned)",
    lifecycleStage: "design",
    severity: "warn",
    rule: { requires: { relationshipType: "sequence_flow", minCount: 1, direction: "inbound" } },
  },
  {
    elementTypeSlug: "bpmn_user_task",
    name: "UserTask should have incoming and outgoing sequence flows before design",
    description: "A User Task should be connected in the process flow (not orphaned)",
    lifecycleStage: "design",
    severity: "warn",
    rule: { requires: { relationshipType: "sequence_flow", minCount: 1, direction: "inbound" } },
  },
  {
    elementTypeSlug: "bpmn_exclusive_gateway",
    name: "ExclusiveGateway must have at least two outgoing flows before design",
    description: "An Exclusive Gateway must branch to at least two paths to be meaningful",
    lifecycleStage: "design",
    severity: "error",
    rule: { requires: { relationshipType: "sequence_flow", minCount: 2, direction: "outbound" } },
  },
  {
    elementTypeSlug: "bpmn_parallel_gateway",
    name: "ParallelGateway must have at least two outgoing flows before design",
    description: "A Parallel Gateway must fork to at least two concurrent paths",
    lifecycleStage: "design",
    severity: "error",
    rule: { requires: { relationshipType: "sequence_flow", minCount: 2, direction: "outbound" } },
  },
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
    slug: "process_execution_path",
    name: "Process Execution Path",
    description: "Trace the execution flow through a BPMN process from start to end, following sequence flows through activities and gateways.",
    patternType: "process_flow",
    steps: [
      { elementTypeSlugs: ["bpmn_start_event"],                                       refinementLevel: null, relationshipTypeSlugs: ["sequence_flow"],    direction: "outbound" },
      { elementTypeSlugs: ["bpmn_task", "bpmn_user_task", "bpmn_service_task", "bpmn_script_task", "bpmn_business_rule_task", "bpmn_manual_task", "bpmn_sub_process", "bpmn_call_activity"], refinementLevel: null, relationshipTypeSlugs: ["sequence_flow"], direction: "outbound" },
      { elementTypeSlugs: ["bpmn_exclusive_gateway", "bpmn_parallel_gateway", "bpmn_inclusive_gateway", "bpmn_event_based_gateway", "bpmn_complex_gateway"], refinementLevel: null, relationshipTypeSlugs: ["sequence_flow", "conditional_flow", "default_flow"], direction: "outbound" },
      { elementTypeSlugs: ["bpmn_end_event"],                                         refinementLevel: null, relationshipTypeSlugs: [],                  direction: "terminal" },
    ],
    forbiddenShortcuts: [
      "Do not skip gateways — they define the branching and synchronization semantics of the process",
      "Do not follow message_flow as if it were sequence_flow — message flows cross pool boundaries",
      "Do not treat data_association as control flow — data objects are passive, not executable",
    ],
  },
  {
    slug: "human_touchpoints",
    name: "Human Touchpoints in Process",
    description: "Identify all points in a BPMN process where humans interact — user tasks, manual tasks, and approval gateways.",
    patternType: "hitl_analysis",
    steps: [
      { elementTypeSlugs: ["bpmn_process"],   refinementLevel: null, relationshipTypeSlugs: ["sequence_flow"], direction: "outbound" },
      { elementTypeSlugs: ["bpmn_user_task", "bpmn_manual_task"], refinementLevel: null, relationshipTypeSlugs: [], direction: "terminal" },
    ],
    forbiddenShortcuts: [
      "Do not count service_task as a human touchpoint even if a human reviews its output — the task type determines the classification",
      "A bpmn_lane linked to a business_actor does not make all tasks in that lane human tasks — the task type is authoritative",
    ],
  },
];

// ─── Seed function ────────────────────────────────────────────────────────────

export async function seedEaBpmn20(): Promise<void> {
  // 1. Upsert notation
  const notation = await prisma.eaNotation.upsert({
    where:  { slug: "bpmn20" },
    update: { name: "BPMN 2.0", version: "2.0" },
    create: { slug: "bpmn20", name: "BPMN 2.0", version: "2.0" },
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
  console.log(`Seeded ${ELEMENT_TYPES.length} EaElementTypes for BPMN 2.0`);

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
  console.log(`Seeded ${REL_TYPES.length} EaRelationshipTypes for BPMN 2.0`);

  // 4. Upsert relationship rules
  let ruleCount = 0;
  for (const [fromSlug, toSlug, relSlug] of RULES) {
    const fromId = etMap.get(fromSlug);
    const toId   = etMap.get(toSlug);
    const relId  = rtMap.get(relSlug);
    if (!fromId || !toId || !relId) {
      console.warn(`Skipping BPMN rule ${fromSlug} -[${relSlug}]-> ${toSlug}: slug not found`);
      continue;
    }
    await prisma.eaRelationshipRule.upsert({
      where: { fromElementTypeId_toElementTypeId_relationshipTypeId: { fromElementTypeId: fromId, toElementTypeId: toId, relationshipTypeId: relId } },
      update: {},
      create: { fromElementTypeId: fromId, toElementTypeId: toId, relationshipTypeId: relId },
    });
    ruleCount++;
  }
  console.log(`Seeded ${ruleCount} EaRelationshipRules for BPMN 2.0`);

  // 5. Upsert DQ rules
  for (const dq of DQ_RULES) {
    const etId = etMap.get(dq.elementTypeSlug);
    if (!etId) {
      console.warn(`Skipping BPMN DQ rule "${dq.name}": element type "${dq.elementTypeSlug}" not found`);
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
  console.log(`Seeded ${DQ_RULES.length} EaDqRules for BPMN 2.0`);

  // 6. Traversal patterns
  for (const p of TRAVERSAL_PATTERNS) {
    await prisma.eaTraversalPattern.upsert({
      where:  { notationId_slug: { notationId: notation.id, slug: p.slug } },
      update: {
        name: p.name, description: p.description, patternType: p.patternType,
        steps: p.steps, forbiddenShortcuts: p.forbiddenShortcuts,
      },
      create: {
        notationId: notation.id, slug: p.slug, name: p.name, description: p.description,
        patternType: p.patternType, steps: p.steps, forbiddenShortcuts: p.forbiddenShortcuts,
      },
    });
  }
  console.log(`Seeded ${TRAVERSAL_PATTERNS.length} EaTraversalPatterns for BPMN 2.0`);
}
