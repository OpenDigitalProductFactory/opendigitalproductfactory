import type { ArchetypeDefinition, SchedulingDefaults } from "../types";

const FOOD_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "next-available",
  defaultOperatingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: "11:00", end: "22:00" })),
  defaultBeforeBuffer: 0,
  defaultAfterBuffer: 15,
  minimumNoticeHours: 1,
  maxAdvanceDays: 30,
};

const CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: true },
];

export const foodHospitalityArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "restaurant",
    name: "Restaurant",
    category: "food-hospitality",
    ctaType: "booking",
    tags: ["restaurant", "dining", "food", "reservation"],
    itemTemplates: [
      { name: "Table for 2", description: "Reserve a table for two guests", priceType: "free", bookingDurationMinutes: 90 },
      { name: "Table for 4", description: "Reserve a table for four guests", priceType: "free", bookingDurationMinutes: 90 },
      { name: "Table for 6+", description: "Group booking for 6 or more guests", priceType: "free", bookingDurationMinutes: 120 },
      { name: "Private Dining", description: "Exclusive use of our private dining room", priceType: "from", bookingDurationMinutes: 180 },
      { name: "Set Lunch Menu", description: "Two or three course set lunch", priceType: "from", ctaType: "booking" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Reservations", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "gallery", title: "Our Food", sortOrder: 3 },
      { type: "testimonials", title: "Guest Reviews", sortOrder: 4 },
      { type: "contact", title: "Find Us", sortOrder: 5 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "covers", label: "Number of guests", type: "select" as const, required: true, options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10+"] },
      { name: "date", label: "Preferred date", type: "text" as const, required: true, placeholder: "DD/MM/YYYY" },
      { name: "time", label: "Preferred time", type: "select" as const, required: true, options: ["12:00", "12:30", "13:00", "13:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30"] },
      { name: "dietaryRequirements", label: "Dietary requirements", type: "textarea" as const, required: false },
    ],
    schedulingDefaults: FOOD_SCHEDULING,
  },
  {
    archetypeId: "catering",
    name: "Catering",
    category: "food-hospitality",
    ctaType: "inquiry",
    tags: ["catering", "events", "food", "hospitality"],
    itemTemplates: [
      { name: "Corporate Catering", description: "Office lunches, meetings, and corporate events", priceType: "quote" },
      { name: "Wedding Catering", description: "Full catering service for your wedding day", priceType: "quote" },
      { name: "Private Event", description: "Bespoke catering for private parties and celebrations", priceType: "quote" },
      { name: "Buffet Package", description: "Hot and cold buffet options per head", priceType: "from" },
      { name: "BBQ Package", description: "Outdoor barbecue package with staffing", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Catering Packages", sortOrder: 1 },
      { type: "gallery", title: "Our Menus", sortOrder: 2 },
      { type: "about", title: "About Us", sortOrder: 3 },
      { type: "contact", title: "Get a Quote", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "eventType", label: "Type of event", type: "select" as const, required: true, options: ["Corporate", "Wedding", "Private party", "Funeral wake", "Other"] },
      { name: "guestCount", label: "Number of guests", type: "select" as const, required: true, options: ["Under 20", "20–50", "50–100", "100–200", "200+"] },
      { name: "date", label: "Event date", type: "text" as const, required: false, placeholder: "DD/MM/YYYY" },
      { name: "dietaryRequirements", label: "Dietary requirements", type: "textarea" as const, required: false },
    ],
  },
  {
    archetypeId: "bakery",
    name: "Bakery",
    category: "food-hospitality",
    ctaType: "purchase",
    tags: ["bakery", "bread", "cakes", "food"],
    itemTemplates: [
      { name: "Sourdough Loaf", description: "Freshly baked sourdough — available daily", priceType: "fixed", ctaType: "purchase" },
      { name: "Birthday Cake", description: "Celebration cake with custom decoration", priceType: "from", ctaType: "purchase" },
      { name: "Custom Order", description: "Bespoke cake or baked goods for any occasion", priceType: "quote", ctaType: "inquiry" },
      { name: "Seasonal Pastries", description: "Fresh pastries, croissants, and buns", priceType: "fixed", ctaType: "purchase" },
      { name: "Wedding Cake", description: "Multi-tier wedding cake with consultation", priceType: "quote", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Our Bakes", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "gallery", title: "Fresh from the Oven", sortOrder: 3 },
      { type: "contact", title: "Get in Touch", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "orderType", label: "Order type", type: "select" as const, required: true, options: ["Standard product", "Custom cake", "Wedding cake", "Other"] },
      { name: "notes", label: "Order details", type: "textarea" as const, required: false },
    ],
  },
];
