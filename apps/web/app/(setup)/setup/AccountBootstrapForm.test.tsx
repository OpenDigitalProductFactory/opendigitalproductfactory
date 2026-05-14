import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AccountBootstrapForm } from "./AccountBootstrapForm";

vi.mock("@/lib/actions/first-run-account-bootstrap", () => ({
  bootstrapFirstRunOwner: vi.fn(),
}));

vi.mock("./AccountBootstrapSubmitButton", () => ({
  AccountBootstrapSubmitButton: () => <button type="submit">Get Started</button>,
}));

describe("AccountBootstrapForm", () => {
  it("renders a native first-run bootstrap form with named required fields", () => {
    const html = renderToStaticMarkup(<AccountBootstrapForm setupId="setup-1" />);

    expect(html).toContain("Welcome to your platform");
    expect(html).toContain('name="organizationName"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('required=""');
    expect(html).toContain('minLength="8"');
    expect(html).toContain("Get Started");
  });
});
