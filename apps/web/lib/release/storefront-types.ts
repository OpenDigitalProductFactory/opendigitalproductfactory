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
  orgName: string;
  orgSlug: string;
  orgLogoUrl: string | null;
  orgAddress: StorefrontAddress | null;
  brandingTokens: Record<string, unknown> | null;
  sections: PublicSection[];
  items: PublicItem[];
  /** Confirmed regulatory display obligations for the disclosures section. */
  displayObligations: PublicDisplayObligation[];
}
