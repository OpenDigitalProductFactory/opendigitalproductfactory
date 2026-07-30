import type {
  PagePurposeContract,
  TaskValidationReceipt,
} from "./page-purpose";

export const PURPOSE_CHECK_IDS = [
  "purpose-intent",
  "served-dom-evidence",
  "route-marker",
  "state-oracle",
  "state-scenario",
  "single-h1",
  "essential-evidence",
  "primary-experience",
  "first-viewport-action",
  "prohibited-action",
  "completion-signal",
  "correction-signal",
  "recovery-signal",
  "disclosure-contract",
  "consequential-action",
  "ai-mediated-action",
] as const;

export type PurposeCheckId = (typeof PURPOSE_CHECK_IDS)[number];
export type PurposeIntentStatus = PagePurposeContract["status"];
export type PurposeStructuralStatus =
  | "not-evaluated"
  | "conformant"
  | "nonconformant";
export type PurposeEnforcement = "advisory" | "blocking";
export type ValidationReceiptStatus = "current" | "stale" | "failed";
export type ValidationOverallStatus =
  | "not-validated"
  | "current"
  | "stale"
  | "failed";
export type ValidationEvidenceClass = TaskValidationReceipt["evidenceClass"];

export type PurposeFinding = {
  checkId: PurposeCheckId;
  severity: "blocking" | "advisory";
  message: string;
};

export type PurposeActionEvidence = {
  key: string;
  primary: boolean;
  visible: boolean;
  geometry: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  href?: string;
};

export type PurposeDisclosureEvidence = {
  key: string;
  triggerPresent: boolean;
  controlledRegionPresent: boolean;
  relationshipValid: boolean;
  expanded: boolean;
};

export type PurposeDomEvidence = {
  routePath: string | null;
  stateKey: string | null;
  h1Count: number;
  purposeKeys: string[];
  actions: PurposeActionEvidence[];
  messages: string[];
  prohibitedActionKeysPresent: string[];
  completionSignalKeys: string[];
  correctionSignalKeys: string[];
  recoverySignal: {
    present: boolean;
    actionKey: string | null;
    routePath: string | null;
  };
  disclosures: PurposeDisclosureEvidence[];
  consequentialAction?: {
    consequenceVisible: boolean;
    reversibilityVisible: boolean;
    confirmationAvailable: boolean;
    authorityVisible: boolean;
    recoveryVisible: boolean;
  };
  aiMediatedAction?: {
    capabilityVisible: boolean;
    readinessVisible: boolean;
    uncertaintyVisible: boolean;
    correctionAvailable: boolean;
    explanationAvailable: boolean;
    consequenceControlsVisible: boolean;
    returnContextVisible: boolean;
  };
  viewport: { width: number; height: number };
};

export type PurposeStateOracle = {
  routePath: string;
  stateKey: string;
  oracleKey: string;
  sourceRef: string;
};

export type PurposeEvaluationContext = {
  contractHash: string;
  fixtureVersion: string;
  interactionFingerprint: string;
  relevantDependencyFingerprint: string;
  resolvedArtifactIds: ReadonlySet<string>;
};

export type EvaluatedValidationReceipt = {
  evidenceClass: ValidationEvidenceClass;
  reviewerRef: string;
  status: ValidationReceiptStatus;
  reasons: string[];
};

export type PurposeValidationStatus = {
  overall: ValidationOverallStatus;
  classes: Partial<Record<ValidationEvidenceClass, ValidationReceiptStatus>>;
  receipts: EvaluatedValidationReceipt[];
};

export type RoutePurposeEvaluation = {
  routePath: string;
  intentStatus: PurposeIntentStatus;
  structuralStatus: PurposeStructuralStatus;
  validation: PurposeValidationStatus;
  enforcement: PurposeEnforcement;
  findings: PurposeFinding[];
  blocking: boolean;
};

export type PurposeCoverageSummary = {
  routeCount: number;
  intentRatifiedCount: number;
  draftCount: number;
  quarantinedCount: number;
  structurallyConformantCount: number;
  structurallyNonconformantCount: number;
  structurallyNotEvaluatedCount: number;
  taskValidatedCount: number;
};

type EvaluateRoutePurposeInput = {
  contract: PagePurposeContract;
  oracle?: PurposeStateOracle | null;
  evidence?: PurposeDomEvidence | null;
  context?: PurposeEvaluationContext;
  enforcement?: PurposeEnforcement;
};

function validationStatus(
  contract: PagePurposeContract,
  context: PurposeEvaluationContext | undefined,
): PurposeValidationStatus {
  if (
    contract.status !== "intent-ratified" ||
    !contract.validationReceipts?.length
  ) {
    return { overall: "not-validated", classes: {}, receipts: [] };
  }

  const latestByClass = new Map<
    ValidationEvidenceClass,
    TaskValidationReceipt
  >();
  for (const receipt of contract.validationReceipts) {
    const current = latestByClass.get(receipt.evidenceClass);
    if (
      !current ||
      Date.parse(receipt.observedAt) >= Date.parse(current.observedAt)
    ) {
      latestByClass.set(receipt.evidenceClass, receipt);
    }
  }

  const receipts = [...latestByClass.values()].map((receipt) => {
    const reasons: string[] = [];
    if (!context) {
      reasons.push("No validation context resolved.");
    } else {
      if (receipt.routePath !== contract.routePath) {
        reasons.push("Route does not match the contract.");
      }
      if (receipt.contractHash !== context.contractHash) {
        reasons.push("Contract fingerprint changed.");
      }
      if (receipt.fixtureVersion !== context.fixtureVersion) {
        reasons.push("Fixture version changed.");
      }
      if (receipt.interactionFingerprint !== context.interactionFingerprint) {
        reasons.push("Interaction fingerprint changed.");
      }
      if (
        receipt.relevantDependencyFingerprint !==
        context.relevantDependencyFingerprint
      ) {
        reasons.push("A relevant dependency changed.");
      }
      const unresolved = receipt.artifactIds.filter(
        (artifactId) => !context.resolvedArtifactIds.has(artifactId),
      );
      if (unresolved.length > 0) {
        reasons.push(`Evidence artifact did not resolve: ${unresolved.join(", ")}.`);
      }
    }
    if (receipt.evidenceClass === "automated-functional") {
      for (const [stateKey, scenario] of Object.entries(
        contract.stateScenarios,
      )) {
        const metricPrefix = `state.${stateKey}`;
        if (
          receipt.metrics[`${metricPrefix}.completionSignalKey`] !==
            scenario.completionSignalKey ||
          receipt.metrics[`${metricPrefix}.completionObserved`] !== true
        ) {
          reasons.push(
            `Completion outcome was not proven for state ${stateKey}.`,
          );
        }
        if (
          receipt.metrics[`${metricPrefix}.correctionSignalKey`] !==
            scenario.correctionSignalKey ||
          receipt.metrics[`${metricPrefix}.correctionObserved`] !== true
        ) {
          reasons.push(
            `Correction outcome was not proven for state ${stateKey}.`,
          );
        }
      }
    }

    const failed =
      (receipt.evidenceClass === "automated-functional" &&
        receipt.completionOracleResult === "failed") ||
      (receipt.evidenceClass === "benchmark" &&
        receipt.comparisonResult === "regressed");

    return {
      evidenceClass: receipt.evidenceClass,
      reviewerRef: receipt.reviewerRef,
      status: failed ? "failed" : reasons.length > 0 ? "stale" : "current",
      reasons,
    } satisfies EvaluatedValidationReceipt;
  });

  const classes: PurposeValidationStatus["classes"] = {};
  for (const receipt of receipts) {
    classes[receipt.evidenceClass] = receipt.status;
  }

  const overall: ValidationOverallStatus = receipts.some(
    (receipt) => receipt.status === "failed",
  )
    ? "failed"
    : receipts.some((receipt) => receipt.status === "stale")
      ? "stale"
      : "current";

  return { overall, classes, receipts };
}

function isInsideViewport(
  action: PurposeActionEvidence,
  viewport: PurposeDomEvidence["viewport"],
): boolean {
  return (
    action.visible &&
    action.geometry.top >= 0 &&
    action.geometry.left >= 0 &&
    action.geometry.bottom <= viewport.height &&
    action.geometry.right <= viewport.width &&
    action.geometry.bottom > action.geometry.top &&
    action.geometry.right > action.geometry.left
  );
}

export function routeMatchesPurposeTemplate(
  template: string,
  concretePath: string,
): boolean {
  if (template === concretePath) return true;
  const templateSegments = template.split("/").filter(Boolean);
  const concreteSegments = concretePath.split("/").filter(Boolean);

  for (let index = 0; index < templateSegments.length; index += 1) {
    const segment = templateSegments[index];
    if (/^\[\[\.\.\.[^\]]+\]\]$/.test(segment)) return true;
    if (/^\[\.\.\.[^\]]+\]$/.test(segment)) {
      return concreteSegments.length > index;
    }
    if (index >= concreteSegments.length) return false;
    if (/^\[[^\]]+\]$/.test(segment)) continue;
    if (segment !== concreteSegments[index]) return false;
  }
  return concreteSegments.length === templateSegments.length;
}

export function evaluateRoutePurpose({
  contract,
  oracle,
  evidence,
  context,
  enforcement = "advisory",
}: EvaluateRoutePurposeInput): RoutePurposeEvaluation {
  const findings: PurposeFinding[] = [];
  const validation = validationStatus(contract, context);
  const add = (
    checkId: PurposeCheckId,
    message: string,
    severity: PurposeFinding["severity"] = "blocking",
  ) => findings.push({ checkId, severity, message });

  if (contract.status === "draft") {
    add(
      "purpose-intent",
      "The route has no owner-ratified Purpose Contract.",
      "advisory",
    );
    return {
      routePath: contract.routePath,
      intentStatus: contract.status,
      structuralStatus: "not-evaluated",
      validation,
      enforcement,
      findings,
      blocking: false,
    };
  }

  if (contract.status === "intent-quarantined") {
    add(
      "purpose-intent",
      `Purpose evaluation is quarantined: ${contract.quarantine.reason}`,
      "advisory",
    );
    return {
      routePath: contract.routePath,
      intentStatus: contract.status,
      structuralStatus: "not-evaluated",
      validation,
      enforcement,
      findings,
      blocking: false,
    };
  }

  if (!evidence) {
    add("served-dom-evidence", "No served-DOM purpose evidence was captured.");
  }
  if (!oracle) {
    add("state-oracle", "No independent state oracle was resolved.");
  }

  if (!evidence || !oracle) {
    const excludedFromGenericSweep =
      !contract.derived.sweepEligible && !evidence && !oracle;
    return {
      routePath: contract.routePath,
      intentStatus: contract.status,
      structuralStatus: excludedFromGenericSweep
        ? "not-evaluated"
        : "nonconformant",
      validation,
      enforcement,
      findings,
      blocking: enforcement === "blocking" && !excludedFromGenericSweep,
    };
  }

  if (
    evidence.routePath !== contract.routePath ||
    oracle.routePath !== contract.routePath
  ) {
    add(
      "route-marker",
      `Expected route marker ${contract.routePath}; received DOM ${String(
        evidence.routePath,
      )} and oracle ${oracle.routePath}.`,
    );
  }
  if (evidence.stateKey !== oracle.stateKey) {
    add(
      "state-oracle",
      `Rendered state ${String(evidence.stateKey)} does not match oracle state ${oracle.stateKey}.`,
    );
  }

  const scenario = contract.stateScenarios[oracle.stateKey];
  if (!scenario) {
    add(
      "state-scenario",
      `Oracle state ${oracle.stateKey} has no ratified scenario.`,
    );
  } else if (
    oracle.oracleKey !== scenario.stateSource.oracleKey ||
    oracle.sourceRef !== scenario.stateSource.sourceRef
  ) {
    add(
      "state-oracle",
      `Expected oracle ${scenario.stateSource.oracleKey} from ${scenario.stateSource.sourceRef}; received ${oracle.oracleKey} from ${oracle.sourceRef}.`,
    );
  }

  if (evidence.h1Count !== 1) {
    add("single-h1", `Expected one H1; found ${evidence.h1Count}.`);
  }

  if (scenario) {
    const missingEvidence = scenario.essentialEvidenceKeys.filter(
      (key) => !evidence.purposeKeys.includes(key),
    );
    if (missingEvidence.length > 0) {
      add(
        "essential-evidence",
        `Missing required purpose evidence: ${missingEvidence.join(", ")}.`,
      );
    }

    if (scenario.primaryExperience.kind === "command") {
      const action = evidence.actions.find(
        (candidate) =>
          candidate.key === scenario.primaryExperience.actionKey &&
          candidate.primary,
      );
      if (!action) {
        add(
          "primary-experience",
          `Primary command ${scenario.primaryExperience.actionKey} is absent.`,
        );
      } else if (!isInsideViewport(action, evidence.viewport)) {
        add(
          "first-viewport-action",
          `Primary command ${scenario.primaryExperience.actionKey} is not fully visible in the first viewport.`,
        );
      }
    } else if (
      !evidence.messages.includes(scenario.primaryExperience.messageKey)
    ) {
      add(
        "primary-experience",
        `Primary message ${scenario.primaryExperience.messageKey} is absent.`,
      );
    }

    const prohibited = new Set([
      ...evidence.prohibitedActionKeysPresent,
      ...evidence.actions
        .map((action) => action.key)
        .filter((key) => scenario.prohibitedActionKeys.includes(key)),
    ]);
    if (prohibited.size > 0) {
      add(
        "prohibited-action",
        `Prohibited actions are present: ${[...prohibited].join(", ")}.`,
      );
    }
    if (
      !evidence.completionSignalKeys.includes(scenario.completionSignalKey)
    ) {
      add(
        "completion-signal",
        `Expected completion signal ${scenario.completionSignalKey}.`,
        "advisory",
      );
    }
    if (
      !evidence.correctionSignalKeys.includes(scenario.correctionSignalKey)
    ) {
      add(
        "correction-signal",
        `Expected correction signal ${scenario.correctionSignalKey}.`,
        "advisory",
      );
    }
    if (
      !evidence.recoverySignal.present ||
      evidence.recoverySignal.actionKey !== scenario.recovery.actionKey ||
      !evidence.recoverySignal.routePath ||
      !routeMatchesPurposeTemplate(
        scenario.recovery.routePath,
        evidence.recoverySignal.routePath,
      )
    ) {
      add(
        "recovery-signal",
        `Expected recovery ${scenario.recovery.actionKey} to ${scenario.recovery.routePath}.`,
      );
    }
  }

  const invalidDisclosures = contract.intent.contentRoles.deferredRegions.filter(
    (region) => {
      const disclosure = evidence.disclosures.find(
        (candidate) => candidate.key === region.key,
      );
      return (
        !disclosure ||
        !disclosure.triggerPresent ||
        !disclosure.controlledRegionPresent ||
        !disclosure.relationshipValid
      );
    },
  );
  if (invalidDisclosures.length > 0) {
    add(
      "disclosure-contract",
      `Deferred regions lack a valid disclosure relationship: ${invalidDisclosures
        .map((region) => region.key)
        .join(", ")}.`,
    );
  }

  if (
    contract.consequentialAction &&
    scenario?.primaryExperience.kind === "command" &&
    scenario.primaryExperience.actionKey === "start-upgrade"
  ) {
    const consequence = evidence.consequentialAction;
    if (
      !consequence ||
      !consequence.consequenceVisible ||
      !consequence.reversibilityVisible ||
      !consequence.confirmationAvailable ||
      !consequence.authorityVisible ||
      !consequence.recoveryVisible
    ) {
      add(
        "consequential-action",
        "The consequential command is missing consequence, reversibility, confirmation, authority, or recovery context.",
      );
    }
  }

  if (contract.aiMediated) {
    const ai = evidence.aiMediatedAction;
    if (
      !ai ||
      !ai.capabilityVisible ||
      !ai.readinessVisible ||
      !ai.uncertaintyVisible ||
      !ai.correctionAvailable ||
      !ai.explanationAvailable ||
      !ai.consequenceControlsVisible ||
      !ai.returnContextVisible
    ) {
      add(
        "ai-mediated-action",
        "The AI-mediated experience is missing capability, readiness, uncertainty, correction, explanation, consequence, or return-context evidence.",
      );
    }
  }

  const structuralStatus: PurposeStructuralStatus =
    findings.some((finding) => finding.severity === "blocking")
      ? "nonconformant"
      : "conformant";

  return {
    routePath: contract.routePath,
    intentStatus: contract.status,
    structuralStatus,
    validation,
    enforcement,
    findings,
    blocking:
      enforcement === "blocking" &&
      findings.some((finding) => finding.severity === "blocking"),
  };
}

export function summarisePurposeCoverage(
  evaluations: readonly RoutePurposeEvaluation[],
): PurposeCoverageSummary {
  return {
    routeCount: evaluations.length,
    intentRatifiedCount: evaluations.filter(
      (evaluation) => evaluation.intentStatus === "intent-ratified",
    ).length,
    draftCount: evaluations.filter(
      (evaluation) => evaluation.intentStatus === "draft",
    ).length,
    quarantinedCount: evaluations.filter(
      (evaluation) => evaluation.intentStatus === "intent-quarantined",
    ).length,
    structurallyConformantCount: evaluations.filter(
      (evaluation) => evaluation.structuralStatus === "conformant",
    ).length,
    structurallyNonconformantCount: evaluations.filter(
      (evaluation) => evaluation.structuralStatus === "nonconformant",
    ).length,
    structurallyNotEvaluatedCount: evaluations.filter(
      (evaluation) => evaluation.structuralStatus === "not-evaluated",
    ).length,
    taskValidatedCount: evaluations.filter(
      (evaluation) => evaluation.validation.overall === "current",
    ).length,
  };
}
