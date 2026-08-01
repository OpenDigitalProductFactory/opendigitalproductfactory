import { z } from "zod";

import {
  ROUTE_AUDIENCES,
  ROUTE_DESTINATION_KINDS,
} from "../navigation/route-audience";
import { UX_SHELLS } from "./budgets";
import { ROUTE_SWEEP_EXCLUSION_REASONS } from "./route-shells";

const nonEmptyString = z.string().trim().min(1);
const nonEmptyStrings = z.array(nonEmptyString).min(1);
const identityKey = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), {
    message: "Identity keys cannot have leading or trailing whitespace.",
  });
const evidenceValue = z.union([z.string(), z.number(), z.boolean()]);
const evidenceMap = z.record(z.string(), evidenceValue);

const derivedRoutePurposeSchema = z
  .object({
    audience: z.enum(ROUTE_AUDIENCES),
    destinationKind: z.enum(ROUTE_DESTINATION_KINDS),
    shell: z.enum(UX_SHELLS),
    confidence: z.enum(["high", "low"]),
    sweepEligible: z.boolean(),
    sweepExclusionReason: z.enum(ROUTE_SWEEP_EXCLUSION_REASONS).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sweepEligible === Boolean(value.sweepExclusionReason)) {
      context.addIssue({
        code: "custom",
        message:
          "A route must be sweep-eligible or carry one exclusion reason, never both.",
      });
    }
  });

const purposeIntentSchema = z
  .object({
    primaryUser: nonEmptyString,
    triggeringNeed: nonEmptyString,
    prerequisites: z.array(nonEmptyString),
    job: nonEmptyString,
    successOutcome: nonEmptyString,
    findability: z
      .object({
        parentArea: nonEmptyString,
        entryPoints: nonEmptyStrings,
        navigationLayer: nonEmptyString,
        discoveryCue: nonEmptyString,
        expectedPath: nonEmptyStrings,
      })
      .strict(),
    contentRoles: z
      .object({
        defaultVisibleKeys: nonEmptyStrings,
        deferredRegions: z.array(
          z
            .object({
              key: nonEmptyString,
              role: nonEmptyString,
              trigger: nonEmptyString,
              defaultExpandedInScenarios: nonEmptyStrings.optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    familyConsistency: z
      .object({
        terminology: nonEmptyString,
        actionLocation: nonEmptyString,
        feedbackPrimitive: nonEmptyString,
        disclosurePattern: nonEmptyString,
        returnBehavior: nonEmptyString,
      })
      .strict(),
  })
  .strict();

const stateSourceSchema = z
  .object({
    oracleKey: z.enum([
      "self-upgrade-status",
      "fixture-read-model",
      "route-owned-read-model",
    ]),
    sourceRef: nonEmptyString,
  })
  .strict();

const primaryExperienceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("command"),
      actionKey: nonEmptyString,
    })
    .strict(),
  z
    .object({
      kind: z.literal("informational"),
      messageKey: nonEmptyString,
    })
    .strict(),
]);

const purposeStateScenarioSchema = z
  .object({
    statePredicate: nonEmptyString,
    stateSource: stateSourceSchema,
    essentialEvidenceKeys: nonEmptyStrings,
    primaryExperience: primaryExperienceSchema,
    prohibitedActionKeys: z.array(nonEmptyString),
    completionSignalKey: identityKey,
    completionSignal: nonEmptyString,
    correctionSignalKey: identityKey,
    errorCorrection: nonEmptyString,
    recovery: z
      .object({
        actionKey: nonEmptyString,
        routePath: z.string().startsWith("/"),
      })
      .strict(),
  })
  .strict();

const stateScenariosSchema = z
  .record(identityKey, purposeStateScenarioSchema)
  .refine((value) => Object.keys(value).length > 0, {
    message: "A ratified contract needs at least one state scenario.",
  });

const taskValidationProtocolSchema = z
  .object({
    startRoute: z.string().startsWith("/"),
    taskPrompt: nonEmptyString,
    completionOracle: nonEmptyString,
    falseSuccessConditions: nonEmptyStrings,
    acceptanceThresholds: nonEmptyStrings,
  })
  .strict();

const intentEvidenceRefSchema = z
  .object({
    kind: z.enum([
      "operator-request",
      "user-research",
      "design-review",
      "governance-decision",
      "existing-behavior",
    ]),
    ref: nonEmptyString,
    summary: nonEmptyString,
  })
  .strict();

const validationReceiptBase = z.object({
  schemaVersion: z.literal(1),
  routePath: nonEmptyString,
  contractHash: nonEmptyString,
  sourceSha: nonEmptyString,
  fixtureVersion: nonEmptyString,
  viewport: nonEmptyString,
  inputMode: z.enum(["pointer", "keyboard", "touch", "assistive-technology"]),
  interactionFingerprint: nonEmptyString,
  relevantDependencyFingerprint: nonEmptyString,
  evidenceFingerprint: nonEmptyString,
  metrics: evidenceMap,
  thresholds: evidenceMap,
  reviewerRef: nonEmptyString,
  observedAt: z.iso.datetime(),
  artifactIds: nonEmptyStrings,
});

const validationTargetSchema = z
  .object({
    artifacts: z
      .array(
        z
          .object({
            id: nonEmptyString,
            path: nonEmptyString,
            role: z.enum([
              "fixture",
              "interaction",
              "dependency",
              "evidence",
            ]),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(4),
  })
  .strict()
  .superRefine((value, context) => {
    for (const role of [
      "fixture",
      "interaction",
      "dependency",
      "evidence",
    ] as const) {
      if (!value.artifacts.some((artifact) => artifact.role === role)) {
        context.addIssue({
          code: "custom",
          path: ["artifacts"],
          message: `Validation target requires ${role === "evidence" ? "an" : "a"} ${role} artifact.`,
        });
      }
    }
  });

const taskValidationReceiptSchema = z.discriminatedUnion("evidenceClass", [
  validationReceiptBase
    .extend({
      evidenceClass: z.literal("automated-functional"),
      runnerRef: nonEmptyString,
      completionOracleResult: z.enum(["passed", "failed"]),
    })
    .strict(),
  validationReceiptBase
    .extend({
      evidenceClass: z.literal("expert-evaluation"),
      evaluatorProfile: nonEmptyString,
      methodRef: nonEmptyString,
    })
    .strict(),
  validationReceiptBase
    .extend({
      evidenceClass: z.literal("representative-user"),
      participantCohort: z
        .object({
          cohortId: nonEmptyString,
          recruitmentCriteria: nonEmptyStrings,
          relevantExperience: nonEmptyString,
          participantCount: z.number().int().positive(),
        })
        .strict(),
      participantAttestationRef: nonEmptyString,
    })
    .strict(),
  validationReceiptBase
    .extend({
      evidenceClass: z.literal("benchmark"),
      sampleSize: z.number().int().positive(),
      taskProtocolVersion: nonEmptyString,
      baselineRoundRef: nonEmptyString,
      completionRate: z.number().min(0).max(1),
      timingDistribution: z
        .object({
          medianMs: z.number().nonnegative(),
          p90Ms: z.number().nonnegative(),
        })
        .strict(),
      easeAndConfidence: z
        .object({
          easeMean: z.number(),
          confidenceMean: z.number(),
        })
        .strict(),
      repeatabilityThreshold: nonEmptyString,
      comparisonResult: z.enum(["improved", "equivalent", "regressed"]),
    })
    .strict(),
]);

const consequentialActionSchema = z
  .object({
    actionKey: identityKey,
    noActionConsequence: nonEmptyString,
    reversibility: nonEmptyString,
    confirmation: nonEmptyString,
    authority: nonEmptyString,
    recovery: nonEmptyString,
  })
  .strict();

const aiMediatedSchema = z
  .object({
    capabilityScope: nonEmptyString,
    readinessDisclosure: nonEmptyString,
    uncertaintyDisclosure: nonEmptyString,
    invocation: nonEmptyString,
    dismissal: nonEmptyString,
    correction: nonEmptyString,
    explanation: nonEmptyString,
    consequenceControls: nonEmptyString,
    returnContext: nonEmptyString,
  })
  .strict();

const draftPurposeRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal("draft"),
    routePath: nonEmptyString,
    derived: derivedRoutePurposeSchema,
    suggestions: purposeIntentSchema.partial().strict().optional(),
  })
  .strict();

function validateConsequentialActionBinding(
  value: {
    consequentialAction?: { actionKey: string };
    validationReceipts?: unknown[];
    validationTarget?: unknown;
    stateScenarios: Record<
      string,
      { primaryExperience: z.infer<typeof primaryExperienceSchema> }
    >;
  },
  context: z.RefinementCtx,
) {
  const actionKey = value.consequentialAction?.actionKey;
  if (
    actionKey &&
    !Object.values(value.stateScenarios).some(
      (scenario) =>
        scenario.primaryExperience.kind === "command" &&
        scenario.primaryExperience.actionKey === actionKey,
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["consequentialAction", "actionKey"],
      message:
        "A consequential action must match a command scenario primary action.",
    });
  }
}

function validateRatifiedPurposeContract(
  value: {
    consequentialAction?: { actionKey: string };
    validationReceipts?: unknown[];
    validationTarget?: unknown;
    stateScenarios: Record<
      string,
      { primaryExperience: z.infer<typeof primaryExperienceSchema> }
    >;
    intent: {
      contentRoles: {
        deferredRegions: Array<{
          defaultExpandedInScenarios?: string[];
        }>;
      };
    };
  },
  context: z.RefinementCtx,
) {
  validateConsequentialActionBinding(value, context);
  if (value.validationReceipts?.length && !value.validationTarget) {
    context.addIssue({
      code: "custom",
      path: ["validationTarget"],
      message:
        "Validation receipts require a production-resolvable validation target.",
    });
  }
  const scenarioKeys = new Set(Object.keys(value.stateScenarios));
  value.intent.contentRoles.deferredRegions.forEach((region, regionIndex) => {
    region.defaultExpandedInScenarios?.forEach((stateKey, stateIndex) => {
      if (!scenarioKeys.has(stateKey)) {
        context.addIssue({
          code: "custom",
          path: [
            "intent",
            "contentRoles",
            "deferredRegions",
            regionIndex,
            "defaultExpandedInScenarios",
            stateIndex,
          ],
          message: `Expanded disclosure scenario ${stateKey} is not defined.`,
        });
      }
    });
  });
}

const ratifiedPurposeContractObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal("intent-ratified"),
    routePath: nonEmptyString,
    derived: derivedRoutePurposeSchema,
    intent: purposeIntentSchema,
    stateScenarios: stateScenariosSchema,
    taskProtocol: taskValidationProtocolSchema,
    ratifiedBy: z
      .object({
        role: z.enum(["owner", "design-owner"]),
        ref: nonEmptyString,
      })
      .strict(),
    reviewRef: nonEmptyString,
    intentEvidenceRefs: z.array(intentEvidenceRefSchema).min(1),
    validationReceipts: z.array(taskValidationReceiptSchema).min(1).optional(),
    validationTarget: validationTargetSchema.optional(),
    consequentialAction: consequentialActionSchema.optional(),
    aiMediated: aiMediatedSchema.optional(),
  })
  .strict();

const ratifiedPurposeContractSchema =
  ratifiedPurposeContractObjectSchema.superRefine(
    validateRatifiedPurposeContract,
  );

const quarantinedPurposeRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal("intent-quarantined"),
    routePath: nonEmptyString,
    derived: derivedRoutePurposeSchema,
    quarantine: z
      .object({
        reason: nonEmptyString,
        incidentRef: nonEmptyString,
        reviewRef: nonEmptyString,
        approvedBy: z
          .object({
            role: z.enum(["owner", "design-owner"]),
            ref: nonEmptyString,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const ratifiedPurposeContractSourceSchema =
  ratifiedPurposeContractObjectSchema
    .omit({ derived: true })
    .superRefine(validateRatifiedPurposeContract);
export const quarantinedPurposeContractSourceSchema =
  quarantinedPurposeRecordSchema.omit({ derived: true });
export const purposeContractSourceSchema = z.discriminatedUnion("status", [
  ratifiedPurposeContractSourceSchema,
  quarantinedPurposeContractSourceSchema,
]);

export const pagePurposeContractSchema = z.discriminatedUnion("status", [
  draftPurposeRecordSchema,
  ratifiedPurposeContractSchema,
  quarantinedPurposeRecordSchema,
]);

export const pagePurposeRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    generator: z.literal("apps/web/scripts/build-page-purpose.ts"),
    pageRouteCount: z.number().int().nonnegative(),
    draftCount: z.number().int().nonnegative(),
    ratifiedCount: z.number().int().nonnegative(),
    quarantinedCount: z.number().int().nonnegative(),
    routes: z.array(pagePurposeContractSchema),
  })
  .strict()
  .superRefine((registry, context) => {
    if (registry.routes.length !== registry.pageRouteCount) {
      context.addIssue({
        code: "custom",
        message: "pageRouteCount must match the route array.",
      });
    }
    if (
      registry.draftCount +
        registry.ratifiedCount +
        registry.quarantinedCount !==
      registry.pageRouteCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Draft, ratified, and quarantined counts must reconcile with pageRouteCount.",
      });
    }
    const actualDraftCount = registry.routes.filter(
      (route) => route.status === "draft",
    ).length;
    const actualRatifiedCount = registry.routes.filter(
      (route) => route.status === "intent-ratified",
    ).length;
    const actualQuarantinedCount = registry.routes.filter(
      (route) => route.status === "intent-quarantined",
    ).length;
    if (registry.draftCount !== actualDraftCount) {
      context.addIssue({
        code: "custom",
        message: "draftCount must match the actual draft route count.",
      });
    }
    if (registry.ratifiedCount !== actualRatifiedCount) {
      context.addIssue({
        code: "custom",
        message: "ratifiedCount must match the actual ratified route count.",
      });
    }
    if (registry.quarantinedCount !== actualQuarantinedCount) {
      context.addIssue({
        code: "custom",
        message:
          "quarantinedCount must match the actual quarantined route count.",
      });
    }
    if (new Set(registry.routes.map((route) => route.routePath)).size !== registry.routes.length) {
      context.addIssue({
        code: "custom",
        message: "Every route must appear exactly once.",
      });
    }
  });

export const purposeIdentityBaselineSchema = z
  .object({
    schemaVersion: z.literal(1),
    legacyDraftRoutePaths: z.array(nonEmptyString),
  })
  .strict()
  .superRefine((baseline, context) => {
    if (
      new Set(baseline.legacyDraftRoutePaths).size !==
      baseline.legacyDraftRoutePaths.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Legacy draft route identities must be unique.",
      });
    }
  });

export type DerivedRoutePurpose = z.infer<typeof derivedRoutePurposeSchema>;
export type DraftPurposeRecord = z.infer<typeof draftPurposeRecordSchema>;
export type RatifiedPurposeContract = z.infer<typeof ratifiedPurposeContractSchema>;
export type QuarantinedPurposeRecord = z.infer<
  typeof quarantinedPurposeRecordSchema
>;
export type RatifiedPurposeContractSource = z.infer<
  typeof ratifiedPurposeContractSourceSchema
>;
export type PurposeContractSource = z.infer<
  typeof purposeContractSourceSchema
>;
export type PagePurposeContract = z.infer<typeof pagePurposeContractSchema>;
export type PagePurposeRegistry = z.infer<typeof pagePurposeRegistrySchema>;
export type PurposeIdentityBaseline = z.infer<typeof purposeIdentityBaselineSchema>;
export type TaskValidationReceipt = z.infer<typeof taskValidationReceiptSchema>;

export function parsePagePurposeContract(value: unknown): PagePurposeContract {
  return pagePurposeContractSchema.parse(value);
}

export function parsePagePurposeRegistry(value: unknown): PagePurposeRegistry {
  return pagePurposeRegistrySchema.parse(value);
}

export function parsePurposeIdentityBaseline(value: unknown): PurposeIdentityBaseline {
  return purposeIdentityBaselineSchema.parse(value);
}
