// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
// BI-7626A660 — the installation badge in the shell header.
//
// The founder's requirement was "a few word indicator on the top line next to
// the logo for all non-production instances", and the safety property behind it
// is that production is the UNMARKED default. These tests pin both.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/docs/ContextualDocsButton", () => ({
  ContextualDocsButton: () => null,
}));
vi.mock("@/components/feedback/HeaderFeedbackButton", () => ({
  HeaderFeedbackButton: () => null,
}));
vi.mock("@/components/monitoring/PlatformHealthIndicator", () => ({
  PlatformHealthIndicator: () => null,
}));
vi.mock("@/components/shell/ShellSignOut", () => ({ ShellSignOut: () => null }));

import { Header } from "./Header";

afterEach(() => { cleanup(); });

const base = {
  platformRole: "HR-000",
  brandName: "Second Chance Animal Rescue",
  brandLogoUrl: null,
  userId: "u1",
} as const;

describe("installation badge", () => {
  it("renders the estate and role on a development installation", () => {
    render(<Header {...base} installationBadge="NORTHWIND DEV" />);
    expect(screen.getByTestId("installation-badge")).toHaveTextContent("NORTHWIND DEV");
  });

  it("renders nothing at all when the badge is null, which is what production passes", () => {
    render(<Header {...base} installationBadge={null} />);
    expect(screen.queryByTestId("installation-badge")).not.toBeInTheDocument();
  });

  it("renders nothing when no badge prop is supplied, so an un-updated caller cannot mislabel a box", () => {
    render(<Header {...base} />);
    expect(screen.queryByTestId("installation-badge")).not.toBeInTheDocument();
  });

  it("links to the installation detail page rather than to the workspace", () => {
    render(<Header {...base} installationBadge="NORTHWIND DEV" />);
    expect(screen.getByTestId("installation-badge")).toHaveAttribute(
      "href",
      "/ops/installation",
    );
  });

  it("is NOT nested inside the brand link, because an anchor in an anchor is invalid", () => {
    const { container } = render(<Header {...base} installationBadge="NORTHWIND DEV" />);
    const badge = screen.getByTestId("installation-badge");
    const brandLink = container.querySelector('a[href="/workspace"]');
    expect(brandLink).not.toBeNull();
    expect(brandLink?.contains(badge)).toBe(false);
  });

  // Simple mode sheds builder chrome — the "Internal cockpit" pill and the
  // specialist-team tagline. The badge is not builder chrome: which installation
  // you are on is the one fact that stops an operator acting on the wrong box.
  it("survives Simple mode, unlike the builder chrome beside it", () => {
    render(<Header {...base} navMode="worker" installationBadge="NORTHWIND DEV" />);
    expect(screen.getByTestId("installation-badge")).toBeInTheDocument();
    expect(screen.queryByText("Internal cockpit")).not.toBeInTheDocument();
  });

  it("shows a role-only badge when nobody has named the installation", () => {
    render(<Header {...base} installationBadge="DEV" />);
    expect(screen.getByTestId("installation-badge")).toHaveTextContent("DEV");
  });

  it("uses theme tokens rather than hardcoded colors", () => {
    render(<Header {...base} installationBadge="NORTHWIND DEV" />);
    const className = screen.getByTestId("installation-badge").className;
    expect(className).toContain("var(--dpf-warning)");
    expect(className).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(className).not.toMatch(/\b(text|bg|border)-(white|black|gray-\d+)\b/);
  });
});
