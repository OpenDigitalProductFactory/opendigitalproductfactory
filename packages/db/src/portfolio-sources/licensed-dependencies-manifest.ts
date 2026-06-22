// Paid / licensed third-party dependencies the platform runs on (BI-PORTCOV-P4;
// spec §4.4.4). Mark: "3rd parties in the SBOM we use … most are not paid for,
// but some may be like Docker." The npm BomComponent SBOM is empty until an
// assurance run and is overwhelmingly free OSS; the *paid* third parties are
// infrastructure (Docker, Neo4j) that live in the digital_product_registry
// procurement layer (product_models). This small manifest surfaces them as
// portfolio components with a paid flag, always present — the dynamic OSS
// long-tail is added by the BomComponent projector when an SBOM exists.

export interface LicensedDependency {
  id: string;
  name: string;
  supplier: string;
  edition?: string;
  /** "seat" | "instance" | "subscription" — the licensing basis (cost driver). */
  licenseBasis: string;
  description: string;
}

export const LICENSED_DEPENDENCIES: readonly LicensedDependency[] = [
  {
    id: "docker-business",
    name: "Docker Business",
    supplier: "Docker",
    edition: "Business",
    licenseBasis: "seat",
    description:
      "Container runtime + Docker Model Runner (local AI inference). Paid Business edition, licensed per seat.",
  },
  {
    id: "neo4j-enterprise",
    name: "Neo4j Enterprise 5",
    supplier: "Neo4j",
    edition: "Enterprise",
    licenseBasis: "instance",
    description:
      "Graph database for impact analysis and dependency management. Paid Enterprise edition, licensed per instance.",
  },
];
