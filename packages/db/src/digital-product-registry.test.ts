import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type RegistryProduct = {
  product_id: string;
  name: string;
  portfolio_id?: string;
  taxonomy_node_id?: string;
  description?: string;
  depends_on_product_ids?: string[];
  lifecycle?: {
    stage?: string;
    stage_status?: string;
  };
};

const registryPath = join(__dirname, "..", "data", "digital_product_registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
  digital_products: RegistryProduct[];
};

function product(productId: string): RegistryProduct {
  const found = registry.digital_products.find((p) => p.product_id === productId);
  if (!found) throw new Error(`Missing registry product ${productId}`);
  return found;
}

describe("digital product registry BOM workforce mappings", () => {
  it("maps the AI Workforce surface to the Workforce portfolio taxonomy", () => {
    const aiWorkforce = product("dpf-ai-workforce");

    expect(aiWorkforce.name).toBe("AI Workforce");
    expect(aiWorkforce.portfolio_id).toBe("for_employees");
    expect(aiWorkforce.taxonomy_node_id).toBe("for_employees/workforce_services");
    expect(aiWorkforce.description).toContain("human employees and AI coworkers");
  });

  it("maps paying taxes / tax remittance to Workforce financial management", () => {
    const taxRemittance = product("dpf-tax-remittance");

    expect(taxRemittance.portfolio_id).toBe("for_employees");
    expect(taxRemittance.taxonomy_node_id).toBe("for_employees/financial_management/manage_taxes");
    expect(taxRemittance.depends_on_product_ids).toEqual(
      expect.arrayContaining(["dpf-ai-workforce", "int-quickbooks", "int-stripe"]),
    );
  });

  it("connects the sold DPF platform offer to AI Workforce for line-of-sight priority", () => {
    const platform = product("dpf-platform-standard");

    expect(platform.depends_on_product_ids).toContain("dpf-ai-workforce");
  });
});

describe("digital product registry retired datastore mappings", () => {
  const retiredDatastoreIds = ["infra-neo4j-core", "infra-qdrant-vector"];

  it.each(retiredDatastoreIds)("marks %s retired after the BET-5 cutover", (productId) => {
    expect(product(productId).lifecycle).toMatchObject({
      stage: "retire",
      stage_status: "retired",
    });
  });

  it("does not leave active or planned products depending on retired datastores", () => {
    const offenders = registry.digital_products
      .filter((candidate) => candidate.lifecycle?.stage_status !== "retired")
      .filter((candidate) =>
        candidate.depends_on_product_ids?.some((dependencyId) =>
          retiredDatastoreIds.includes(dependencyId),
        ),
      )
      .map((candidate) => candidate.product_id);

    expect(offenders).toEqual([]);
    expect(product("dpf-meta").depends_on_product_ids).toContain("infra-postgres-core");
  });
});
