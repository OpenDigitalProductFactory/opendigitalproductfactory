import { prisma } from "@dpf/db";
import {
  isCapabilityKey,
  resolveOrgCapabilityActivations,
  type CapabilityActivationChoice,
  type CapabilityApplicability,
  type EffectiveCapabilityActivation,
} from "@dpf/storefront-templates";

/**
 * Server data-access for the generic per-organization capability-activation
 * overlay (EP-PARTNER-CHANNEL Phase 1b). The archetype derivation answers "is
 * this capability applicable?"; these rows record "did this org turn it on?".
 * Used by the setup wizard (decidedVia="setup-wizard") and the admin add-later
 * toggle (decidedVia="admin"). Generic — partner-program is the first consumer.
 *
 * The pure fold lives in `resolveOrgCapabilityActivations` (@dpf/storefront-templates);
 * this module is only the Prisma I/O + key validation around it.
 */
export type CapabilityDecisionVia = "setup-wizard" | "admin";

function isChoice(value: string): value is CapabilityActivationChoice {
  return value === "enabled" || value === "disabled";
}

/** Load this org's persisted capability opt-in choices as a key → choice map. */
export async function getOrgCapabilityChoices(
  organizationId: string,
): Promise<Record<string, CapabilityActivationChoice>> {
  const rows = await prisma.organizationCapabilityActivation.findMany({
    where: { organizationId },
    select: { capabilityKey: true, choice: true },
  });
  const choices: Record<string, CapabilityActivationChoice> = {};
  for (const row of rows) {
    if (isChoice(row.choice)) {
      choices[row.capabilityKey] = row.choice;
    }
  }
  return choices;
}

/**
 * Fold this org's stored choices over the archetype-derived capability
 * applicabilities, producing the effective per-capability activation the setup
 * wizard, admin toggle, and route/UI gating all consume.
 */
export async function getEffectiveCapabilityActivations(
  organizationId: string,
  derived: ReadonlyArray<{ capabilityKey: string; applicability: CapabilityApplicability }>,
): Promise<EffectiveCapabilityActivation[]> {
  const choices = await getOrgCapabilityChoices(organizationId);
  return resolveOrgCapabilityActivations(derived, choices);
}

/**
 * Record an organization's enable/disable decision for a capability. Used at
 * setup and from the admin "add it later" toggle. Rejects unknown capability
 * keys so a typo can never persist an orphan activation row.
 */
export async function setCapabilityChoice(input: {
  organizationId: string;
  capabilityKey: string;
  choice: CapabilityActivationChoice;
  decidedVia: CapabilityDecisionVia;
}): Promise<void> {
  if (!isCapabilityKey(input.capabilityKey)) {
    throw new Error(`Unknown capability key: ${input.capabilityKey}`);
  }
  await prisma.organizationCapabilityActivation.upsert({
    where: {
      organizationId_capabilityKey: {
        organizationId: input.organizationId,
        capabilityKey: input.capabilityKey,
      },
    },
    create: {
      organizationId: input.organizationId,
      capabilityKey: input.capabilityKey,
      choice: input.choice,
      decidedVia: input.decidedVia,
    },
    update: {
      choice: input.choice,
      decidedVia: input.decidedVia,
    },
  });
}
