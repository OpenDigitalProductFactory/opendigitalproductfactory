import { z } from "zod";

// Inert wire contract. Parsing establishes shape and local invariants only.
// Neither the projection nor any reference in it is accepted as authority.
export const S5_LAUNCH_WIRE_VERSION = "s5-launch.v1";
const version = z.literal(S5_LAUNCH_WIRE_VERSION);
const ROUTE_HANDOFF_ACTIVITY = "s5-route-handoff";
const key = z.string().min(1).max(256).regex(/^\S+$/u);
const ref = z.string().min(1).max(256).regex(/^[a-zA-Z0-9][a-zA-Z0-9:._/-]*$/u);
const operation = z.string().min(1).max(128).regex(/^[a-z][a-z0-9_.-]*$/u);
const instant = z.int().nonnegative(); // Unix milliseconds, as used by resolveS5JsiEligibility.
const versionedRef = z.strictObject({ id: key, version: key });
const subject = z.strictObject({
  principalId: key,
  gaid: z.string().max(256).regex(/^gaid:[^\s]+$/u),
});

// The launch transports the resolver's selector minus its subject. The same
// single authenticated subject block is used to reconstruct the full selector.
const eligible = z.strictObject({
  kind: z.literal("eligible"),
  qualification: z.strictObject({ id: key, version: z.int().positive(), statusRevision: z.int().positive() }),
  validUntil: instant,
  selector: z.strictObject({
    organizationId: key,
    installationId: key,
    job: versionedRef,
    activityKey: key,
    scope: z.strictObject({ workflow: key, archetype: key, jurisdiction: key, dataClass: key, riskClass: key }),
    profileFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    scheme: versionedRef,
  }),
});
const noScheme = z.strictObject({ kind: z.literal("not-applicable"), activityKey: key });

const binding = {
  issuer: key, // DPF installation identity, verified independently of the payload.
  audience: key, // The exact DPF2 Control receiver, not a guest or T3 actor id.
  hostRef: ref,
  workroomId: ref,
  sessionRef: ref,
  stageKey: key,
  stageAttemptRef: ref,
};
const caseKey = z.string().max(256).regex(/^[a-z][a-z0-9-]*:[a-zA-Z0-9][a-zA-Z0-9_-]*$/u);
const recipient = z.strictObject({ authorityRef: ref, destinationRef: ref, reservationRef: ref });
const coordinationOperations = ["get_workroom", "read_room_messages", "post_room_message"] as const;
const budget = z.strictObject({
  maxInputBytes: z.int().positive(),
  maxInputTokens: z.int().positive(),
  maxOutputTokens: z.int().positive(),
  maxReasoningTokens: z.int().nonnegative(),
});
const coordinationBudget = budget.extend({
  maxInputTokens: budget.shape.maxInputTokens.max(10_000),
  maxOutputTokens: budget.shape.maxOutputTokens.max(1_200),
});
const launch = {
  schemaVersion: version,
  kind: z.literal("launch"),
  ...binding,
  caseKey,
  subject,
  issuedAt: instant,
  expiresAt: instant,
  authority: z.strictObject({ bindingRef: ref, permitRef: ref, grantKeys: z.array(key).max(128) }),
};
const coordinationLaunch = z.strictObject({
  ...launch,
  mode: z.literal("read-only-coordination"),
  permittedOperations: z.array(z.enum(coordinationOperations)).min(1).max(coordinationOperations.length),
  jsi: eligible,
  budget: coordinationBudget,
  coordination: z.strictObject({ recipient, postEffects: z.literal("proposal-only-no-wake") }),
});
const codingLaunch = z.strictObject({
  ...launch,
  mode: z.literal("bounded-coding"),
  worktreeRef: ref,
  permittedOperations: z.array(operation).min(1).max(128),
  jsi: z.discriminatedUnion("kind", [eligible, noScheme]),
  budget,
});

export const s5LaunchProjectionSchema = z.discriminatedUnion("mode", [coordinationLaunch, codingLaunch])
  .superRefine((value, ctx) => {
    const issue = (field: string, message: string) => ctx.addIssue({ code: "custom", path: [field], message });
    if (new Set(value.permittedOperations).size !== value.permittedOperations.length) issue("permittedOperations", "Operation names must be unique");
    if (new Set(value.authority.grantKeys).size !== value.authority.grantKeys.length) issue("authority", "Grant keys must be unique");
    if (value.issuedAt >= value.expiresAt) issue("expiresAt", "Launch expiry must follow issuance");
    if (value.budget.maxReasoningTokens > value.budget.maxOutputTokens) issue("budget", "Reasoning must fit within the output limit");
    const activityKey = value.jsi.kind === "eligible" ? value.jsi.selector.activityKey : value.jsi.activityKey;
    if ((activityKey === ROUTE_HANDOFF_ACTIVITY) !== (value.mode === "read-only-coordination")) issue("jsi", "Activity does not match the launch mode");
    if (value.jsi.kind === "eligible" && (value.jsi.selector.installationId !== value.issuer || value.expiresAt > value.jsi.validUntil)) {
      issue("jsi", "Qualification must cover the issuing installation and launch window");
    }
  });
export type S5LaunchProjection = z.infer<typeof s5LaunchProjectionSchema>;

export function hydrateS5JsiSelector(value: { subject: S5LaunchProjection["subject"]; jsi: z.infer<typeof eligible> }) {
  return { ...value.jsi.selector, subject: value.subject };
}

const operationId = z.string().regex(/^room-operation:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
const broker = { schemaVersion: version, ...binding, operationId, operation: z.literal("post_room_message") };
export const s5BrokerCallSchema = z.strictObject({
  ...broker,
  kind: z.literal("coordination-broker-call"),
  args: z.strictObject({
    caseKey,
    // The v1 pilot conservatively rejects all @ text. Nothing reaches the
    // ordinary post path, even a post without addressees or mentions.
    body: z.string().min(1).max(2_000).regex(/^[^@]+$/u),
    recipient,
  }),
});
export type S5BrokerCall = z.infer<typeof s5BrokerCallSchema>;

export const s5BrokerReceiptSchema = z.strictObject({
  ...broker,
  kind: z.literal("coordination-broker-receipt"),
  result: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("proposal-recorded"), proposalRef: ref }),
    z.strictObject({ kind: z.literal("refused") }),
  ]),
});
export type S5BrokerReceipt = z.infer<typeof s5BrokerReceiptSchema>;

export const s5ProviderPreflightSchema = z.strictObject({
  schemaVersion: version,
  kind: z.literal("provider-preflight"),
  ...binding,
  providerCallRef: ref,
  providerModelRef: ref,
  appliedLimits: budget,
  input: z.strictObject({
    tokenizerRef: ref,
    totalBytes: z.int().positive(),
    totalTokens: z.int().positive(),
    bytesByPart: z.strictObject({
      prompt: z.int().nonnegative(),
      projection: z.int().nonnegative(),
      roomContext: z.int().nonnegative(),
      toolSchemas: z.int().nonnegative(),
      framing: z.int().nonnegative(),
    }),
  }),
}).superRefine(({ input, appliedLimits }, ctx) => {
  const measured = Object.values(input.bytesByPart).reduce((sum, bytes) => sum + bytes, 0);
  if (measured !== input.totalBytes || input.totalBytes > appliedLimits.maxInputBytes || input.totalTokens > appliedLimits.maxInputTokens) {
    ctx.addIssue({ code: "custom", path: ["input"], message: "Input must be fully accounted for and fit its applied limits" });
  }
  if (appliedLimits.maxReasoningTokens > appliedLimits.maxOutputTokens) {
    ctx.addIssue({ code: "custom", path: ["appliedLimits"], message: "Reasoning must fit within the output limit" });
  }
});
export type S5ProviderPreflight = z.infer<typeof s5ProviderPreflightSchema>;

// JSON Schema exports structural constraints only. See the linked contract for
// cross-field invariants and consumers' authenticated expected-state checks.
export function s5LaunchWireJsonSchema() {
  return {
    ...z.toJSONSchema(z.union([s5LaunchProjectionSchema, s5BrokerCallSchema, s5BrokerReceiptSchema, s5ProviderPreflightSchema]), {
      target: "draft-2020-12",
      io: "input",
      reused: "ref",
    }),
    $id: "urn:dpf:workroom:s5-launch:v1",
  };
}
