"use server";

// BI-7626A660 — name the estate that operates this installation.
//
// WHY THIS IS NOT PART OF declareInstallationIdentity:
//
// That action carries a preview-and-confirm ritual, and it earns it: purpose,
// environment class and pairing all move the stances an AI coworker is held to,
// so an operator must see what a change LOOSENS before it takes effect.
//
// The estate name moves nothing. It is a label — design invariant 3, "the estate
// name is not an authorization input". Wrapping a label in a consequence preview
// would train operators to click through the ritual, which is exactly how a
// meaningful confirmation stops being read. So this is a plain, audited write,
// and the ceremony stays where the consequences are.
//
// It still requires manage_platform, and it still records who set it and how it
// arrived, because the value ends up in an MCP handshake and an mDNS record.

import { revalidatePath } from "next/cache";

import { prisma, type Prisma } from "@dpf/db";

import {
  ESTATE_IDENTITY_CONFIG_KEY,
  ESTATE_NAME_MAX_LENGTH,
  isEstateNameSource,
  normalizeEstateName,
  type EstateNameSource,
  type PortalEstateIdentityDeclarationV1,
} from "@/lib/install/estate-identity-contract";
import { requireCapability } from "@/lib/actions/shared/guards";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { resolvePrincipalIdForUser } from "@/lib/identity/principal-linking";

/** Composed from the canonical ActionResult primitive (BI-1CED89B9) rather than
 *  hand-inlined, so the discriminant cannot drift and the one-ActionResult
 *  ratchet stays green. The payload carries the name now in force, which is null
 *  when the operator cleared it. */
export type DeclareEstateNameResult = ActionResult<{ estateName: string | null }>;

/**
 * Record — or clear — the estate name for this installation.
 *
 * An empty submission clears the name rather than storing `""`, so "unnamed"
 * stays a single state instead of two that render differently.
 */
export async function declareEstateName(
  rawName: string,
  rawSource: string = "operator",
): Promise<DeclareEstateNameResult> {
  const { userId } = await requireCapability("manage_platform");

  const source: EstateNameSource = isEstateNameSource(rawSource) ? rawSource : "operator";
  const trimmed = typeof rawName === "string" ? rawName.trim() : "";

  if (trimmed.length === 0) {
    await prisma.platformConfig.deleteMany({ where: { key: ESTATE_IDENTITY_CONFIG_KEY } });
    revalidatePath("/ops/installation");
    return ok({ estateName: null });
  }

  const estateName = normalizeEstateName(trimmed);
  if (estateName === null) {
    return err(
      `Use letters, numbers, spaces, dots, dashes or underscores, starting with a letter or number, up to ${ESTATE_NAME_MAX_LENGTH} characters. ` +
        "The name is published to peers on your network and to connected agents, so it has to survive both.",
    );
  }

  const principalId = (await resolvePrincipalIdForUser(userId)) ?? userId;
  const declaration: PortalEstateIdentityDeclarationV1 = {
    schemaVersion: 1,
    estateName,
    source,
    declaredAt: new Date().toISOString(),
    declaredByPrincipalId: principalId,
  };

  // The same cast the operating-intent writer uses: a typed interface has no
  // index signature, which is what Prisma's InputJsonValue wants.
  const value = declaration as unknown as Prisma.InputJsonValue;
  await prisma.platformConfig.upsert({
    where: { key: ESTATE_IDENTITY_CONFIG_KEY },
    create: { key: ESTATE_IDENTITY_CONFIG_KEY, value },
    update: { value },
  });

  // The badge is rendered by the shell layout, so the whole tree has to revalidate
  // for a rename to reach the header rather than only this page.
  revalidatePath("/", "layout");
  return ok({ estateName });
}
