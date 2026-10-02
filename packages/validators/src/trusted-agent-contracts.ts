import { z } from "zod";
import { DECISION_SCOPES } from "./decision-scope";
import { OUTCOME_DISPOSITIONS } from "./outcome-disposition";

// Structural schemas describe data, not authenticated authority. The importer
// additionally checks bounded JSON, extensions and cross-field semantics.
export const TRUSTED_ARTIFACT_VERSION = "0.1.0";
const id = z.string().min(1).max(512);
const description = z.string().min(1).max(4096);
const timestamp = z.iso.datetime({ offset: true });
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const trustedReferenceSchema = z.strictObject({ id, version: id, digest: digest.optional() });
export type TrustedReference = z.infer<typeof trustedReferenceSchema>;
const refs = z.array(trustedReferenceSchema).max(128);
const ids = z.array(id).max(64);
export const trustedRestrictionsSchema = z.strictObject({
  classificationRef: trustedReferenceSchema,
  accessPolicyRef: trustedReferenceSchema,
  retentionPolicyRef: trustedReferenceSchema,
  destinationPolicyRef: trustedReferenceSchema,
  expiresAt: timestamp.optional(),
});
export const trustedGppBindingSchema = z.strictObject({
  bindingRef: trustedReferenceSchema, shapeRef: trustedReferenceSchema,
  stageId: id, scope: z.enum(DECISION_SCOPES), gateDecisionRef: trustedReferenceSchema,
  mode: z.enum(["enforce", "shadow", "off"]), observedAt: timestamp,
});
export const trustedEffectBindingSchema = z.strictObject({
  effectId: id, actorRef: trustedReferenceSchema, toolRef: trustedReferenceSchema,
  targetRef: trustedReferenceSchema, accountRef: trustedReferenceSchema,
  argumentDigest: digest, canonicalization: id, purpose: description,
  workRef: trustedReferenceSchema, profileRef: trustedReferenceSchema,
  policyGeneration: id, gppBindings: z.array(trustedGppBindingSchema).max(64),
});
export type TrustedEffectBinding = z.infer<typeof trustedEffectBindingSchema>;
const common = {
  schemaVersion: z.literal(TRUSTED_ARTIFACT_VERSION), id,
  sourceRef: trustedReferenceSchema, restrictions: trustedRestrictionsSchema,
  extensions: z.array(z.strictObject({
    id: id.regex(/^[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/), version: id,
    mandatory: z.boolean(), data: z.json(),
  })).max(32),
};
export const trustedWorkDefinitionSchema = z.strictObject({
  ...common, kind: z.literal("work-definition"), activity: trustedReferenceSchema,
  purpose: description, scope: z.enum(DECISION_SCOPES), accountablePrincipalRef: trustedReferenceSchema,
  flow: z.literal("sequential"), gpp: z.boolean(),
  capabilities: z.array(trustedReferenceSchema).max(64),
  stages: z.array(z.strictObject({
    id, consequential: z.boolean(), capabilityIds: ids, next: ids,
    gppBindings: z.array(trustedGppBindingSchema).max(64),
  })).min(1).max(64),
  requiredEvidence: refs,
  limits: z.strictObject({ steps: z.int().positive().max(10000), attempts: z.int().positive().max(100), reconciliations: z.int().positive().max(100) }),
  stopConditions: z.array(description).min(1).max(64), reviewConditions: z.array(description).min(1).max(64),
});
export const trustedOperatingProfileSchema = z.strictObject({
  ...common, kind: z.literal("operating-profile"), subjectRef: trustedReferenceSchema,
  principalRef: trustedReferenceSchema, composition: trustedReferenceSchema,
  instructions: refs.min(1), skills: refs, models: refs.min(1),
  tools: z.array(trustedReferenceSchema).max(64),
  doctrine: z.array(z.strictObject({ scope: z.enum(DECISION_SCOPES), profileRef: trustedReferenceSchema })).min(1).max(3),
  qualifications: refs,
});
export const trustedQualificationSchema = z.strictObject({
  ...common, kind: z.literal("qualification-reference"), schemeRef: trustedReferenceSchema,
  subjectRef: trustedReferenceSchema, compositionRef: trustedReferenceSchema,
  status: id, evidence: refs, assessorRef: trustedReferenceSchema, harnessRef: trustedReferenceSchema,
  validFrom: timestamp, validUntil: timestamp,
});
export const trustedDecisionSchema = z.strictObject({
  ...common, kind: z.literal("decision"), workRef: trustedReferenceSchema,
  profileRef: trustedReferenceSchema, scope: z.enum(DECISION_SCOPES),
  eligibleOptionIds: ids, selectedOptionId: id.optional(), constraintsSatisfied: z.boolean(),
  disposition: z.enum(OUTCOME_DISPOSITIONS), reasonCodes: ids.min(1), evidence: refs,
  resolverRef: trustedReferenceSchema.optional(),
});
export const trustedEffectReceiptSchema = z.strictObject({
  ...common, kind: z.literal("effect-receipt"), decisionRef: trustedReferenceSchema,
  authorizationRef: trustedReferenceSchema, binding: trustedEffectBindingSchema,
  attemptId: id, observation: z.enum(["not-submitted", "succeeded", "no-effect", "unknown"]),
  recordedAt: timestamp, evidence: refs,
});
export const trustedArtifactSchema = z.discriminatedUnion("kind", [
  trustedWorkDefinitionSchema, trustedOperatingProfileSchema, trustedQualificationSchema,
  trustedDecisionSchema, trustedEffectReceiptSchema,
]);
export type TrustedArtifact = z.infer<typeof trustedArtifactSchema>;
export type TrustedWorkDefinition = z.infer<typeof trustedWorkDefinitionSchema>;
export type TrustedOperatingProfile = z.infer<typeof trustedOperatingProfileSchema>;
export type TrustedDecision = z.infer<typeof trustedDecisionSchema>;
export type TrustedEffectReceipt = z.infer<typeof trustedEffectReceiptSchema>;
export type TrustedContractError = { code: "invalid-structure" | "unsupported-version" | "unsupported-extension" | "invalid-semantics" | "input-limit"; path: string; message: string };
export type TrustedImportResult = { ok: true; value: TrustedArtifact } | { ok: false; errors: TrustedContractError[] };
export type TrustedExtensionValidator = { id: string; version: string; validate: (data: z.infer<ReturnType<typeof z.json>>) => boolean };
export type TrustedImportOptions = { extensions?: readonly TrustedExtensionValidator[]; now?: string };

/** Same source identity, including an optional digest. A reference is not a grant. */
export function sameTrustedReference(a: TrustedReference, b: TrustedReference): boolean {
  return a.id === b.id && a.version === b.version && a.digest === b.digest;
}

/** Bound traversal before a recursive schema can encounter hostile depth/cycles. */
export function isBoundedTrustedJson(value: unknown): boolean {
  const stack = [{ value, depth: 0 }];
  let nodes = 0; let characters = 0;
  try {
    while (stack.length) {
      const entry = stack.pop()!; const v = entry.value;
      if (++nodes > 20000 || entry.depth > 16) return false;
      if (v === null || typeof v === "boolean") continue;
      if (typeof v === "number") { if (!Number.isFinite(v)) return false; continue; }
      if (typeof v === "string") { characters += v.length; if (characters > 1048576) return false; continue; }
      if (typeof v !== "object") return false;
      if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
      // Aliased objects are allowed; a cycle is rejected by the depth ceiling.
      const entries = Object.entries(Object.getOwnPropertyDescriptors(v));
      if (entries.length > 20000 || Object.getOwnPropertySymbols(v).length) return false;
      if (Array.isArray(v) && (entries.length !== v.length + 1 || entries.some(([key]) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)))) return false;
      for (const [key, property] of entries) {
        if (Array.isArray(v) && key === "length") continue;
        if (!property.enumerable || !("value" in property)) return false;
        characters += key.length; if (characters > 1048576) return false;
        stack.push({ value: property.value, depth: entry.depth + 1 });
      }
    }
    return true;
  } catch { return false; }
}

function semanticErrors(value: TrustedArtifact, options: TrustedImportOptions): TrustedContractError[] {
  const errors: TrustedContractError[] = [];
  const add = (path: string, message: string) => { if (errors.length < 32) errors.push({ code: "invalid-semantics", path, message }); };
  const unique = (values: string[], path: string) => { if (new Set(values).size !== values.length) add(path, "Duplicate identities are not allowed."); };
  const uniqueRefs = (values: TrustedReference[], path: string) => unique(values.map(v => v.id), path);
  unique(value.extensions.map(v => v.id), "extensions");
  for (const extension of value.extensions) {
    const validators = (options.extensions ?? []).filter(v => v.id === extension.id && v.version === extension.version);
    if (!validators.length && extension.mandatory) errors.push({ code: "unsupported-extension", path: "extensions", message: "Mandatory extension needs an exact-version semantic validator." });
    if (validators.length > 1) add("extensions", "Extension validator identity is ambiguous.");
    if (validators.length === 1) {
      try { if (validators[0]!.validate(extension.data) !== true) add("extensions", "Extension semantic validation failed."); }
      catch { add("extensions", "Extension semantic validator did not produce a verdict."); }
    }
  }
  if (options.now !== undefined) {
    const now = timestamp.safeParse(options.now);
    if (!now.success) add("now", "A valid observation time is required.");
    else if (value.restrictions.expiresAt && Date.parse(value.restrictions.expiresAt) <= Date.parse(now.data)) add("restrictions.expiresAt", "Restrictions expired; obtain current source policy.");
  }
  if (value.kind === "work-definition") {
    unique(value.stages.map(v => v.id), "stages"); uniqueRefs(value.capabilities, "capabilities"); uniqueRefs(value.requiredEvidence, "requiredEvidence");
    for (const stage of value.stages) {
      unique(stage.next, "stages.next"); unique(stage.capabilityIds, "stages.capabilityIds");
      uniqueRefs(stage.gppBindings.map(v => v.bindingRef), "stages.gppBindings");
      if (stage.next.length > 1) add("stages.next", "Sequential projection cannot represent a fork.");
      if (stage.next.some(next => !value.stages.some(s => s.id === next))) add("stages.next", "Transition target does not exist.");
      if (stage.capabilityIds.some(capability => !value.capabilities.some(c => c.id === capability))) add("stages.capabilityIds", "Capability is not declared by this work.");
      if (stage.consequential && stage.capabilityIds.length === 0) add("stages.capabilityIds", "Consequential stages must name a capability.");
      if (value.gpp && stage.consequential && stage.gppBindings.length === 0) add("stages.gppBindings", "Declared GPP projection requires a binding for consequential stages.");
      if (!value.gpp && stage.gppBindings.length) add("gpp", "GPP bindings require an explicit supported projection.");
      for (const binding of stage.gppBindings) {
        if (!sameTrustedReference(binding.shapeRef, value.activity) || binding.stageId !== stage.id || binding.scope !== value.scope) add("stages.gppBindings", "GPP binding does not match its shape, stage or owning scope.");
      }
    }
  } else if (value.kind === "operating-profile") {
    unique(value.doctrine.map(v => v.scope), "doctrine");
    for (const field of ["instructions", "skills", "models", "tools", "qualifications"] as const) uniqueRefs(value[field], field);
  } else if (value.kind === "qualification-reference") {
    if (Date.parse(value.validUntil) <= Date.parse(value.validFrom)) add("validUntil", "Qualification window must end after it starts.");
    if (options.now && (Date.parse(options.now) < Date.parse(value.validFrom) || Date.parse(options.now) >= Date.parse(value.validUntil))) add("validUntil", "Qualification reference is outside its validity window.");
    uniqueRefs(value.evidence, "evidence");
  } else if (value.kind === "decision") {
    unique(value.eligibleOptionIds, "eligibleOptionIds"); unique(value.reasonCodes, "reasonCodes"); uniqueRefs(value.evidence, "evidence");
    if (value.disposition === "proceed") {
      if (!value.constraintsSatisfied || !value.selectedOptionId || !value.eligibleOptionIds.includes(value.selectedOptionId)) add("selectedOptionId", "Proceed requires satisfied constraints and an eligible selected option.");
    } else if (value.selectedOptionId !== undefined) add("selectedOptionId", "A non-proceed decision cannot select an actionable option.");
    if (["awaiting-person", "awaiting-input", "inconclusive"].includes(value.disposition) && !value.resolverRef) add("resolverRef", "An unresolved outcome needs an accountable resolver.");
  } else {
    uniqueRefs(value.evidence, "evidence"); uniqueRefs(value.binding.gppBindings.map(v => v.bindingRef), "binding.gppBindings");
    if (["no-effect", "succeeded"].includes(value.observation) && !value.evidence.length) add("evidence", "A claimed target outcome requires evidence; timeout alone remains unknown.");
    for (const binding of value.binding.gppBindings) if (!sameTrustedReference(binding.shapeRef, value.binding.workRef)) add("binding.gppBindings", "Effect and GPP shape revisions differ.");
  }
  return errors.slice(0, 32);
}

/** Import data only. Provenance, export eligibility and current authority belong to the adapter. */
export function importTrustedArtifact(value: unknown, options: TrustedImportOptions = {}): TrustedImportResult {
  if (!isBoundedTrustedJson(value)) return { ok: false, errors: [{ code: "input-limit", path: "", message: "Expected bounded plain JSON without cycles, accessors or nonfinite values." }] };
  try {
    if (value && typeof value === "object" && "schemaVersion" in value && value.schemaVersion !== TRUSTED_ARTIFACT_VERSION) return { ok: false, errors: [{ code: "unsupported-version", path: "schemaVersion", message: "Unsupported contract version." }] };
    const parsed = trustedArtifactSchema.safeParse(value);
    if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 32).map(issue => ({ code: "invalid-structure", path: issue.path.join("."), message: "Value does not match the strict structural contract." })) };
    const errors = semanticErrors(parsed.data, options);
    return errors.length ? { ok: false, errors } : { ok: true, value: parsed.data };
  } catch { return { ok: false, errors: [{ code: "invalid-structure", path: "", message: "Input could not be validated." }] }; }
}

/** Cross-field and cross-record authority checks are deliberately not advertised by JSON Schema. */
export function trustedArtifactJsonSchema() {
  return { ...z.toJSONSchema(trustedArtifactSchema, { target: "draft-2020-12" }), $id: "urn:dpf:trusted-agent:0.1.0" };
}
