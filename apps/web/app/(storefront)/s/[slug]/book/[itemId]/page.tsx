import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@dpf/db";
import { getPublicStorefront, getPublicItem, resolveInquiryFormSchema } from "@/lib/storefront-data";
import { resolveTrustProfile } from "@/lib/storefront/public-trust";
import { CustomerRestaurantAvailability } from "@/components/storefront/CustomerRestaurantAvailability";
import { SlotBookingFlow } from "@/components/storefront/SlotBookingFlow";
import { resolveResourceVocabulary } from "@/lib/storefront/resource-vocabulary";
import {
  loadPublicRestaurantAvailabilityBySlugSafe,
  type PublicRestaurantAvailabilityDatabase,
} from "@/lib/twin/restaurant-floor-loader.server";

export default async function BookItemPage({
  params,
}: {
  params: Promise<{ slug: string; itemId: string }>;
}) {
  const { slug, itemId } = await params;
  const [storefront, item, restaurantAvailability] = await Promise.all([
    getPublicStorefront(slug),
    getPublicItem(slug, itemId),
    loadPublicRestaurantAvailabilityBySlugSafe(
      prisma as unknown as PublicRestaurantAvailabilityDatabase,
      { slug },
    ),
  ]);
  if (!storefront || !item) notFound();

  const formSchema = await resolveInquiryFormSchema(storefront.archetypeId);
  const trust = resolveTrustProfile(storefront.archetypeCategory);
  const capitalizedNoun = trust.bookingNoun.charAt(0).toUpperCase() + trust.bookingNoun.slice(1);

  // For a capacity archetype (Restaurant FLOOR), availability reads in table
  // terms; other archetypes keep generic booking copy (BI-7C95A586).
  const resourceVocab = resolveResourceVocabulary({ archetypeId: storefront.archetypeId, teamLabel: "" });
  const resourceNoun = resourceVocab.hasCapacityResources ? resourceVocab.resourceSingular : undefined;

  return (
    <div style={{ paddingTop: 40, maxWidth: 520 }}>
      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--dpf-muted)", margin: "0 0 4px" }}>
        {capitalizedNoun} request
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: "var(--dpf-text)" }}>Book: {item.name}</h1>

      <div
        style={{
          marginBottom: 20,
          padding: "14px 16px",
          borderRadius: 10,
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-surface-1)",
        }}
      >
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--dpf-text)", margin: "0 0 6px" }}>
          {trust.bookingPolicy}
        </p>
        {trust.dietaryNote && (
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--dpf-muted)", margin: 0 }}>
            {trust.dietaryNote}
          </p>
        )}
      </div>

      {restaurantAvailability && (
        <CustomerRestaurantAvailability
          availability={restaurantAvailability}
        />
      )}

      <SlotBookingFlow
        orgSlug={slug}
        itemId={item.itemId}
        itemInternalId={item.id}
        itemName={item.name}
        timezone={storefront.timezone}
        bookingConfig={item.bookingConfig as Record<string, unknown> | null}
        formSchema={formSchema}
        resourceNoun={resourceNoun}
      />

      <p style={{ marginTop: 16, fontSize: 13, color: "var(--dpf-muted)" }}>
        {trust.cancellationPolicy}{" "}
        <Link href={`/s/${slug}/inquire`} style={{ color: "var(--dpf-accent)" }}>Contact {storefront.orgName}</Link>
        {" · "}
        <Link href={`/s/${slug}/policies`} style={{ color: "var(--dpf-accent)" }}>Full policy</Link>
      </p>
    </div>
  );
}
