/**
 * Repository-owned reference manufacturer for EP-VERTICAL-MANUFACTURING.
 *
 * FluxForge Motion Systems is fictional. Its operating shape is informed by
 * public industrial-OEM patterns, but no real company's customer, employee,
 * production, or equipment data is copied here. The fixture is deterministic
 * and intentionally richer than a storefront demo: it is the contract shared
 * by archetype, Operations, Performance, edge, and simulator work.
 */

export type FactoryNodeKind =
  | "enterprise"
  | "site"
  | "area"
  | "line"
  | "cell"
  | "station"
  | "equipment";

export type EquipmentState =
  | "running"
  | "idle"
  | "starved"
  | "blocked"
  | "changeover"
  | "planned-downtime"
  | "unplanned-downtime"
  | "offline"
  | "unknown";

export interface FactoryNode {
  id: string;
  kind: FactoryNodeKind;
  name: string;
  parentId?: string;
  siteId?: string;
  position?: { x: number; y: number };
  capacityPerHour?: number;
}

export interface ReferenceEquipment {
  id: string;
  nodeId: string;
  assetClass: "robot" | "press" | "printer" | "oven" | "tester" | "conveyor" | "utility";
  manufacturer: string;
  model: string;
  serial: string;
  controlBoundary: "observe-only";
  criticality: "low" | "medium" | "high" | "safety-critical";
}

export interface ReferenceSignal {
  key: string;
  equipmentId: string;
  semantic: "mode" | "state" | "job" | "good-count" | "reject-count" | "alarm" | "energy" | "cycle-time";
  protocol: "opc-ua" | "sparkplug" | "simulator";
  sourcePath: string;
  unit?: string;
  writable: false;
  staleAfterSeconds: number;
}

export interface ReferenceObservation {
  signalKey: string;
  value: string | number;
  sourceObservedAt: string;
  receivedAt: string;
  quality: "good" | "uncertain" | "bad";
}

export interface ManufacturingProcessStage {
  key: string;
  name: string;
  sequence: number;
  nodeIds: string[];
  input: string;
  output: string;
  qualityGate?: string;
}

export interface ReferenceMetric {
  key: string;
  name: string;
  formula: string;
  grain: "shift" | "day" | "week";
  unit: "%" | "units/hour" | "minutes" | "kWh/good-unit";
  sourceSignalKeys: string[];
  freshnessSeconds: number;
}

export interface ManufacturingScenario {
  id: string;
  title: string;
  at: string;
  facts: string[];
  expectedOperationsDecision: string;
  expectedPerformanceEffect: string[];
  provesBacklogItems: string[];
}

export interface ManufacturingReferenceCompany {
  referenceId: string;
  legalNotice: string;
  company: {
    name: string;
    industry: string;
    employeeCount: number;
    operatingModel: string;
    mission: string;
    archetypeTarget: "industrial-oem";
  };
  sites: Array<{
    id: string;
    name: string;
    city: string;
    countryCode: "US" | "MX";
    timezone: string;
    role: "engineering" | "manufacturing" | "distribution";
  }>;
  productFamilies: Array<{
    id: string;
    name: string;
    makeTo: "stock" | "order" | "configure-to-order";
    unit: string;
  }>;
  topology: FactoryNode[];
  equipment: ReferenceEquipment[];
  process: ManufacturingProcessStage[];
  signals: ReferenceSignal[];
  observations: ReferenceObservation[];
  metrics: ReferenceMetric[];
  scenarios: ManufacturingScenario[];
};

const SITE_SALTILLO = "site-saltillo";
const LINE_A = "line-aircore-a";

export const FLUXFORGE_MOTION_REFERENCE: ManufacturingReferenceCompany = {
  referenceId: "mfg-ref-fluxforge-motion-v1",
  legalNotice:
    "FluxForge Motion Systems is fictional. Public industry patterns informed this test fixture; it contains no real customer, employee, order, or equipment data.",
  company: {
    name: "FluxForge Motion Systems",
    industry: "High-efficiency electric motor manufacturing",
    employeeCount: 210,
    operatingModel: "US engineering and validation with Mexico discrete manufacturing",
    mission: "Make efficient motion systems simpler to build, operate, service, and recover.",
    archetypeTarget: "industrial-oem",
  },
  sites: [
    { id: "site-austin", name: "Innovation Center", city: "Austin", countryCode: "US", timezone: "America/Chicago", role: "engineering" },
    { id: SITE_SALTILLO, name: "North Mexico Plant", city: "Saltillo", countryCode: "MX", timezone: "America/Monterrey", role: "manufacturing" },
    { id: "site-laredo", name: "Northbound Distribution Hub", city: "Laredo", countryCode: "US", timezone: "America/Chicago", role: "distribution" },
  ],
  productFamilies: [
    { id: "pf-ec-fan", name: "Air-frame EC fan motors", makeTo: "configure-to-order", unit: "motor" },
    { id: "pf-pump", name: "Integrated pump-drive motors", makeTo: "order", unit: "motor" },
    { id: "pf-mobility", name: "Mobility traction modules", makeTo: "order", unit: "module" },
  ],
  topology: [
    { id: "enterprise-fluxforge", kind: "enterprise", name: "FluxForge Motion Systems" },
    { id: SITE_SALTILLO, kind: "site", name: "North Mexico Plant", parentId: "enterprise-fluxforge", siteId: SITE_SALTILLO },
    { id: "area-production", kind: "area", name: "Motor production", parentId: SITE_SALTILLO, siteId: SITE_SALTILLO },
    { id: LINE_A, kind: "line", name: "Air-frame Line A", parentId: "area-production", siteId: SITE_SALTILLO, capacityPerHour: 42 },
    { id: "cell-stator", kind: "cell", name: "Printed stator cell", parentId: LINE_A, siteId: SITE_SALTILLO, position: { x: 80, y: 120 } },
    { id: "station-print", kind: "station", name: "Stator print", parentId: "cell-stator", siteId: SITE_SALTILLO, position: { x: 180, y: 120 }, capacityPerHour: 48 },
    { id: "eq-printer-01", kind: "equipment", name: "Stator Printer 01", parentId: "station-print", siteId: SITE_SALTILLO },
    { id: "station-cure", kind: "station", name: "Stator cure", parentId: "cell-stator", siteId: SITE_SALTILLO, position: { x: 340, y: 120 }, capacityPerHour: 44 },
    { id: "eq-oven-01", kind: "equipment", name: "Cure Oven 01", parentId: "station-cure", siteId: SITE_SALTILLO },
    { id: "cell-assembly", kind: "cell", name: "Final assembly cell", parentId: LINE_A, siteId: SITE_SALTILLO, position: { x: 500, y: 120 } },
    { id: "station-assembly", kind: "station", name: "Robotic assembly", parentId: "cell-assembly", siteId: SITE_SALTILLO, position: { x: 600, y: 120 }, capacityPerHour: 40 },
    { id: "eq-robot-01", kind: "equipment", name: "Assembly Robot 01", parentId: "station-assembly", siteId: SITE_SALTILLO },
    { id: "station-eol", kind: "station", name: "End-of-line test", parentId: "cell-assembly", siteId: SITE_SALTILLO, position: { x: 760, y: 120 }, capacityPerHour: 36 },
    { id: "eq-tester-01", kind: "equipment", name: "Dynamometer Tester 01", parentId: "station-eol", siteId: SITE_SALTILLO },
  ],
  equipment: [
    { id: "asset-printer-01", nodeId: "eq-printer-01", assetClass: "printer", manufacturer: "Fictional Motion Works", model: "PS-480", serial: "SIM-PS480-001", controlBoundary: "observe-only", criticality: "high" },
    { id: "asset-oven-01", nodeId: "eq-oven-01", assetClass: "oven", manufacturer: "Fictional Thermal", model: "CureCell 44", serial: "SIM-CC44-001", controlBoundary: "observe-only", criticality: "high" },
    { id: "asset-robot-01", nodeId: "eq-robot-01", assetClass: "robot", manufacturer: "Fictional Robotics", model: "AR-40", serial: "SIM-AR40-001", controlBoundary: "observe-only", criticality: "safety-critical" },
    { id: "asset-tester-01", nodeId: "eq-tester-01", assetClass: "tester", manufacturer: "Fictional Test Systems", model: "Dyno-36", serial: "SIM-D36-001", controlBoundary: "observe-only", criticality: "safety-critical" },
  ],
  process: [
    { key: "release", name: "Release production order", sequence: 10, nodeIds: [LINE_A], input: "approved motor configuration and effective manufacturing BOM", output: "released order" },
    { key: "print-stator", name: "Print stator", sequence: 20, nodeIds: ["station-print", "eq-printer-01"], input: "substrate, copper and released job", output: "printed stator" },
    { key: "cure-stator", name: "Cure and inspect stator", sequence: 30, nodeIds: ["station-cure", "eq-oven-01"], input: "printed stator", output: "cured stator", qualityGate: "electrical-continuity" },
    { key: "assemble", name: "Assemble motor and drive", sequence: 40, nodeIds: ["station-assembly", "eq-robot-01"], input: "cured stator, rotor, housing and drive", output: "assembled motor" },
    { key: "eol-test", name: "End-of-line performance test", sequence: 50, nodeIds: ["station-eol", "eq-tester-01"], input: "assembled motor", output: "tested motor", qualityGate: "efficiency-vibration-safety" },
    { key: "pack-ship", name: "Pack and ship", sequence: 60, nodeIds: [LINE_A], input: "released tested motor", output: "serialized shipment" },
  ],
  signals: [
    { key: "printer-state", equipmentId: "asset-printer-01", semantic: "state", protocol: "opc-ua", sourcePath: "ns=4;s=Machines/Printer01/State", writable: false, staleAfterSeconds: 15 },
    { key: "printer-good", equipmentId: "asset-printer-01", semantic: "good-count", protocol: "opc-ua", sourcePath: "ns=4;s=Machines/Printer01/Counts/Good", unit: "stators", writable: false, staleAfterSeconds: 30 },
    { key: "robot-state", equipmentId: "asset-robot-01", semantic: "state", protocol: "sparkplug", sourcePath: "spBv1.0/FluxForge/DDATA/LineA/Robot01", writable: false, staleAfterSeconds: 15 },
    { key: "tester-state", equipmentId: "asset-tester-01", semantic: "state", protocol: "sparkplug", sourcePath: "spBv1.0/FluxForge/DDATA/LineA/Tester01", writable: false, staleAfterSeconds: 15 },
    { key: "tester-good", equipmentId: "asset-tester-01", semantic: "good-count", protocol: "opc-ua", sourcePath: "ns=4;s=Machines/Tester01/Counts/Good", unit: "motors", writable: false, staleAfterSeconds: 30 },
    { key: "tester-reject", equipmentId: "asset-tester-01", semantic: "reject-count", protocol: "opc-ua", sourcePath: "ns=4;s=Machines/Tester01/Counts/Reject", unit: "motors", writable: false, staleAfterSeconds: 30 },
    { key: "tester-energy", equipmentId: "asset-tester-01", semantic: "energy", protocol: "opc-ua", sourcePath: "ns=4;s=Machines/Tester01/Energy/ShiftKwh", unit: "kWh", writable: false, staleAfterSeconds: 60 },
  ],
  observations: [
    { signalKey: "printer-state", value: "running", sourceObservedAt: "2026-08-08T15:19:55.000Z", receivedAt: "2026-08-08T15:19:55.180Z", quality: "good" },
    { signalKey: "printer-good", value: 326, sourceObservedAt: "2026-08-08T15:19:50.000Z", receivedAt: "2026-08-08T15:19:50.205Z", quality: "good" },
    { signalKey: "robot-state", value: "starved", sourceObservedAt: "2026-08-08T15:19:56.000Z", receivedAt: "2026-08-08T15:19:56.142Z", quality: "good" },
    { signalKey: "tester-state", value: "blocked", sourceObservedAt: "2026-08-08T15:19:57.000Z", receivedAt: "2026-08-08T15:19:57.161Z", quality: "good" },
    { signalKey: "tester-good", value: 281, sourceObservedAt: "2026-08-08T15:19:50.000Z", receivedAt: "2026-08-08T15:19:50.192Z", quality: "good" },
    { signalKey: "tester-reject", value: 7, sourceObservedAt: "2026-08-08T15:19:50.000Z", receivedAt: "2026-08-08T15:19:50.193Z", quality: "good" },
    { signalKey: "tester-energy", value: 421.8, sourceObservedAt: "2026-08-08T15:19:00.000Z", receivedAt: "2026-08-08T15:19:00.240Z", quality: "good" },
  ],
  metrics: [
    { key: "line-throughput", name: "Good-unit throughput", formula: "delta(tester-good) / elapsed production hours", grain: "shift", unit: "units/hour", sourceSignalKeys: ["tester-good"], freshnessSeconds: 60 },
    { key: "first-pass-yield", name: "First-pass yield", formula: "good / (good + reject) * 100", grain: "shift", unit: "%", sourceSignalKeys: ["tester-good", "tester-reject"], freshnessSeconds: 60 },
    { key: "oee", name: "Overall equipment effectiveness", formula: "availability * performance * quality", grain: "shift", unit: "%", sourceSignalKeys: ["printer-state", "robot-state", "tester-state", "tester-good", "tester-reject"], freshnessSeconds: 60 },
    { key: "energy-good-unit", name: "Test energy per good motor", formula: "delta(tester-energy) / delta(tester-good)", grain: "shift", unit: "kWh/good-unit", sourceSignalKeys: ["tester-energy", "tester-good"], freshnessSeconds: 120 },
  ],
  scenarios: [
    {
      id: "scenario-starved-assembly",
      title: "Assembly is starved while upstream WIP grows",
      at: "2026-08-08T14:00:00.000Z",
      facts: ["Assembly robot state is starved", "Cure output buffer has 18 stators", "Required drive lot is held for supplier inspection"],
      expectedOperationsDecision: "Keep the quality hold; re-sequence an eligible order that uses the available drive lot and show the blocked order owner.",
      expectedPerformanceEffect: ["throughput below plan", "WIP age rising", "schedule attainment at risk"],
      provesBacklogItems: ["BI-E118D536", "BI-17FC03D1", "BI-9CE1B61A"],
    },
    {
      id: "scenario-tester-blocked",
      title: "End-of-line tester blocks the line",
      at: "2026-08-08T15:20:00.000Z",
      facts: ["Tester state is blocked", "Vibration alarm is active", "Four assembled motors are queued"],
      expectedOperationsDecision: "Highlight the tester as the single bottleneck, open maintenance/quality work, and stop releasing more work into the constrained buffer.",
      expectedPerformanceEffect: ["availability loss", "OEE decline", "customer promise risk"],
      provesBacklogItems: ["BI-E118D536", "BI-64B4581A", "BI-BD94A40B"],
    },
    {
      id: "scenario-stale-edge",
      title: "Plant telemetry becomes stale",
      at: "2026-08-08T16:05:00.000Z",
      facts: ["No trusted edge observation has arrived for 90 seconds", "The last machine states were running"],
      expectedOperationsDecision: "Render the line as stale/unknown, preserve last-observed timestamps, and refuse live-state recommendations until evidence resumes.",
      expectedPerformanceEffect: ["current-shift metrics marked incomplete", "no fabricated OEE"],
      provesBacklogItems: ["BI-B9BC5B0B", "BI-E118D536"],
    },
  ],
};

export interface ManufacturingReferenceViolation {
  path: string;
  message: string;
}

export function validateManufacturingReference(
  reference: ManufacturingReferenceCompany,
): ManufacturingReferenceViolation[] {
  const violations: ManufacturingReferenceViolation[] = [];
  const nodeIds = new Set<string>();
  for (const node of reference.topology) {
    if (nodeIds.has(node.id)) violations.push({ path: `topology.${node.id}`, message: "duplicate node id" });
    nodeIds.add(node.id);
  }
  for (const node of reference.topology) {
    if (node.parentId && !nodeIds.has(node.parentId)) {
      violations.push({ path: `topology.${node.id}.parentId`, message: `unknown parent ${node.parentId}` });
    }
  }

  const equipmentIds = new Set<string>();
  for (const equipment of reference.equipment) {
    if (equipmentIds.has(equipment.id)) violations.push({ path: `equipment.${equipment.id}`, message: "duplicate equipment id" });
    equipmentIds.add(equipment.id);
    if (!nodeIds.has(equipment.nodeId)) violations.push({ path: `equipment.${equipment.id}.nodeId`, message: `unknown node ${equipment.nodeId}` });
    if (equipment.controlBoundary !== "observe-only") violations.push({ path: `equipment.${equipment.id}.controlBoundary`, message: "reference equipment must remain observe-only" });
  }

  const signalKeys = new Set<string>();
  for (const signal of reference.signals) {
    if (signalKeys.has(signal.key)) violations.push({ path: `signals.${signal.key}`, message: "duplicate signal key" });
    signalKeys.add(signal.key);
    if (!equipmentIds.has(signal.equipmentId)) violations.push({ path: `signals.${signal.key}.equipmentId`, message: `unknown equipment ${signal.equipmentId}` });
    if (signal.writable !== false) violations.push({ path: `signals.${signal.key}.writable`, message: "reference telemetry must be read-only" });
    if (signal.staleAfterSeconds <= 0) violations.push({ path: `signals.${signal.key}.staleAfterSeconds`, message: "freshness window must be positive" });
  }

  for (const observation of reference.observations) {
    if (!signalKeys.has(observation.signalKey)) {
      violations.push({ path: `observations.${observation.signalKey}`, message: `unknown signal ${observation.signalKey}` });
    }
    if (Date.parse(observation.sourceObservedAt) > Date.parse(observation.receivedAt)) {
      violations.push({ path: `observations.${observation.signalKey}`, message: "source observation cannot arrive before it was observed" });
    }
  }

  for (const stage of reference.process) {
    for (const nodeId of stage.nodeIds) {
      if (!nodeIds.has(nodeId)) violations.push({ path: `process.${stage.key}.nodeIds`, message: `unknown node ${nodeId}` });
    }
  }
  const sequences = reference.process.map((stage) => stage.sequence);
  if (new Set(sequences).size !== sequences.length || sequences.some((value, index) => index > 0 && value <= sequences[index - 1])) {
    violations.push({ path: "process", message: "process sequence must be unique and strictly increasing" });
  }

  for (const metric of reference.metrics) {
    if (!metric.formula.trim()) violations.push({ path: `metrics.${metric.key}.formula`, message: "metric formula is required" });
    for (const signalKey of metric.sourceSignalKeys) {
      if (!signalKeys.has(signalKey)) violations.push({ path: `metrics.${metric.key}.sourceSignalKeys`, message: `unknown signal ${signalKey}` });
    }
  }

  if (!reference.scenarios.some((scenario) => scenario.id === "scenario-stale-edge")) {
    violations.push({ path: "scenarios", message: "a stale-edge degradation scenario is required" });
  }
  return violations;
}
