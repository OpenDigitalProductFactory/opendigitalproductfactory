// apps/web/lib/portal-context/capability-resolver.ts
//
// D29 (2026-05-23): compute a CoworkerCapabilitySnapshot for the routes
// where a coworker would otherwise default to "wait and try again" advice
// (configuration pages, Build Studio entry). The snapshot piped into the
// prompt-digest gives the coworker the actual gap + recommended action so
// it can produce concrete guidance even on a weak local model.
//
// Pure + thin so the index.ts resolver can race it against the other
// envelope sources without owning the conditional logic.

import { loadBuildStudioCapability } from "@/lib/build/build-studio-capability";
import type { CoworkerCapabilitySnapshot } from "./types";

/**
 * Routes where the coworker should have the build-studio capability snapshot
 * in its prompt. Match by prefix.
 */
const BUILD_STUDIO_CAPABILITY_ROUTES: readonly string[] = [
  "/build",
  "/platform/ai", // /platform/ai/providers, /platform/ai/providers/<id>, etc.
];

function routeWantsBuildStudioCapability(routeContext: string): boolean {
  return BUILD_STUDIO_CAPABILITY_ROUTES.some(
    (prefix) => routeContext === prefix || routeContext.startsWith(`${prefix}/`),
  );
}

/**
 * Decide the user-can-fix flag. Today: HR-000 (org owner / superuser tier)
 * can manage providers; non-HR-000 cannot. If/when finer-grained capability
 * grants land for `manage_provider_connections`, swap this for an actual
 * permission check.
 */
function userCanManageProviders(platformRole: string): boolean {
  return platformRole === "HR-000";
}

export async function resolveCoworkerCapability(args: {
  routeContext: string;
  platformRole: string;
}): Promise<CoworkerCapabilitySnapshot | null> {
  if (!routeWantsBuildStudioCapability(args.routeContext)) {
    return null;
  }

  const capability = await loadBuildStudioCapability();
  const userCanFix = userCanManageProviders(args.platformRole);

  if (capability.ok) {
    return {
      kind: "build_studio",
      gateOpen: true,
      // Reason carries the "why open" — for now stub to the closest enum value.
      // The prompt-digest only renders gateOpen=false, so the reason is unused
      // on this branch; keep the field populated for downstream extensions.
      reason: "no_strong_tier_model_available",
      recommendedAction: null,
      userCanFix,
    };
  }

  const recommendedAction = userCanFix
    ? "Connect Claude (Anthropic) — Subscription sign-in on this page. No API key needed; it takes about a minute and unlocks Build Studio."
    : "Ask an administrator to connect Claude, Gemini, or OpenAI at Platform > AI > Providers.";

  return {
    kind: "build_studio",
    gateOpen: false,
    reason: capability.reason,
    recommendedAction,
    userCanFix,
  };
}
