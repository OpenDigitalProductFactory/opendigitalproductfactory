import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

export type ReassessmentPolicy = {
  schemaVersion: 1; subjectItemId: "BI-285EF102"; maxAssessments: 2;
  historicalConsumption: "retain-unknown"; currentLimits: "normal-recorded"; originalReplay: false;
  operatorEvidenceActivityIds: string[];
  requirements: Array<{ gate: "design-spec" | "spec-approval"; originalRequestDigest: string; maxAssessments: 1 }>;
};
export type PresentReassessmentRelation = {
  schemaVersion: 1; authorizationItemId: string; baselineId: string; policyDigest: string;
  originalTaskRunId: string; originalRequestDigest: string; predecessorTaskRunIds: string[];
  authorityArtifact: { kind: "repo-blob-at-commit"; repositoryFullName: string; commitSha: string; path: string; providerBlobId: string };
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 500 && v.trim() === v;
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
const unique = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= max && v.every(text) && new Set(v).size === v.length;

/** JSON.parse accepts duplicate member names. Authority must not depend on
 * which duplicate a parser happens to retain, including escaped key names. */
function duplicateMember(source: string): boolean {
  const stack: Array<{ object: boolean; key: boolean; names: Set<string> }> = [];
  for (const match of source.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/g)) {
    const token = match[0], frame = stack.at(-1);
    if (token === "{" || token === "[") stack.push({ object: token === "{", key: token === "{", names: new Set() });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && frame?.object) frame.key = true;
    else if (token.startsWith('"') && frame?.object && frame.key) {
      const name = JSON.parse(token) as string;
      if (frame.names.has(name)) return true;
      frame.names.add(name); frame.key = false;
    }
  }
  return false;
}

/** Decoding selects evidence only. A policy never grants authority without its
 * independently approved, current immutable baseline and live owner checks. */
export function parseReassessmentPolicy(source: string): ReassessmentPolicy | null {
  if (typeof source !== "string" || Buffer.byteLength(source) > 1024 * 1024) return null;
  const blocks = [...source.matchAll(/^```review-reassessment-policy-v1\s*\r?\n([\s\S]*?)^```[ \t]*$/gm)];
  if (blocks.length !== 1 || [...source.matchAll(/^```review-reassessment-policy-v1[ \t]*\r?$/gm)].length !== 1) return null;
  let v: unknown;
  try { v = JSON.parse(blocks[0]![1]!); if (duplicateMember(blocks[0]![1]!)) return null; } catch { return null; }
  if (!object(v) || !keys(v, ["schemaVersion", "subjectItemId", "maxAssessments", "historicalConsumption", "currentLimits", "originalReplay", "operatorEvidenceActivityIds", "requirements"])
    || v.schemaVersion !== 1 || v.subjectItemId !== "BI-285EF102" || v.maxAssessments !== 2
    || v.historicalConsumption !== "retain-unknown" || v.currentLimits !== "normal-recorded" || v.originalReplay !== false
    || !unique(v.operatorEvidenceActivityIds, 20) || !Array.isArray(v.requirements) || v.requirements.length !== 2) return null;
  const gates = new Set<string>(); const originals = new Set<string>();
  for (const requirement of v.requirements) {
    if (!object(requirement) || !keys(requirement, ["gate", "originalRequestDigest", "maxAssessments"])
      || !["design-spec", "spec-approval"].includes(String(requirement.gate)) || !digest(requirement.originalRequestDigest)
      || requirement.maxAssessments !== 1 || gates.has(String(requirement.gate)) || originals.has(requirement.originalRequestDigest)) return null;
    gates.add(String(requirement.gate)); originals.add(requirement.originalRequestDigest);
  }
  return v as ReassessmentPolicy;
}

/** All additive relation bytes survive request digest reconstruction. An older
 * decoder dropping this relation obtains a different digest and must refuse. */
export function parsePresentReassessmentRelation(v: unknown): PresentReassessmentRelation | null {
  if (!object(v) || !keys(v, ["schemaVersion", "authorizationItemId", "baselineId", "policyDigest", "originalTaskRunId", "originalRequestDigest", "predecessorTaskRunIds", "authorityArtifact"])
    || v.schemaVersion !== 1 || !text(v.authorizationItemId) || !/^BI-[A-F0-9]{8}$/.test(v.authorizationItemId)
    || !text(v.baselineId) || !v.baselineId.startsWith("baseline-") || !digest(v.policyDigest) || !digest(v.originalRequestDigest)
    || !text(v.originalTaskRunId) || !v.originalTaskRunId.startsWith("TR-") || !unique(v.predecessorTaskRunIds, 100)
    || !v.predecessorTaskRunIds.includes(v.originalTaskRunId) || !v.predecessorTaskRunIds.every(id => id.startsWith("TR-"))) return null;
  const a = v.authorityArtifact;
  if (!object(a) || !keys(a, ["kind", "repositoryFullName", "commitSha", "path", "providerBlobId"])
    || a.kind !== "repo-blob-at-commit" || !text(a.repositoryFullName) || !/^[^/\s]+\/[^/\s]+$/.test(a.repositoryFullName)
    || typeof a.commitSha !== "string" || !/^[a-f0-9]{40}$/.test(a.commitSha)
    || typeof a.providerBlobId !== "string" || !/^[a-f0-9]{40}$/.test(a.providerBlobId)
    || !text(a.path) || a.path.includes("\\") || a.path.split("/").some(p => !p || p === "." || p === "..")) return null;
  return v as PresentReassessmentRelation;
}

export function reassessmentPolicyDigest(value: ReassessmentPolicy): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
