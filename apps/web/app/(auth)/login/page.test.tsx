import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  signIn: vi.fn(),
}));
const quiescence = { level: "normal", runId: null as string | null, enteredAt: "2026-01-01T00:00:00.000Z" };
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceConfig: vi.fn(async () => quiescence),
}));
vi.mock("@/components/auth/UpgradeHold", () => ({
  UpgradeHold: ({ runId }: { runId?: string | null }) => <div role="status">upgrade hold {runId}</div>,
}));
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {
    type = "CredentialsSignin";
  },
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

  it("shows the upgrade hold instead of the form while the platform is quiescing (BI-57D91FF0)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    quiescence.level = "draining";
    quiescence.runId = "QR-2026-09-18-xq990684";
    try {
      const element = await LoginPage({ searchParams: Promise.resolve({}) });
      const html = renderToStaticMarkup(element);
      expect(html).toContain("upgrade hold QR-2026-09-18-xq990684");
      expect(html).not.toContain("Forgot password?");
      expect(html).not.toContain("Sign in");
    } finally {
      quiescence.level = "normal";
      quiescence.runId = null;
    }
  });
});
