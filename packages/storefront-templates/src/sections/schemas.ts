// Typed content shape for each StorefrontSection type.
// These are the shapes stored in StorefrontSection.content (Json).

export interface HeroContent {
  headline: string;
  subheading?: string;
  ctaLabel?: string;
  backgroundImageUrl?: string;
}

export interface AboutContent {
  body: string;
  imageUrl?: string;
}

export interface TeamContent {
  members: Array<{ name: string; role: string; imageUrl?: string; bio?: string }>;
}

export interface GalleryContent {
  images: Array<{ url: string; caption?: string }>;
}

export interface ContactContent {
  showMap: boolean;
  customMessage?: string;
}

export interface TestimonialsContent {
  testimonials: Array<{ author: string; quote: string; rating?: number }>;
}

export interface DonationSectionContent {
  campaignTitle: string;
  campaignDescription?: string;
  targetAmount?: number;
  currency?: string;
}

export interface AnimalsContent {
  intro?: string;
}

export interface CustomContent {
  markdown: string;
}
