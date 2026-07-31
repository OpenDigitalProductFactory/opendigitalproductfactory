import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

export const COWORKER_AVAILABILITY_STATES = [
  "available",
  "setup-needed",
  "needs-attention",
  "not-available",
  "coverage-not-defined",
] as const;

export type CoworkerAvailabilityState = (typeof COWORKER_AVAILABILITY_STATES)[number];
export type CoworkerAvailabilityMatchLevel = "leaf" | "category" | null;

export type CoworkerInstallArchetype = {
  archetypeId: string;
  category: string;
};

export type CoworkerAvailabilityEvidence = {
  source:
    | "storefront-archetype"
    | "coworker-service"
    | "coworker-service-archetypes"
    | "readiness-evaluation"
    | "readiness-detail"
    | "availability-blocker"
    | "setup-prerequisite";
  values: string[];
};

export type CoworkerAvailabilityRecoveryKind =
  | "business-type"
  | "catalog"
  | "capabilities"
  | "capability-needs"
  | "lifecycle"
  | "routing";

export type CoworkerAvailabilityRecovery = {
  kind: CoworkerAvailabilityRecoveryKind;
  label: string;
};

type ApplicableProjection = {
  matchLevel: Exclude<CoworkerAvailabilityMatchLevel, null>;
  reason: string;
  evidence: CoworkerAvailabilityEvidence[];
  recovery?: CoworkerAvailabilityRecovery;
};

export type CoworkerAvailabilityProjection =
  | (ApplicableProjection & {
      state: "available";
      label: "Available for your business type";
    })
  | (ApplicableProjection & {
      state: "setup-needed";
      label: "Setup needed";
    })
  | (ApplicableProjection & {
      state: "needs-attention";
      label: "Needs attention";
    })
  | {
      state: "not-available";
      label: "Not available for your business type";
      reason: string;
      matchLevel: null;
      evidence: CoworkerAvailabilityEvidence[];
      recovery?: CoworkerAvailabilityRecovery;
    }
  | {
      state: "coverage-not-defined";
      label: "Coverage not defined";
      reason: string;
      matchLevel: CoworkerAvailabilityMatchLevel;
      evidence: CoworkerAvailabilityEvidence[];
      recovery?: CoworkerAvailabilityRecovery;
    };

export type CoworkerAvailabilityReadiness =
  | {
      status: "evaluated";
      blockers: readonly string[];
      missingPrerequisites: readonly string[];
      details?: readonly string[];
      recovery?: CoworkerAvailabilityRecovery;
    }
  | {
      status: "not-evaluated";
      reason: string;
    };

export type CoworkerAvailabilityProjectionInput = {
  install?: CoworkerInstallArchetype | null;
  installResolutionReason?: string | null;
  declarations: unknown;
  readiness?: CoworkerAvailabilityReadiness;
};

export type CoworkerInstallArchetypeResolution = {
  install: CoworkerInstallArchetype | null;
  installResolutionReason: string;
};

export type CoworkerAvailabilityContextClient = {
  storefrontConfig: {
    findUnique(args: {
      where: {
        organizationId: string;
      };
      select: {
        archetype: {
          select: {
            archetypeId: true;
            category: true;
          };
        };
      };
    }): Promise<{ archetype: CoworkerInstallArchetype | null } | null>;
  };
};

const leafToCategory = new Map<string, string>(
  ALL_ARCHETYPES.map((archetype) => [archetype.archetypeId, archetype.category] as const),
);
const leafIdentifiers: ReadonlySet<string> = new Set(leafToCategory.keys());
const categoryIdentifiers: ReadonlySet<string> = new Set(
  ALL_ARCHETYPES.map((archetype) => archetype.category),
);
export async function resolveInstallArchetypeContext(
  db: CoworkerAvailabilityContextClient,
  organizationId: string,
): Promise<CoworkerInstallArchetypeResolution> {
  try {
    const storefront = await db.storefrontConfig.findUnique({
      where: { organizationId },
      select: {
        archetype: {
          select: {
            archetypeId: true,
            category: true,
          },
        },
      },
    });
    if (!storefront?.archetype) {
      return {
        install: null,
        installResolutionReason: "No storefront business type is configured for this organization.",
      };
    }
    return {
      install: storefront.archetype,
      installResolutionReason: "The storefront business type was resolved.",
    };
  } catch {
    return {
      install: null,
      installResolutionReason: "The storefront business type could not be read.",
    };
  }
}

export function projectCoworkerAvailability(
  input: CoworkerAvailabilityProjectionInput,
): CoworkerAvailabilityProjection {
  const install = validateInstall(input.install);
  if (!install) {
    return coverageNotDefined(
      input.installResolutionReason ??
        "Your business type could not be resolved from the storefront configuration.",
      installEvidence(input.install, input.installResolutionReason),
      null,
      "business-type",
    );
  }

  const declarationResult = validateDeclarations(input.declarations);
  const baseEvidence: CoworkerAvailabilityEvidence[] = [
    {
      source: "storefront-archetype",
      values: [install.archetypeId, install.category],
    },
    {
      source: "coworker-service-archetypes",
      values: declarationResult.evidenceValues,
    },
  ];

  if (!declarationResult.valid) {
    return coverageNotDefined(declarationResult.reason, baseEvidence);
  }

  const matchLevel = declarationResult.leafValues.includes(install.archetypeId)
    ? "leaf"
    : declarationResult.categoryValues.includes(install.category)
      ? "category"
      : null;

  if (!matchLevel) {
    return {
      state: "not-available",
      label: "Not available for your business type",
      reason: `This coworker's explicit coverage does not include ${install.archetypeId} or ${install.category}.`,
      matchLevel: null,
      evidence: baseEvidence,
    };
  }

  if (!input.readiness || input.readiness.status === "not-evaluated") {
    const reason =
      input.readiness?.reason ??
      "Setup and blocker readiness has not been evaluated for this coworker.";
    return coverageNotDefined(
      reason,
      [
        ...baseEvidence,
        {
          source: "readiness-evaluation",
          values: ["not-evaluated", reason],
        },
      ],
      matchLevel,
    );
  }

  const readinessEvidence: CoworkerAvailabilityEvidence = {
    source: "readiness-evaluation",
    values: ["evaluated"],
  };
  const readinessDetails = normalizedFacts(input.readiness.details);
  const detailEvidence: CoworkerAvailabilityEvidence[] =
    readinessDetails.length > 0
      ? [{ source: "readiness-detail", values: readinessDetails }]
      : [];
  const blockers = normalizedFacts(input.readiness.blockers);
  if (blockers.length > 0) {
    return {
      state: "needs-attention",
      label: "Needs attention",
      reason: blockers.join("; "),
      matchLevel,
      evidence: [
        ...baseEvidence,
        readinessEvidence,
        ...detailEvidence,
        {
          source: "availability-blocker",
          values: blockers,
        },
      ],
      ...(input.readiness.recovery
        ? { recovery: input.readiness.recovery }
        : {}),
    };
  }

  const missingPrerequisites = normalizedFacts(input.readiness.missingPrerequisites);
  if (missingPrerequisites.length > 0) {
    return {
      state: "setup-needed",
      label: "Setup needed",
      reason: `Finish setup: ${missingPrerequisites.join(", ")}.`,
      matchLevel,
      evidence: [
        ...baseEvidence,
        readinessEvidence,
        ...detailEvidence,
        {
          source: "setup-prerequisite",
          values: missingPrerequisites,
        },
      ],
      ...(input.readiness.recovery
        ? { recovery: input.readiness.recovery }
        : {}),
    };
  }

  return {
    state: "available",
    label: "Available for your business type",
    reason:
      matchLevel === "leaf"
        ? `This coworker explicitly supports the ${install.archetypeId} business type.`
        : `This coworker supports the ${install.category} business category.`,
    matchLevel,
    evidence: [...baseEvidence, readinessEvidence, ...detailEvidence],
  };
}

function validateInstall(
  install: CoworkerInstallArchetype | null | undefined,
): CoworkerInstallArchetype | null {
  if (!install || typeof install.archetypeId !== "string" || typeof install.category !== "string") {
    return null;
  }
  if (!leafIdentifiers.has(install.archetypeId) || !categoryIdentifiers.has(install.category)) {
    return null;
  }
  if (leafToCategory.get(install.archetypeId) !== install.category) {
    return null;
  }
  return install;
}

function validateDeclarations(declarations: unknown):
  | {
      valid: true;
      values: string[];
      leafValues: string[];
      categoryValues: string[];
      evidenceValues: string[];
    }
  | {
      valid: false;
      values: string[];
      leafValues: string[];
      categoryValues: string[];
      evidenceValues: string[];
      reason: string;
    } {
  if (!Array.isArray(declarations) || declarations.length === 0) {
    return {
      valid: false,
      values: [],
      leafValues: [],
      categoryValues: [],
      evidenceValues: declarationEvidenceValues(declarations),
      reason: "This coworker's business-type coverage has not been defined.",
    };
  }

  const values = declarations.filter((declaration): declaration is string => typeof declaration === "string");
  const allGoverned = declarations.every(
    (declaration) =>
      typeof declaration === "string" &&
      declaration.length > 0 &&
      declaration === declaration.trim() &&
      (leafIdentifiers.has(declaration) || categoryIdentifiers.has(declaration)),
  );

  if (!allGoverned) {
    return {
      valid: false,
      values,
      leafValues: [],
      categoryValues: [],
      evidenceValues: declarationEvidenceValues(declarations),
      reason: "This coworker's business-type coverage contains an unrecognized declaration.",
    };
  }

  const uniqueValues = [...new Set(values)];
  const leafValues = uniqueValues.filter((value) => leafIdentifiers.has(value));
  const categoryValues = uniqueValues.filter(
    (value) => !leafIdentifiers.has(value) && categoryIdentifiers.has(value),
  );
  return { valid: true, values: uniqueValues, leafValues, categoryValues, evidenceValues: uniqueValues };
}

function coverageNotDefined(
  reason: string,
  evidence: CoworkerAvailabilityEvidence[],
  matchLevel: CoworkerAvailabilityMatchLevel = null,
  recoveryKind: "business-type" | "catalog" = "catalog",
): CoworkerAvailabilityProjection {
  return {
    state: "coverage-not-defined",
    label: "Coverage not defined",
    reason,
    matchLevel,
    evidence,
    recovery: {
      kind: recoveryKind,
      label:
        recoveryKind === "business-type"
          ? "Review business type"
          : "Platform update required",
    },
  };
}

function installEvidence(
  install: CoworkerInstallArchetype | null | undefined,
  resolutionReason?: string | null,
): CoworkerAvailabilityEvidence[] {
  if (!install) {
    return [
      {
        source: "storefront-archetype",
        values: [resolutionReason ?? "unresolved"],
      },
    ];
  }
  const values = [install.archetypeId, install.category].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return values.length > 0 ? [{ source: "storefront-archetype", values }] : [];
}

function declarationEvidenceValues(declarations: unknown): string[] {
  if (!Array.isArray(declarations)) {
    return [`<not-an-array:${typeof declarations}>`];
  }
  if (declarations.length === 0) return ["<empty>"];
  return declarations.map((declaration) =>
    typeof declaration === "string" ? declaration : `<non-string:${typeof declaration}>`,
  );
}

function normalizedFacts(values: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
}
