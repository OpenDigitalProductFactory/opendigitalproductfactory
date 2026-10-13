import { describe, expect, it } from "vitest";
import { assertFixtureRoutePath, assertResolvedSweepPaths, loadExhaustivePreviewFixtures } from "./ux-sweep-preview-context";
describe("exhaustive preview coverage", () => {
  it("accepts concrete dynamic/catch-all paths and refuses substitutions or escapes", () => {
    assertFixtureRoutePath("/finance/invoices/[id]", "/finance/invoices/fixture-id");
    assertFixtureRoutePath("/docs/[[...slug]]", "/docs");
    assertFixtureRoutePath("/wiki/[...slug]", "/wiki/principles/example");
    for (const path of ["/admin", "//foreign.example", "/finance/invoices/../admin", "/finance/invoices/[id]"]) {
      expect(() => assertFixtureRoutePath("/finance/invoices/[id]", path)).toThrow();
    }
    expect(() => assertResolvedSweepPaths([{ routePath: "/finance/invoices/[id]" }], {})).toThrow(/fixture/);
  });
  it("binds fixtures to the served source, lease and preview origin", async () => {
    const preview = { sourceSha: "a".repeat(40), leaseId: "NPEL-1", baseUrl: "http://localhost:3001" };
    const fixture = { ...preview, routes: { "/finance/invoices/[id]": "/finance/invoices/fixture-id" } };
    const deps = { sourceSha: () => preview.sourceSha, readJson: () => fixture, health: async () => ({ ok: true, body: { preview } }) };
    await expect(loadExhaustivePreviewFixtures({ root: "/repo", fixturePath: "fixtures.json", baseUrl: preview.baseUrl }, deps)).resolves.toMatchObject({ leaseId: "NPEL-1" });
    await expect(loadExhaustivePreviewFixtures({ root: "/repo", fixturePath: "fixtures.json", baseUrl: "http://localhost:3000" }, deps)).rejects.toThrow(/does not belong/);
    await expect(loadExhaustivePreviewFixtures({ root: "/repo", fixturePath: "fixtures.json", baseUrl: preview.baseUrl }, { ...deps, sourceSha: () => "different" })).rejects.toThrow(/inventory source/);
    await expect(loadExhaustivePreviewFixtures({ root: "/repo", fixturePath: "fixtures.json", baseUrl: preview.baseUrl }, { ...deps, readJson: () => ({ ...fixture, sourceSha: "other" }) })).rejects.toThrow(/does not belong/);
  });
});
