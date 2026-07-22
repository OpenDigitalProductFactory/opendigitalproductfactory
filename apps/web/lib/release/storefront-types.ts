export interface StorefrontAddress {
  street?: string;
  city?: string;
  postcode?: string;
  country?: string;
}

export interface SocialLinks {
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  tiktok?: string;
  twitter?: string;
  youtube?: string;
}

export interface PublicItem {
  id: string;
  itemId: string;
  name: string;
  description: string | null;
  category: string | null;
  priceAmount: string | null;
  priceCurrency: string;
  priceType: string | null;
  imageUrl: string | null;
  ctaType: string;
  ctaLabel: string | null;
  bookingConfig: Record<string, unknown> | null;
  sortOrder: number;
}

export interface PublicSection {
  id: string;
  type: string;
  title: string | null;
  content: Record<string, unknown>;
  sortOrder: number;
  isVisible: boolean;
}

/** One image attached to a public-facing entity (item, animal, gallery section). */
export interface PublicMediaImage {
  url: string;
  altText: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
}

/**
 * An adoptable animal rendered by the `animals-available` section
 * (pet-rescue / animal-shelter). Backed by the AdoptableAnimal entity + a
 * MediaAttachment gallery, replacing the old free-form section JSON.
 */
export interface PublicAdoptableAnimal {
  id: string;
  animalRef: string;
  name: string;
  species: string | null;
  breed: string | null;
  age: string | null;
  sex: string | null;
  size: string | null;
  description: string | null;
  status: string;
  attributes: Record<string, unknown> | null;
  primaryPhotoUrl: string | null;
  photos: PublicMediaImage[];
}

/**
 * A confirmed regulatory display obligation rendered by the storefront
 * "disclosures" section (BI-5D9DCDE6 spec §9.3). Only obligations backed by an
 * ACTIVE OrganizationLicenseRecord are exposed publicly — the D5 honesty rule:
 * never render an insurance or registration claim without a confirmed
 * credential row behind it.
 */
export interface PublicDisplayObligation {
  displayObligationId: string;
  displayType: string;
  /** Disclosure line text (obligation notes, falling back to the credential's display rule). */
  text: string | null;
  /** e.g. "Member FDIC" authority context for the line. */
  authorityName: string | null;
  /** Credential number to display where the rule requires it (e.g. NMLS ID). */
  licenseNumber: string | null;
}

export interface PublicStorefrontConfig {
  tagline: string | null;
  description: string | null;
  timezone: string;
  heroImageUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  socialLinks: SocialLinks | null;
  archetypeId: string; // human-readable slug from StorefrontArchetype.archetypeId
  /** Archetype category (e.g. "food-hospitality") — drives vocabulary + trust copy. */
  archetypeCategory: string;
  orgName: string;
  orgSlug: string;
  orgLogoUrl: string | null;
  orgAddress: StorefrontAddress | null;
  brandingTokens: Record<string, unknown> | null;
  sections: PublicSection[];
  items: PublicItem[];
  /** Adoptable animals for the `animals-available` section (empty otherwise). */
  animals: PublicAdoptableAnimal[];
  /** Confirmed regulatory display obligations for the disclosures section. */
  displayObligations: PublicDisplayObligation[];
}
