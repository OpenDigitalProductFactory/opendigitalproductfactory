"use server";

// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
// Operator-facing writes for installation identity.
//
// Two actions, and the split between them is the design's §5.3 rule made
// mechanical: `previewInstallationIdentityChange` computes what a change would
// do and writes nothing; `declareInstallationIdentity` refuses a material change
// unless it carries the token of the preview the operator was actually shown.
//
// Authority split (parent design §4.4):
//   - installer state stays canonical for the local host environment fact, and
//     this file never writes it;
//   - the semantic intent goes to `installation.operating-intent.v1`;
//   - the operator's environment declaration goes to
//     `installation.environment-class.v1`, the *derived projection* tier, which
//     ranks below installer state. When a higher tier disagrees, the declaration
//     is still recorded but the intent is stored as `needs-review`, because the
//     identity the operator declared is not the identity in force.

import { revalidatePath } from "next/cache";

import { prisma, type Prisma } from "@dpf/db";
import {
  INSTALLATION_ENVIRONMENT_CLASSES,
  INSTALLATION_OPERATING_PURPOSES,
  isInstallationEnvironmentClass,
  isInstallationOperatingPurpose,
  parseInstallationOperatingIntent,
  type InstallationEnvironmentClass,
  type InstallationIntentConfirmationStatus,
  type InstallationOperatingIntentV1,
  type InstallationOperatingPurpose,
} from "@dpf/db/installation-operating-intent";

import { requireCapability } from "@/lib/actions/shared/guards";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { resolvePrincipalIdForUser } from "@/lib/identity/principal-linking";
import {
  ENVIRONMENT_CLASS_CONFIG_KEY,
  ENVIRONMENT_CLASS_ENV_VAR,
  loadEnvironmentClassResolution,
  resolveEnvironmentClassPrecedence,
  type EnvironmentClassResolution,
  type PortalEnvironmentClassDeclarationV1,
} from "@/lib/install/environment-class";
import { buildInstallationIdentityImpact } from "@/lib/installation-journey/identity-change-impact";
import {
  normalizeIdentityDeclaration,
  type InstallationIdentityDeclaration,
  type InstallationIdentityImpact,
} from "@/lib/installation-journey/identity-presentation";
import { loadInstanceStance, prismaInstanceStanceStore } from "@/lib/install/instance-stance";
import { INSTALLATION_OPERATING_INTENT_KEY } from "@/lib/installation-journey/operating-intent";

/** The raw shape a client form submits. Validated before anything else runs. */
export interface InstallationIdentityInput {
  primaryPurpose: string;
  environmentClass: string;
  pairedProductionInstallationRef?: string | null;
}

export interface InstallationIdentityPreview {
  impact: InstallationIdentityImpact;
  /** What the environment resolves to once the declaration is recorded. */
  environmentAfter: EnvironmentClassResolution;
}

/**
 * What declaring produced.
 *
 * A refused change is a designed outcome carrying data, not a string failure:
 * the operator needs the fresh preview to look at, and `ActionFailure` only
 * carries a message. `err()` stays for genuine failures — an unrecognised job or
 * environment, which have nothing to show.
 */
export type DeclareInstallationIdentityOutcome =
  | {
      kind: "saved";
      /** False when the identity already matched and nothing needed writing. */
      changed: boolean;
      confirmationStatus: InstallationIntentConfirmationStatus;
      environmentAfter: EnvironmentClassResolution;
    }
  | {
      kind: "needs-preview";
      reason: string;
      impact: InstallationIdentityImpact;
    };

export type PreviewInstallationIdentityResult = ActionResult<InstallationIdentityPreview>;
export type DeclareInstallationIdentityResult = ActionResult<DeclareInstallationIdentityOutcome>;

/** Longest accepted paired-installation reference. Matches the installer's field. */
const MAX_PAIRED_REF_LENGTH = 200;

type ValidatedInput =
  | { valid: true; declaration: InstallationIdentityDeclaration }
  | { valid: false; error: string };

function validate(input: InstallationIdentityInput): ValidatedInput {
  if (!isInstallationOperatingPurpose(input.primaryPurpose)) {
    return {
      valid: false,
      error: `Choose one of these jobs: ${INSTALLATION_OPERATING_PURPOSES.join(", ")}.`,
    };
  }
  if (!isInstallationEnvironmentClass(input.environmentClass)) {
    return {
      valid: false,
      error: `Choose one of these environments: ${INSTALLATION_ENVIRONMENT_CLASSES.join(", ")}.`,
    };
  }
  const ref = input.pairedProductionInstallationRef?.trim() ?? "";
  if (ref.length > MAX_PAIRED_REF_LENGTH) {
    return { valid: false, error: "The paired installation name is too long." };
  }
  return {
    valid: true,
    declaration: normalizeIdentityDeclaration({
      primaryPurpose: input.primaryPurpose,
      environmentClass: input.environmentClass,
      pairedProductionInstallationRef: ref.length > 0 ? ref : null,
    }),
  };
}

/**
 * The intent to compute against when no readable record exists.
 *
 * Mirrors the fallback in `loadInstanceStance` so the preview an operator sees
 * on a fresh install matches the stance an agent is already being given.
 */
function fallbackIntent(purpose: InstallationOperatingPurpose): InstallationOperatingIntentV1 {
  return {
    schemaVersion: 1,
    primaryPurpose: purpose,
    secondaryPurposes: [],
    relationshipIntents: [],
    evidence: [],
    confidence: "low",
    confirmation: { status: "needs-review" },
  };
}

interface IdentityContext {
  intent: InstallationOperatingIntentV1;
  intentExists: boolean;
  current: InstallationIdentityDeclaration;
  environmentNow: EnvironmentClassResolution;
  sourceCapable: boolean;
  holdsIrreplaceableWork: boolean;
}

/**
 * Read the identity in force, plus the host facts the stance resolver needs.
 *
 * `sourceCapable` and `holdsIrreplaceableWork` are read back off the composed
 * stance rather than re-derived, so the preview cannot disagree with the stance
 * the same request already resolved.
 */
async function readIdentityContext(): Promise<IdentityContext> {
  const store = prismaInstanceStanceStore(prisma);
  const [row, environmentNow, stance] = await Promise.all([
    prisma.platformConfig.findUnique({
      where: { key: INSTALLATION_OPERATING_INTENT_KEY },
      select: { value: true },
    }),
    loadEnvironmentClassResolution(store),
    loadInstanceStance(store),
  ]);

  const parsed = parseInstallationOperatingIntent(row?.value);
  const intent = parsed.ok ? parsed.value : fallbackIntent(stance.primaryPurpose);

  return {
    intent,
    intentExists: parsed.ok,
    current: {
      primaryPurpose: intent.primaryPurpose,
      environmentClass: environmentNow.environmentClass,
      pairedProductionInstallationRef: intent.pairedProductionInstallationRef ?? null,
    },
    environmentNow,
    sourceCapable: stance.sourceAuthority === "governed-worktree",
    holdsIrreplaceableWork: stance.holdsIrreplaceableWork,
  };
}

function impactFor(
  context: IdentityContext,
  next: InstallationIdentityDeclaration,
): InstallationIdentityImpact {
  return buildInstallationIdentityImpact({
    intent: context.intent,
    current: context.current,
    next,
    host: { sourceCapable: context.sourceCapable },
    holdsIrreplaceableWork: context.holdsIrreplaceableWork,
  });
}

/**
 * Resolve what the environment will be once this declaration is recorded.
 *
 * Computed rather than read back, because the answer decides whether the intent
 * may be stored as confirmed and the write has to be one transaction.
 */
function environmentAfterDeclaring(
  context: IdentityContext,
  declaration: PortalEnvironmentClassDeclarationV1,
  env: Record<string, string | undefined> = process.env,
): EnvironmentClassResolution {
  return resolveEnvironmentClassPrecedence({
    processOverride: env[ENVIRONMENT_CLASS_ENV_VAR],
    installerState: context.environmentNow.installerStateValue,
    portalDeclaration: declaration,
  });
}

/**
 * Compute the impact of a proposed identity. Writes nothing.
 *
 * Requires `manage_platform` because the preview names the paired installation
 * and the backlog-capture posture of this install.
 */
export async function previewInstallationIdentityChange(
  input: InstallationIdentityInput,
): Promise<PreviewInstallationIdentityResult> {
  const validated = validate(input);
  if (!validated.valid) return err(validated.error);

  const { userId } = await requireCapability("manage_platform");
  const principalId = (await resolvePrincipalIdForUser(userId)) ?? userId;

  const context = await readIdentityContext();
  const impact = impactFor(context, validated.declaration);
  const environmentAfter = environmentAfterDeclaring(context, {
    schemaVersion: 1,
    environmentClass: validated.declaration.environmentClass,
    declaredAt: new Date().toISOString(),
    declaredByPrincipalId: principalId,
  });

  return ok({ impact, environmentAfter });
}

/**
 * Record a declared installation identity.
 *
 * A material change must carry `previewToken` from the preview the operator saw.
 * The token is recomputed here from the identity in force, so a stale token — a
 * field edited after previewing, or another operator's change landing first —
 * fails and returns the fresh preview instead of writing.
 */
export async function declareInstallationIdentity(
  input: InstallationIdentityInput,
  previewToken?: string,
): Promise<DeclareInstallationIdentityResult> {
  const validated = validate(input);
  if (!validated.valid) return err(validated.error);

  const { userId } = await requireCapability("manage_platform");
  const principalId = (await resolvePrincipalIdForUser(userId)) ?? userId;

  const context = await readIdentityContext();
  const next = validated.declaration;
  const impact = impactFor(context, next);

  if (impact.material && previewToken !== impact.previewToken) {
    return ok({
      kind: "needs-preview",
      reason: "This changes what the installation is. Look at the impact, then confirm it.",
      impact,
    });
  }

  const now = new Date().toISOString();
  const environmentDeclaration: PortalEnvironmentClassDeclarationV1 = {
    schemaVersion: 1,
    environmentClass: next.environmentClass,
    declaredAt: now,
    declaredByPrincipalId: principalId,
  };
  const environmentAfter = environmentAfterDeclaring(context, environmentDeclaration);
  const environmentTakesEffect = environmentAfter.environmentClass === next.environmentClass;

  // Nothing changed and the record already says so: don't rewrite it. A silent
  // re-confirm would restamp the timestamp and grow the evidence log for an
  // operator who only opened the panel.
  if (
    !impact.material
    && context.intentExists
    && context.intent.confirmation.status === "confirmed"
    && environmentTakesEffect
    && context.environmentNow.portalDeclaration?.environmentClass === next.environmentClass
  ) {
    return ok({
      kind: "saved",
      changed: false,
      confirmationStatus: "confirmed",
      environmentAfter,
    });
  }

  // The declared identity is only "confirmed" when it is also the identity in
  // force. A shadowed environment declaration leaves the record needing review,
  // which is what the panel then tells the operator.
  const confirmationStatus: InstallationIntentConfirmationStatus = environmentTakesEffect
    ? "confirmed"
    : "needs-review";

  const evidence = [...context.intent.evidence, ...buildEvidence({
    now,
    next,
    impact,
    environmentTakesEffect,
    environmentInForce: environmentAfter.environmentClass,
  })];

  const value: InstallationOperatingIntentV1 = {
    schemaVersion: 1,
    primaryPurpose: next.primaryPurpose,
    secondaryPurposes: context.intent.secondaryPurposes.filter(
      (purpose) => purpose !== next.primaryPurpose,
    ),
    relationshipIntents: context.intent.relationshipIntents,
    ...(next.pairedProductionInstallationRef
      ? { pairedProductionInstallationRef: next.pairedProductionInstallationRef }
      : {}),
    evidence,
    confidence: environmentTakesEffect ? "high" : "medium",
    confirmation:
      confirmationStatus === "confirmed"
        ? { status: "confirmed", confirmedAt: now, confirmedByPrincipalId: principalId }
        : { status: "needs-review" },
  };

  await prisma.$transaction([
    prisma.platformConfig.upsert({
      where: { key: INSTALLATION_OPERATING_INTENT_KEY },
      update: { value: value as unknown as Prisma.InputJsonValue },
      create: {
        key: INSTALLATION_OPERATING_INTENT_KEY,
        value: value as unknown as Prisma.InputJsonValue,
      },
    }),
    prisma.platformConfig.upsert({
      where: { key: ENVIRONMENT_CLASS_CONFIG_KEY },
      update: { value: environmentDeclaration as unknown as Prisma.InputJsonValue },
      create: {
        key: ENVIRONMENT_CLASS_CONFIG_KEY,
        value: environmentDeclaration as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);

  revalidatePath("/workspace");
  return ok({ kind: "saved", changed: true, confirmationStatus, environmentAfter });
}

/**
 * The evidence entries this declaration adds.
 *
 * One entry for the human act, plus one naming the disagreement when the
 * declared environment is not the one in force. Existing entries are never
 * removed: a superseded inference stays in the record as history, and the
 * preview is what tells the operator it no longer describes the install.
 */
function buildEvidence(input: {
  now: string;
  next: InstallationIdentityDeclaration;
  impact: InstallationIdentityImpact;
  environmentTakesEffect: boolean;
  environmentInForce: InstallationEnvironmentClass;
}) {
  const changed = input.impact.changes.map((change) => change.label).join(", ");
  const claim = input.impact.material
    ? `The operator declared this installation: ${input.next.primaryPurpose} in ${input.next.environmentClass}. Changed: ${changed}.`
    : `The operator confirmed this installation: ${input.next.primaryPurpose} in ${input.next.environmentClass}.`;

  const entries = [{ source: "human" as const, claim, observedAt: input.now }];

  if (!input.environmentTakesEffect) {
    entries.push({
      source: "human" as const,
      claim: `The operator declared ${input.next.environmentClass}, but ${input.environmentInForce} is in force from a higher authority.`,
      observedAt: input.now,
    });
  }

  return entries;
}
