import { decide, type DecideConfig, type DecisionOption, type DecisionPrinciple, type DecisionResult } from "./option-scoring.ts";
import { DECISION_SCOPES, type DecisionScope } from "./scopes.ts";
import { validateOptionIdentities } from "./option-identities.ts";

export const SCOPED_ADVICE_VERSION = "scoped-advice/0.1" as const;
export type JudgmentOwner = { scope: DecisionScope; id: string };
export type JudgmentReference = { id: string; revision: string; digest: string };
export type CurrentJudgmentReference = {
  reference: JudgmentReference;
  currentReference: JudgmentReference;
  status: "current" | "revoked";
};
export type ScopedPrinciple = CurrentJudgmentReference & { principle: DecisionPrinciple };
export type TrustedJudgmentContext = CurrentJudgmentReference & {
  owner: JudgmentOwner;
  principles: ScopedPrinciple[];
};
export type OptionEligibility = {
  optionId: string;
  eligible: boolean;
  reasons: string[];
  constraintReferences: JudgmentReference[];
};
export type ScopedAdviceInput = {
  owner: JudgmentOwner;
  subject: { id: string; revision: string; producingGateId?: string };
  context: TrustedJudgmentContext | null;
  options: DecisionOption[];
  eligibility: OptionEligibility[];
  config?: DecideConfig;
};
/** A pure host port: use the owning domain's existing feature catalog. */
export type JudgmentDomainPort = {
  validateFeatures: (options: readonly DecisionOption[]) => readonly string[];
};
export type JudgmentDiagnostic = { code: string; path: string; detail: string };
export type ScopedAdvice = {
  contractVersion: typeof SCOPED_ADVICE_VERSION;
  authority: "advisory-only";
  status: "held" | "advice";
  diagnostics: JudgmentDiagnostic[];
  owner?: JudgmentOwner;
  subject?: ScopedAdviceInput["subject"];
  contextReference?: JudgmentReference;
  principleReferences: JudgmentReference[];
  eligibleOptionIds: string[];
  excludedOptions: OptionEligibility[];
  evaluation?: DecisionResult;
  feedback: "owner-capture-required" | "unsupported";
};

export const SCOPED_ADVICE_LIMITS = { options: 64, principles: 128, dimensions: 64, embedding: 4096, text: 4096 } as const;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonblank = (value: unknown, max = 256): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const sameReference = (a: JudgmentReference, b: JudgmentReference): boolean =>
  a.id === b.id && a.revision === b.revision && a.digest === b.digest;

/**
 * Validate a host-supplied snapshot and rank only its hard-eligible options.
 * The host authenticates the owner, resolves current refs, applies domain
 * constraints and captures outcomes. This function performs no admission,
 * persistence, retrieval, feedback promotion or authority intersection.
 * Bounds below belong to scoped-advice/0.1; legacy decide remains unchanged.
 */
export function evaluateScopedAdvice(input: ScopedAdviceInput, domain?: JudgmentDomainPort): ScopedAdvice {
  const diagnostics: JudgmentDiagnostic[] = [];
  const response: ScopedAdvice = {
    contractVersion: SCOPED_ADVICE_VERSION, authority: "advisory-only", status: "held",
    diagnostics, principleReferences: [], eligibleOptionIds: [], excludedOptions: [], feedback: "unsupported",
  };
  const issue = (code: string, path: string, detail: string): void => { diagnostics.push({ code, path, detail }); };
  const reference = (value: unknown, path: string): value is JudgmentReference => {
    if (!record(value) || !nonblank(value.id) || !nonblank(value.revision) || !nonblank(value.digest)) {
      issue("invalid-reference", path, "A bounded source id, revision and digest are required."); return false;
    }
    return true;
  };
  const current = (value: CurrentJudgmentReference, path: string): boolean => {
    if (!record(value)) { issue("invalid-reference", path, "A current source snapshot is required."); return false; }
    const validRef = reference(value.reference, path + ".reference");
    const validCurrent = reference(value.currentReference, path + ".currentReference");
    if (value.status === "revoked") issue("revoked-context", path, "The host reports this source revoked.");
    else if (value.status !== "current") issue("missing-context", path, "Current source status is required.");
    if (validRef && validCurrent && !sameReference(value.reference, value.currentReference))
      issue("stale-context", path, "Source id, revision or digest differs from the host's current reference.");
    return validRef && validCurrent;
  };
  const number = (value: unknown, path: string, min: number, max: number): void => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
      issue("invalid-number", path, `Expected a finite number in [${min}, ${max}].`);
  };
  const vector = (value: unknown, path: string, min: number): void => {
    if (!record(value)) { issue("invalid-vector", path, "A numeric feature/vector record is required."); return; }
    const entries = Object.entries(value);
    if (entries.length > SCOPED_ADVICE_LIMITS.dimensions) issue("size-limit", path, "Too many dimensions.");
    for (const [key, val] of entries.slice(0, SCOPED_ADVICE_LIMITS.dimensions + 1)) {
      if (!nonblank(key)) issue("invalid-vector", path, "Dimension keys must be bounded and nonblank.");
      number(val, path + "." + key, min, 1);
    }
  };
  const embedding = (value: unknown, path: string): void => {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length > SCOPED_ADVICE_LIMITS.embedding) {
      issue("size-limit", path, "Embedding must be an array of at most 4096 values."); return;
    }
    value.forEach((val, i) => number(val, `${path}[${i}]`, -1, 1));
  };
  if (!record(input)) { issue("invalid-input", "", "A scoped request is required."); return response; }
  if (!record(input.owner) || !DECISION_SCOPES.includes(input.owner.scope) || !nonblank(input.owner.id))
    issue("invalid-owner", "owner", "Declared scope and exact platform, organization or profession owner id are required.");
  else { response.owner = { ...input.owner }; response.feedback = input.owner.scope === "wsid" ? "unsupported" : "owner-capture-required"; }
  if (!record(input.subject) || !nonblank(input.subject.id) || !nonblank(input.subject.revision))
    issue("invalid-subject", "subject", "An exact subject id and revision are required.");
  else {
    response.subject = { ...input.subject };
    if (input.subject.producingGateId !== undefined && !nonblank(input.subject.producingGateId))
      issue("missing-producing-gate", "subject.producingGateId", "A supplied producing gate must be nonblank.");
  }
  if (input.owner?.scope === "wsid" && !nonblank(input.subject?.producingGateId))
    issue("missing-producing-gate", "subject.producingGateId", "WSID retains the producing profession gate identity even with fallback doctrine.");

  const context = input.context;
  if (!record(context)) issue("missing-context", "context", "Owning-scope trusted context is required; cross-scope advice cannot replace it.");
  else {
    current(context, "context");
    if (!record(context.owner) || context.owner.scope !== input.owner?.scope || context.owner.id !== input.owner?.id)
      issue("owner-context-mismatch", "context.owner", "Context must belong to the exact declared scope and owner.");
    if (reference(context.reference, "context.reference")) response.contextReference = { ...context.reference };
    if (!Array.isArray(context.principles) || context.principles.length === 0)
      issue("missing-principles", "context.principles", "An owning-scope principle corpus is required.");
    else if (context.principles.length > SCOPED_ADVICE_LIMITS.principles)
      issue("size-limit", "context.principles", "Too many principles.");
    else {
      const seen = new Set<string>();
      context.principles.forEach((source, i) => {
        const path = `context.principles[${i}]`;
        if (current(source, path)) response.principleReferences.push({ ...source.reference });
        const p = source?.principle;
        if (!record(p) || !nonblank(p.id) || !nonblank(p.name, SCOPED_ADVICE_LIMITS.text) || !nonblank(p.tier)) {
          issue("invalid-principle", path, "Bounded principle identity, name and tier are required."); return;
        }
        if (seen.has(p.id.trim())) issue("duplicate-principle", path, "Principle ids must be distinct.");
        seen.add(p.id.trim());
        number(p.weight, path + ".weight", 0, 1);
        vector(p.dimensionVector, path + ".dimensionVector", -1);
        embedding(p.directionEmbedding, path + ".directionEmbedding");
      });
    }
  }
  if (!Array.isArray(input.options) || input.options.length === 0 || input.options.length > SCOPED_ADVICE_LIMITS.options) {
    issue("size-limit", "options", "Between 1 and 64 options are required."); return response;
  }
  for (const error of validateOptionIdentities(input.options))
    issue("invalid-option-identity", `options[${error.index}].${error.field}`, error.detail);
  input.options.forEach((option, i) => {
    const path = `options[${i}]`;
    if (!record(option)) return;
    if (!nonblank(option.id) || !nonblank(option.description, SCOPED_ADVICE_LIMITS.text))
      issue("invalid-option-identity", path, "Option identity and description exceed bounds or are blank.");
    vector(option.features, path + ".features", 0);
    embedding(option.embedding, path + ".embedding");
  });
  const eligibility = new Map<string, OptionEligibility>();
  if (!Array.isArray(input.eligibility) || input.eligibility.length !== input.options.length)
    issue("invalid-eligibility", "eligibility", "Each option needs exactly one explicit hard-eligibility result.");
  else input.eligibility.forEach((item, i) => {
    const path = `eligibility[${i}]`;
    if (!record(item) || !nonblank(item.optionId) || eligibility.has(item.optionId)
        || !input.options.some((o) => o?.id === item.optionId) || typeof item.eligible !== "boolean"
        || !Array.isArray(item.reasons) || item.reasons.length > 64
        || item.reasons.some((reason) => !nonblank(reason, SCOPED_ADVICE_LIMITS.text))
        || (!item.eligible && item.reasons.length === 0)
        || !Array.isArray(item.constraintReferences) || item.constraintReferences.length === 0 || item.constraintReferences.length > 64) {
      issue("invalid-eligibility", path, "Distinct exact option, explicit eligibility, reasons for exclusions and revisioned constraint references are required."); return;
    }
    item.constraintReferences.forEach((ref, j) => reference(ref, `${path}.constraintReferences[${j}]`));
    eligibility.set(item.optionId, item);
  });
  if (eligibility.size !== input.options.length) issue("invalid-eligibility", "eligibility", "Eligibility must cover every exact option once.");
  const config = input.config;
  if (config !== undefined) {
    if (!record(config)) issue("invalid-config", "config", "Expected a bounded scoring configuration.");
    else for (const [key, value] of Object.entries(config)) {
      const unit = ["tieMargin", "semanticFallbackWarnRatio", "commandmentConflictThreshold", "sensitivityEpsilon"];
      const valid = key === "stakes" ? ["routine", "elevated", "high"].includes(value as string)
        : key === "minFeatureKeys" ? typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 64
        : unit.includes(key) && typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 && (key !== "sensitivityEpsilon" || value > 0);
      if (!valid) issue("invalid-config", "config." + key, "Unknown key or value outside scoped-advice/0.1 bounds.");
    }
  }
  if (!domain || typeof domain.validateFeatures !== "function")
    issue("missing-domain-validator", "domain", "The host must supply its canonical feature catalog validator.");
  if (diagnostics.length > 0) return response;
  try {
    const errors = domain!.validateFeatures(input.options);
    if (!Array.isArray(errors) || errors.length > 0)
      issue("domain-features-invalid", "options", "The owning host feature catalog rejected this exact option set.");
  } catch {
    issue("domain-validator-unavailable", "domain", "Host domain validation did not return a result.");
  }
  if (diagnostics.length > 0) return response;
  const eligible = input.options.filter((option) => eligibility.get(option.id)!.eligible);
  response.eligibleOptionIds = eligible.map((option) => option.id);
  response.excludedOptions = input.eligibility.filter((item) => !item.eligible).map((item) => ({
    ...item, reasons: [...item.reasons], constraintReferences: item.constraintReferences.map((ref) => ({ ...ref })),
  }));
  if (eligible.length === 0) { issue("no-eligible-options", "eligibility", "No option satisfies the host's hard constraints."); return response; }
  response.evaluation = decide(eligible, context!.principles.map((source) => source.principle), config);
  response.status = "advice";
  return response;
}
