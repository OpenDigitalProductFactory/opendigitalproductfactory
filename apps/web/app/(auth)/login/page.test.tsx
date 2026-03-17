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

  it("shows a forgot password link on the login page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    // LoginPage is an async server component; await it to get the JSX tree
    const element = await LoginPage({ searchParams: Promise.resolve({}) });

    const html = renderToStaticMarkup(element);

    expect(html).toContain("Forgot password?");
    expect(html).toContain("/forgot-password");
  });
});
