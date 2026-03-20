/**
 * One-time migration: upgrade flat ThemeTokens in BrandingConfig.tokens
 * to dual { dark, light } format.
 *
 * Run: npx tsx apps/web/scripts/migrate-dual-branding-tokens.ts
 */
import { PrismaClient } from "@prisma/client";
import { deriveThemeTokens } from "../lib/branding-presets";

const prisma = new PrismaClient();

export function needsMigration(tokens: unknown): boolean {
  if (!tokens || typeof tokens !== "object") return true;
  const t = tokens as Record<string, unknown>;
  return !("dark" in t && "light" in t);
}

export function migrateFlatTokens(flat: Record<string, unknown>): { dark: unknown; light: unknown } {
  const accent = (flat?.palette as any)?.accent ?? "#7c8cf8";
  const fontFamily = (flat?.typography as any)?.fontFamily ?? undefined;
  const dual = deriveThemeTokens(accent, fontFamily ? { fontFamily } : undefined);
  return dual;
}

async function main() {
  const configs = await prisma.brandingConfig.findMany();
  let migrated = 0;

  for (const config of configs) {
    const tokens = config.tokens as Record<string, unknown>;

    if (!needsMigration(tokens)) {
      console.log(`[skip] ${config.scope} — already dual format`);
      continue;
    }

    const dualTokens = migrateFlatTokens(tokens);

    await prisma.brandingConfig.update({
      where: { id: config.id },
      data: { tokens: dualTokens as any },
    });

    console.log(`[migrated] ${config.scope} — upgraded to dual format`);
    migrated++;
  }

  console.log(`\nDone. Migrated ${migrated} of ${configs.length} records.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
