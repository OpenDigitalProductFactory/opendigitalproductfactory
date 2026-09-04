// @vitest-environment jsdom
//
// Common Shell Action-Result Contract (BI-9C0954D0) — action-result smoke.
// Exercises the shared shell chrome across the seven owner routes named in the
// BI (/workspace, /storefront, /finance, /customer/marketing, /employee,
// /admin, /ops/self-upgrade) and asserts the contract:
//   C1 unique accessible target per region (contextual "Help for this page" ≠ global "All docs")
//   C2 label matches result   C3 visible result after click
//   C5 ≥44px tap targets       C6 task-before-chrome delta in Simple mode
// See docs/superpowers/specs/2026-07-22-shell-action-result-contract-design.md.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/workspace";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    ["aria-label"]: ariaLabel,
    title,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "aria-label"?: string;
    title?: string;
  }) => (
    <a href={href} className={className} aria-label={ariaLabel} title={title}>
      {children}
    </a>
  ),
}));

// Sign out is a server action; the smoke only cares about the rendered control.
vi.mock("@/lib/actions", () => ({ signOutAction: vi.fn() }));

// Health badge must render without a live fetch.
vi.mock("@/components/monitoring/useAlertQuery", () => ({
  useAlertQuery: () => ({ alerts: [], loading: false, offline: true }),
}));

// The feedback surface is asserted by its label/role, not its internals.
vi.mock("@/components/feedback/FeedbackForm", () => ({
  FeedbackForm: () => <div data-testid="feedback-form-body">form</div>,
}));

import { Header } from "@/components/shell/Header";
import { AppRail } from "@/components/shell/AppRail";
import { PORTAL_NAV_ROUTES } from "@/lib/navigation/portal-navigation-model";
import type { ShellNavSection } from "@/lib/permissions";
import {
  CONTEXTUAL_DOCS_LABEL,
  GLOBAL_DOCS_LABEL,
  SHELL_TAP_TARGET_CLASS,
  navModeExplanation,
} from "@/lib/shell/shell-action-contract";

const OWNER_ROUTES = [
  "/workspace",
  "/storefront",
  "/finance",
  "/customer/marketing",
  "/employee",
  "/admin",
  "/ops/self-upgrade",
] as const;

function renderHeader(navMode: "worker" | "operator" = "operator") {
  return render(
    <Header
      platformRole="OWNER"
      brandName="Acme"
      brandLogoUrl={null}
      brandLogoUrlLight={null}
      userId="user-1"
      navMode={navMode}
    />,
  );
}

const sections: ShellNavSection[] = [
  {
    key: "workspace",
    label: "Workspace",
    description: "Your queue.",
    items: [
      {
        key: "workspace",
        label: "Workspace",
        href: "/workspace",
        description: "See what needs attention.",
        sectionKey: "workspace",
        capabilityKey: null,
        orgCapabilityKey: null,
        audienceModes: ["worker", "operator"],
      },
    ],
  },
];

afterEach(() => cleanup());

describe("shell action-result contract", () => {
  describe.each(OWNER_ROUTES)("route %s", (route) => {
    it("names contextual help distinctly from the global docs catalog (C1/C2/C4)", () => {
      pathname = route;
      renderHeader();

      const help = screen.getByRole("link", { name: CONTEXTUAL_DOCS_LABEL });
      expect(help).toHaveAccessibleName(CONTEXTUAL_DOCS_LABEL);
      expect(help).not.toHaveAccessibleName(GLOBAL_DOCS_LABEL);
      // Route-scoped target (C4): a contextual help href carrying this route.
      const href = help.getAttribute("href") ?? "";
      expect(href).toContain("sourceRoute");
      expect(href).toContain(encodeURIComponent(route));
    });

    it("exposes the shell actions as ≥44px tap targets (C5)", () => {
      pathname = route;
      renderHeader();

      expect(screen.getByRole("link", { name: CONTEXTUAL_DOCS_LABEL })).toHaveClass(
        SHELL_TAP_TARGET_CLASS,
      );
      expect(screen.getByRole("button", { name: /^feedback$/i })).toHaveClass(
        SHELL_TAP_TARGET_CLASS,
      );
      expect(screen.getByRole("button", { name: /sign out/i })).toHaveClass(
        SHELL_TAP_TARGET_CLASS,
      );
      expect(screen.getByRole("button", { name: /platform health/i })).toHaveClass(
        SHELL_TAP_TARGET_CLASS,
      );
    });

    it("opens a feedback-labeled surface on Feedback click (C2/C3)", () => {
      pathname = route;
      renderHeader();

      const trigger = screen.getByRole("button", { name: /^feedback$/i });
      expect(trigger).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(trigger);

      const dialog = screen.getByRole("dialog", { name: "Send feedback" });
      expect(within(dialog).getByText(/send feedback/i)).toBeVisible();
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });
  });

  it("recedes builder chrome in Simple mode but restores it in Full (C6)", () => {
    pathname = "/workspace";

    const { unmount } = renderHeader("operator");
    expect(screen.getByText("Internal cockpit")).toBeInTheDocument();
    unmount();

    renderHeader("worker");
    expect(screen.queryByText("Internal cockpit")).not.toBeInTheDocument();
  });

  it("keeps the global docs catalog label distinct from contextual help (C1)", () => {
    const docsEntry = PORTAL_NAV_ROUTES.find((r) => r.key === "docs");
    expect(docsEntry?.label).toBe(GLOBAL_DOCS_LABEL);
    expect(GLOBAL_DOCS_LABEL).not.toBe(CONTEXTUAL_DOCS_LABEL);
  });

  describe("Simple/Full toggle explains the mode and gives visible feedback (C2/C3/C5)", () => {
    it("renders a mode-specific explanation and a live region", () => {
      pathname = "/workspace";

      const { unmount } = render(<AppRail sections={sections} mode="worker" />);
      expect(screen.getByText(navModeExplanation("worker"))).toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
      // Both toggles are tap-safe and name their outcome.
      expect(screen.getByRole("button", { name: "Switch to Simple view" })).toHaveClass(
        SHELL_TAP_TARGET_CLASS,
      );
      expect(screen.getByRole("button", { name: "Switch to Full view" })).toHaveClass(
        SHELL_TAP_TARGET_CLASS,
      );
      unmount();

      render(<AppRail sections={sections} mode="operator" />);
      expect(screen.getByText(navModeExplanation("operator"))).toBeInTheDocument();
      // The explanation genuinely differs between modes.
      expect(navModeExplanation("worker")).not.toBe(navModeExplanation("operator"));
    });
  });
});

// A kennel technician does morning rounds at 768x1024. The mode toggle and its
// explanation lived inside #primary-navigation-menu, which is `hidden` below
// `lg`, so at tablet width the buttons measured 0x0 with a null offsetParent
// and the explanation vanished — locking the one worker Simple mode exists for
// into Full mode, looking at Build Studio while feeding a dog (BI-6395DA89).
describe("the mode control is reachable at tablet width", () => {
  it("does not sit inside the collapsible navigation menu", () => {
    const { container } = render(<AppRail sections={sections} mode="worker" />);

    const menu = container.querySelector("#primary-navigation-menu");
    expect(menu).not.toBeNull();

    for (const name of ["Switch to Simple view", "Switch to Full view"]) {
      const button = screen.getByRole("button", { name });
      expect(
        menu!.contains(button),
        `${name} is inside the menu that is hidden below lg`,
      ).toBe(false);
    }
  });

  it("keeps the mode explanation outside that menu too", () => {
    const { container } = render(<AppRail sections={sections} mode="worker" />);

    const menu = container.querySelector("#primary-navigation-menu")!;
    const explanation = screen.getByText(navModeExplanation("worker"));
    expect(menu.contains(explanation)).toBe(false);
  });

  it("still collapses the navigation destinations themselves", () => {
    const { container } = render(<AppRail sections={sections} mode="operator" />);

    // The menu must keep its responsive collapse — only the mode control moved.
    const menu = container.querySelector("#primary-navigation-menu")!;
    expect(menu.className).toContain("hidden");
    expect(menu.className).toContain("lg:flex");
    expect(menu.querySelectorAll("a").length).toBeGreaterThan(0);
  });
});
