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

export interface PublicStorefrontConfig {
  tagline: string | null;
  description: string | null;
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
}
