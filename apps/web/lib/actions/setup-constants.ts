/**
 * Setup steps map to REAL portal routes. The user tours the actual platform
 * with the COO providing guidance in the coworker panel. The only exception
 * is "account-bootstrap" which runs at /setup before auth exists.
 */
export const SETUP_STEPS = [
  "account-bootstrap",   // /setup — the ONE custom page (org + user creation)
  "business-context",    // /storefront/settings/business — tell us about your business
  "direction",           // /storefront/settings/business?section=direction — mission, vision, 1-3 outcomes; skippable (BI-916216E7)
  "ai-providers",        // /platform/ai/providers — choose governed AI connections
  "branding",            // /admin/branding — logo, colors, tagline
  "how-you-decide",      // /coworker-decisions/stance — confirm the archetype-prefilled stance cards (BI-D6DC2432)
  "operating-hours",     // /storefront/settings/operations — business hours
  "storefront",          // /storefront — customer-facing portal setup
  "mailroom",            // /workspace/mailroom — declare the mailboxes the Mailroom reads, or learn what it would do (design 2026-09-09 §4.9)
  "platform-development",// /admin/platform-development — contribution mode
  "monitoring",          // /admin/settings/monitoring — only while runtime:deep-observability is undecided
  "build-studio",        // /build — show the self-development capability
  "meet-your-coo",       // /workspace — optionally choose a conversational name for the standing COO
  "workspace",           // /workspace — see the workspace, meet the COO
] as const;

/** Maps each post-bootstrap step to the real portal route the user visits. */
export const STEP_ROUTES: Record<string, string> = {
  "ai-providers": "/platform/ai/providers",
  "branding": "/admin/branding",
  "business-context": "/storefront/settings/business",
  // Same page, its own panel. A query string (not a hash) so the overlay's
  // full-reload navigation re-renders the step.
  "direction": "/storefront/settings/business?section=direction",
  "how-you-decide": "/coworker-decisions/stance",
  "operating-hours": "/storefront/settings/operations",
  "storefront": "/storefront",
  "mailroom": "/workspace/mailroom",
  "platform-development": "/admin/platform-development",
  "monitoring": "/admin/settings/monitoring",
  "build-studio": "/build",
  "meet-your-coo": "/workspace",
  "workspace": "/workspace",
};

// Step labels live in the message catalog: packages/i18n/src/messages/en-US/setup.json
// (steps.*), rendered with useT("setup") (EP-6B33A840 L0.2).

export type SetupStep = (typeof SETUP_STEPS)[number];
export type StepStatus = "pending" | "completed" | "skipped";

/** install-state `runtimeCapabilityDecisions["runtime:deep-observability"].decision`. */
export type MonitoringCapabilityDecision = "enabled" | "disabled" | "undecided";

export function parseMonitoringCapabilityDecision(
  value: string | null | undefined,
): MonitoringCapabilityDecision | null {
  if (value === "enabled" || value === "disabled" || value === "undecided") return value;
  return null;
}

/**
 * Monitoring is offered only while nobody has chosen the capability.
 * Enabled, disabled, or a missing record hides the step.
 */
export function visibleSetupSteps(
  monitoringDecision: MonitoringCapabilityDecision | null | undefined,
): SetupStep[] {
  if (monitoringDecision === "undecided") return [...SETUP_STEPS];
  return SETUP_STEPS.filter((step) => step !== "monitoring");
}

export type SetupContext = {
  orgName?: string;
  industry?: string;
  /**
   * Whether a cloud provider can actually take work (BI-575F0046 Slice 2).
   *
   * Replaces `hasCloudProvider`, which was declared, read by the onboarding
   * prompt, and never written by anything — so the COO's setup guidance always
   * said "no". It was also the wrong question: a connected provider is granted
   * `["public"]` until its trust evidence is reviewed, and no route is ever
   * public, so "has a provider" and "can use a provider" are different facts.
   *
   * Computed live in getSetupContext rather than stored, because a stored
   * boolean goes stale the moment the owner connects or attests one.
   */
  cloudProviderReadiness?: "none" | "public-only" | "ready";
  /**
   * Live install-state decision for runtime:deep-observability.
   * Only "undecided" offers the monitoring step. Computed in getSetupContext,
   * not stored — a stored copy would hide or show the step after the host moved on.
   */
  monitoringCapabilityDecision?: MonitoringCapabilityDecision;
  cooConversationalName?: string;
  skippedSteps?: string[];
  /** The owner skipped the Mailroom step with no mailbox to connect; the page
   *  keeps offering the connect flow (design 2026-09-09 §4.9). */
  mailroomSkipped?: boolean;
  // Populated by importBrandFromUrl during the branding step
  suggestedCompanyName?: string;
  suggestedArchetypeId?: string;
  suggestedArchetypeName?: string;
  archetypeConfidence?: "high" | "medium";
  suggestedCurrency?: string;
  suggestedCountryCode?: string;
  brandingSourceUrl?: string;
  // Populated by importBrandFromUrl — derived from archetype + page scrape
  suggestedIndustry?: string;
  suggestedDescription?: string;
  suggestedContactEmail?: string;
  suggestedContactPhone?: string;
  suggestedGeographicScope?: string;
  suggestedTimezone?: string;
  // Tracks which steps have already dispatched their COO auto-message trigger.
  // Guards against duplicate welcomes across page reloads / component remounts.
  triggeredSteps?: string[];
};
