import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DigitalProductDetail } from "./DigitalProductDetail";
import type { DigitalProductView } from "@/lib/portfolio/digital-product-view-model";

const emptyVm: DigitalProductView = {
  id: "dp_min",
  productId: "minimal-thing",
  name: "Minimal Thing",
  description: null,
  version: "0.1.0",
  lifecycleStage: "plan",
  lifecycleStatus: "draft",
  observationConfig: null,
  coworker: null,
  taxonomyLineage: [],
  portfolio: null,
  primaryEntity: null,
  linkedEntities: [],
  linkedEntityCount: 0,
  freshness: null,
  enrichmentStatus: null,
  lastEnrichedAt: null,
  openQualityIssues: [],
};

const fullVm: DigitalProductView = {
  id: "dp_1",
  productId: "host-postgres",
  name: "PostgreSQL",
  description: "Primary relational database for the platform.",
  version: "16.0",
  lifecycleStage: "production",
  lifecycleStatus: "active",
  observationConfig: { classifyAs: "infrastructure_endpoint" },
  coworker: null,
  taxonomyLineage: [
    { nodeId: "foundational", name: "Foundational" },
    { nodeId: "foundational/data_and_storage_management", name: "Data and Storage Management" },
    { nodeId: "foundational/data_and_storage_management/database", name: "Database" },
  ],
  portfolio: { id: "p_1", slug: "foundational", name: "Foundational" },
  primaryEntity: {
    id: "ent_1",
    name: "PostgreSQL Container",
    entityKey: "container:dpf-postgres-1",
    entityType: "container",
    manufacturer: "PostgreSQL Global Development Group",
    productModel: "PostgreSQL",
    technicalClass: "relational_database",
    iconKey: "postgres",
    observedVersion: "16.0",
    normalizedVersion: "16.0.0",
    attributionConfidence: 0.98,
    lastSeenAt: new Date("2026-04-30T12:00:00Z"),
  },
  linkedEntities: [
    {
      id: "ent_1",
      name: "PostgreSQL Container",
      entityKey: "container:dpf-postgres-1",
      entityType: "container",
      manufacturer: "PostgreSQL Global Development Group",
      productModel: "PostgreSQL",
      technicalClass: "relational_database",
      iconKey: "postgres",
      observedVersion: "16.0",
      normalizedVersion: "16.0.0",
      attributionConfidence: 0.98,
      lastSeenAt: new Date("2026-04-30T12:00:00Z"),
    },
    {
      id: "ent_2",
      name: "Postgres Replica",
      entityKey: "container:dpf-postgres-2",
      entityType: "container",
      manufacturer: null,
      productModel: null,
      technicalClass: null,
      iconKey: null,
      observedVersion: "16.0",
      normalizedVersion: "16.0.0",
      attributionConfidence: 0.92,
      lastSeenAt: new Date("2026-04-30T11:00:00Z"),
    },
    {
      id: "ent_3",
      name: "Postgres Backup Job",
      entityKey: "container:dpf-postgres-backup",
      entityType: "container",
      manufacturer: null,
      productModel: null,
      technicalClass: null,
      iconKey: null,
      observedVersion: null,
      normalizedVersion: null,
      attributionConfidence: null,
      lastSeenAt: new Date("2026-04-29T08:00:00Z"),
    },
  ],
  linkedEntityCount: 3,
  freshness: "fresh",
  enrichmentStatus: "enriched",
  lastEnrichedAt: new Date("2026-04-29T08:00:00Z"),
  openQualityIssues: [
    {
      id: "q_1",
      issueType: "incomplete_detail",
      severity: "warn",
      summary: "Manufacturer field is missing on related entity",
      lastDetectedAt: new Date("2026-04-30T11:00:00Z"),
    },
  ],
};

describe("DigitalProductDetail", () => {
  describe("empty (only required fields populated)", () => {
    it("renders the product name and version", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={emptyVm} />);
      expect(html).toContain("Minimal Thing");
      expect(html).toContain("0.1.0");
    });

    it("renders the productId", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={emptyVm} />);
      expect(html).toContain("minimal-thing");
    });

    it("renders lifecycle stage and status", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={emptyVm} />);
      expect(html).toContain("plan");
      expect(html).toContain("draft");
    });

    it("renders 'Unknown' freshness badge when freshness is null", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={emptyVm} />);
      expect(html).toContain("Unknown");
    });

    it("does not render description section when description is null", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={emptyVm} />);
      expect(html).not.toMatch(/>Description</);
    });

    it("does not render quality issues section when none open", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={emptyVm} />);
      expect(html).not.toMatch(/>Open Quality Issues</);
    });

    it("does not render linked entities section when no entities linked", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={emptyVm} />);
      expect(html).not.toMatch(/>Linked Inventory Entities</);
    });

    it("does not render taxonomy breadcrumb when lineage is empty", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={emptyVm} />);
      expect(html).not.toMatch(/>Taxonomy</);
    });
  });

  describe("full (all fields populated)", () => {
    it("renders the product name, version, and productId", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={fullVm} />);
      expect(html).toContain("PostgreSQL");
      expect(html).toContain("16.0");
      expect(html).toContain("host-postgres");
    });

    it("renders the description in a Description section", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={fullVm} />);
      expect(html).toContain(">Description<");
      expect(html).toContain("Primary relational database for the platform.");
    });

    it("renders Identity (manufacturer, productModel, technicalClass, iconKey)", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={fullVm} />);
      expect(html).toContain(">Identity<");
      expect(html).toContain("PostgreSQL Global Development Group");
      expect(html).toContain("relational_database");
      expect(html).toContain("postgres");
    });

    it("renders the taxonomy lineage breadcrumb", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={fullVm} />);
      expect(html).toContain(">Taxonomy<");
      expect(html).toContain("Foundational");
      expect(html).toContain("Data and Storage Management");
      expect(html).toContain("Database");
    });

    it("renders Linked Inventory Entities section with all entities, not just the primary", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={fullVm} />);
      expect(html).toContain(">Linked Inventory Entities<");
      // All three entities render in the table, in order.
      expect(html).toContain("PostgreSQL Container");
      expect(html).toContain("container:dpf-postgres-1");
      expect(html).toContain("Postgres Replica");
      expect(html).toContain("container:dpf-postgres-2");
      expect(html).toContain("Postgres Backup Job");
      expect(html).toContain("container:dpf-postgres-backup");
      // Three <tr> rows in <tbody> (header row is in <thead>).
      const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
      expect(tbodyMatch).not.toBeNull();
      const trCount = (tbodyMatch![1].match(/<tr\b/g) ?? []).length;
      expect(trCount).toBe(3);
    });

    it("renders Open Quality Issues section with summary text", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={fullVm} />);
      expect(html).toContain(">Open Quality Issues<");
      expect(html).toContain("Manufacturer field is missing on related entity");
    });

    it("renders the Fresh freshness badge", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={fullVm} />);
      expect(html).toContain("Fresh");
    });

    it("does not leak raw JSON (no { or } around primaryEntity name string)", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={fullVm} />);
      // No bare JSON-looking blobs (e.g. the entire stringified entity).
      expect(html).not.toContain("entityKey:");
      expect(html).not.toContain('"manufacturer"');
    });
  });

  describe("AI coworker product (BI-8F9EDD6C)", () => {
    const coworkerVm: DigitalProductView = {
      ...emptyVm,
      id: "dp_coworker",
      productId: "coworker-AGT-COO",
      name: "Chief of Staff",
      coworker: {
        agentId: "AGT-COO",
        humanRoleParity: "HR-000",
        approvalInterfaceOwner: "HR-000",
      },
    };

    it("renders the AI Coworker section with parity anchor + approval owner", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={coworkerVm} />);
      expect(html).toContain(">AI Coworker<");
      expect(html).toContain("Employee-role parity");
      expect(html).toContain("Approval / interface owner");
      expect(html).toContain("AGT-COO");
      expect(html).toContain("HR-000");
    });

    it("shows a broad-unassigned owner when no owner role is set", () => {
      const vm: DigitalProductView = {
        ...coworkerVm,
        coworker: { agentId: "AGT-X", humanRoleParity: null, approvalInterfaceOwner: null },
      };
      const html = renderToStaticMarkup(<DigitalProductDetail vm={vm} />);
      expect(html).toContain("broad (unassigned)");
    });

    it("does not render the AI Coworker section for a non-coworker product", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={fullVm} />);
      expect(html).not.toMatch(/>AI Coworker</);
    });
  });

  describe("theming", () => {
    it("uses only theme tokens (no raw white/black/gray classes)", () => {
      const html = renderToStaticMarkup(<DigitalProductDetail vm={fullVm} />);
      expect(html).not.toMatch(/text-white|text-black|text-gray-|bg-white|bg-black|bg-gray-/);
      expect(html).toContain("var(--dpf-");
    });
  });
});
