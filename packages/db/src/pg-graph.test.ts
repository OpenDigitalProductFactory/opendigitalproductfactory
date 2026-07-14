import { describe, it, expect } from "vitest";
import {
  IMPACT_RELATIONSHIP_TYPES,
  IMPACT_REL_FILTER,
  nodeFromRow,
  reachabilitySql,
} from "./pg-graph";

describe("pg-graph IMPACT_RELATIONSHIP_TYPES (parity with neo4j-graph)", () => {
  it("lists the 10 traversed rel types in order", () => {
    expect([...IMPACT_RELATIONSHIP_TYPES]).toEqual([
      "DEPENDS_ON",
      "HOSTS",
      "RUNS_ON",
      "LISTENS_ON",
      "MONITORS",
      "MEMBER_OF",
      "ROUTES_THROUGH",
      "CARRIED_BY",
      "CONNECTS_TO",
      "PEER_OF",
    ]);
  });

  it("derives the pipe-joined Cypher filter fragment", () => {
    expect(IMPACT_REL_FILTER).toBe(
      "DEPENDS_ON|HOSTS|RUNS_ON|LISTENS_ON|MONITORS|MEMBER_OF|ROUTES_THROUGH|CARRIED_BY|CONNECTS_TO|PEER_OF",
    );
  });
});

describe("pg-graph nodeFromRow (label/name/id mapping, parity with nodeFromRecord)", () => {
  it("picks the primary label (labels[0]) and reads name from props", () => {
    const n = nodeFromRow({
      key: "prod-1",
      labels: ["DigitalProduct", "Extra"],
      props: { productId: "prod-1", name: "Billing" },
    });
    expect(n.label).toBe("DigitalProduct");
    expect(n.name).toBe("Billing");
    expect(n.id).toBe("prod-1");
    expect(n.properties).toEqual({ productId: "prod-1", name: "Billing" });
  });

  it("coalesces id in productId→ciId→nodeId→slug order", () => {
    expect(nodeFromRow({ key: "k", labels: ["InfraCI"], props: { ciId: "ci-9" } }).id).toBe("ci-9");
    expect(nodeFromRow({ key: "k", labels: ["TaxonomyNode"], props: { nodeId: "n-3" } }).id).toBe("n-3");
    expect(nodeFromRow({ key: "k", labels: ["Portfolio"], props: { slug: "core" } }).id).toBe("core");
    // productId wins over the others when several are present
    expect(
      nodeFromRow({ key: "k", labels: ["X"], props: { productId: "p", ciId: "c", nodeId: "n", slug: "s" } }).id,
    ).toBe("p");
  });

  it("falls back to the row key when no id property is present", () => {
    const n = nodeFromRow({ key: "the-key", labels: ["InfraCI"], props: {} });
    expect(n.id).toBe("the-key");
    // name falls back to id when props.name is absent
    expect(n.name).toBe("the-key");
  });

  it("defaults the label to Unknown when labels is empty", () => {
    expect(nodeFromRow({ key: "k", labels: [], props: {} }).label).toBe("Unknown");
  });
});

describe("pg-graph reachabilitySql (recursive CTE builder)", () => {
  it("downstream walks dst→src (reverse edges) from the origin key $2", () => {
    const sql = reachabilitySql("downstream", "InfraCI", 10);
    expect(sql).toContain("WHERE e.dst_key = $2"); // base: edges pointing INTO origin
    expect(sql).toContain("ARRAY[$2::text, e.src_key]"); // step to src
    expect(sql).toContain("JOIN graph_edge e ON e.dst_key = w.node_key");
    expect(sql).toContain("'InfraCI' = ANY(origin.labels)");
  });

  it("upstream walks src→dst (forward edges) from the origin key $2", () => {
    const sql = reachabilitySql("upstream", "DigitalProduct", 15);
    expect(sql).toContain("WHERE e.src_key = $2");
    expect(sql).toContain("ARRAY[$2::text, e.dst_key]");
    expect(sql).toContain("JOIN graph_edge e ON e.src_key = w.node_key");
    expect(sql).toContain("'DigitalProduct' = ANY(origin.labels)");
  });

  it("binds the rel-type filter as the $1 text[] param and carries a cycle guard", () => {
    const sql = reachabilitySql("upstream", "InfraCI", 10);
    expect(sql).toContain("e.rel_type = ANY($1::text[])");
    expect(sql).toContain("NOT e.dst_key = ANY(w.path)");
  });

  it("interpolates the depth cap as a truncated positive integer only", () => {
    expect(reachabilitySql("downstream", "InfraCI", 10)).toContain("w.depth < 10");
    // fractional → truncated, never a float in the SQL
    expect(reachabilitySql("downstream", "InfraCI", 12.9)).toContain("w.depth < 12");
    // zero / non-finite → clamped to a minimum of 1
    expect(reachabilitySql("downstream", "InfraCI", 0)).toContain("w.depth < 1");
    expect(reachabilitySql("downstream", "InfraCI", Number.NaN)).toContain("w.depth < 1");
  });

  it("escapes single quotes in the origin label (no injection via label)", () => {
    const sql = reachabilitySql("upstream", "O'Neil", 5);
    expect(sql).toContain("'O''Neil' = ANY(origin.labels)");
  });
});
