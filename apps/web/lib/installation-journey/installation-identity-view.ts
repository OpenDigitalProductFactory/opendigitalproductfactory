// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
// The read model behind the workspace installation-identity panel.
//
// Parent design §11.5: "No visible status may be computed independently in a
// component." Everything the panel renders is assembled here from the canonical
// authorities, so the sentence an operator reads and the briefing an agent
// receives come from one resolver.

import type { InstanceStanceProfile } from "@dpf/db/installation-instance-stance";
import {
  type InstallationIntentConfirmationStatus,
  type InstallationOperatingPurpose,
} from "@dpf/db/installation-operating-intent";

import {
  loadEnvironmentClassResolution,
  type EnvironmentClassResolution,
} from "@/lib/install/environment-class";
import type { readInstallHostProfile } from "@/lib/install/host-profile";
import {
  loadInstanceStance,
  type InstanceStanceStore,
} from "@/lib/install/instance-stance";
import {
  ENVIRONMENT_CLASS_LABEL,
  PURPOSE_LABEL,
  STANCE_KEYS,
  STANCE_LABEL,
  STANCE_VALUE_INTENT,
  STANCE_VALUE_LABEL,
  type InstallationIdentityDeclaration,
  type StanceKey,
} from "@/lib/installation-journey/identity-change-impact";
import {
  loadInstallationOperatingIntent,
  type InstallationIntentDb,
} from "@/lib/installation-journey/operating-intent";

/** One stance row: what the brake is, and the resolver's reason for it. */
export interface StanceRow {
  stance: StanceKey;
  label: string;
  value: string;
  valueLabel: string;
  intent: "neutral" | "warning" | "danger";
  rationale: string;
}

/** How each confirmation status is shown. Owned here, not in the component. */
export const CONFIRMATION_PRESENTATION: Record<
  InstallationIntentConfirmationStatus,
  { label: string; intent: "success" | "info" | "warning" }
> = {
  confirmed: { label: "Confirmed", intent: "success" },
  suggested: { label: "Suggested", intent: "info" },
  "needs-review": { label: "Needs review", intent: "warning" },
};

export interface InstallationIdentityView {
  stance: InstanceStanceProfile;
  environment: EnvironmentClassResolution;
  /** Whether a readable intent record exists at all. */
  intentStatus: "valid" | "missing" | "invalid";
  confirmationStatus: InstallationIntentConfirmationStatus;
  /** The identity actually in force, which the change form starts from. */
  declaration: InstallationIdentityDeclaration;
  /** One sentence naming what this installation is. */
  headline: string;
  /** A second sentence for the pairing and the environment's authority, when either has something to say. */
  detail: string | null;
  stances: StanceRow[];
}

function environmentDetail(environment: EnvironmentClassResolution): string | null {
  if (environment.shadowedPortalDeclaration) {
    const { declaredClass, winningClass } = environment.shadowedPortalDeclaration;
    const winner =
      environment.shadowedPortalDeclaration.winningTier === "installer-state"
        ? "The installer"
        : "A runtime setting";
    return `You saved ${ENVIRONMENT_CLASS_LABEL[declaredClass].toLowerCase()} here. ${winner} set ${ENVIRONMENT_CLASS_LABEL[winningClass].toLowerCase()}, and that wins.`;
  }
  switch (environment.tier) {
    case "installer-state":
      return "The installer set the environment.";
    case "process-override":
      return "A runtime setting fixes the environment.";
    case "portal-declaration":
      return "You set the environment here.";
    default:
      return null;
  }
}

/** The lead sentence. States the identity plainly, including the cautious default. */
export function buildIdentityHeadline(input: {
  environment: EnvironmentClassResolution;
  purpose: InstallationOperatingPurpose;
  intentStatus: "valid" | "missing" | "invalid";
}): string {
  const environmentWord = ENVIRONMENT_CLASS_LABEL[input.environment.environmentClass].toLowerCase();
  if (!input.environment.declared) {
    return `Treated as a ${environmentWord} installation. Nobody has said what this one is.`;
  }
  if (input.intentStatus !== "valid") {
    return `A ${environmentWord} installation. Nobody has said what its job is.`;
  }
  return `A ${environmentWord} installation. Its job: ${PURPOSE_LABEL[input.purpose].toLowerCase()}.`;
}

function stanceRows(stance: InstanceStanceProfile): StanceRow[] {
  return STANCE_KEYS.map((key) => {
    const value = stance[key] as string;
    return {
      stance: key,
      label: STANCE_LABEL[key],
      value,
      valueLabel: STANCE_VALUE_LABEL[key][value] ?? value,
      intent: STANCE_VALUE_INTENT[key][value] ?? "neutral",
      rationale: stance.rationale[key],
    };
  });
}

function pairingDetail(stance: InstanceStanceProfile): string | null {
  return stance.pairedProductionInstallationRef
    ? `Paired with ${stance.pairedProductionInstallationRef}.`
    : null;
}

/**
 * Load everything the panel renders.
 *
 * The environment class shown is the one the precedence chain resolved, not the
 * one stored in the semantic intent — the intent does not own that fact.
 */
export async function loadInstallationIdentityView(
  db: InstallationIntentDb,
  store: InstanceStanceStore,
  options: {
    readText?: (path: string) => Promise<string>;
    env?: Record<string, string | undefined>;
    readHostProfile?: typeof readInstallHostProfile;
  } = {},
): Promise<InstallationIdentityView> {
  const [loaded, environment, stance] = await Promise.all([
    loadInstallationOperatingIntent(db),
    loadEnvironmentClassResolution(store, options),
    loadInstanceStance(store, options),
  ]);

  const intentStatus = loaded.status;
  const purpose = loaded.status === "valid" ? loaded.intent.primaryPurpose : stance.primaryPurpose;
  const confirmationStatus: InstallationIntentConfirmationStatus =
    loaded.status === "valid" ? loaded.intent.confirmation.status : "needs-review";

  const details = [pairingDetail(stance), environmentDetail(environment)].filter(
    (part): part is string => Boolean(part),
  );

  return {
    stance,
    environment,
    intentStatus,
    confirmationStatus,
    declaration: {
      primaryPurpose: purpose,
      environmentClass: environment.environmentClass,
      pairedProductionInstallationRef: stance.pairedProductionInstallationRef ?? null,
    },
    headline: buildIdentityHeadline({ environment, purpose, intentStatus }),
    detail: details.length > 0 ? details.join(" ") : null,
    stances: stanceRows(stance),
  };
}
