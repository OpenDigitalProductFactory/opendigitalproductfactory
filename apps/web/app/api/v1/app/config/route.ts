// GET /api/v1/app/config
//
// The install manifest the generic mobile app fetches after login to drive its
// design (branding tokens) and functionality (capabilities) — see
// apps/mobile/src/lib/appConfig.ts. Three layers per the design; this v1 ships
// the design + capability layers (the server-driven screen layer follows in P3).
// Requires authentication via Bearer JWT or NextAuth session.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { getCompositeActivationProfile } from "@/lib/storefront/archetype-activation";
import {
  buildAppConfigManifest,
  activationToCapabilities,
  resolveAppPersona,
  resolveAppNavigation,
} from "@/lib/mobile/manifest";
import type { AppConfigManifest } from "@dpf/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user, authContext } = await authenticateRequest(request);

    const org = await prisma.organization.findFirst({ select: { name: true } });
    if (!org) {
      throw apiError("NOT_CONFIGURED", "No organization configured", 404);
    }

    const [storefront, branding] = await Promise.all([
      prisma.storefrontConfig.findFirst({
        select: { id: true, archetypeId: true },
      }),
      prisma.brandingConfig.findUnique({
        where: { scope: "organization" },
        select: { tokens: true },
      }),
    ]);

    const activation = storefront
      ? await getCompositeActivationProfile(storefront.id)
      : null;
    const capabilities = activationToCapabilities(
      activation
        ? { modules: activation.modules, axes: activation.axes }
        : null,
    );

    const persona = resolveAppPersona({
      userType: user.type,
      employeeId: authContext.employeeId,
      capabilities,
    });
    const navigation = resolveAppNavigation({ persona, capabilities });

    const manifest = buildAppConfigManifest({
      orgName: org.name,
      archetype: storefront?.archetypeId ?? null,
      persona,
      brandingTokensRaw: branding?.tokens ?? null,
      capabilities,
      navigation,
    });

    return apiSuccess<AppConfigManifest>(manifest);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
