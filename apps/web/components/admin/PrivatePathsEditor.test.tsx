import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/platform-dev-config", () => ({
  addPrivatePathRule: vi.fn(),
  removePrivatePathRule: vi.fn(),
}));

import { PrivatePathsEditor } from "@/components/admin/PrivatePathsEditor";

describe("PrivatePathsEditor", () => {
  it("renders the empty state with an add form", () => {
    const html = renderToStaticMarkup(<PrivatePathsEditor rules={[]} />);
    expect(html).toContain("Keep these paths private");
    expect(html).toMatch(/Pattern/);
    expect(html).toContain(".dpf/private-paths");
  });

  it("lists existing rules with their patterns and reasons", () => {
    const html = renderToStaticMarkup(
      <PrivatePathsEditor
        rules={[
          { id: "1", pattern: "proprietary/", reason: "our pricing logic", createdAt: "2026-06-19T00:00:00Z" },
          { id: "2", pattern: "**/*.secret", reason: null, createdAt: "2026-06-19T00:00:00Z" },
        ]}
      />,
    );
    expect(html).toContain("proprietary/");
    expect(html).toContain("our pricing logic");
    expect(html).toContain("**/*.secret");
    expect(html).toContain('data-testid="remove-private-path"');
  });
});
