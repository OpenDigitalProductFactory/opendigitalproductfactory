// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMobilePanelModal } from "./use-mobile-panel-modal";

afterEach(cleanup);

function Harness({
  isMobile = true,
  onClose = vi.fn(),
}: {
  isMobile?: boolean;
  onClose?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useMobilePanelModal({
    isOpen: true,
    isMobile,
    panelRef,
    onClose,
  });

  return (
    <>
      <main data-testid="background">
        <button type="button">Background action</button>
      </main>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="AI coworker panel"
        tabIndex={-1}
      >
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </div>
    </>
  );
}

describe("useMobilePanelModal", () => {
  it("closes on Escape and keeps background content inert", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Harness onClose={onClose} />);
    const background = screen.getByTestId("background");

    expect(background).toHaveAttribute("inert");
    expect(background).toHaveAttribute("aria-hidden", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(background).not.toHaveAttribute("inert");
    expect(background).not.toHaveAttribute("aria-hidden");
  });

  it("wraps backward focus from the dialog container", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog", {
      name: "AI coworker panel",
    });
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Last action" })).toHaveFocus();
  });

  it("does not make the desktop panel modal", () => {
    render(<Harness isMobile={false} />);
    expect(screen.getByTestId("background")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
  });
});
