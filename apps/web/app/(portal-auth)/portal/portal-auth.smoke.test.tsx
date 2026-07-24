// @vitest-environment jsdom
//
// Route-composition smoke coverage for the customer portal auth entry
// points (BI-C764BE03). Live usability testing found the visible
// "Create an account" link on /portal/sign-in pointing at /portal/sign-up,
// which 404'd — and the same for the legacy /customer-signup redirect
// target. This asserts the full navigation actually lands on a working
// page, not just that a component renders in isolation.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

class RedirectError extends Error {
  url: string;
  constructor(url: string) {
    super("NEXT_REDIRECT");
    this.url = url;
  }
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("next/link", () => ({
  // Forward href like the real Link so hrefs are assertable.
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const resolveOrgSlug = vi.fn();
const getPublicStorefront = vi.fn();
vi.mock("@/lib/storefront-data", () => ({
  resolveOrgSlug: (...a: unknown[]) => resolveOrgSlug(...a),
  getPublicStorefront: (...a: unknown[]) => getPublicStorefront(...a),
}));
vi.mock("@/lib/storefront/public-trust", () => ({
  resolveTrustProfile: () => null,
}));
// The storefront sign-up form itself is owned/tested elsewhere
// (components/storefront/SignUpForm.test.tsx) — stub it here so this test
// asserts route composition, not form internals.
vi.mock("@/components/storefront/SignUpForm", () => ({
  SignUpForm: ({ orgSlug }: { orgSlug: string }) => <form data-test="signup" data-org={orgSlug} />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderServer(el: Promise<React.ReactElement>) {
  return renderToStaticMarkup(await el);
}

describe("customer sign-in -> create-account navigation (BI-C764BE03)", () => {
  it("points Create an account straight at the working storefront sign-up flow, not the dead /portal/sign-up hop", async () => {
    resolveOrgSlug.mockResolvedValue("copper-kettle");
    const SignInPage = (await import("./sign-in/page")).default;
    render(await SignInPage());

    const link = screen.getByRole("link", { name: /create an account/i });
    expect(link).toHaveAttribute("href", "/s/copper-kettle/sign-up");
    expect(link.getAttribute("href")).not.toBe("/portal/sign-up");
  });

  it("the Create an account href actually renders a working page (not the platform 404)", async () => {
    resolveOrgSlug.mockResolvedValue("copper-kettle");
    getPublicStorefront.mockResolvedValue({ orgName: "The Copper Kettle", archetypeCategory: "food-hospitality" });

    const SignInPage = (await import("./sign-in/page")).default;
    render(await SignInPage());
    const href = screen.getByRole("link", { name: /create an account/i }).getAttribute("href")!;

    const slug = href.match(/^\/s\/([^/]+)\/sign-up$/)?.[1];
    expect(slug).toBe("copper-kettle");

    const StorefrontSignUpPage = (await import("@/app/(storefront)/s/[slug]/sign-up/page")).default;
    const html = await renderServer(
      StorefrontSignUpPage({
        params: Promise.resolve({ slug: slug! }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain('data-test="signup"');
    expect(html).not.toMatch(/could not be found/i);
  });
});

describe("generic /portal/sign-up entry point (welcome link + legacy /customer-signup 301 target)", () => {
  it("forwards to the storefront-scoped sign-up flow when the install's org is known", async () => {
    resolveOrgSlug.mockResolvedValue("copper-kettle");
    const SignUpPage = (await import("./sign-up/page")).default;

    let redirectUrl: string | null = null;
    try {
      await SignUpPage();
    } catch (err) {
      if (err instanceof RedirectError) redirectUrl = err.url;
      else throw err;
    }
    expect(redirectUrl).toBe("/s/copper-kettle/sign-up");
  });

  it("shows a customer-safe message instead of a dead end when no org is configured yet", async () => {
    resolveOrgSlug.mockResolvedValue(null);
    const SignUpPage = (await import("./sign-up/page")).default;

    const html = await renderServer(SignUpPage());
    expect(html).not.toMatch(/could not be found/i);
    expect(html).toContain("Back to sign in");
  });
});
