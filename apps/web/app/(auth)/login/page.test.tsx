import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  signIn: vi.fn(),
}));

import LoginPage from "./page";

describe("LoginPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a forgot password link on the login page", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const html = renderToStaticMarkup(<LoginPage />);

    expect(html).toContain("Forgot password?");
    expect(html).toContain("/forgot-password");
  });
});
