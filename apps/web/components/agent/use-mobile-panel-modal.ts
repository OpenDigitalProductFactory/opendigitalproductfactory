import { useEffect, type RefObject } from "react";

type MobilePanelModalOptions = {
  isOpen: boolean;
  isMobile: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
};

export function useMobilePanelModal({
  isOpen,
  isMobile,
  panelRef,
  onClose,
}: MobilePanelModalOptions) {
  useEffect(() => {
    if (!isOpen || !isMobile) return;
    const panel = panelRef.current;
    if (!panel) return;

    const background = [...(panel.parentElement?.children ?? [])].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== panel,
    );
    const previousBackgroundState = background.map((element) => ({
      element,
      inert: element.inert,
      inertAttribute: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    for (const element of background) {
      element.inert = true;
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleModalKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel ||
          !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleModalKeyDown);
    panel.focus();
    return () => {
      document.removeEventListener("keydown", handleModalKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      for (const state of previousBackgroundState) {
        state.element.inert = state.inert;
        if (state.inertAttribute) {
          state.element.setAttribute("inert", "");
        } else {
          state.element.removeAttribute("inert");
        }
        if (state.ariaHidden === null) {
          state.element.removeAttribute("aria-hidden");
        } else {
          state.element.setAttribute("aria-hidden", state.ariaHidden);
        }
      }
    };
  }, [isMobile, isOpen, onClose, panelRef]);
}
