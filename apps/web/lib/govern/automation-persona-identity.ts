/** Reserved identity used by ensureAutomationPersona, including installations
 * predating the per-verification fixture columns. This is an exact platform
 * identity, not a naming heuristic for other accounts. */
export const AUTOMATION_PERSONA_EMAIL = "automation@dpf.local";
export const AUTOMATION_PERSONA_DISPLAY_NAME = "Platform automation";

export function isPlatformAutomationPersona(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === AUTOMATION_PERSONA_EMAIL;
}
