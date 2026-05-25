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
});
