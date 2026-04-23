import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/users", () => ({
  completePasswordReset: vi.fn(),
}));
vi.mock("@/components/auth/ResetPasswordForm", () => ({
  ResetPasswordForm: ({ token }: { token: string }) => (
    <form>
      <input name="newPassword" />
      <input name="confirmPassword" />
      <input type="hidden" value={token} />
    </form>
  ),
}));

import ResetPasswordPage from "./page";

describe("ResetPasswordPage", () => {
  it("renders token-bound password fields", () => {
    const html = renderToStaticMarkup(
      <ResetPasswordPage searchParams={{ token: "token-123" }} />,
    );

    expect(html).toContain("Reset password");
    expect(html).toContain('name="newPassword"');
    expect(html).toContain('name="confirmPassword"');
    expect(html).toContain('value="token-123"');
  });
});
