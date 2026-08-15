"use server";
// "How you decide" confirmation action (BI-D6DC2432, EP-0AF96937).
//
// The owner confirms (or adjusts) the archetype-prefilled stance cards; this
// is the moment autonomy is granted. Per confirmed vector: publish + embed the
// stance page, then upgrade its whole class bundle to owner-confirmed A/0.9 —
// including the seeded identity-page echoes in the covered classes (bundle
// semantics; see confirm-stance-vectors.ts). Skipping writes nothing: the
// gate keeps escalating everything, exactly like today.
//
// Domain errors are RETURNED as values, never thrown (use-server rule).

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";
import { upsertWikiPage, appendRevision } from "@dpf/db/wiki-store";
import { requireCapability } from "@/lib/actions/shared/guards";
import { promoteStanceMaterial } from "@/lib/decision-perspective/stance-promotion";
import { projectStanceDimensionVector } from "@/lib/decision-perspective/stance-dimension-map";
import { storeWikiPage } from "@/lib/wiki/embeddings";
import {
  resolveStanceVectors,
  type StanceVectorKey,
} from "@/lib/onboarding/archetype-business-context";
import { STANCE_VECTOR_BUNDLES, stanceVectorSlug } from "@/lib/onboarding/seed-org-wwwd-corpus";
import {
  classesCoveredByVectors,
  confirmedStanceBody,
  identityUpgradesForClasses,
  validateConfirmStanceVectors,
  type ConfirmedVectorInput,
} from "@/lib/onboarding/confirm-stance-vectors";

export type ConfirmStanceVectorsResult =
  | { ok: true; confirmedVectors: number; upgradedIdentityPages: number }
  | { ok: false; error: string };

export async function confirmStanceVectors(input: {
  vectors: ConfirmedVectorInput[];
}): Promise<ConfirmStanceVectorsResult> {
  let userId: string;
  try {
    userId = (await requireCapability("view_platform")).userId;
  } catch {
    return { ok: false, error: "You do not have access to confirm stances." };
  }

  const v = validateConfirmStanceVectors(input);
  if (!v.ok) {
    return { ok: false, error: v.error };
  }

  const org = await prisma.organization.findFirst({ select: { id: true, name: true } });
  if (!org) {
    return { ok: false, error: "No organization is configured for this install." };
  }
  const orgLabel = org.name?.trim() || "this organization";

  const storefront = await prisma.storefrontConfig.findFirst({
    select: { archetypeId: true, archetype: { select: { category: true } } },
  });
  const defaults = resolveStanceVectors({
    archetypeId: storefront?.archetypeId ?? null,
    industry: storefront?.archetype?.category ?? null,
  });

  try {
    for (const vector of v.vectors) {
      const slug = stanceVectorSlug(vector.key);
      const title = defaults[vector.key].title;
      const { body, abstract } = confirmedStanceBody({
        title,
        stance: vector.stance,
        ceilingUsd: vector.ceilingUsd,
        orgLabel,
      });

      const existing = (await prisma.wikiPage.findFirst({
        where: { organizationId: org.id, slug },
        select: { id: true, body: true },
      })) as { id: string; body: string } | null;

      const saved = (await upsertWikiPage(prisma, {
        organizationId: org.id,
        slug,
        title,
        body,
        pageKind: "stance",
        status: "published",
        isKernel: false,
        abstract,
        ...projectStanceDimensionVector(vector.key),
      })) as { id: string };

      if (!existing || existing.body !== body) {
        await appendRevision(prisma, {
          pageId: saved.id,
          title,
          body,
          changeKind: "manual",
          changeSummary: "Stance confirmed by the owner (How you decide)",
          createdById: userId,
        });
        // Deliberation layer; the material below is the enforcement, so a failed
        // embed never rolls back the confirm. BI-D4C1E05E: it must NOT be a
        // SILENT skip — log loudly so the reembed reconcile's self-heal is a
        // known follow-up rather than an undiagnosed governance gap.
        try {
          const embedded = await storeWikiPage({
            pageId: saved.id,
            slug,
            title,
            body,
            abstract,
            pageKind: "stance",
            status: "published",
            isKernel: false,
            kernelVersion: null,
            organizationId: org.id,
            kernelPageId: null,
            ...projectStanceDimensionVector(vector.key),
          });
          if (!embedded) {
            console.error(
              `[embed-published-overlay] EMBED-SKIPPED slug=${slug} origin=stance-confirm — ` +
                "confirmed stance was NOT embedded (embedding provider unavailable); invisible to " +
                "wiki_query / principle_decide until the reembed reconcile runs. " +
                "Fix: docker model pull ai/nomic-embed-text-v1.5",
            );
          }
        } catch (err) {
          console.error(
            `[embed-published-overlay] EMBED-FAILED slug=${slug} origin=stance-confirm: ` +
              `${(err as Error).message}. Stance confirmed but not embedded; the reembed ` +
              "reconcile will self-heal it on the next upgrade boot.",
          );
        }
      }

      const promoted = await promoteStanceMaterial({
        db: prisma,
        organizationId: org.id,
        wikiPageId: saved.id,
        slug,
        summary: abstract,
        domainClasses: STANCE_VECTOR_BUNDLES[vector.key],
        tier: "confirmed",
      });
      if (!promoted.ok) {
        return {
          ok: false,
          error: "Your stances were saved, but the decision profile is missing — finish business setup first.",
        };
      }
    }

    // Bundle semantics: upgrade the identity-page echoes in every covered class.
    const covered = classesCoveredByVectors(v.vectors.map((x) => x.key as StanceVectorKey));
    const upgrades = identityUpgradesForClasses(covered);
    let upgradedIdentityPages = 0;
    for (const upgrade of upgrades) {
      const page = (await prisma.wikiPage.findFirst({
        where: { organizationId: org.id, slug: upgrade.slug },
        select: { id: true, abstract: true, title: true },
      })) as { id: string; abstract: string | null; title: string } | null;
      if (!page) continue;
      const promoted = await promoteStanceMaterial({
        db: prisma,
        organizationId: org.id,
        wikiPageId: page.id,
        slug: upgrade.slug,
        summary: page.abstract ?? page.title,
        domainClasses: upgrade.domainClasses,
        tier: "confirmed",
        sourceType: upgrade.slug === "org-mission" ? "principle" : "stance",
      });
      if (promoted.ok) upgradedIdentityPages += 1;
    }

    revalidatePath("/coworker-decisions/stance");
    revalidatePath("/coworker-decisions");
    return { ok: true, confirmedVectors: v.vectors.length, upgradedIdentityPages };
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Could not confirm the stances." };
  }
}
