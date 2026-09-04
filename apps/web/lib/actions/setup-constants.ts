/**
 * Setup steps map to REAL portal routes. The user tours the actual platform
 * with the COO providing guidance in the coworker panel. The only exception
 * is "account-bootstrap" which runs at /setup before auth exists.
 */
export const SETUP_STEPS = [
  "account-bootstrap",   // /setup — the ONE custom page (org + user creation)
  "business-context",    // /storefront/settings/business — tell us about your business
  "ai-providers",        // /platform/ai/providers — choose governed AI connections
  "branding",            // /admin/branding — logo, colors, tagline
  "how-you-decide",      // /coworker-decisions/stance — confirm the archetype-prefilled stance cards (BI-D6DC2432)
  "operating-hours",     // /storefront/settings/operations — business hours
  "storefront",          // /storefront — customer-facing portal setup
  "platform-development",// /admin/platform-development — contribution mode
  "build-studio",        // /build — show the self-development capability
  "meet-your-coo",       // /workspace — optionally choose a conversational name for the standing COO
  "workspace",           // /workspace — see the workspace, meet the COO
] as const;

/** Maps each post-bootstrap step to the real portal route the user visits. */
export const STEP_ROUTES: Record<string, string> = {
  "ai-providers": "/platform/ai/providers",
  "branding": "/admin/branding",
  "business-context": "/storefront/settings/business",
  "how-you-decide": "/coworker-decisions/stance",
  "operating-hours": "/storefront/settings/operations",
  "storefront": "/storefront",
  "platform-development": "/admin/platform-development",
  "build-studio": "/build",
  "meet-your-coo": "/workspace",
  "workspace": "/workspace",
};

export const STEP_LABELS: Record<string, string> = {
  "account-bootstrap": "Account",
  "ai-providers": "AI Providers",
  "branding": "Branding",
  "business-context": "Your Business",
  "how-you-decide": "How You Decide",
  "operating-hours": "Operating Hours",
  "storefront": "Storefront",
  "platform-development": "Platform Dev",
  "build-studio": "Build",
  "meet-your-coo": "Meet Your COO",
  "workspace": "Workspace",
};

export type SetupStep = (typeof SETUP_STEPS)[number];
export type StepStatus = "pending" | "completed" | "skipped";

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
  cooConversationalName?: string;
  skippedSteps?: string[];
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
