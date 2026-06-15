/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/client';

type EngineEntry = {
  binary: string;
  verify: { command: string; versionRegex: string };
  bakeInDefault: boolean;
  recipes: unknown[];
};

type SyncEngineClient = {
  buildEngine: {
    upsert(args: {
      where: { engineId: string };
      create: {
        engineId: string;
        binary: string;
        verifyCommand: string;
        versionRegex: string;
        bakeInDefault: boolean;
        recipes: unknown[];
      };
      update: {
        binary: string;
        verifyCommand: string;
        versionRegex: string;
        bakeInDefault: boolean;
        recipes: unknown[];
      };
    }): Promise<{ createdAt: Date; updatedAt: Date }>;
  };
};

type RecipeShape = { muslSafe?: boolean };

/**
 * Engines whose recipes are ALL non-musl-safe — they cannot be provisioned on
 * the Alpine/musl sandbox base, so provisionBuildEngine would always return
 * no-recipe. Pure; surfaced as a sync-time warning (BI-A2F0A608).
 */
export function enginesMissingMuslSafeRecipe(engines: Record<string, EngineEntry>): string[] {
  return Object.entries(engines)
    .filter(([, e]) => {
      const recipes = Array.isArray(e.recipes) ? (e.recipes as RecipeShape[]) : [];
      return recipes.length > 0 && recipes.every((r) => r.muslSafe === false);
    })
    .map(([engineId]) => engineId);
}

export async function syncEngineRegistry(prisma: SyncEngineClient, dataPath: string): Promise<void> {
  const raw = readFileSync(dataPath, 'utf-8');

  let engines: Record<string, EngineEntry>;
  try {
    engines = JSON.parse(raw) as Record<string, EngineEntry>;
  } catch (e) {
    throw new Error(`Failed to parse ${dataPath}: ${(e as Error).message}`);
  }

  const unprovisionable = enginesMissingMuslSafeRecipe(engines);
  if (unprovisionable.length > 0) {
    console.warn(
      `[sync-engine-registry] WARNING: no musl-safe recipe for ${unprovisionable.join(", ")} — these engines cannot be provisioned on the Alpine/musl sandbox base.`,
    );
  }

  let created = 0;
  let updated = 0;

  for (const [engineId, entry] of Object.entries(engines)) {
    const result = await prisma.buildEngine.upsert({
      where: { engineId },
      create: {
        engineId,
        binary: entry.binary,
        verifyCommand: entry.verify.command,
        versionRegex: entry.verify.versionRegex,
        bakeInDefault: entry.bakeInDefault ?? false,
        recipes: entry.recipes,
      },
      update: {
        binary: entry.binary,
        verifyCommand: entry.verify.command,
        versionRegex: entry.verify.versionRegex,
        bakeInDefault: entry.bakeInDefault ?? false,
        recipes: entry.recipes,
      },
    });

    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created++;
    } else {
      updated++;
    }
  }

  console.log(`Done: ${created} created, ${updated} updated`);
}

async function main() {
  const dataPath = join(__dirname, '..', 'data', 'build-engines.json');
  try {
    await syncEngineRegistry(prisma, dataPath);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('FATAL:', e.message);
    process.exit(1);
  });
}
