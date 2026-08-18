// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity (BI-A9F60372)
// Guarded repository boundary over Prisma PlatformConfig key `installation.operating-intent.v1`.

import {
  parseInstallationOperatingIntent,
  validateOperatingIntent,
  type InstallationOperatingIntentV1,
  type InstallationOperatingPurpose,
  type InstallationEnvironmentClass,
  type InstallationOperatingIntentEvidence,
  type InstallationIntentConfidence,
} from "@dpf/db/installation-operating-intent";
import type { Prisma } from "@dpf/db";

export const INSTALLATION_OPERATING_INTENT_KEY = "installation.operating-intent.v1";

export type InstallationIntentDb = {
  platformConfig: {
    findUnique(args: {
      where: { key: string };
      select?: { value: true } | Record<string, boolean>;
    }): Promise<{ value: unknown } | null>;
    upsert(args: {
      where: { key: string };
      update: { value: Prisma.InputJsonValue };
      create: { key: string; value: Prisma.InputJsonValue };
    }): Promise<unknown>;
  };
  organization?: {
    findFirst?(args?: unknown): Promise<{ id: string; name: string } | null>;
  };
  businessContext?: {
    findFirst?(args?: unknown): Promise<{ id: string; mission?: string | null } | null>;
  };
  federationLink?: {
    findMany?(args?: unknown): Promise<Array<{ id: string; preset?: string | null }>>;
  };
};

export type LoadedInstallationOperatingIntent =
  | { status: "valid"; intent: InstallationOperatingIntentV1 }
  | { status: "missing" }
  | { status: "invalid"; error: string };

export type InvestmentFundingAuthority =
  | { allowed: true }
  | { allowed: false; error: "installation_authority_required"; message: string };

export async function loadInstallationOperatingIntent(
  db: InstallationIntentDb,
): Promise<LoadedInstallationOperatingIntent> {
  const row = await db.platformConfig.findUnique({
    where: { key: INSTALLATION_OPERATING_INTENT_KEY },
    select: { value: true },
  });
  if (!row) return { status: "missing" };

  const parsed = parseInstallationOperatingIntent(row.value);
  return parsed.ok
    ? { status: "valid", intent: parsed.value }
    : { status: "invalid", error: parsed.error };
}

export async function saveInstallationOperatingIntent(
  db: InstallationIntentDb,
  intent: InstallationOperatingIntentV1,
): Promise<{ ok: true; intent: InstallationOperatingIntentV1 } | { ok: false; error: string }> {
  const validated = validateOperatingIntent(intent);
  if (!validated.valid || !validated.data) {
    return { ok: false, error: validated.errors.join("; ") };
  }

  await db.platformConfig.upsert({
    where: { key: INSTALLATION_OPERATING_INTENT_KEY },
    update: { value: validated.data as unknown as Prisma.InputJsonValue },
    create: {
      key: INSTALLATION_OPERATING_INTENT_KEY,
      value: validated.data as unknown as Prisma.InputJsonValue,
    },
  });

  return { ok: true, intent: validated.data };
}

/**
 * Derives suggested installation intent for existing installations.
 * Invariant: derivation produces `status: "suggested"` and never auto-confirms.
 */
export async function deriveExistingInstallIntent(
  db: InstallationIntentDb,
  options?: {
    environmentClass?: InstallationEnvironmentClass;
    isDevWorkspace?: boolean;
  },
): Promise<InstallationOperatingIntentV1> {
  const now = new Date().toISOString();
  const evidence: InstallationOperatingIntentEvidence[] = [];
  let primaryPurpose: InstallationOperatingPurpose = "operate-organization";
  let confidence: InstallationIntentConfidence = "medium";
  const relationshipIntents: ("same-organization" | "service-provider" | "channel" | "community-peer")[] = [];

  const envClass = options?.environmentClass ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  const isDevWorkspace = options?.isDevWorkspace ?? Boolean(process.env.DPF_DEV_WORKSPACE_PATH);

  if (isDevWorkspace || envClass === "development") {
    primaryPurpose = "evolve-dpf";
    confidence = "high";
    evidence.push({
      source: "installer",
      claim: "Development workspace or development environment detected on host",
      observedAt: now,
    });
  }

  if (db.organization?.findFirst) {
    const org = await db.organization.findFirst();
    if (org) {
      evidence.push({
        source: "organization",
        claim: "Existing organization record present",
        sourceRef: org.id,
        observedAt: now,
      });
      if (envClass === "production" && !isDevWorkspace) {
        primaryPurpose = "operate-organization";
        confidence = "high";
      }
    }
  }

  if (db.businessContext?.findFirst) {
    const context = await db.businessContext.findFirst();
    if (context) {
      evidence.push({
        source: "business-context",
        claim: "Existing business context configured",
        sourceRef: context.id,
        observedAt: now,
      });
    }
  }

  if (db.federationLink?.findMany) {
    const links = await db.federationLink.findMany();
    if (links && links.length > 0) {
      for (const link of links) {
        if (link.preset === "service-provider" && !relationshipIntents.includes("service-provider")) {
          relationshipIntents.push("service-provider");
        } else if (link.preset === "channel" && !relationshipIntents.includes("channel")) {
          relationshipIntents.push("channel");
        } else if (link.preset === "same-organization" && !relationshipIntents.includes("same-organization")) {
          relationshipIntents.push("same-organization");
        } else if (link.preset === "community-peer" && !relationshipIntents.includes("community-peer")) {
          relationshipIntents.push("community-peer");
        }
      }
      evidence.push({
        source: "federation",
        claim: `Found ${links.length} existing federation link(s)`,
        observedAt: now,
      });
      if (relationshipIntents.includes("service-provider") && primaryPurpose !== "evolve-dpf") {
        primaryPurpose = "deliver-managed-services";
      }
    }
  }

  if (evidence.length === 0) {
    evidence.push({
      source: "installer",
      claim: "Default installation intent derived from host environment",
      observedAt: now,
    });
    confidence = "low";
  }

  return {
    schemaVersion: 1,
    primaryPurpose,
    secondaryPurposes: [],
    relationshipIntents,
    evidence,
    confidence,
    confirmation: {
      status: "suggested",
    },
  };
}

export interface BootstrapIntentEnvelope {
  schemaVersion: 1;
  primaryPurpose: InstallationOperatingPurpose;
  secondaryPurposes?: InstallationOperatingPurpose[];
  relationshipIntents?: ("same-organization" | "service-provider" | "channel" | "community-peer")[];
  pairedProductionInstallationRef?: string;
  confidence: InstallationIntentConfidence;
  recordedAt: string;
  absorbedAt?: string | null;
}

/**
 * Idempotently absorbs pre-DB bootstrap intent from install-state into PlatformConfig.
 */
export async function absorbBootstrapIntent(
  db: InstallationIntentDb,
  bootstrapIntent: BootstrapIntentEnvelope | null | undefined,
): Promise<{ absorbed: boolean; intent?: InstallationOperatingIntentV1 }> {
  if (!bootstrapIntent || bootstrapIntent.absorbedAt) {
    return { absorbed: false };
  }

  const existing = await loadInstallationOperatingIntent(db);
  if (existing.status === "valid" && existing.intent.confirmation.status === "confirmed") {
    return { absorbed: false, intent: existing.intent };
  }

  const now = new Date().toISOString();
  const intent: InstallationOperatingIntentV1 = {
    schemaVersion: 1,
    primaryPurpose: bootstrapIntent.primaryPurpose,
    secondaryPurposes: bootstrapIntent.secondaryPurposes ?? [],
    relationshipIntents: bootstrapIntent.relationshipIntents ?? [],
    pairedProductionInstallationRef: bootstrapIntent.pairedProductionInstallationRef,
    evidence: [
      {
        source: "installer",
        claim: "Bootstrap intent captured by installer prior to database initialization",
        observedAt: bootstrapIntent.recordedAt || now,
      },
    ],
    confidence: bootstrapIntent.confidence || "medium",
    confirmation: {
      status: "suggested",
    },
  };

  const saveRes = await saveInstallationOperatingIntent(db, intent);
  if (saveRes.ok) {
    return { absorbed: true, intent: saveRes.intent };
  }
  return { absorbed: false };
}

/**
 * Installation intent never grants funding permission. This prerequisite only
 * proves that an already-authorized caller is acting on the confirmed business
 * installation before WWWD decides whether the investment should proceed.
 */
export function resolveInvestmentFundingAuthority(
  loaded: LoadedInstallationOperatingIntent,
): InvestmentFundingAuthority {
  if (
    loaded.status === "valid"
    && loaded.intent.confirmation.status === "confirmed"
    && loaded.intent.primaryPurpose === "operate-organization"
  ) {
    return { allowed: true };
  }

  const reason = loaded.status === "missing"
    ? "This installation has not confirmed its operating purpose."
    : loaded.status === "invalid"
      ? "This installation's operating-purpose record is invalid."
      : loaded.intent.confirmation.status !== "confirmed"
        ? "This installation's operating purpose still needs owner confirmation."
        : "Investment funding is owned by the confirmed organization-operating installation.";

  return {
    allowed: false,
    error: "installation_authority_required",
    message: `${reason} This installation may still contribute demand and evidence, but it cannot make the canonical funding decision.`,
  };
}
