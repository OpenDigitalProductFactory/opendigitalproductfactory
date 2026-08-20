// Typed accessor over the capability-completeness derived artifact.
//
// Design: docs/architecture/2026-08-20-assurance-operating-loop-and-capability-completeness.md
// Producer: scripts/measure-capability-completeness.mjs (registered in
// scripts/lib/derived-artifacts-registry.mjs, so the artifact cannot drift from
// source without CI saying so).
//
// A capability is real only when all SEVEN planes resolve. This module is the
// single read path shared by the platform UX and the coworker-facing MCP tool,
// so the operator and the coworker read the same numbers.
//
// v2 scores the FULL inventory — every distinct agent identity across the
// canonical AGT-* registry, the workforce roster, and the profession registry,
// joined through agent-identity.ts — and grades each plane 0-3 rather than
// pass/fail, because "declared but unreachable" is the failure mode that
// produced almost every defect this measure exists to find, and a binary check
// cannot tell it apart from "absent".

import report from "./capability-completeness.generated.json";

export const CAPABILITY_PLANES = [
  "identity",
  "corpus",
  "governance",
  "shape",
  "cadence",
  "toolsAndSkills",
  "evidence",
] as const;

export type CapabilityPlane = (typeof CAPABILITY_PLANES)[number];

/** 0 absent · 1 declared · 2 reachable · 3 proven. */
export type PlaneLevel = 0 | 1 | 2 | 3;

export type PlaneState = {
  level: PlaneLevel;
  levelKey: "absent" | "declared" | "reachable" | "proven";
  ceiling: PlaneLevel;
  atCeiling: boolean;
  detail: string;
  missingGrants?: string[];
};

export type IdentityClass =
  | "active-roster"
  | "active-registry-only"
  | "roster-only"
  | "defined-roster"
  | "declared-only";

export type AgentCompleteness = {
  key: string;
  displayName: string;
  identityClass: IdentityClass;
  handles: string[];
  registryStatus: string | null;
  valueStream: string | null;
  tier: string | null;
  score: {
    earned: number;
    attainableMax: number;
    absoluteMax: number;
    attainablePct: number;
    absolutePct: number;
  };
  planes: Record<CapabilityPlane, PlaneState>;
  gaps: { plane: CapabilityPlane; level: PlaneLevel; ceiling: PlaneLevel; detail: string }[];
  blockedPlanes: { plane: CapabilityPlane; ceiling: PlaneLevel; blocker: string | null }[];
};

export type PlaneContract = {
  label: string;
  asserts: string;
  weight: number;
  ceiling: PlaneLevel;
  blocker: string | null;
  criteria: Record<string, string>;
};

export type CompletenessReport = {
  schemaVersion: string;
  design: string;
  contract: {
    levels: Record<string, { key: string; label: string; meaning: string }>;
    planes: Record<CapabilityPlane, PlaneContract>;
    identityClasses: Record<IdentityClass, string>;
  };
  summary: {
    agents: number;
    sources: {
      canonicalRegistry: number;
      workforceRoster: number;
      professionRoles: number;
      note: string;
    };
    byClass: Record<IdentityClass, { count: number; meaning: string; medianAttainablePct: number | null }>;
    atFullAttainable: number;
    medianAttainablePct: number;
    medianAbsolutePct: number;
    planeLevels: Record<
      CapabilityPlane,
      {
        label: string;
        weight: number;
        ceiling: PlaneLevel;
        blocker: string | null;
        distribution: Record<string, number>;
        atCeiling: number;
      }
    >;
    skills: {
      total: number;
      stranded: number;
      cadenceCapable: number;
      unresolvedAssignTargets: string[];
      assignToHealth: { unresolved: number; unseeded: number; unbridged: number };
    };
    unbackedSkillIds: string[];
  };
  agents: AgentCompleteness[];
  orphans: {
    strandedSkills: {
      file: string;
      name: string;
      assignTo: string[];
      health: { target: string; health: string; rosterSlug: string | null; canonical: string | null }[];
    }[];
    assignToHealth: {
      target: string;
      health: "unresolved" | "unseeded" | "unbridged";
      files: string[];
      rosterSlug?: string;
      canonical?: string;
      status?: string | null;
    }[];
    unresolvedAssignTargets: { target: string; files: string[] }[];
    unbackedSkillIds: string[];
  };
};

const REPORT = report as unknown as CompletenessReport;

export function capabilityCompletenessReport(): CompletenessReport {
  return REPORT;
}

export function planeContract(plane: CapabilityPlane): PlaneContract {
  return REPORT.contract.planes[plane];
}

/** Completeness for one agent, resolved by canonical key OR any handle it answers to. */
export function capabilityCompletenessFor(handle: string): AgentCompleteness | null {
  return (
    REPORT.agents.find((a) => a.key === handle) ??
    REPORT.agents.find((a) => a.handles.includes(handle)) ??
    null
  );
}

/** Agents whose named plane sits below its ceiling, worst first. */
export function agentsBelowCeiling(plane: CapabilityPlane): AgentCompleteness[] {
  return REPORT.agents.filter((a) => a.planes[plane].level < a.planes[plane].ceiling);
}

/**
 * Ordered planes for display: always the full seven, so an absent plane reads
 * as absent rather than silently vanishing. That is the whole lesson of this
 * measure — every gate that produced these gaps iterated only what was present.
 */
export function orderedPlanes(a: AgentCompleteness): {
  plane: CapabilityPlane;
  label: string;
  asserts: string;
  state: PlaneState;
  contract: PlaneContract;
}[] {
  return CAPABILITY_PLANES.map((plane) => ({
    plane,
    label: REPORT.contract.planes[plane].label,
    asserts: REPORT.contract.planes[plane].asserts,
    state: a.planes[plane],
    contract: REPORT.contract.planes[plane],
  }));
}
