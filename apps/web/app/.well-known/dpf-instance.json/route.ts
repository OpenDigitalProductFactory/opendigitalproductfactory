// GET /.well-known/dpf-instance.json
//
// Public install-discovery descriptor. The generic mobile app calls this to
// confirm a URL is a real DPF install and learn its identity, archetype, auth
// modes, and branding seed before the user signs in (see
// apps/mobile/src/lib/serverConfig.ts → fetchInstanceDescriptor).
//
// Public by design: returns only non-sensitive instance metadata.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { buildInstanceDescriptor } from "@/lib/mobile/manifest";

export const dynamic = "force-dynamic";

function readAccent(tokens: unknown): string | undefined {
  if (typeof tokens !== "object" || tokens === null) return undefined;
  const t = tokens as Record<string, unknown>;
  const light = t.light as Record<string, unknown> | undefined;
  const lightPalette = light?.palette as Record<string, unknown> | undefined;
  const flatPalette = t.palette as Record<string, unknown> | undefined;
  const accent = lightPalette?.accent ?? flatPalette?.accent;
  return typeof accent === "string" && accent.trim().length > 0 ? accent : undefined;
}

export async function GET() {
  try {
    const org = await prisma.organization.findFirst({
      select: { orgId: true, name: true },
    });
    if (!org) {
      return NextResponse.json(
        { code: "NOT_CONFIGURED", message: "No organization configured" },
        { status: 404 },
      );
    }

    const [storefront, branding] = await Promise.all([
      prisma.storefrontConfig.findFirst({ select: { archetypeId: true } }),
      prisma.brandingConfig.findUnique({
        where: { scope: "organization" },
        select: { logoUrlLight: true, tokens: true },
      }),
    ]);

    const descriptor = buildInstanceDescriptor({
      instanceId: org.orgId,
      orgName: org.name,
      archetype: storefront?.archetypeId ?? null,
      authModes: ["password"],
      accent: readAccent(branding?.tokens),
      logoUrl: branding?.logoUrlLight ?? null,
    });

    return NextResponse.json(descriptor, { status: 200 });
  } catch {
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
