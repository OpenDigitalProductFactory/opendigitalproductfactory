import { describe, expect, it } from "vitest";

import { withDpfMcpCatalogTier } from "./mcp-catalog-tier";

describe("withDpfMcpCatalogTier", () => {
  it("adds the explicit full-catalog contract for a lazy host", () => {
    expect(withDpfMcpCatalogTier("http://127.0.0.1:3000/api/mcp/v1", "full")).toBe(
      "http://127.0.0.1:3000/api/mcp/v1?tier=full",
    );
  });

  it("preserves unrelated query parameters while replacing a stale tier", () => {
    expect(
      withDpfMcpCatalogTier(
        "https://dpf.example.com/api/mcp/v1?tenant=demo&tier=core",
        "full",
      ),
    ).toBe("https://dpf.example.com/api/mcp/v1?tenant=demo&tier=full");
  });

  it("is idempotent", () => {
    const once = withDpfMcpCatalogTier(
      "http://127.0.0.1:3000/api/mcp/v1?tier=full",
      "full",
    );
    expect(withDpfMcpCatalogTier(once, "full")).toBe(once);
  });
});
