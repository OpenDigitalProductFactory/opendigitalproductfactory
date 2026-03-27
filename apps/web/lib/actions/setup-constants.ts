/**
 * Setup steps map to REAL portal routes. The user tours the actual platform
 * with the COO providing guidance in the coworker panel. The only exception
 * is "account-bootstrap" which runs at /setup before auth exists.
 */
export const SETUP_STEPS = [
  "account-bootstrap",   // /setup — the ONE custom page (org + user creation)
  "ai-providers",        // /platform/ai/providers — configure AI providers
  "branding",            // /admin/branding — logo, colors, tagline
  "org-settings",        // /admin/settings — org details, location, timezone
  "operating-hours",     // /admin/operating-hours — business hours
  "storefront",          // /admin/storefront — customer-facing portal setup
  "build-studio",        // /build — show the self-development capability
  "workspace",           // /workspace — see the workspace, meet the COO
] as const;

/** Maps each post-bootstrap step to the real portal route the user visits. */
export const STEP_ROUTES: Record<string, string> = {
  "ai-providers": "/platform/ai/providers",
  "branding": "/admin/branding",
  "org-settings": "/admin/settings",
  "operating-hours": "/admin/operating-hours",
  "storefront": "/admin/storefront",
  "build-studio": "/build",
  "workspace": "/workspace",
};

export const STEP_LABELS: Record<string, string> = {
  "account-bootstrap": "Account",
  "ai-providers": "AI Providers",
  "branding": "Branding",
  "org-settings": "Settings",
  "operating-hours": "Operating Hours",
  "storefront": "Storefront",
  "build-studio": "Build",
  "workspace": "Workspace",
};

export type SetupStep = (typeof SETUP_STEPS)[number];
export type StepStatus = "pending" | "completed" | "skipped";

export type SetupContext = {
  orgName?: string;
  industry?: string;
  hasCloudProvider?: boolean;
  skippedSteps?: string[];
  // Populated by importBrandFromUrl during the branding step
  suggestedCompanyName?: string;
  suggestedArchetypeId?: string;
  suggestedArchetypeName?: string;
  archetypeConfidence?: "high" | "medium";
  suggestedCurrency?: string;
  suggestedCountryCode?: string;
  brandingSourceUrl?: string;
};
