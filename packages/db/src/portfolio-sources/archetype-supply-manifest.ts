// Per-archetype-category starter suppliers + goods (BI-PORTCOV-P5; spec §4.4.5).
//
// seed-market-offer.ts already seeds the SERVICES an archetype sells into
// Products & Services Sold. This manifest adds the buy-side and the goods-side
// the archetype implies but never seeds: the SUPPLIERS a business manages to
// deliver (a plumber's trade merchants — "a missing part means a second trip")
// and the GOODS it sells distinct from its services. These are broad, true,
// EDITABLE starters keyed by archetype category — the same day-one-understanding
// discipline as archetype-business-context.ts; the operator refines them.
//
// Categories with no starter are simply not seeded (the projector no-ops), so
// adding a category here is purely additive.

import type { ArchetypeCategory } from "@dpf/storefront-templates";

export interface ArchetypeSupplyItem {
  name: string;
  description: string;
}

export interface ArchetypeSupplyStarter {
  /** Vendors the business manages to deliver — projected into Manufacturing & Delivery (coverage=used). */
  suppliers: ArchetypeSupplyItem[];
  /** Physical goods sold, distinct from services — projected into Products & Services Sold (coverage=sold). */
  goods: ArchetypeSupplyItem[];
}

export const ARCHETYPE_SUPPLY_MANIFEST: Partial<
  Record<ArchetypeCategory, ArchetypeSupplyStarter>
> = {
  "trades-maintenance": {
    suppliers: [
      {
        name: "Trade Merchants & Wholesalers",
        description:
          "Parts and materials suppliers (plumbing/electrical/HVAC merchants). Much is carried as van stock so common jobs are first-visit fixes; matching parts to the day's jobs is the discipline.",
      },
      { name: "Tool & Equipment Hire", description: "Hire of specialist tools and plant for larger jobs." },
      { name: "PPE & Safety Supplier", description: "Personal protective equipment and site-safety consumables." },
    ],
    goods: [
      {
        name: "Parts & Materials (van stock)",
        description: "Parts and fittings supplied and billed alongside labour — the goods side of a service call.",
      },
      { name: "Fixtures & Fittings", description: "Customer-selected fixtures supplied as part of an installation." },
    ],
  },
  "retail-goods": {
    suppliers: [
      { name: "Wholesale Distributor", description: "Primary supplier of merchandise inventory for resale." },
      { name: "Dropship Supplier", description: "Supplier fulfilling orders directly to the customer without held stock." },
      { name: "Packaging & Fulfilment Supplier", description: "Packaging materials and fulfilment consumables." },
    ],
    goods: [
      { name: "Retail Merchandise", description: "The sold-inventory product lines — the core of a goods business." },
    ],
  },
  "food-hospitality": {
    suppliers: [
      { name: "Food & Beverage Wholesaler", description: "Core supplier of ingredients, drinks, and kitchen consumables." },
      { name: "Fresh Produce Supplier", description: "Perishable produce on a frequent delivery cadence." },
    ],
    goods: [
      { name: "Menu Items & Packaged Food", description: "Prepared and packaged food sold to customers." },
    ],
  },
  "automotive-services": {
    suppliers: [
      { name: "Auto Parts Distributor", description: "VIN-to-part parts supply for repairs and replacements." },
      { name: "Fluids & Consumables Supplier", description: "Oils, fluids, and shop consumables." },
    ],
    goods: [
      { name: "Replacement Parts", description: "Parts supplied and billed with the service." },
    ],
  },
  "moving-and-logistics": {
    suppliers: [
      { name: "Packing Materials Supplier", description: "Boxes, wrap, and protective materials for moves." },
      { name: "Fleet Fuel & Maintenance", description: "Fuel and vehicle maintenance keeping the crew+truck running." },
    ],
    goods: [
      { name: "Packing Supplies (sold)", description: "Boxes and materials sold to customers ahead of a move." },
    ],
  },
  "beauty-personal-care": {
    suppliers: [
      { name: "Salon Products Distributor", description: "Professional-use products and back-bar supply." },
    ],
    goods: [
      { name: "Retail Hair & Skin Products", description: "Take-home products sold to clients." },
    ],
  },
  "pet-services": {
    suppliers: [
      { name: "Pet Food & Supplies Distributor", description: "Food, treats, and supplies for service delivery and resale." },
    ],
    goods: [
      { name: "Retail Pet Products", description: "Food, toys, and accessories sold to owners." },
    ],
  },
  "asset-rental": {
    suppliers: [
      { name: "Equipment Manufacturer / Distributor", description: "Source of the rental fleet assets." },
      { name: "Maintenance & Parts Supplier", description: "Spares and servicing that keep pooled assets rentable." },
    ],
    goods: [
      { name: "Consumables & Accessories", description: "Consumables and accessories sold alongside a rental." },
    ],
  },
  "warehousing-fulfilment": {
    suppliers: [
      {
        name: "Packaging & Consumables Supplier",
        description:
          "Cartons, pallets, stretch wrap, and labels. Consumed per order, so usage tracks despatch volume and is usually recharged to the client.",
      },
      {
        name: "Materials Handling Equipment",
        description:
          "Forklifts, pallet trucks, and racking — bought or leased, with servicing. Availability caps how much can be moved in a shift.",
      },
      {
        name: "Carriers & Parcel Networks",
        description:
          "Pallet networks and parcel carriers that collect outbound freight. Their cut-off times set the deadline every pick wave runs against.",
      },
      {
        name: "WMS & Systems Vendor",
        description:
          "The warehouse management system and scanning hardware — the stock ledger of record, and where client integrations land.",
      },
    ],
    // A 3PL sells custody and handling, not goods; the stock on its racks
    // belongs to its clients and must never be projected as its own.
    goods: [],
  },
  "fabric-care-services": {
    suppliers: [
      {
        name: "Cleaning Supplies & Solvents Distributor",
        description:
          "Detergents, spotting agents, wet-cleaning chemistry, and plant consumables. Supply continuity protects ready promises and garment quality.",
      },
      {
        name: "Tags Tickets & Packaging Supplier",
        description:
          "Claim tickets, barcode tags, garment covers, hangers, and bags that keep every item tied to the customer's order.",
      },
      {
        name: "Equipment Maintenance Vendor",
        description:
          "Washer, dryer, press, boiler, conveyor, and spotting-table maintenance. Plant downtime turns into delayed customer orders.",
      },
      {
        name: "Delivery Route Provider",
        description:
          "In-house drivers, courier partners, or route software used for home, office, and satellite-store pickup and return.",
      },
    ],
    goods: [
      {
        name: "Garment Covers Hangers & Laundry Bags",
        description:
          "Packaging and reusable bags sold or issued alongside cleaning and pickup services.",
      },
    ],
  },
};
