import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/users", () => ({
  requestPasswordReset: vi.fn(),
}));
vi.mock("@/components/auth/ForgotPasswordForm", () => ({
  ForgotPasswordForm: () => (
    <form>
      <input name="email" type="email" />
      <p>If an account exists, check your email.</p>
    </form>
  ),
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
