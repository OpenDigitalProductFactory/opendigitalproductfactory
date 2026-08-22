import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/teardown", () => ({
  listInstallationTeardownEvidence: vi.fn(async () => []),
  previewInstallationTeardown: vi.fn(),
  executeInstallationTeardown: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/ops/teardown" }));

import TeardownPage from "./page";

describe("installation teardown page", () => {
  it("is an operator lifecycle surface with plain-language safety context", async () => {
    const html = renderToStaticMarkup(await TeardownPage());
    expect(html).toContain("Installation lifecycle");
    expect(html).toContain("Governed teardown");
    expect(html).toContain("data-dpf-lead");
    expect(html).toContain("Recovery evidence remains outside the deletion boundary");
    expect(html).toContain('href="/ops/teardown"');
  });
});
