/**
 * Sync provider registry from JSON to DB.
 * Creates missing providers, updates names/metadata on existing ones.
 * Does NOT touch API keys, credentials, or provider status.
 * Safe to check in — contains zero secrets.
 */
import { prisma } from "../src/client";
import { readFileSync } from "fs";
import { join } from "path";

const REGISTRY_PATH = join(__dirname, "..", "data", "providers-registry.json");

interface RegistryEntry {
  providerId: string;
  name: string;
  category: string;
  baseUrl: string | null;
  authMethod: string;
  supportedAuthMethods: string[];
  authHeader: string | null;
  costModel: string;
  families: string[];
  inputPricePerMToken?: number;
  outputPricePerMToken?: number;
  docsUrl?: string | null;
  consoleUrl?: string | null;
  billingLabel?: string | null;
  costPerformanceNotes?: string | null;
  modelRestrictions?: string[];
  catalogVisibility?: string;
  authorizeUrl?: string | null;
  tokenUrl?: string | null;
  oauthClientId?: string | null;
  oauthRedirectUri?: string | null;
  userFacing?: Record<string, string> | null;
  supportsToolUse?: boolean;
  cliEngine?: string | null;
}

async function main() {
  const raw = readFileSync(REGISTRY_PATH, "utf-8");
  const entries: RegistryEntry[] = JSON.parse(raw);

  console.log(`Registry has ${entries.length} providers\n`);

  let created = 0;
  let updated = 0;

  for (const entry of entries) {
    const existing = await prisma.modelProvider.findUnique({
      where: { providerId: entry.providerId },
      select: { providerId: true, name: true, status: true },
    });

    if (existing) {
      // Update name and metadata, preserve status and credentials
      await prisma.modelProvider.update({
        where: { providerId: entry.providerId },
        data: {
          name: entry.name,
          families: entry.families,
          baseUrl: entry.baseUrl ?? null,
          supportedAuthMethods: entry.supportedAuthMethods,
          authHeader: entry.authHeader ?? null,
          costModel: entry.costModel,
          category: entry.category,
          ...(entry.inputPricePerMToken !== undefined && { inputPricePerMToken: entry.inputPricePerMToken }),
          ...(entry.outputPricePerMToken !== undefined && { outputPricePerMToken: entry.outputPricePerMToken }),
          docsUrl: entry.docsUrl ?? null,
          consoleUrl: entry.consoleUrl ?? null,
          ...(entry.billingLabel !== undefined && { billingLabel: entry.billingLabel }),
          ...(entry.costPerformanceNotes !== undefined && { costPerformanceNotes: entry.costPerformanceNotes }),
          ...(entry.modelRestrictions !== undefined && { modelRestrictions: entry.modelRestrictions }),
          ...(entry.catalogVisibility !== undefined && { catalogVisibility: entry.catalogVisibility }),
          ...(entry.authorizeUrl !== undefined && { authorizeUrl: entry.authorizeUrl }),
          ...(entry.tokenUrl !== undefined && { tokenUrl: entry.tokenUrl }),
          ...(entry.oauthClientId !== undefined && { oauthClientId: entry.oauthClientId }),
          ...(entry.oauthRedirectUri !== undefined && { oauthRedirectUri: entry.oauthRedirectUri }),
          ...(entry.supportsToolUse !== undefined && { supportsToolUse: entry.supportsToolUse }),
          ...(entry.userFacing !== undefined && { userFacingDescription: entry.userFacing }),
          ...(entry.cliEngine !== undefined && { cliEngine: entry.cliEngine }),
        },
      });
      console.log(`  UPDATED  ${entry.providerId.padEnd(20)} → "${entry.name}" (was "${existing.name}", status=${existing.status} preserved)`);
      updated++;
    } else {
      // Create new provider — starts as unconfigured, no credentials
      await prisma.modelProvider.create({
        data: {
          providerId: entry.providerId,
          name: entry.name,
          families: entry.families,
          enabledFamilies: [],
          status: "unconfigured",
          category: entry.category,
          baseUrl: entry.baseUrl ?? null,
          authMethod: entry.authMethod,
          supportedAuthMethods: entry.supportedAuthMethods,
          authHeader: entry.authHeader ?? null,
          costModel: entry.costModel,
          inputPricePerMToken: entry.inputPricePerMToken ?? null,
          outputPricePerMToken: entry.outputPricePerMToken ?? null,
          docsUrl: entry.docsUrl ?? null,
          consoleUrl: entry.consoleUrl ?? null,
          billingLabel: entry.billingLabel ?? null,
          costPerformanceNotes: entry.costPerformanceNotes ?? null,
          modelRestrictions: entry.modelRestrictions ?? [],
          catalogVisibility: entry.catalogVisibility ?? "visible",
          authorizeUrl: entry.authorizeUrl ?? null,
          tokenUrl: entry.tokenUrl ?? null,
          oauthClientId: entry.oauthClientId ?? null,
          oauthRedirectUri: entry.oauthRedirectUri ?? null,
          supportsToolUse: entry.supportsToolUse ?? false,
          userFacingDescription: entry.userFacing ?? null,
          cliEngine: entry.cliEngine ?? null,
        },
      });
      console.log(`  CREATED  ${entry.providerId.padEnd(20)} → "${entry.name}" (status=unconfigured)`);
      created++;
    }
  }

  console.log(`\nDone: ${created} created, ${updated} updated`);

  // Show final state
  const all = await prisma.modelProvider.findMany({
    select: { providerId: true, name: true, status: true },
    orderBy: { providerId: "asc" },
  });
  console.log("\nAll providers:");
  for (const p of all) {
    console.log(`  ${p.providerId.padEnd(20)} ${p.name.padEnd(40)} [${p.status}]`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
