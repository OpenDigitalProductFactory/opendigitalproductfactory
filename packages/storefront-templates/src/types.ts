export type CtaType = "booking" | "purchase" | "inquiry" | "donation";

export type PriceType =
  | "fixed" | "from" | "per-hour" | "per-session"
  | "free" | "donation" | "quote";

export type SectionType =
  | "hero" | "about" | "items" | "team" | "gallery"
  | "contact" | "testimonials" | "donate"
  | "animals-available" | "custom";

export type ArchetypeCategory =
  | "healthcare-wellness"
  | "beauty-personal-care"
  | "trades-maintenance"
  | "professional-services"
  | "education-training"
  | "pet-services"
  | "food-hospitality"
  | "retail-goods"
  | "fitness-recreation"
  | "nonprofit-community"
  | "hoa-property-management";

export interface FormField {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea" | "select";
  required: boolean;
  options?: string[];         // for select type
  placeholder?: string;
}

export interface ItemTemplate {
  name: string;
  description: string;
  priceType: PriceType;
  ctaType?: CtaType;          // overrides archetype default if set
  ctaLabel?: string;
  bookingDurationMinutes?: number;
}

export interface SectionTemplate {
  type: SectionType;
  title: string;
  sortOrder: number;
}

export interface SchedulingDefaults {
  schedulingPattern: "slot" | "class" | "recurring";
  assignmentMode: "next-available" | "customer-choice";
  defaultOperatingHours: { day: number; start: string; end: string }[];
  defaultBeforeBuffer: number;
  defaultAfterBuffer: number;
  minimumNoticeHours: number;
  maxAdvanceDays: number;
}

export interface ArchetypeDefinition {
  archetypeId: string;
  name: string;
  category: ArchetypeCategory;
  ctaType: CtaType;
  itemTemplates: ItemTemplate[];
  sectionTemplates: SectionTemplate[];
  formSchema: FormField[];
  tags: string[];
  schedulingDefaults?: SchedulingDefaults;
}
