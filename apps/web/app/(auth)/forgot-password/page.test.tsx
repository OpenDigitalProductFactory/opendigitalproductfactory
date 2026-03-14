import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/users", () => ({
  requestPasswordReset: vi.fn(),
}));

import ForgotPasswordPage from "./page";

describe("ForgotPasswordPage", () => {
  it("renders the forgot-password email form", () => {
    const html = renderToStaticMarkup(<ForgotPasswordPage />);

    expect(html).toContain("Forgot password");
    expect(html).toContain('type="email"');
    expect(html).toContain("If an account exists");
  });
});
