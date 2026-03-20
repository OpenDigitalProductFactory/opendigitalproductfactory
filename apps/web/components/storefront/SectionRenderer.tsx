import type { PublicSection, PublicStorefrontConfig } from "@/lib/storefront-types";
import { HeroSection } from "./sections/HeroSection";
import { AboutSection } from "./sections/AboutSection";
import { ItemsGrid } from "./sections/ItemsGrid";
import { ContactSection } from "./sections/ContactSection";
import { TeamSection } from "./sections/TeamSection";
import { GallerySection } from "./sections/GallerySection";
import { TestimonialsSection } from "./sections/TestimonialsSection";
import { DonationSection } from "./sections/DonationSection";
import { AnimalsSection } from "./sections/AnimalsSection";
import { CustomSection } from "./sections/CustomSection";

export function SectionRenderer({
  section,
  storefront,
  orgSlug,
}: {
  section: PublicSection;
  storefront: PublicStorefrontConfig;
  orgSlug: string;
}) {
  const content = section.content;

  switch (section.type) {
    case "hero":
      return <HeroSection content={content} orgName={storefront.orgName} tagline={storefront.tagline} />;
    case "about":
      return <AboutSection content={content} />;
    case "items":
      return <ItemsGrid items={storefront.items} orgSlug={orgSlug} />;
    case "contact":
      return <ContactSection storefront={storefront} />;
    case "team":
      return <TeamSection content={content} />;
    case "gallery":
      return <GallerySection content={content} />;
    case "testimonials":
      return <TestimonialsSection content={content} />;
    case "donate":
      return <DonationSection content={content} orgSlug={orgSlug} />;
    case "animals-available":
      return <AnimalsSection content={content} />;
    case "custom":
      return <CustomSection content={content} />;
    default:
      return null;
  }
}
