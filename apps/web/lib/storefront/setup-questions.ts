import { getCapabilitySetupPrompt, readActivationProfile } from "@dpf/storefront-templates";

export type CapabilitySetupQuestion = {
  capabilityKey: string;
  question: string;
  helpText?: string;
};

/**
 * The capability questions to ASK during setup for a given archetype
 * (EP-PARTNER-CHANNEL Phase 1b). Only `recommended` capabilities that declare a
 * setup prompt are asked (opt-in) — e.g. partner-program's "Do you sell through
 * partners or resellers?". `required` capabilities are core to the business
 * model (shown in the activation summary, not asked); `optional` ones are left to
 * the admin settings "add it later" surface.
 */
export function setupQuestionsFor(activationProfile: unknown): CapabilitySetupQuestion[] {
  const profile = readActivationProfile(activationProfile);
  if (!profile) return [];

  const questions: CapabilitySetupQuestion[] = [];
  for (const capability of profile.capabilityActivations) {
    if (capability.applicability !== "recommended") continue;
    const prompt = getCapabilitySetupPrompt(capability.capabilityKey);
    if (!prompt) continue;
    questions.push({
      capabilityKey: capability.capabilityKey,
      question: prompt.question,
      helpText: prompt.helpText,
    });
  }
  return questions;
}
