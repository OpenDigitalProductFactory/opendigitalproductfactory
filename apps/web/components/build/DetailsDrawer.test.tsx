// @vitest-environment jsdom
//
// apps/web/components/build/DetailsDrawer.test.tsx
//
// Pins the DetailsDrawer contract:
//   - Slides in/out via translate-x, motion-reduce gating.
//   - role=region + aria-label + aria-hidden reflects open state.
//   - Sections render in given order; defaultOpen drives initial expansion.
//   - Accordion toggle flips aria-expanded.
//   - Esc closes when open; close button invokes onClose.
//   - BS-Queue subsection has the canonical test ID for integration.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DetailsDrawer, DetailsDrawerPill, type DetailsDrawerSection } from "./DetailsDrawer";
import { BUILD_STUDIO_TEST_IDS } from "./build-studio-layout";

afterEach(cleanup);

function sampleSections(): DetailsDrawerSection[] {
  return [
    { id: "progress", title: "Progress", content: <p data-testid="content-progress">progress body</p> },
    { id: "brief", title: "Brief / Design Doc", defaultOpen: true, content: <p data-testid="content-brief">brief body</p> },
    { id: "review", title: "Review", content: <p data-testid="content-review">review body</p> },
    { id: "sandbox", title: "Sandbox", content: <p data-testid="content-sandbox">sandbox body</p> },
    { id: "bs-queue", title: "BS Queue", content: <p data-testid="content-queue">queue body</p> },
  ];
}

describe("DetailsDrawer", () => {
  it("keeps the closed drawer out of keyboard navigation", () => {
    render(
      <DetailsDrawer
        isOpen={false}
        onClose={() => undefined}
        sections={[{ id: "proof", title: "Proof", content: <button type="button">Hidden action</button> }]}
      />,
    );

    expect(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer)).toHaveAttribute("inert");
  });

  it("renders role=region with aria-label='Build details'", () => {
    render(
      <DetailsDrawer isOpen onClose={vi.fn()} sections={sampleSections()} />,
    );
    const drawer = screen.getByRole("region", { name: "Build details" });
    expect(drawer).toHaveAttribute("data-open", "true");
  });

  it("aria-hidden=true and translate-x-full when closed", () => {
    render(
      <DetailsDrawer isOpen={false} onClose={vi.fn()} sections={sampleSections()} />,
    );
    const drawer = screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer);
    expect(drawer).toHaveAttribute("aria-hidden", "true");
    expect(drawer.className).toContain("translate-x-full");
  });

  it("translate-x-0 when open", () => {
    render(
      <DetailsDrawer isOpen onClose={vi.fn()} sections={sampleSections()} />,
    );
    const drawer = screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer);
    expect(drawer.className).toContain("translate-x-0");
  });

  it("motion-reduce class disables transitions for prefers-reduced-motion users", () => {
    render(
      <DetailsDrawer isOpen onClose={vi.fn()} sections={sampleSections()} />,
    );
    const drawer = screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawer);
    expect(drawer.className).toContain("motion-reduce:transition-none");
  });

  it("renders sections in given order", () => {
    render(
      <DetailsDrawer isOpen onClose={vi.fn()} sections={sampleSections()} />,
    );
    const sections = Array.from(document.querySelectorAll("[data-section-id]"));
    expect(sections.map((s) => s.getAttribute("data-section-id"))).toEqual([
      "progress",
      "brief",
      "review",
      "sandbox",
      "bs-queue",
    ]);
  });

  it("defaultOpen drives initial expansion (Brief expanded, others collapsed)", () => {
    render(
      <DetailsDrawer isOpen onClose={vi.fn()} sections={sampleSections()} />,
    );
    expect(screen.getByText("brief body")).toBeInTheDocument();
    expect(screen.queryByText("progress body")).not.toBeInTheDocument();
    expect(screen.queryByText("review body")).not.toBeInTheDocument();
  });

  it("clicking a collapsed section header expands it (aria-expanded flips, body renders)", () => {
    render(
      <DetailsDrawer isOpen onClose={vi.fn()} sections={sampleSections()} />,
    );
    const progressHeader = screen.getByRole("button", { name: "Progress" });
    expect(progressHeader).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(progressHeader);
    expect(progressHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("progress body")).toBeInTheDocument();
  });

  it("clicking an expanded section header collapses it", () => {
    render(
      <DetailsDrawer isOpen onClose={vi.fn()} sections={sampleSections()} />,
    );
    const briefHeader = screen.getByRole("button", { name: "Brief / Design Doc" });
    expect(briefHeader).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(briefHeader);
    expect(briefHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("brief body")).not.toBeInTheDocument();
  });

  it("the BS-queue section uses the canonical detailsDrawerQueue test ID for integration", () => {
    render(
      <DetailsDrawer isOpen onClose={vi.fn()} sections={sampleSections()} />,
    );
    expect(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawerQueue)).toBeInTheDocument();
  });

  it("Esc closes the drawer when open", () => {
    const onClose = vi.fn();
    render(
      <DetailsDrawer isOpen onClose={onClose} sections={sampleSections()} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc does NOT trigger onClose when drawer is closed", () => {
    const onClose = vi.fn();
    render(
      <DetailsDrawer isOpen={false} onClose={onClose} sections={sampleSections()} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("close button invokes onClose", () => {
    const onClose = vi.fn();
    render(
      <DetailsDrawer isOpen onClose={onClose} sections={sampleSections()} />,
    );
    fireEvent.click(screen.getByLabelText("Close details drawer"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the expanded section and restores the invoking control on close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Review outcome";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <DetailsDrawer isOpen onClose={vi.fn()} sections={sampleSections()} />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Brief / Design Doc" })).toHaveFocus();
    });

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("uses the supplied fallback when the invoking control is removed before close", async () => {
    const trigger = document.createElement("button");
    const fallback = document.createElement("button");
    document.body.append(trigger, fallback);
    trigger.focus();

    const { unmount } = render(
      <DetailsDrawer
        isOpen
        onClose={vi.fn()}
        sections={sampleSections()}
        fallbackFocusRef={{ current: fallback }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Brief / Design Doc" })).toHaveFocus();
    });

    trigger.remove();
    unmount();
    expect(fallback).toHaveFocus();
    fallback.remove();
  });

  it("renders an empty-state placeholder when sections is empty", () => {
    render(
      <DetailsDrawer isOpen onClose={vi.fn()} sections={[]} />,
    );
    expect(screen.getByText(/No details for this build\./i)).toBeInTheDocument();
  });

  it("re-seeds expansion when sections change (different defaultOpen)", () => {
    const initial = sampleSections();
    const { rerender } = render(
      <DetailsDrawer isOpen onClose={vi.fn()} sections={initial} />,
    );
    expect(screen.getByText("brief body")).toBeInTheDocument();

    const updated: DetailsDrawerSection[] = initial.map((s) => ({
      ...s,
      defaultOpen: s.id === "review",
    }));
    rerender(<DetailsDrawer isOpen onClose={vi.fn()} sections={updated} />);
    expect(screen.queryByText("brief body")).not.toBeInTheDocument();
    expect(screen.getByText("review body")).toBeInTheDocument();
  });
});

describe("DetailsDrawerPill", () => {
  it("renders with the canonical test ID + aria-expanded reflecting state", () => {
    const { rerender } = render(<DetailsDrawerPill isOpen={false} onClick={vi.fn()} />);
    const pill = screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawerPill);
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(pill).toHaveAttribute("aria-label", "Open build details drawer");

    rerender(<DetailsDrawerPill isOpen onClick={vi.fn()} />);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(pill).toHaveAttribute("aria-label", "Close build details drawer");
  });

  it("click invokes onClick", () => {
    const onClick = vi.fn();
    render(<DetailsDrawerPill isOpen={false} onClick={onClick} />);
    fireEvent.click(screen.getByTestId(BUILD_STUDIO_TEST_IDS.detailsDrawerPill));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
