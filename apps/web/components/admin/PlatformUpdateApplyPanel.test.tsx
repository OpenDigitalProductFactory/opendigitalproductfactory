import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/platform-dev-config", () => ({
  applyPlatformUpdate: vi.fn(),
}));

import { ApplyResult } from "@/components/admin/PlatformUpdateApplyPanel";

describe("PlatformUpdateApplyPanel", () => {
  it("does not send update-conflict recovery through Build Studio", () => {
    const html = renderToStaticMarkup(
      <ApplyResult
        result={{
          kind: "conflicts",
          message: "Merge has conflicts.",
          version: "v1.2.3",
          resumedMerge: false,
          conflicts: [
            {
              file: "apps/web/page.tsx",
              upstreamChange: "upstream",
              localChange: "local",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("managed source workspace");
    expect(html).toContain("click Apply update again");
    expect(html).not.toMatch(/Build Studio/i);
  });

  it("renders the Engine-B-retired result as a Self-Upgrade pointer, not a failure (BI-5B6C1C35)", () => {
    const html = renderToStaticMarkup(
      <ApplyResult
        result={{
          kind: "engine-retired",
          message:
            "Applying updates by merging into /workspace is retired. Open Self-Upgrade.",
        }}
      />,
    );

    expect(html).toMatch(/Use Self-Upgrade/i);
    expect(html).toMatch(/retired/i);
    // Not framed as an apply failure.
    expect(html).not.toMatch(/Apply failed/i);
  });
});
