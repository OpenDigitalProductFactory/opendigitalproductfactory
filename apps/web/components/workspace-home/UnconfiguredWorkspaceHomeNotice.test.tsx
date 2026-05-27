import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { UnconfiguredWorkspaceHomeNotice } from "./UnconfiguredWorkspaceHomeNotice";

describe("UnconfiguredWorkspaceHomeNotice", () => {
  it("renders honest worker-home setup copy without architecture language", () => {
    const html = renderToStaticMarkup(<UnconfiguredWorkspaceHomeNotice />);

    expect(html).toContain("Workspace home is using the standard view");
    expect(html).toContain("Review business setup");
    expect(html).not.toMatch(/gear|architecture|contribution|specialist|platform layer|business layer|market vertical/i);
  });

  it("uses DPF theme tokens instead of hardcoded neutral color classes", () => {
    const html = renderToStaticMarkup(<UnconfiguredWorkspaceHomeNotice />);

    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/text-gray-|bg-gray-|border-gray-|text-white|text-black|bg-white|#[0-9a-fA-F]{3,6}/);
  });
});
