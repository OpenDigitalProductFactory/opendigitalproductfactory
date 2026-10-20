import { isBoundedTrustedJson } from "../bounded-trusted-json.js";
import { buildOperatingComposition, hasExactKeys, isCompositionRecord, isCompositionReference,
  sameCompositionReference, type CompositionDiagnostic, type CompositionReference } from "./composition.js";
export const QUALIFICATION_FACT_VERSION = "operating-qualification-fact/0.1" as const;
export type QualificationFacts = { schemaVersion: typeof QUALIFICATION_FACT_VERSION; reference: CompositionReference;
  subjectRef: CompositionReference; principalRef: CompositionReference; compositionRef: CompositionReference;
  schemeRef: CompositionReference; harnessRef: CompositionReference; runtimeRef: CompositionReference;
  assessorRef: CompositionReference; status: "qualified" | "failed" | "revoked";
  evidence: CompositionReference[]; validFrom: string; validUntil: string };
export type QualificationQuery = { schemeRef: CompositionReference; now: string };
export type QualificationSubject = { subjectRef: CompositionReference; principalRef: CompositionReference;
  compositionRef: CompositionReference; schemeRef: CompositionReference };
export type OperatingQualificationPorts = {
  digest: (text: string) => string;
  readCurrentComposition: (subject: QualificationSubject) => Promise<unknown>;
  readQualification: (subject: QualificationSubject) => Promise<unknown>;
};
export type QualificationAssessment = { status: "qualified" | "held"; authority: "assessment-only";
  compositionRef?: CompositionReference; qualificationRef?: CompositionReference; diagnostics: CompositionDiagnostic[] };
function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
    && Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59
    && Number(match[7] ?? 0) <= 23 && Number(match[8] ?? 0) <= 59 && Number.isFinite(Date.parse(value));
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Evaluate supplied host facts, never admit execution. Hosts authenticate facts,
 * qualify the scheme/harness, and atomically recheck authority at the actual effect.
 * No cache: every query, including a replay, reads current composition again.
 */
export async function queryOperatingQualification(input: unknown, query: unknown, ports: OperatingQualificationPorts): Promise<QualificationAssessment> {
  const result: QualificationAssessment = { status: "held", authority: "assessment-only", diagnostics: [] };
  const hold = (code: string, path = ""): QualificationAssessment => { result.diagnostics.push({ code, path }); return result; };
  try {
    if (!isBoundedTrustedJson(query) || !isCompositionRecord(query) || !hasExactKeys(query, ["schemeRef", "now"])
      || !isCompositionReference(query.schemeRef) || !timestamp(query.now)) return hold("invalid-query");
    const pinnedQuery = copy(query) as QualificationQuery;
    if (!ports || typeof ports.digest !== "function" || typeof ports.readCurrentComposition !== "function" || typeof ports.readQualification !== "function") return hold("missing-fact-port");
    const built = buildOperatingComposition(input, text => ports.digest(text));
    if (!built.ok) { result.diagnostics = built.diagnostics; return result; }
    result.compositionRef = copy(built.compositionRef);
    const subject: QualificationSubject = { subjectRef: built.value.subjectRef, principalRef: built.value.principalRef,
      compositionRef: built.compositionRef, schemeRef: pinnedQuery.schemeRef };
    const current = async (): Promise<boolean> => {
      const facts = await ports.readCurrentComposition(copy(subject));
      return isBoundedTrustedJson(facts) && isCompositionRecord(facts)
        && hasExactKeys(facts, ["status", "subjectRef", "principalRef", "compositionRef"])
        && facts.status === "current" && ["subjectRef", "principalRef", "compositionRef"].every(key =>
          isCompositionReference(facts[key]) && sameCompositionReference(facts[key], subject[key as "subjectRef" | "principalRef" | "compositionRef"]));
    };
    if (!await current()) return hold("composition-not-current");
    const observed = await ports.readQualification(copy(subject));
    if (!isBoundedTrustedJson(observed) || !isCompositionRecord(observed)) return hold("missing-qualification");
    const facts = copy(observed);
    const referenceKeys = ["reference", "subjectRef", "principalRef", "compositionRef", "schemeRef", "harnessRef", "runtimeRef", "assessorRef"] as const;
    if (!hasExactKeys(facts, ["schemaVersion", ...referenceKeys, "status", "evidence", "validFrom", "validUntil"])) return hold("unsupported-qualification-facts");
    if (facts.schemaVersion !== QUALIFICATION_FACT_VERSION) return hold("unsupported-qualification-version");
    if (!referenceKeys.every(key => isCompositionReference(facts[key]))) return hold("invalid-qualification-reference");
    for (const key of ["subjectRef", "principalRef", "compositionRef", "schemeRef"] as const)
      if (!sameCompositionReference(facts[key] as CompositionReference, subject[key])) return hold("qualification-subject-mismatch", key);
    for (const key of ["harnessRef", "runtimeRef"] as const)
      if (!sameCompositionReference(facts[key] as CompositionReference, built.value[key])) return hold("qualification-runtime-mismatch", key);
    if (facts.status !== "qualified") return hold("qualification-not-current", "status");
    if (!timestamp(facts.validFrom) || !timestamp(facts.validUntil) || Date.parse(facts.validFrom) >= Date.parse(facts.validUntil)
      || Date.parse(pinnedQuery.now) < Date.parse(facts.validFrom) || Date.parse(pinnedQuery.now) >= Date.parse(facts.validUntil)) return hold("qualification-outside-window");
    if (!Array.isArray(facts.evidence) || facts.evidence.length === 0 || facts.evidence.length > 128 || !facts.evidence.every(isCompositionReference)
      || new Set(facts.evidence.map(ref => ref.id)).size !== facts.evidence.length) return hold("invalid-qualification-evidence");
    if (!await current()) return hold("composition-not-current");
    result.status = "qualified"; result.qualificationRef = copy(facts.reference as CompositionReference);
    return result;
  } catch { return hold("fact-port-unavailable"); }
}
