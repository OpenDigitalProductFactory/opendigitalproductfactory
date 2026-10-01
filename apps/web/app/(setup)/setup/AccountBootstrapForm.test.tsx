import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AccountBootstrapForm } from "./AccountBootstrapForm";

vi.mock("@/lib/i18n/t.server", async () => {
  const { translate } = await import("@dpf/i18n");
  return {
    getT: async (namespace: "setup") => (key: string) => translate("en-US", namespace, key as never),
  };
});

vi.mock("@/lib/actions/first-run-account-bootstrap", () => ({
  bootstrapFirstRunOwner: vi.fn(),
}));

vi.mock("./AccountBootstrapSubmitButton", () => ({
  AccountBootstrapSubmitButton: () => <button type="submit">Get Started</button>,
}));

describe("AccountBootstrapForm", () => {
  it("renders a native first-run bootstrap form with named required fields", async () => {
    const html = renderToStaticMarkup(await AccountBootstrapForm({ setupId: "setup-1" }));

    expect(html).toContain("Welcome to your platform");
    expect(html).toContain('name="organizationName"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('required=""');
    expect(html).toContain('minLength="8"');
    expect(html).toContain("Get Started");
    expect(html).toContain("You&#x27;ll be the organization&#x27;s accountable owner (change it in Admin › Settings).");
  });
});
