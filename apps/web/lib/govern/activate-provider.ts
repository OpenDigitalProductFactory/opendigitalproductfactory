// apps/web/lib/govern/activate-provider.ts
// Single entry point for transitioning a provider to "active" state.
// Every activation path (OAuth, API key, Test Auth, seed, first-run bootstrap)
// calls activateProvider() instead of doing ad-hoc status/clearance/discovery updates.
//
// See: PROVIDER-ACTIVATION-AUDIT.md §5 — consolidates F-01, F-03.

import { prisma } from "@dpf/db";
import { autoDiscoverAndProfile } from "@/lib/ai-provider-internals";
import type { SensitivityLevel } from "@/lib/routing/types";

// ─── Types ──────────────────────────────────────────────────────────────────────

export type ActivationTrigger =
  | "oauth_exchange"
  | "test_auth"
  | "api_key_configure"
  | "seed"
  | "bootstrap"
  | "mcp_register";

export interface ActivateProviderOpts {
  /** How the provider was activated — logged for diagnostics. */
  trigger: ActivationTrigger;

  /** Override authMethod (set during OAuth exchange). */
  authMethod?: string;

  /** Explicit clearance restriction. It can narrow, but never broaden, derived clearance. */
  sensitivityClearance?: SensitivityLevel[];

  /** Skip model discovery (MCP services, seeds that handle discovery separately). */
  skipDiscovery?: boolean;

  /** Activate a provider sibling that intentionally shares this credential. */
  activateLinked?: boolean;
}

export interface ActivationResult {
  providerId: string;
  status: "active";
  clearance: SensitivityLevel[];
  discovered: number;
  profiled: number;
  warning: string | null;
}

// ─── Clearance derivation ───────────────────────────────────────────────────────

/**
 * Derive default sensitivity clearance from provider attributes.
 * Local / on-prem providers get all four levels including "restricted".
 * Cloud providers default to three levels (no "restricted").
 */
type ConnectionClearanceFacts = {
  accountClass: string;
  evidenceStatus: string;
  entitlements: unknown;
};

function entitlementIsTrue(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>)[key] === true);
}

/**
 * Authentication proves that a credential works; it does not prove that the
 * connected account has commercial data protections. Hosted connections stay
 * public-only until the account and its no-training treatment are reviewed.
 */
export function deriveActivationClearance(provider: {
  category: string;
  endpointType: string;
  providerId: string;
}, connections: ConnectionClearanceFacts[]): SensitivityLevel[] {
  if (
    provider.category === "local" ||
    provider.endpointType === "ollama" ||
    provider.providerId === "local" ||
    provider.providerId === "ollama"
  ) {
    return ["public", "internal", "confidential", "restricted"];
  }

  const everyConnectionReviewed = connections.length > 0 && connections.every((connection) => {
    const businessAccount = connection.accountClass === "business-team" || connection.accountClass === "enterprise";
    const currentEvidence = connection.evidenceStatus === "operator-attested" || connection.evidenceStatus === "contract-uploaded";
    return businessAccount && currentEvidence && entitlementIsTrue(connection.entitlements, "noTraining");
  });
  return everyConnectionReviewed
    ? ["public", "internal", "confidential"]
    : ["public"];
}

function narrowClearance(
  derived: SensitivityLevel[],
  requested?: SensitivityLevel[],
): SensitivityLevel[] {
  if (!requested) return derived;
  const allowed = new Set(derived);
  return requested.filter((level) => allowed.has(level));
}

// ─── Core function ──────────────────────────────────────────────────────────────

/**
 * Activate a provider: set status, clearance, optionally authMethod, run model
 * discovery, restore runtime-retired models, and sync linked providers.
 *
 * Replaces the ad-hoc status/clearance/discover mutations previously scattered
 * across exchangeOAuthCode, testProviderAuth, configureProvider, and seeds.
 */
export async function activateProvider(
  providerId: string,
  opts: ActivateProviderOpts,
): Promise<ActivationResult> {
  const provider = await prisma.modelProvider.findUnique({
    where: { providerId },
    select: { providerId: true, category: true, endpointType: true, status: true },
  });

  if (!provider) {
    return {
      providerId,
      status: "active",
      clearance: [],
      discovered: 0,
      profiled: 0,
      warning: `Provider "${providerId}" not found — skipped activation`,
    };
  }

  // 1. Derive clearance from connection evidence. Working credentials alone
  // never manufacture business-account or contract posture.
  // A missing evidence reader (including older test doubles or a partially
  // converged runtime) fails closed to public-only for hosted providers.
  const connections = typeof prisma.aiProviderConnection?.findMany === "function"
    ? await prisma.aiProviderConnection.findMany({
        where: { providerId, status: { not: "disabled" } },
        select: { accountClass: true, evidenceStatus: true, entitlements: true },
      })
    : [];
  const clearance = narrowClearance(
    deriveActivationClearance(provider, connections),
    opts.sensitivityClearance,
  );

  // 2. Update provider state atomically
  await prisma.modelProvider.update({
    where: { providerId },
    data: {
      status: "active",
      sensitivityClearance: clearance,
      ...(opts.authMethod ? { authMethod: opts.authMethod } : {}),
    },
  });

  // 3. Activate linked MCP services that depend on this provider
  try {
    const linkedServers = await prisma.mcpServer.findMany({
      where: { config: { path: ["linkedProviderId"], equals: providerId } },
    });
    for (const server of linkedServers) {
      if (server.status !== "active") {
        await prisma.mcpServer.update({
          where: { id: server.id },
          data: { status: "active" },
        });
        await prisma.modelProvider.updateMany({
          where: { providerId: server.serverId, status: { not: "active" } },
          data: { status: "active" },
        });
      }
    }
  } catch (err) {
    // CodeQL #43 (js/tainted-format-string): providerId came from a user-
    // facing source; passing it inside the format-string template lets it
    // act as a format directive (%s, %j etc). Use the format-arg form so
    // console treats it as a value.
    console.warn("[activateProvider] MCP link activation failed for %s: %s",
      JSON.stringify(providerId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)));
  }

  // 4. Activate sibling provider (shared-account execution endpoints)
  if (opts.activateLinked) {
    try {
      await activateLinkedSibling(providerId, opts);
    } catch (err) {
      // CodeQL #44 — see #43 comment above.
      console.warn("[activateProvider] Sibling activation failed for %s: %s",
        JSON.stringify(providerId),
        err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)));
    }
  }

  // 5. Model discovery + profiling (awaited, not fire-and-forget)
  let discovered = 0;
  let profiled = 0;
  let warning: string | null = null;

  if (!opts.skipDiscovery) {
    try {
      const result = await autoDiscoverAndProfile(providerId);
      discovered = result.discovered;
      profiled = result.profiled;
      if (result.error) {
        warning = result.error;
        // CodeQL #45 — format-arg form per #43 comment.
        console.warn(
          "[activateProvider] Discovery warning for %s (trigger=%s): %s",
          JSON.stringify(providerId),
          JSON.stringify(opts.trigger),
          JSON.stringify(result.error),
        );
      }
    } catch (err) {
      warning = err instanceof Error ? err.message : String(err);
      // CodeQL #46 — format-arg form per #43 comment.
      console.warn(
        "[activateProvider] Discovery failed for %s (trigger=%s): %s",
        JSON.stringify(providerId),
        JSON.stringify(opts.trigger),
        err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
      );
    }
  }

  // 6. Restore models that were runtime-retired by transient errors.
  //    Only restore models retired by the fallback chain, not by catalog/admin/discovery.
  try {
    await prisma.modelProfile.updateMany({
      where: {
        providerId,
        modelStatus: { in: ["degraded", "retired"] },
        retiredReason: { in: ["model_not_found from provider"] },
      },
      data: {
        modelStatus: "active",
        retiredAt: null,
        retiredReason: null,
      },
    });
  } catch (err) {
    // CodeQL — last activate-provider alert; format-arg form per #43 comment.
    console.warn("[activateProvider] Model restoration failed for %s: %s",
      JSON.stringify(providerId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)));
  }

  return { providerId, status: "active", clearance, discovered, profiled, warning };
}

// ─── Sibling activation ─────────────────────────────────────────────────────────

// Codex and ChatGPT share the same OpenAI OAuth token. Z.ai and Z.ai GLM Coding
// share one Z.ai account key, but the coding sibling points OpenCode at Z.ai's
// separate coding endpoint.
// TODO(F-13): Replace this map with a `linkedProviderId` field on ModelProvider.
const LINKED_PROVIDER_SIBLINGS: Record<string, string> = {
  codex: "chatgpt",
  chatgpt: "codex",
  zai: "zai-coding",
};

async function activateLinkedSibling(
  providerId: string,
  parentOpts: ActivateProviderOpts,
): Promise<void> {
  const siblingId = LINKED_PROVIDER_SIBLINGS[providerId];
  if (!siblingId) return;

  const sibling = await prisma.modelProvider.findUnique({
    where: { providerId: siblingId },
  });
  if (!sibling) return;

  // Activate sibling without recursing into linked activation
  await activateProvider(siblingId, {
    trigger: parentOpts.trigger,
    authMethod: parentOpts.authMethod,
    skipDiscovery: parentOpts.skipDiscovery,
    activateLinked: false, // prevent infinite recursion
  });
}
